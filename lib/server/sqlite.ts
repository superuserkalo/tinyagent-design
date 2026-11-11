// A local SQLite database that speaks the same SQL as Cloudflare D1 (D1 is SQLite).
// Used by the tests and by `next dev` when no D1 is configured. Never in production.
import { readdirSync, readFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import type { SqlExecutor } from "./store.ts";

/** Every migration in migrations/, in order. Each is idempotent (IF NOT EXISTS). */
export function migrations(directory: URL): string[] {
  return readdirSync(directory).filter((name) => name.endsWith(".sql")).sort()
    .map((name) => readFileSync(new URL(name, directory), "utf8"));
}

/** Runs a batch in one transaction, as D1 does, with parameters as strings, as D1's HTTP API sends them. */
export function sqliteExecutor(db: DatabaseSync): SqlExecutor {
  return async (statements) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map(({ sql, params }) => db.prepare(sql).all(...params.map(String)) as Record<string, unknown>[]);
      db.exec("COMMIT");
      return results;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };
}
