// Development only: a local SQLite database with the same migrations and SQL as
// Cloudflare D1. Loaded by lib/server/db.ts outside the bundler (turbopackIgnore), so
// the dev server neither bundles node:sqlite nor watches the database or migrations.
import { readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export function openDevDatabase(root) {
  const file = process.env.TINYAGENT_DEV_SQLITE || join(tmpdir(), "tinyagent-design-dev.sqlite");
  const db = new DatabaseSync(file);
  const directory = join(root, "migrations");
  for (const name of readdirSync(directory).filter((entry) => entry.endsWith(".sql")).sort()) db.exec(readFileSync(join(directory, name), "utf8"));
  // A batch is one transaction, as on D1; parameters arrive as strings, as from D1's HTTP API.
  const executor = async (statements) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map(({ sql, params }) => db.prepare(sql).all(...params.map(String)));
      db.exec("COMMIT");
      return results;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };
  return { file, executor };
}
