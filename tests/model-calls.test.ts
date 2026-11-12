// Model calls that outlive the tab: a reload replays the saved output and follows the
// rest live, without a second gateway request or a second charge. Runs the real SQL on SQLite.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { CHAT_HEADER, GRANT_HEADER, handleModelRequest, type ModelRouteDeps } from "../lib/server/model-route.ts";
import { STALE_MS } from "../lib/server/model-calls.ts";
import { startPrompt } from "../lib/server/quota.ts";
import { migrations, sqliteExecutor } from "../lib/server/sqlite.ts";
import { MemoryQuotaStore } from "../lib/server/store.ts";

const ORIGIN = "http://localhost:3000";
process.env.FREE_PROMPTS = "100";
const encoder = new TextEncoder();
const data = (value: unknown) => encoder.encode(`data: ${JSON.stringify(value)}\n\n`);

/** A gateway stream the test writes to by hand. */
function gateway() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start: (c) => { controller = c; } });
  let aborted = false;
  return {
    body,
    get aborted() { return aborted; },
    onAbort: (signal: AbortSignal) => signal.addEventListener("abort", () => { aborted = true; try { controller.error(new Error("aborted")); } catch {} }),
    think: (text: string) => controller.enqueue(data({ choices: [{ index: 0, delta: { reasoning: text } }] })),
    say: (text: string) => controller.enqueue(data({ choices: [{ index: 0, delta: { content: text } }] })),
    call: (args: string, first = false) => controller.enqueue(data({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, ...(first ? { id: "call_1", function: { name: "publish_design", arguments: args } } : { function: { arguments: args } }) }] } }] })),
    cut: () => controller.close(),
    end: () => {
      controller.enqueue(data({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] }));
      controller.enqueue(data({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 20 } }));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  };
}

function setup() {
  const db = new DatabaseSync(":memory:");
  for (const sql of migrations(new URL("../migrations/", import.meta.url))) db.exec(sql);
  const exec = sqliteExecutor(db);
  const store = new MemoryQuotaStore();
  let clock = 1_800_000_000_000;
  const upstreams: ReturnType<typeof gateway>[] = [];
  const work: Promise<unknown>[] = [];
  const deps: ModelRouteDeps = {
    user: async (request) => request.headers.get("cookie")?.includes("hanko=valid") ? { id: "user-1", email: "a@b.c" } : null,
    store: () => store,
    credential: async () => "gateway-secret",
    model: "anthropic/claude-haiku-5.5",
    calls: async () => exec,
    waitUntil: (promise) => { work.push(promise); },
    now: () => clock,
    fetch: (async (_url: string, init: RequestInit) => {
      const upstream = gateway();
      upstream.onAbort(init.signal!);
      upstreams.push(upstream);
      return new Response(upstream.body, { headers: { "Content-Type": "text/event-stream" } });
    }) as typeof fetch,
  };
  return { db, store, deps, upstreams, work, advance: (ms: number) => { clock += ms; } };
}

async function grantFor(store: MemoryQuotaStore) {
  const result = await startPrompt(store, "user-1");
  assert.ok(result.ok);
  return result.grant.id;
}

function request(grant: string, chat = "s_chat1", prompt = "Design a page") {
  return new Request(`${ORIGIN}/api/model/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", host: "localhost:3000", origin: ORIGIN, cookie: "hanko=valid", [GRANT_HEADER]: grant, [CHAT_HEADER]: chat },
    body: JSON.stringify({
      model: "x", messages: [{ role: "user", content: prompt }],
      tools: [{ type: "function", function: { name: "publish_design", description: "", parameters: { type: "object" } } }],
      stream: true, stream_options: { include_usage: true },
    }),
  });
}

/** What the SDK would make of a stream: text, the tool call's arguments, whether it ended cleanly. */
async function read(response: Response, { upTo }: { upTo?: string } = {}) {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let raw = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    raw += decoder.decode(value, { stream: true });
    if (upTo && raw.includes(upTo)) { await reader.cancel(); break; }
  }
  let text = "", args = "", thinking = "", done = false, error = "";
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    if (line === "data: [DONE]") { done = true; continue; }
    const event = JSON.parse(line.slice(6));
    if (event.error) error = event.error.message;
    for (const choice of event.choices ?? []) {
      text += choice.delta?.content ?? "";
      thinking += choice.delta?.reasoning ?? "";
      for (const call of choice.delta?.tool_calls ?? []) args += call.function?.arguments ?? "";
    }
  }
  return { text, args, thinking, done, error, raw };
}

const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

test("a reload mid-step replays what was streamed and follows the rest, with one gateway request and one charge", async () => {
  const { deps, store, upstreams, work, db } = setup();
  const grant = await grantFor(store);

  const first = await handleModelRequest(request(grant), deps);
  assert.equal(first.status, 200);
  const up = upstreams[0];
  up.think("I should make it dark. ");
  up.say("Building it now.");
  up.call('{"title":"Kontinent","html":"<h1>', true);
  // The tab reloads: it stops listening after the first part.
  await read(first, { upTo: "Kontinent" });
  up.call("Eleven regions");
  await tick(500); // a save happens

  // The SDK repeats the interrupted step with the same request.
  const second = await handleModelRequest(request(grant), deps);
  assert.equal(second.status, 200);
  const following = read(second);
  await tick(50);
  up.call('</h1>"}');
  up.think("Done.");
  up.end();
  const replay = await following;
  await Promise.all(work);

  assert.equal(upstreams.length, 1, "no second gateway request");
  assert.equal(up.aborted, false, "the reload did not stop the model");
  assert.equal(replay.text, "Building it now.");
  assert.equal(replay.args, '{"title":"Kontinent","html":"<h1>Eleven regions</h1>"}');
  assert.equal(replay.done, true);
  assert.equal(replay.thinking, "", "thinking never reaches the browser");
  assert.ok(!replay.raw.includes("dark"), "thinking never reaches the browser");

  const [row] = db.prepare("SELECT status, reasoning, usage FROM model_calls").all() as { status: string; reasoning: string; usage: string }[];
  assert.equal(row.status, "done");
  assert.equal(row.reasoning, "I should make it dark. Done.");
  assert.deepEqual(JSON.parse(row.usage), { prompt_tokens: 10, completion_tokens: 20 });
  const grants = (store as unknown as { grants: Map<string, { requests: number }> }).grants;
  if (grants) assert.equal([...grants.values()][0].requests, 1, "the replay was not charged");
});

test("a finished call replays in full; the same request in another chat is a new call", async () => {
  const { deps, store, upstreams, work } = setup();
  const grant = await grantFor(store);
  const first = await handleModelRequest(request(grant), deps);
  upstreams[0].say("Hello");
  upstreams[0].end();
  assert.equal((await read(first)).text, "Hello");
  await Promise.all(work);

  const again = await read(await handleModelRequest(request(grant), deps));
  assert.equal(again.text, "Hello");
  assert.equal(again.done, true);
  assert.equal(upstreams.length, 1);

  const other = await handleModelRequest(request(grant, "s_chat2"), deps);
  assert.equal(upstreams.length, 2, "another chat starts its own call");
  upstreams[1].end();
  await read(other);
});

test("the stop button ends the call on the server and aborts the gateway request", async () => {
  const { deps, store, upstreams, work, db } = setup();
  const grant = await grantFor(store);
  const response = await handleModelRequest(request(grant), deps);
  upstreams[0].say("Start");
  await tick(50);
  db.prepare("UPDATE model_calls SET status = 'cancelled' WHERE chat_id = 's_chat1'").run();
  await tick(600); // the next save notices
  assert.equal(upstreams[0].aborted, true);
  await read(response);
  await Promise.all(work);
  const [row] = db.prepare("SELECT status FROM model_calls").all() as { status: string }[];
  assert.equal(row.status, "cancelled");

  // Sending the same request again starts it afresh.
  const again = await handleModelRequest(request(grant), deps);
  assert.equal(upstreams.length, 2);
  upstreams[1].say("Fresh");
  upstreams[1].end();
  assert.equal((await read(again)).text, "Fresh");
});

test("a call whose function died is started again rather than followed forever", async () => {
  const { deps, store, upstreams, advance } = setup();
  const grant = await grantFor(store);
  await handleModelRequest(request(grant), deps);
  upstreams[0].say("Partial");
  await tick(500);
  // The function was killed: no more saves. Time passes.
  advance(STALE_MS + 1);
  const again = await handleModelRequest(request(grant), deps);
  assert.equal(upstreams.length, 2, "a new gateway request");
  upstreams[1].say("Whole");
  upstreams[1].end();
  const result = await read(again);
  assert.equal(result.text, "Whole");
});

test("a stream that breaks off is saved as failed; repeating the request starts it again", async () => {
  const { deps, store, upstreams, work } = setup();
  const grant = await grantFor(store);
  const first = await handleModelRequest(request(grant), deps);
  upstreams[0].say("Half");
  upstreams[0].cut();
  const result = await read(first);
  await Promise.all(work);
  assert.equal(result.text, "Half");
  assert.equal(result.done, false);
  assert.match(result.error, /ended early/);

  const again = await handleModelRequest(request(grant), deps);
  assert.equal(upstreams.length, 2);
  upstreams[1].say("Whole");
  upstreams[1].end();
  assert.equal((await read(again)).text, "Whole");
});

test("a replay still needs a live grant of the user's own, though it is not counted", async () => {
  const { deps, store, upstreams, work } = setup();
  const grant = await grantFor(store);
  const first = await handleModelRequest(request(grant), deps);
  upstreams[0].say("Hello");
  upstreams[0].end();
  await read(first);
  await Promise.all(work);

  const forged = await handleModelRequest(request("g_" + "A".repeat(32)), deps);
  assert.equal(forged.status, 403);
  assert.equal(upstreams.length, 1);
  assert.equal((await read(await handleModelRequest(request(grant), deps))).text, "Hello");
});
