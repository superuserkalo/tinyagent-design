// POST /api/model/v1/chat/completions: the only way the browser reaches a model.
// The agent loop runs in the tab; it posts each model request here through the
// SDK's ChatCompletionsProvider. This route checks the radian.sh session and the
// prompt grant, then forwards a request it builds itself to Vercel AI Gateway:
// our model, our instructions, our tools only, capped output, the Radian user id
// for reporting. The gateway's SSE stream comes back unbuffered. No credential
// ever reaches the browser.
import { INSTRUCTIONS } from "../agent.ts";
import { GATEWAY_URL, MAX_MODEL_BODY_BYTES, MAX_OUTPUT_TOKENS } from "./config.ts";
import type { UserLookup } from "./hanko.ts";
import { validateRequest } from "./request-shape.ts";
import { json, sameOrigin } from "./origin.ts";
import { useGrant } from "./quota.ts";
import type { QuotaStore } from "./store.ts";

export const GRANT_HEADER = "x-tinyagent-grant";

export interface ModelRouteDeps {
  user: UserLookup;
  store: () => QuotaStore | Promise<QuotaStore>;
  /** AI_GATEWAY_API_KEY, else the Vercel OIDC token; null when neither exists. */
  credential: () => Promise<string | null>;
  model: string;
  fetch?: typeof fetch;
}

const fail = (status: number, code: string, message: string) => json({ error: { code, message } }, status);

type Message = { role: string; content?: unknown };

export async function handleModelRequest(request: Request, deps: ModelRouteDeps): Promise<Response> {
  if (!sameOrigin(request, { requireOrigin: true })) return fail(403, "forbidden_origin", "Requests must come from this site.");

  const user = await deps.user(request);
  if (!user) return fail(401, "not_signed_in", "Sign in with your Radian account.");

  const grantId = request.headers.get(GRANT_HEADER);
  if (!grantId) return fail(403, "no_grant", "This request has no prompt grant. Send the prompt again.");

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_MODEL_BODY_BYTES) return fail(413, "too_large", "This chat is too long to continue. Start a new design.");
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_MODEL_BODY_BYTES) return fail(413, "too_large", "This chat is too long to continue. Start a new design.");
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text);
  } catch {
    return fail(400, "invalid_json", "The request body is not JSON.");
  }
  const problem = validateRequest(body);
  if (problem) return fail(400, problem.includes("image") ? "invalid_images" : problem.includes("tool") ? "invalid_tools" : "invalid_request",
    problem.charAt(0).toUpperCase() + problem.slice(1) + ".");

  // Counted only once the request is known to be well formed.
  let use;
  try {
    use = await useGrant(await deps.store(), grantId, user.id);
  } catch {
    return fail(503, "quota_unavailable", "Prompt accounting is unavailable. Try again shortly.");
  }
  if (use === "missing" || use === "wrong_user") return fail(403, "grant_expired", "This prompt's grant has expired. Send a new prompt.");
  if (use === "exhausted") return fail(429, "grant_exhausted", "This prompt used all of its model requests.");

  const credential = await deps.credential();
  if (!credential) return fail(503, "gateway_not_configured", "The model gateway is not configured on this deployment.");

  // The instructions are ours, whatever the page sent.
  const messages = [{ role: "system", content: INSTRUCTIONS },
    ...(body.messages as Message[]).filter((message) => message.role !== "system" && message.role !== "developer")];
  const forwarded: Record<string, unknown> = {
    model: deps.model,
    messages,
    ...(Array.isArray(body.tools) && body.tools.length ? { tools: body.tools } : {}),
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: MAX_OUTPUT_TOKENS,
    user: user.id,
    providerOptions: { gateway: { user: user.id, tags: ["app:tinyagent-design"] } },
  };

  let upstream: Response;
  try {
    upstream = await (deps.fetch ?? fetch)(GATEWAY_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${credential}`, "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify(forwarded),
      signal: request.signal,
    });
  } catch {
    return fail(502, "gateway_unreachable", "The model gateway could not be reached.");
  }
  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    let message = "The model gateway refused the request.";
    try { message = String(JSON.parse(detail)?.error?.message ?? message).slice(0, 300); } catch {}
    // 429 and 5xx keep their status so the SDK retries them; anything else is final.
    const status = upstream.status === 429 || upstream.status >= 500 ? upstream.status : 502;
    return fail(status, "gateway_error", message);
  }
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
