import assert from "node:assert/strict";
import test from "node:test";
import { Agent, FencedError, ScriptedProvider, Session, checkStorage } from "tiny-agent-sdk/browser";
import { JournalStorage, MemoryJournalBackend } from "../lib/storage.ts";
import { publishDesignTool, type PublishedDesign } from "../lib/tools.ts";

test("JournalStorage keeps the SDK's storage contract", async () => {
  await checkStorage(new JournalStorage(new MemoryJournalBackend()));
});

test("a writer that fell behind is fenced and writes nothing", async () => {
  const storage = new JournalStorage(new MemoryJournalBackend());
  assert.equal(await storage.append("s_a", 0, { type: "session" }), 1);
  await assert.rejects(storage.append("s_a", 0, { type: "session" }), FencedError);
  assert.equal((await storage.load("s_a"))?.length, 1);
  assert.deepEqual(await storage.list(), ["s_a"]);
});

test("each record's write time is kept beside it", async () => {
  let now = 100;
  const storage = new JournalStorage(new MemoryJournalBackend(), () => now);
  await storage.append("s_t", 0, { type: "one" });
  now = 250;
  await storage.append("s_t", 1, { type: "two" });
  assert.deepEqual([...await storage.stamps("s_t")], [[1, 100], [2, 250]]);
});

const PAGE = "<!doctype html><html><head><title>x</title></head><body>hi</body></html>";

test("a run interrupted inside publish_design resumes, reruns with the same executionId and stores the design once", async () => {
  const storage = new JournalStorage(new MemoryJournalBackend());
  const designs = new Map<string, PublishedDesign>();
  const turns = () => new ScriptedProvider([
    [{ callId: "c1", name: "publish_design", arguments: { title: "Starship", html: PAGE } }],
    "Published.",
  ]);

  // First "tab": the tool stores the design, then the tab dies before the result is journaled.
  let crash = true;
  const crashing = publishDesignTool(async (design, signal) => {
    designs.set(design.executionId, design);
    // Never returns while the tab is "alive": the reload happens here.
    if (crash) await new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason)));
    return designs.size;
  });
  const first = new Session(new Agent({ model: "m", tools: [crashing], provider: turns() }), { storage });
  await first.ready;
  const controller = new AbortController();
  const running = first.run("Design a starship", { signal: controller.signal }).catch(() => {});
  while (designs.size === 0) await new Promise((resolve) => setTimeout(resolve, 5));
  // A reload loses the tab without journaling anything more: simulate by opening a second
  // session object on the same storage while the first is stuck, as the reloaded tab would.
  crash = false;
  const tool = publishDesignTool(async (design) => { designs.set(design.executionId, design); return designs.size; });
  const provider = new ScriptedProvider(["Published."]);
  const second = new Session(new Agent({ model: "m", tools: [tool], provider }), { storage, sessionId: first.id, resume: true });
  await second.ready;
  assert.equal(second.resumable, true);
  const rerun: unknown[] = [];
  const result = await second.resume({ onEvent: (event) => { if (event.type === "tool_execution_start") rerun.push(event.rerun); } });
  assert.equal(result.text, "Published.");
  assert.deepEqual(rerun, [true]);
  assert.equal(designs.size, 1, "the rerun overwrote the same design instead of adding one");
  assert.match([...designs.keys()][0], new RegExp(`^${first.id}:\\d+$`));
  controller.abort();
  await running;
});
