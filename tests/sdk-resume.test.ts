// What a reload mid-reply costs: after a resume, does the SDK ask the model again
// for turns it already journaled? It must not. Only the interrupted turn is redone.
import assert from "node:assert/strict";
import test from "node:test";
import { Agent, ScriptedProvider, Session, Tool, type ProviderRequest, type Storage } from "tiny-agent-sdk/browser";
import { JournalStorage, MemoryJournalBackend } from "../lib/storage.ts";

const tool = (onRun: () => Promise<void> | void) => new Tool({
  name: "step", description: "A step.", parameters: { type: "object", properties: { n: { type: "integer" } }, required: ["n"] },
  idempotent: true,
  handler: async ({ n }) => { await onRun(); return `step ${n} done`; },
});

/** Runs until `stopWhen` says the tab "dies", then returns what had been journaled. */
async function runUntil(storage: Storage, stopWhen: (request: ProviderRequest) => boolean, turns: number) {
  const controller = new AbortController();
  let stopped = false;
  const provider = new ScriptedProvider(Array.from({ length: turns }, (_, index) => (request: ProviderRequest) => {
    if (stopWhen(request)) {
      stopped = true;
      return new Promise(() => {}); // the model turn in flight when the tab dies
    }
    return index < 2 ? { text: `turn ${index + 1}`, toolCalls: [{ callId: `c${index + 1}`, name: "step", arguments: { n: index + 1 } }] } : "done";
  }));
  const session = new Session(new Agent({ model: "m", tools: [tool(() => {})], provider }), { storage });
  await session.ready;
  const run = session.run("go", { signal: controller.signal }).catch(() => {});
  while (!stopped) await new Promise((resolve) => setTimeout(resolve, 2));
  return { id: session.id, provider, stop: () => { controller.abort(); return run; } };
}

test("resume re-requests only the interrupted model turn, never journaled ones", async () => {
  const storage = new JournalStorage(new MemoryJournalBackend());
  // Turns 1 and 2 (each a tool call) complete; the tab dies while turn 3 is streaming.
  const first = await runUntil(storage, (request) => request.history.filter((item) => item.role === "tool_result").length === 2, 3);
  assert.equal(first.provider.requests.length, 3);

  const toolRuns: number[] = [];
  const resumed = new ScriptedProvider(["done"]);
  const session = new Session(new Agent({ model: "m", tools: [tool(() => { toolRuns.push(1); })], provider: resumed }), { storage, sessionId: first.id, resume: true });
  await session.ready;
  assert.equal(session.resumable, true);
  const events: string[] = [];
  const result = await session.resume({ onEvent: (event) => { events.push(event.type); } });
  assert.equal(result.text, "done");
  assert.equal(resumed.requests.length, 1, "one model request: the interrupted third turn");
  assert.equal(resumed.requests[0].history.filter((item) => item.role === "tool_result").length, 2, "it is sent both finished steps");
  assert.deepEqual(toolRuns, [], "finished tool calls are not run again");
  assert.ok(!events.includes("tool_execution_start"), "no finished step is replayed as a live event");
  await first.stop();
});
