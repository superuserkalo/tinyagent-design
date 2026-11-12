// What the model route accepts, deny by default. A request must look exactly like what
// the SDK's ChatCompletionsProvider sends for this site's agent: these top-level fields,
// these message shapes, text and image parts only, this site's tools only. Anything
// else (other part types such as files or audio, routing or cost fields such as
// `models`, `providerOptions`, `n`, `modalities`, `audio`, extra keys) is refused, so the
// paid route cannot be used for anything but this agent.
import { TOOL_NAMES } from "../tools.ts";
import { validateImages } from "./images.ts";

type Value = Record<string, unknown>;

const isObject = (value: unknown): value is Value => typeof value === "object" && value !== null && !Array.isArray(value);
const onlyKeys = (value: Value, allowed: readonly string[]) => Object.keys(value).every((key) => allowed.includes(key));
const isToolName = (value: unknown) => typeof value === "string" && (TOOL_NAMES as readonly string[]).includes(value);

export const TOP_LEVEL = ["model", "messages", "tools", "stream", "stream_options"] as const;
export const MAX_MESSAGES = 400;

function part(value: unknown): string | null {
  if (!isObject(value)) return "a content part is not an object";
  if (value.type === "text") {
    if (!onlyKeys(value, ["type", "text"])) return "a text part has unexpected fields";
    return typeof value.text === "string" ? null : "a text part's text must be a string";
  }
  if (value.type === "image_url") {
    if (!onlyKeys(value, ["type", "image_url"]) || !isObject(value.image_url) || !onlyKeys(value.image_url, ["url"]) || typeof value.image_url.url !== "string")
      return "an image part must be { type: \"image_url\", image_url: { url } }";
    return null;
  }
  return `content parts of type ${JSON.stringify(value.type)} are not accepted`;
}

function message(value: unknown): string | null {
  if (!isObject(value)) return "a message is not an object";
  switch (value.role) {
    case "system":
    case "developer":
      if (!onlyKeys(value, ["role", "content"]) || typeof value.content !== "string") return "a system message must be { role, content: string }";
      return null;
    case "user": {
      if (!onlyKeys(value, ["role", "content"])) return "a user message has unexpected fields";
      if (typeof value.content === "string") return null;
      if (!Array.isArray(value.content) || value.content.length === 0) return "a user message's content must be a string or a list of parts";
      for (const item of value.content) {
        const problem = part(item);
        if (problem) return problem;
      }
      return null;
    }
    case "assistant": {
      if (!onlyKeys(value, ["role", "content", "tool_calls"])) return "an assistant message has unexpected fields";
      if (value.content !== null && value.content !== undefined && typeof value.content !== "string") return "an assistant message's content must be a string or null";
      if (value.tool_calls === undefined) return null;
      if (!Array.isArray(value.tool_calls)) return "tool_calls must be a list";
      for (const call of value.tool_calls) {
        if (!isObject(call) || !onlyKeys(call, ["id", "type", "function"]) || typeof call.id !== "string" || call.type !== "function" ||
            !isObject(call.function) || !onlyKeys(call.function, ["name", "arguments"]) || !isToolName(call.function.name) || typeof call.function.arguments !== "string")
          return "a tool call must be a function call to one of this site's tools";
      }
      return null;
    }
    case "tool":
      if (!onlyKeys(value, ["role", "tool_call_id", "content"]) || typeof value.tool_call_id !== "string" || typeof value.content !== "string")
        return "a tool message must be { role, tool_call_id, content: string }";
      return null;
    default:
      return `messages with role ${JSON.stringify(value.role)} are not accepted`;
  }
}

function tool(value: unknown): string | null {
  if (!isObject(value) || !onlyKeys(value, ["type", "function"]) || value.type !== "function") return "tools must be functions";
  const fn = value.function;
  if (!isObject(fn) || !onlyKeys(fn, ["name", "description", "parameters"]) || !isToolName(fn.name) ||
      (fn.description !== undefined && typeof fn.description !== "string") || (fn.parameters !== undefined && !isObject(fn.parameters)))
    return "only this site's tools may be sent";
  return null;
}

/** Null when the request has exactly the shape this site's agent sends; otherwise why not. */
export function validateRequest(body: unknown): string | null {
  if (!isObject(body)) return "the request body must be a JSON object";
  const extra = Object.keys(body).filter((key) => !(TOP_LEVEL as readonly string[]).includes(key));
  if (extra.length) return `unexpected request fields: ${extra.slice(0, 5).join(", ")}`;
  if (body.model !== undefined && typeof body.model !== "string") return "model must be a string";
  if (body.stream !== undefined && body.stream !== true) return "only streaming requests are accepted";
  if (body.stream_options !== undefined && (!isObject(body.stream_options) || !onlyKeys(body.stream_options, ["include_usage"]) || typeof body.stream_options.include_usage !== "boolean"))
    return "stream_options may only set include_usage";
  if (!Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > MAX_MESSAGES) return "messages must be a list of chat messages";
  for (const item of body.messages) {
    const problem = message(item);
    if (problem) return problem;
  }
  if (body.tools !== undefined) {
    if (!Array.isArray(body.tools)) return "tools must be a list";
    for (const item of body.tools) {
      const problem = tool(item);
      if (problem) return problem;
    }
  }
  return validateImages(body.messages as { role: string; content?: unknown }[]);
}
