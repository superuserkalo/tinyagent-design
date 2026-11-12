// POST /api/model/v1/chat/completions: the only way the browser reaches a model.
// The agent loop runs in the tab; it posts each model request here through the
// SDK's ChatCompletionsProvider. This route checks the radian.sh session and the
// prompt grant, then forwards a request it builds itself to Vercel AI Gateway:
// our model, our instructions, our tools only, capped output, the Radian user id
// for reporting. No credential ever reaches the browser.
//
// With a chat id (x-tinyagent-chat) the call runs on the server to its end even if
// the tab goes away, saved as it streams (model-calls.ts). The SDK repeats an
// interrupted step with the same request, and gets the saved output back followed by
// the rest, live: a reload continues mid-step instead of starting the step again.
import { INSTRUCTIONS } from "../agent.ts";
import { GATEWAY_URL, MAX_MODEL_BODY_BYTES, MAX_OUTPUT_TOKENS, reasoningOptions } from "./config.ts";
import type { UserLookup } from "./hanko.ts";
import { validateRequest } from "./request-shape.ts";
import { json, sameOrigin } from "./origin.ts";
import { ModelCalls, callId } from "./model-calls.ts";
import { useGrant, checkGrant } from "./quota.ts";
import { SESSION_ID } from "./sessions.ts";
import type { QuotaStore, SqlExecutor } from "./store.ts";

export const GRANT_HEADER = "x-tinyagent-grant";
export const CHAT_HEADER = "x-tinyagent-chat";

export interface ModelRouteDeps {
  user: UserLookup;
  store: () => QuotaStore | Promise<QuotaStore>;
  /** AI_GATEWAY_API_KEY, else the Vercel OIDC token; null when neither exists. */
  credential: () => Promise<string | null>;
  model: string;
  fetch?: typeof fetch;
  /** Where calls that outlive the tab are saved. Without it, the gateway stream is passed straight through. */
  calls?: () => Promise<SqlExecutor>;
  /** Keeps the function alive until a call ends (Next's after() on Vercel). */
  waitUntil?: (work: Promise<unknown>) => void;
  now?: () => number;
}

const STREAM_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-store, no-transform",
  "X-Accel-Buffering": "no",
};

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

  // The instructions are ours, whatever the page sent.
  const messages = [{ role: "system", content: INSTRUCTIONS },
    ...(body.messages as Message[]).filter((message) => message.role !== "system" && message.role !== "developer")];
  const reasoning = reasoningOptions(deps.model);
  const forwarded: Record<string, unknown> = {
    model: deps.model,
    messages,
    ...(Array.isArray(body.tools) && body.tools.length ? { tools: body.tools } : {}),
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: MAX_OUTPUT_TOKENS,
    ...reasoning.top,
    user: user.id,
    // caching "auto": the long system prompt (brief and starter scenes) is cached by the provider.
    providerOptions: { gateway: { user: user.id, tags: ["app:tinyagent-design"], caching: "auto" }, ...reasoning.provider },
  };

  // A call this tab (or another) already started: replay it and follow it. Not charged again.
  const chatId = request.headers.get(CHAT_HEADER);
  let calls: ModelCalls | null = null;
  let id = "";
  if (deps.calls && chatId && SESSION_ID.test(chatId)) {
    try {
      calls = new ModelCalls(await deps.calls(), deps.now);
      id = await callId(user.id, chatId, forwarded);
      if (calls.replayable(await calls.get(id))) {
        // Not counted again, but it still takes a live grant of this user's.
        if (await checkGrant(await deps.store(), grantId, user.id) !== "ok") return fail(403, "grant_expired", "This prompt's grant has expired. Send a new prompt.");
        return new Response(calls.follow(id), { status: 200, headers: STREAM_HEADERS });
      }
    } catch {
      return fail(503, "storage_unavailable", "Chats are unavailable right now. Try again shortly.");
    }
  }

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

  let attempt: number | null = null;
  if (calls) {
    try {
      attempt = await calls.claim(id, user.id, chatId!, deps.model);
    } catch {
      return fail(503, "storage_unavailable", "Chats are unavailable right now. Try again shortly.");
    }
    // Another request started this same call a moment ago: follow that one.
    if (attempt === null) return new Response(calls.follow(id), { status: 200, headers: STREAM_HEADERS });
  }

  // A saved call keeps running when the tab goes away; only the stop button ends it.
  const abort = new AbortController();
  let upstream: Response;
  try {
    upstream = await (deps.fetch ?? fetch)(GATEWAY_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${credential}`, "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify(forwarded),
      signal: calls ? abort.signal : request.signal,
    });
  } catch {
    if (calls) await calls.fail(id, attempt!, "The model gateway could not be reached.").catch(() => {});
    return fail(502, "gateway_unreachable", "The model gateway could not be reached.");
  }
  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    let message = "The model gateway refused the request.";
    try { message = String(JSON.parse(detail)?.error?.message ?? message).slice(0, 300); } catch {}
    if (calls) await calls.fail(id, attempt!, message).catch(() => {});
    // 429 and 5xx keep their status so the SDK retries them; anything else is final.
    const status = upstream.status === 429 || upstream.status >= 500 ? upstream.status : 502;
    return fail(status, "gateway_error", message);
  }
  if (!calls) return new Response(upstream.body, { status: 200, headers: STREAM_HEADERS });

  const { live, done } = calls.run(id, attempt!, upstream.body, abort);
  deps.waitUntil?.(done);
  return new Response(live, { status: 200, headers: STREAM_HEADERS });
}
