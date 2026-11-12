import assert from "node:assert/strict";
import test from "node:test";
import { INSTRUCTIONS } from "../lib/agent.ts";
import { EXAMPLE_SCENE } from "../lib/design/example-scene.ts";

test("the instructions carry the vgpu scene brief and its worked example, at a sensible size", () => {
  assert.match(INSTRUCTIONS, /the global `vgpu`/);
  assert.match(INSTRUCTIONS, /prepareShader/);
  assert.match(INSTRUCTIONS, /Refinements edit the existing design/);
  assert.ok(INSTRUCTIONS.includes(EXAMPLE_SCENE), "the worked example is included whole");
  // About four characters per token: stay under 8k tokens.
  assert.ok(INSTRUCTIONS.length < 32_000, `${INSTRUCTIONS.length} characters`);
});
