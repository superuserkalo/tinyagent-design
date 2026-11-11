import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { FREE_PROMPTS, GRANT_MAX_REQUESTS, GRANT_TTL_SECONDS, PROMPT_RATE } from "../lib/server/config.ts";
import { promptsLeft, startPrompt, useGrant } from "../lib/server/quota.ts";
import { D1Error, MemoryQuotaStore, SQL, SqlQuotaStore, d1Executor, type QuotaStore, type SqlExecutor } from "../lib/server/store.ts";

const MIGRATION = readFileSync(new URL("../migrations/0001_init.sql", import.meta.url), "utf8");

/** The production SQL, run on a local SQLite with the real migration: D1 is SQLite. */
function sqliteExecutor(): SqlExecutor {
  const db = new DatabaseSync(":memory:");
  db.exec(MIGRATION);
  return async (statements) => {
    // A batch is one transaction, as D1 runs it. Parameters arrive as strings, as from D1's HTTP API.
    db.exec("BEGIN");
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

function clock(start = 1_800_000_000_000) {
  let now = start;
  return { now: () => now, advance: (ms: number) => { now += ms; } };
}

const stores: [string, (now: () => number) => QuotaStore][] = [
  ["memory", (now) => new MemoryQuotaStore(now)],
  ["SQL on SQLite (the D1 statements)", (now) => new SqlQuotaStore(sqliteExecutor(), now)],
];

for (const [name, make] of stores) {
  test(`${name}: a new account starts with 3 free prompts`, async () => {
    assert.equal(FREE_PROMPTS, 3);
    assert.equal(await promptsLeft(make(Date.now), "u1"), 3);
  });

  test(`${name}: each prompt decrements once and the count floors at 0`, async () => {
    const time = clock();
    const store = make(time.now);
    const left: number[] = [];
    for (let i = 0; i < 3; i++) {
      const result = await startPrompt(store, "u1", time.now());
      assert.ok(result.ok);
      left.push(result.remaining);
      time.advance(PROMPT_RATE.windowSeconds * 1000); // stay clear of the rate limit
    }
    assert.deepEqual(left, [2, 1, 0]);
    assert.deepEqual(await startPrompt(store, "u1", time.now()), { ok: false, error: "no_prompts_left", remaining: 0 });
    assert.deepEqual(await startPrompt(store, "u1", time.now()), { ok: false, error: "no_prompts_left", remaining: 0 });
    assert.equal(await promptsLeft(store, "u1"), 0);
    assert.equal(await promptsLeft(store, "u2"), 3);
  });

  test(`${name}: concurrent prompts cannot spend more than 3`, async () => {
    const time = clock();
    const store = make(time.now);
    const results = await Promise.all(Array.from({ length: 5 }, () => startPrompt(store, "racer", time.now())));
    const granted = results.filter((result) => result.ok).length;
    assert.equal(granted, 3);
    assert.equal(await promptsLeft(store, "racer"), 0);
  });

  test(`${name}: prompts are rate limited per user`, async () => {
    const time = clock();
    const store = make(time.now);
    for (let i = 0; i < PROMPT_RATE.limit; i++) assert.ok(await store.hit("prompts:busy", PROMPT_RATE.limit, PROMPT_RATE.windowSeconds));
    assert.deepEqual(await startPrompt(store, "busy", time.now()), { ok: false, error: "rate_limited", remaining: 3 });
    time.advance(PROMPT_RATE.windowSeconds * 1000);
    assert.ok((await startPrompt(store, "busy", time.now())).ok);
  });

  test(`${name}: a grant is valid for its owner, until its TTL`, async () => {
    const time = clock();
    const store = make(time.now);
    const result = await startPrompt(store, "u1", time.now());
    assert.ok(result.ok);
    assert.equal(result.grant.expiresAt, time.now() + GRANT_TTL_SECONDS * 1000);
    assert.equal(await useGrant(store, result.grant.id, "u1"), "ok");
    assert.equal(await useGrant(store, result.grant.id, "someone-else"), "wrong_user");
    time.advance(GRANT_TTL_SECONDS * 1000 - 1);
    assert.equal(await useGrant(store, result.grant.id, "u1"), "ok");
    time.advance(1);
    assert.equal(await useGrant(store, result.grant.id, "u1"), "missing");
  });

  test(`${name}: a grant allows at most its cap of model requests`, async () => {
    const time = clock();
    const store = make(time.now);
    const result = await startPrompt(store, "u1", time.now());
    assert.ok(result.ok);
    for (let i = 0; i < GRANT_MAX_REQUESTS; i++) assert.equal(await useGrant(store, result.grant.id, "u1"), "ok");
    assert.equal(await useGrant(store, result.grant.id, "u1"), "exhausted");
    assert.equal(await useGrant(store, result.grant.id, "u1"), "exhausted");
  });

  test(`${name}: made-up and malformed grant ids are refused`, async () => {
    const store = make(Date.now);
    assert.equal(await useGrant(store, "g_" + "a".repeat(32), "u1"), "missing");
    assert.equal(await useGrant(store, "not a grant", "u1"), "missing");
  });
}

test("SQL: a grant cannot be created without spending a prompt (the trigger runs in the same statement)", async () => {
  const exec = sqliteExecutor();
  const now = 1_800_000_000_000;
  // No quota row yet: the grant insert finds nothing and creates nothing.
  const [created] = await exec([{ sql: SQL.createGrant, params: ["g_x", "nobody", now + 1, 40, now] }]);
  assert.deepEqual(created, []);
  await exec([{ sql: SQL.ensureQuota, params: ["u", 1, now] }]);
  const [first] = await exec([{ sql: SQL.createGrant, params: ["g_1", "u", now + 1, 40, now] }]);
  assert.equal(first.length, 1);
  const [second] = await exec([{ sql: SQL.createGrant, params: ["g_2", "u", now + 1, 40, now] }]);
  assert.deepEqual(second, [], "no second grant at zero");
  const [[row]] = await exec([{ sql: SQL.remaining, params: ["u"] }]);
  assert.equal(Number(row.remaining), 0);
});

test("D1 executor: sends a batch with the bearer token and returns each statement's rows", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const exec = d1Executor({
    accountId: "acc", databaseId: "db-1", token: "secret-token",
    fetcher: (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Response.json({ success: true, errors: [], messages: [], result: [{ results: [], success: true }, { results: [{ remaining: 2 }], success: true }] });
    }) as typeof fetch,
  });
  const rows = await exec([{ sql: "A", params: ["x", 3] }, { sql: "B", params: [] }]);
  assert.deepEqual(rows, [[], [{ remaining: 2 }]]);
  assert.equal(calls[0].url, "https://api.cloudflare.com/client/v4/accounts/acc/d1/database/db-1/query");
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, "Bearer secret-token");
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { batch: [{ sql: "A", params: ["x", "3"] }, { sql: "B", params: [] }] });
});

test("D1 executor: fails closed on an error, a short result or a network failure, without the token", async () => {
  const failing = (response: () => Response | Promise<Response>) => d1Executor({ accountId: "a", databaseId: "d", token: "secret-token", fetcher: (async () => response()) as typeof fetch });
  for (const exec of [
    failing(() => Response.json({ success: false, errors: [{ code: 7500, message: "no such table: quota" }], result: [] }, { status: 400 })),
    failing(() => Response.json({ success: true, errors: [], result: [] })),
    failing(() => { throw new TypeError("fetch failed"); }),
    failing(() => new Response("not json", { status: 502 })),
  ]) {
    await assert.rejects(exec([{ sql: "SELECT 1", params: [] }]), (error: unknown) => {
      assert.ok(error instanceof D1Error);
      assert.doesNotMatch((error as Error).message, /secret-token/);
      return true;
    });
  }
});
