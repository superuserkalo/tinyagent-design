import assert from "node:assert/strict";
import test from "node:test";
import { INSTRUCTIONS } from "../lib/agent.ts";
import { STARTER_SCENES } from "../lib/design/starter-scenes.ts";

test("the instructions carry the vgpu scene brief and every starter scene whole", () => {
  assert.match(INSTRUCTIONS, /the global `vgpu`/);
  assert.match(INSTRUCTIONS, /prepareShader/);
  assert.match(INSTRUCTIONS, /Refinements edit the existing design/);
  assert.ok(STARTER_SCENES.length >= 1);
  for (const scene of STARTER_SCENES) {
    assert.ok(INSTRUCTIONS.includes(scene.html), `${scene.name} is included whole`);
    assert.ok(!/<script[^>]*src=/i.test(scene.html), `${scene.name} loads no script (the frame injects vgpu)`);
  }
  // About four characters per token: stay under 40k tokens, cached after the first request.
  assert.ok(INSTRUCTIONS.length < 160_000, `${INSTRUCTIONS.length} characters`);
});
