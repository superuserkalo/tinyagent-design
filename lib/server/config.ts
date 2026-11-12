// Server settings, read from the environment when a request needs them.

export const DEFAULT_MODEL = "anthropic/claude-sonnet-5.5";
export const GATEWAY_URL = "https://ai-gateway.vercel.sh/v1/chat/completions";

/** Free prompts a radian.sh account starts with (env FREE_PROMPTS, default 1). Existing accounts keep their count. */
export function freePrompts(): number {
  const value = Number(process.env.FREE_PROMPTS ?? 1);
  return Number.isSafeInteger(value) && value >= 0 && value <= 100 ? value : 1;
}
/** A prompt grant lives this long: enough for a long run and a resume after a reload. */
export const GRANT_TTL_SECONDS = 20 * 60;
/** Model calls one prompt may start. Replaying a call after a reload does not count. */
export const GRANT_MAX_REQUESTS = 16;
/** /api/prompts calls per user per minute. */
export const PROMPT_RATE = { limit: 5, windowSeconds: 60 };
/** Output tokens per model request, thinking included. A long page fits in well under this. */
export const MAX_OUTPUT_TOKENS = 48_000;
/** Request bodies the model route accepts: the chat so far, pages included. */
export const MAX_MODEL_BODY_BYTES = 4_000_000;

export function gatewayModel(): string {
  return process.env.AI_GATEWAY_MODEL?.trim() || DEFAULT_MODEL;
}

/** The name the composer shows: the model without its provider prefix. */
export function modelLabel(model = gatewayModel()): string {
  return model.slice(model.indexOf("/") + 1);
}

/**
 * How hard the model thinks (env AI_GATEWAY_REASONING_EFFORT, default "medium"). On this
 * task Claude Haiku 5.5 at max spent all 128k output tokens thinking and wrote nothing, and
 * at high one scene took 236 s (47k thinking tokens), too close to the 300 s function limit. Claude models are also asked for a summary of their thinking,
 * which the server saves and never shows.
 */
export function reasoningEffort(): string {
  const value = process.env.AI_GATEWAY_REASONING_EFFORT?.trim();
  return value && /^(low|medium|high|xhigh|max)$/.test(value) ? value : "medium";
}

/** The reasoning fields of a gateway request for this model. */
export function reasoningOptions(model: string, effort = reasoningEffort()): { top: Record<string, unknown>; provider: Record<string, unknown> } {
  if (model.startsWith("anthropic/")) return { top: {}, provider: { anthropic: { thinking: { type: "adaptive", display: "summarized" }, effort } } };
  return { top: { reasoning_effort: effort === "max" || effort === "xhigh" ? "high" : effort }, provider: {} };
}
