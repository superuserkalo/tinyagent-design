import assert from "node:assert/strict";
import test from "node:test";
import { INSTRUCTIONS } from "../lib/agent.ts";

test("the instructions carry the design brief and stay a sensible size", () => {
  assert.match(INSTRUCTIONS, /Self-review before every publish/);
  assert.match(INSTRUCTIONS, /Refinements edit the existing design/);
  assert.match(INSTRUCTIONS, /fonts\.googleapis\.com/);
  // About four characters per token: stay well under 4k tokens.
  assert.ok(INSTRUCTIONS.length < 15_000, `${INSTRUCTIONS.length} characters`);
});
