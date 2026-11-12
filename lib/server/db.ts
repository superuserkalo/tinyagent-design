// The database behind quotas and chats. Production: Cloudflare D1 over its HTTP API.
// `next dev` without TINYAGENT_DEV_DB=d1: a local SQLite file in the OS temp directory with
// the same migrations and SQL, so development never writes to the production database.
import { SessionStore } from "./sessions.ts";
import { SqlQuotaStore, StoreUnavailableError, d1Executor, type QuotaStore, type SqlExecutor } from "./store.ts";

let executor: Promise<SqlExecutor> | undefined;

async function localExecutor(): Promise<SqlExecutor> {
  // The project root from npm's environment, not process.cwd(): a cwd-relative path in
  // server code makes the dev bundler watch the whole project, and reload on every request.
  const root = (process.env.TINYAGENT_ROOT ?? process.env.INIT_CWD ?? process.env.PWD ?? ".").replace(/\/$/, "");
  const module = `file://${root}/scripts/dev-db.mjs`;
  const { openDevDatabase } = await import(/* turbopackIgnore: true */ module) as { openDevDatabase: (root: string) => { file: string; executor: SqlExecutor } };
  const { file, executor } = openDevDatabase(root);
  console.warn(`[tinyagent-design] Development database: ${file} (local SQLite, same SQL as D1). ` +
    "Set TINYAGENT_DEV_DB=d1 to use the configured Cloudflare D1 instead.");
  return executor;
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
