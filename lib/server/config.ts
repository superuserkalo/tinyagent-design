// Server settings, read from the environment when a request needs them.

export const DEFAULT_MODEL = "anthropic/claude-haiku-5.5";
export const GATEWAY_URL = "https://ai-gateway.vercel.sh/v1/chat/completions";

/** Free prompts per radian.sh account. */
export const FREE_PROMPTS = 3;
/** A prompt grant lives this long: enough for a long run and a resume after a reload. */
export const GRANT_TTL_SECONDS = 20 * 60;
/** Model requests one prompt may make, retries and resumes included. */
export const GRANT_MAX_REQUESTS = 40;
/** /api/prompts calls per user per minute. */
export const PROMPT_RATE = { limit: 5, windowSeconds: 60 };
/** Output tokens per model request. A long page fits in well under this. */
export const MAX_OUTPUT_TOKENS = 24_000;
/** Request bodies the model route accepts: the chat so far, pages included. */
export const MAX_MODEL_BODY_BYTES = 3_000_000;

export function gatewayModel(): string {
  return process.env.AI_GATEWAY_MODEL?.trim() || DEFAULT_MODEL;
}

/** The name the composer shows: the model without its provider prefix. */
export function modelLabel(model = gatewayModel()): string {
  return model.slice(model.indexOf("/") + 1);
}
