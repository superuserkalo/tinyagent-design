// The database behind quotas and chats. Production: Cloudflare D1 over its HTTP API.
// `next dev` without TINYAGENT_DEV_DB=d1: a local SQLite file (.data/dev.sqlite) with
// the same migrations and SQL, so development never writes to the production database.
import { SessionStore } from "./sessions.ts";
import { SqlQuotaStore, StoreUnavailableError, d1Executor, type QuotaStore, type SqlExecutor } from "./store.ts";

let executor: Promise<SqlExecutor> | undefined;

async function localExecutor(): Promise<SqlExecutor> {
  const [{ DatabaseSync }, { mkdirSync }, { sqliteExecutor, migrations }] = await Promise.all([
    import("node:sqlite"), import("node:fs"), import("./sqlite.ts"),
  ]);
  mkdirSync(".data", { recursive: true });
  const db = new DatabaseSync(".data/dev.sqlite");
  for (const sql of migrations(new URL("../../migrations/", import.meta.url))) db.exec(sql);
  console.warn("[tinyagent-design] Development database: .data/dev.sqlite (local SQLite, same SQL as D1). " +
    "Set TINYAGENT_DEV_DB=d1 to use the configured Cloudflare D1 instead.");
  return sqliteExecutor(db);
}

export function sqlExecutor(): Promise<SqlExecutor> {
  if (executor) return executor;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID?.trim();
  const token = process.env.CLOUDFLARE_D1_TOKEN?.trim();
  const development = process.env.NODE_ENV === "development";
  if (development && process.env.TINYAGENT_DEV_DB !== "d1") return (executor = localExecutor());
  if (accountId && databaseId && token) return (executor = Promise.resolve(d1Executor({ accountId, databaseId, token })));
  return Promise.reject(new StoreUnavailableError("Cloudflare D1 is not configured (CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_D1_DATABASE_ID, CLOUDFLARE_D1_TOKEN)"));
}

export async function quotaStore(): Promise<QuotaStore> {
  return new SqlQuotaStore(await sqlExecutor());
}

export async function sessionStore(): Promise<SessionStore> {
  return new SessionStore(await sqlExecutor());
}
