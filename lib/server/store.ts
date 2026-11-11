// Where prompt counts and grants live: Cloudflare D1 in deployments (over its HTTP
// API, schema in migrations/0001_init.sql), memory only in local development without
// D1 credentials. Every check-and-update is one SQL statement, so concurrent requests
// cannot both spend the last prompt or both slip past a grant's cap.

export type GrantUse = "ok" | "missing" | "wrong_user" | "exhausted";

export interface QuotaStore {
  /** Prompts left; `initial` when the user has never sent one. */
  remaining(userId: string, initial: number): Promise<number>;
  /** Spend one prompt and create grant `grantId` for it, or return null at zero. Returns what is left. */
  consume(userId: string, initial: number, grantId: string, ttlSeconds: number, maxRequests: number): Promise<number | null>;
  /** Count one model request against a grant. */
  useGrant(grantId: string, userId: string): Promise<GrantUse>;
  /** Fixed-window rate limit. True when this hit is allowed. */
  hit(key: string, limit: number, windowSeconds: number): Promise<boolean>;
}

export interface Statement {
  sql: string;
  params: (string | number)[];
}

/** Runs statements in order, as one batch, and returns each statement's rows. */
export type SqlExecutor = (statements: Statement[]) => Promise<Record<string, unknown>[][]>;

// The SQL, shared by D1 and the tests (which run it on node:sqlite). Numbers are
// CAST because D1's HTTP API passes parameters as strings.
export const SQL = {
  ensureQuota:
    "INSERT INTO quota (user_id, remaining, created_at, updated_at) VALUES (?1, CAST(?2 AS INTEGER), CAST(?3 AS INTEGER), CAST(?3 AS INTEGER)) ON CONFLICT (user_id) DO NOTHING",
  // Creates the grant only while a prompt is left; the grants_spend_prompt trigger
  // decrements the quota inside this same statement.
  createGrant:
    "INSERT INTO grants (id, user_id, expires_at, requests, max_requests, created_at) " +
    "SELECT ?1, ?2, CAST(?3 AS INTEGER), 0, CAST(?4 AS INTEGER), CAST(?5 AS INTEGER) FROM quota WHERE user_id = ?2 AND remaining > 0 RETURNING id",
  remaining: "SELECT remaining FROM quota WHERE user_id = ?1",
  useGrant:
    "UPDATE grants SET requests = requests + 1 WHERE id = ?1 AND user_id = ?2 AND expires_at > CAST(?3 AS INTEGER) AND requests < max_requests RETURNING requests",
  /** Read only, after a refused useGrant, to say why. */
  grant: "SELECT user_id, expires_at, requests, max_requests FROM grants WHERE id = ?1",
  hit:
    "INSERT INTO rate_limits (key, window_start, count) VALUES (?1, CAST(?2 AS INTEGER), 1) " +
    "ON CONFLICT (key) DO UPDATE SET count = CASE WHEN rate_limits.window_start = excluded.window_start THEN rate_limits.count + 1 ELSE 1 END, " +
    "window_start = excluded.window_start RETURNING count",
};

export class SqlQuotaStore implements QuotaStore {
  private readonly exec: SqlExecutor;
  private readonly now: () => number;

  constructor(exec: SqlExecutor, now: () => number = Date.now) {
    this.exec = exec;
    this.now = now;
  }

  async remaining(userId: string, initial: number): Promise<number> {
    const [rows] = await this.exec([{ sql: SQL.remaining, params: [userId] }]);
    return rows[0] ? Number(rows[0].remaining) : initial;
  }

  async consume(userId: string, initial: number, grantId: string, ttlSeconds: number, maxRequests: number): Promise<number | null> {
    const now = this.now();
    const [, created, left] = await this.exec([
      { sql: SQL.ensureQuota, params: [userId, initial, now] },
      { sql: SQL.createGrant, params: [grantId, userId, now + ttlSeconds * 1000, maxRequests, now] },
      { sql: SQL.remaining, params: [userId] },
    ]);
    if (!created.length) return null;
    return Number(left[0]?.remaining ?? 0);
  }

  async useGrant(grantId: string, userId: string): Promise<GrantUse> {
    const now = this.now();
    const [used] = await this.exec([{ sql: SQL.useGrant, params: [grantId, userId, now] }]);
    if (used.length) return "ok";
    const [rows] = await this.exec([{ sql: SQL.grant, params: [grantId] }]);
    const grant = rows[0];
    if (!grant || Number(grant.expires_at) <= now) return "missing";
    if (grant.user_id !== userId) return "wrong_user";
    return "exhausted";
  }

  async hit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
    const window = Math.floor(this.now() / (windowSeconds * 1000));
    const [rows] = await this.exec([{ sql: SQL.hit, params: [key, window] }]);
    return Number(rows[0]?.count ?? Infinity) <= limit;
  }
}

const D1_TIMEOUT_MS = 4_000;

export class D1Error extends Error {}

/**
 * Cloudflare D1's HTTP API: POST .../d1/database/{id}/query with { batch: [{ sql, params }] }.
 * The token never appears in an error or a log line; a slow or failed call throws (fail closed).
 */
export function d1Executor({ accountId, databaseId, token, fetcher = fetch }: {
  accountId: string; databaseId: string; token: string; fetcher?: typeof fetch;
}): SqlExecutor {
  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/d1/database/${encodeURIComponent(databaseId)}/query`;
  return async (statements) => {
    let response: Response;
    try {
      response = await fetcher(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ batch: statements.map(({ sql, params }) => ({ sql, params: params.map(String) })) }),
        cache: "no-store",
        signal: AbortSignal.timeout(D1_TIMEOUT_MS),
      });
    } catch (error) {
      throw new D1Error(`D1 request failed: ${error instanceof Error ? error.name : "error"}`);
    }
    const body = await response.json().catch(() => null) as {
      success?: boolean; errors?: { code?: number; message?: string }[]; result?: { results?: Record<string, unknown>[]; success?: boolean }[];
    } | null;
    if (!response.ok || !body?.success || !Array.isArray(body.result) || body.result.length !== statements.length || body.result.some((item) => item.success === false)) {
      const reason = body?.errors?.map((error) => `${error.code ?? ""} ${error.message ?? ""}`.trim()).join("; ") || `HTTP ${response.status}`;
      throw new D1Error(`D1 query failed: ${reason.slice(0, 200)}`);
    }
    return body.result.map((item) => item.results ?? []);
  };
}

/** For local development and tests. `now` is injectable so tests can move time. */
export class MemoryQuotaStore implements QuotaStore {
  private readonly prompts = new Map<string, number>();
  private readonly grants = new Map<string, { user: string; requests: number; max: number; expiresAt: number }>();
  private readonly windows = new Map<string, { count: number; window: number }>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  async remaining(userId: string, initial: number): Promise<number> {
    return this.prompts.get(userId) ?? initial;
  }

  async consume(userId: string, initial: number, grantId: string, ttlSeconds: number, maxRequests: number): Promise<number | null> {
    const left = this.prompts.get(userId) ?? initial;
    if (left <= 0) return null;
    this.prompts.set(userId, left - 1);
    this.grants.set(grantId, { user: userId, requests: 0, max: maxRequests, expiresAt: this.now() + ttlSeconds * 1000 });
    return left - 1;
  }

  async useGrant(grantId: string, userId: string): Promise<GrantUse> {
    const grant = this.grants.get(grantId);
    if (!grant || grant.expiresAt <= this.now()) return "missing";
    if (grant.user !== userId) return "wrong_user";
    if (grant.requests >= grant.max) return "exhausted";
    grant.requests += 1;
    return "ok";
  }

  async hit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
    const window = Math.floor(this.now() / (windowSeconds * 1000));
    const current = this.windows.get(key);
    const count = current && current.window === window ? current.count + 1 : 1;
    this.windows.set(key, { count, window });
    return count <= limit;
  }
}

export class StoreUnavailableError extends Error {}

let shared: QuotaStore | undefined;

/**
 * Cloudflare D1 when CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_D1_DATABASE_ID and
 * CLOUDFLARE_D1_TOKEN are set. Without them, memory, but only in development;
 * anywhere else the routes answer 503.
 */
export function quotaStore(): QuotaStore {
  if (shared) return shared;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID?.trim();
  const token = process.env.CLOUDFLARE_D1_TOKEN?.trim();
  if (accountId && databaseId && token) return (shared = new SqlQuotaStore(d1Executor({ accountId, databaseId, token })));
  if (process.env.NODE_ENV === "development") {
    console.warn("[tinyagent-design] CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_D1_DATABASE_ID / CLOUDFLARE_D1_TOKEN are not set: " +
      "prompt counts and grants are kept in memory for local development only. They reset when the dev server restarts.");
    return (shared = new MemoryQuotaStore());
  }
  throw new StoreUnavailableError("Cloudflare D1 is not configured (CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_D1_DATABASE_ID, CLOUDFLARE_D1_TOKEN)");
}
