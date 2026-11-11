import { sessionUser } from "@/lib/server/hanko";
import { json, sameOrigin } from "@/lib/server/origin";
import { startPrompt } from "@/lib/server/quota";
import { quotaStore } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Spend one free prompt and get the grant its model requests carry. */
export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request, { requireOrigin: true })) return json({ error: { code: "forbidden_origin", message: "Requests must come from this site." } }, 403);
  const user = await sessionUser(request);
  if (!user) return json({ error: { code: "not_signed_in", message: "Sign in with your Radian account." } }, 401);
  let result;
  try {
    result = await startPrompt(quotaStore(), user.id);
  } catch {
    return json({ error: { code: "quota_unavailable", message: "Prompt accounting is unavailable. Try again shortly." } }, 503);
  }
  if (!result.ok) {
    return result.error === "rate_limited"
      ? json({ error: { code: "rate_limited", message: "Too many prompts at once. Wait a minute and try again." }, remaining: result.remaining }, 429, { "Retry-After": "60" })
      : json({ error: { code: "no_prompts_left", message: "Your free prompts are used." }, remaining: 0 }, 402);
  }
  return json({ grant: result.grant, remaining: result.remaining });
}
