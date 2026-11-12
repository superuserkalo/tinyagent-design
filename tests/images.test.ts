import assert from "node:assert/strict";
import test from "node:test";
import { MAX_IMAGES, MAX_IMAGE_BYTES, MAX_REQUEST_IMAGE_CHARS, sniffImageType } from "../lib/images.ts";
import { OMITTED_DESIGN, OMITTED_IMAGE, compactRequest } from "../lib/request-budget.ts";
import { validateImages } from "../lib/server/images.ts";

const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const png = (bytes = 2000) => Buffer.from([...PNG_HEADER, ...new Array(bytes).fill(7)]).toString("base64");
const webp = (bytes = 2000) => Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.alloc(bytes)]).toString("base64");
const part = (type: string, data: string) => ({ type: "image_url", image_url: { url: `data:${type};base64,${data}` } });
const user = (...parts: unknown[]) => ({ role: "user", content: [{ type: "text", text: "like this" }, ...parts] });

test("images: five per user message are accepted, six are not", () => {
  assert.equal(MAX_IMAGES, 5);
  assert.equal(validateImages([user(...Array.from({ length: 5 }, () => part("image/png", png())))]), null);
  assert.match(validateImages([user(...Array.from({ length: 6 }, () => part("image/png", png())))]) ?? "", /at most 5/);
  // Five in each of two messages is fine: the limit is per message.
  assert.equal(validateImages([user(...Array.from({ length: 5 }, () => part("image/webp", webp()))), user(...Array.from({ length: 5 }, () => part("image/webp", webp())))]), null);
});

test("images: only real PNG, JPEG, GIF or WebP data URLs, in user messages, within size", () => {
  assert.match(validateImages([user({ type: "image_url", image_url: { url: "https://example.com/a.png" } })]) ?? "", /data URLs/);
  assert.match(validateImages([user(part("image/svg+xml", png()))]) ?? "", /PNG, JPEG, GIF or WebP/);
  assert.match(validateImages([user(part("image/jpeg", png()))]) ?? "", /not the image\/jpeg/);
  assert.match(validateImages([user(part("image/png", "not base64!"))]) ?? "", /data URLs/);
  assert.match(validateImages([user(part("image/png", png(MAX_IMAGE_BYTES)))]) ?? "", /larger than/);
  assert.match(validateImages([{ role: "assistant", content: [part("image/png", png())] }]) ?? "", /only accepted in user messages/);
  const big = png(500_000);
  assert.match(validateImages([user(...Array.from({ length: 5 }, () => part("image/png", big)))]) ?? "", /too large together/);
});

test("images: the type is read from the bytes", () => {
  assert.equal(sniffImageType(Buffer.from(png(), "base64")), "image/png");
  assert.equal(sniffImageType(Buffer.from(webp(), "base64")), "image/webp");
  assert.equal(sniffImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(sniffImageType(Buffer.from("GIF89a")), "image/gif");
  assert.equal(sniffImageType(Buffer.from("<svg>")), null);
});

test("request budget: older pages and the oldest images are left out, the latest kept", () => {
  const call = (html: string) => ({ role: "assistant", content: null, tool_calls: [{ id: html, type: "function", function: { name: "publish_design", arguments: JSON.stringify({ title: "t", html }) } }] });
  const image = part("image/png", "A".repeat(Math.floor(MAX_REQUEST_IMAGE_CHARS / 4)));
  const body = {
    model: "m",
    messages: [user(image, image), call("<p>v1</p>"), { role: "tool", tool_call_id: "x", content: "ok" }, user(image, image), call("<p>v2</p>")],
  };
  const compact = compactRequest(body);
  const args = (index: number) => JSON.parse((compact.messages[index] as { tool_calls: { function: { arguments: string } }[] }).tool_calls[0].function.arguments);
  assert.equal(args(1).html, OMITTED_DESIGN);
  assert.equal(args(4).html, "<p>v2</p>");
  const kinds = (index: number) => (compact.messages[index] as { content: { type: string; text?: string }[] }).content.map((item) => item.type === "text" ? item.text : item.type);
  assert.deepEqual(kinds(3), ["like this", "image_url", "image_url"], "the newest images stay");
  assert.deepEqual(kinds(0), ["like this", "image_url", OMITTED_IMAGE], "older ones go once the budget is spent");
  assert.equal(JSON.parse(JSON.stringify(body.messages[1])).tool_calls[0].function.arguments.includes("v1"), true, "the input is not modified");
});
