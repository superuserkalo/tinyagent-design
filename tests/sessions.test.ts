// The server-side journal, run on SQLite with the real migrations and the SQL that D1 runs.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { CHUNK_CHARS, LEASE_MS, SessionStore } from "../lib/server/sessions.ts";
import { migrations, sqliteExecutor } from "../lib/server/sqlite.ts";

function setup() {
  const db = new DatabaseSync(":memory:");
  for (const sql of migrations(new URL("../migrations/", import.meta.url))) db.exec(sql);
  let now = 1_800_000_000_000;
  let ids = 0;
  const store = new SessionStore(sqliteExecutor(db), () => now, () => `chunk-${++ids}`);
  return { db, store, advance: (ms: number) => { now += ms; } };
}

const OWNER_A = "tab-aaaaaaaa";
const OWNER_B = "tab-bbbbbbbb";

test("append follows the fencing rule: only one of two concurrent writers gets each sequence", async () => {
  const { store } = setup();
  assert.equal((await store.claim("alice", "s_one", OWNER_A)).ok, true);
  await store.release("alice", "s_one", OWNER_A);
  assert.equal(await store.append("alice", "s_one", 0, { type: "session" }, OWNER_A), "ok");
  // Two devices race for record 2.
  const results = await Promise.all([
    store.append("alice", "s_one", 1, { type: "run_start", from: "a" }, OWNER_A),
    store.append("alice", "s_one", 1, { type: "run_start", from: "b" }, OWNER_B),
  ]);
  assert.deepEqual(results.sort(), ["fenced", "ok"]);
  // A writer that is behind, or ahead, is fenced too.
  assert.equal(await store.append("alice", "s_one", 1, { type: "late" }, OWNER_A), "fenced");
  assert.equal(await store.append("alice", "s_one", 5, { type: "ahead" }, OWNER_A), "fenced");
  const page = await store.load("alice", "s_one");
  assert.deepEqual(page?.records.map((row) => row.seq), [1, 2]);
});

test("many concurrent appends never leave a gap or a duplicate", async () => {
  const { store } = setup();
  await store.claim("alice", "s_many", OWNER_A);
  await store.release("alice", "s_many", OWNER_A);
  for (let round = 0; round < 20; round++) {
    const expected = round;
    const outcomes = await Promise.all(Array.from({ length: 4 }, (_, writer) => store.append("alice", "s_many", expected, { round, writer }, `tab-writer${writer}0`)));
    assert.equal(outcomes.filter((outcome) => outcome === "ok").length, 1);
  }
  const page = await store.load("alice", "s_many");
  assert.deepEqual(page?.records.map((row) => row.seq), Array.from({ length: 20 }, (_, index) => index + 1));
});

test("a chat belongs to its user: no one else can read, append, lease or publish to it", async () => {
  const { store } = setup();
  await store.claim("alice", "s_private", OWNER_A);
  assert.equal(await store.append("alice", "s_private", 0, { type: "session" }, OWNER_A), "ok");
  assert.equal(await store.load("mallory", "s_private"), null);
  assert.equal(await store.append("mallory", "s_private", 1, { type: "evil" }, OWNER_B), "not_found");
  assert.equal((await store.claim("mallory", "s_private", OWNER_B)).ok, false);
  assert.equal(await store.putDesign("mallory", "s_private:2", "x", "<p>x</p>"), false);
  assert.equal(await store.chat("mallory", "s_private"), null);
  assert.deepEqual((await store.list("mallory")).map((chat) => chat.id), []);
  assert.deepEqual((await store.list("alice")).map((chat) => chat.id), ["s_private"]);
});

test("a lease keeps a second tab from running the chat until it is released or lapses", async () => {
  const { store, advance } = setup();
  assert.equal((await store.claim("alice", "s_lease", OWNER_A)).ok, true);
  assert.equal((await store.claim("alice", "s_lease", OWNER_B)).ok, false, "held by A");
  assert.equal(await store.append("alice", "s_lease", 0, { type: "session" }, OWNER_B), "fenced", "B cannot write while A holds it");
  assert.equal(await store.append("alice", "s_lease", 0, { type: "session" }, OWNER_A), "ok");
  assert.equal((await store.claim("alice", "s_lease", OWNER_A)).ok, true, "A renews");
  advance(LEASE_MS + 1);
  assert.equal((await store.claim("alice", "s_lease", OWNER_B)).ok, true, "lapsed: B may take over");
  await store.release("alice", "s_lease", OWNER_A); // A's release no longer applies
  assert.equal((await store.claim("alice", "s_lease", OWNER_A)).ok, false);
  await store.release("alice", "s_lease", OWNER_B);
  assert.equal((await store.claim("alice", "s_lease", OWNER_A)).ok, true);
});

test("a prompt with five images and a large design round-trip through chunks", async () => {
  const { store, db } = setup();
  await store.claim("alice", "s_big", OWNER_A);
  assert.equal(await store.append("alice", "s_big", 0, { type: "session" }, OWNER_A), "ok");
  const image = (seed: number) => Buffer.from(Array.from({ length: 300_000 }, (_, index) => (index * seed) % 251)).toString("base64");
  const prompt = {
    type: "run_start", runId: "r1",
    item: { role: "user", content: [{ type: "text", text: "Match these" }, ...[1, 2, 3, 4, 5].map((seed) => ({ type: "image", mediaType: "image/webp", data: image(seed) }))] },
  };
  assert.ok(JSON.stringify(prompt).length > 3 * CHUNK_CHARS, "the record is several chunks long");
  assert.equal(await store.append("alice", "s_big", 1, prompt, OWNER_A), "ok");
  const html = `<!doctype html><html><body>${"<p>Ünïcødé page ✓</p>".repeat(9000)}</body></html>`;
  assert.equal(await store.append("alice", "s_big", 2, { type: "item", item: { role: "assistant", content: [{ type: "tool_call", callId: "c", name: "publish_design", arguments: { title: "Big", html } }] } }, OWNER_A), "ok");
  assert.equal(await store.putDesign("alice", "s_big:4", "Big", html), true);

  const page = await store.load("alice", "s_big");
  assert.deepEqual(page?.records[1].record, prompt);
  assert.equal((page?.records[2].record as { item: { content: { arguments: { html: string } }[] } }).item.content[0].arguments.html, html);
  assert.equal((await store.design("alice", "s_big:4"))?.html, html);
  const parts = db.prepare("SELECT COUNT(*) AS n FROM record_chunks").get() as { n: number };
  assert.ok(parts.n >= 4);
});

test("a fenced large write leaves the winner's parts intact", async () => {
  const { store } = setup();
  await store.claim("alice", "s_race", OWNER_A);
  await store.release("alice", "s_race", OWNER_A);
  await store.append("alice", "s_race", 0, { type: "session" }, OWNER_A);
  const big = (fill: string) => ({ type: "item", data: fill.repeat(CHUNK_CHARS * 2) });
  const outcomes = await Promise.all([store.append("alice", "s_race", 1, big("a"), OWNER_A), store.append("alice", "s_race", 1, big("b"), OWNER_B)]);
  assert.deepEqual(outcomes, ["ok", "fenced"]);
  const page = await store.load("alice", "s_race");
  assert.equal((page?.records[1].record as { data: string }).data, "a".repeat(CHUNK_CHARS * 2));
});

test("designs are keyed by executionId: a rerun overwrites, versions list in journal order", async () => {
  const { store } = setup();
  await store.claim("alice", "s_designs", OWNER_A);
  assert.equal(await store.putDesign("alice", "s_designs:9", "Second", "<b>2</b>"), true);
  assert.equal(await store.putDesign("alice", "s_designs:4", "First", "<b>1</b>"), true);
  assert.equal(await store.putDesign("alice", "s_designs:4", "First", "<b>1</b>"), true); // the rerun
  assert.deepEqual((await store.designs("alice", "s_designs")).map((design) => design.id), ["s_designs:4", "s_designs:9"]);
  assert.equal(await store.putDesign("alice", "not-an-execution-id", "x", "y"), false);
});

test("loading pages large journals", async () => {
  const { store } = setup();
  await store.claim("alice", "s_pages", OWNER_A);
  const filler = "x".repeat(400_000);
  for (let index = 0; index < 9; index++) assert.equal(await store.append("alice", "s_pages", index, { index, filler }, OWNER_A), "ok");
  const seen: number[] = [];
  let after = 0;
  for (let pages = 0; pages < 10; pages++) {
    const page = await store.load("alice", "s_pages", after);
    seen.push(...page!.records.map((row) => row.seq));
    if (page!.next === null) break;
    after = page!.next;
  }
  assert.deepEqual(seen, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
});
