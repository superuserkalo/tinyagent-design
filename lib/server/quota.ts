// Free prompts: 3 per radian.sh account. Sending a message spends one and returns
// a prompt grant, a random id the browser sends with every model request of that
// run. A resume after a reload reuses the grant, so it is not charged again.
import { FREE_PROMPTS, GRANT_MAX_REQUESTS, GRANT_TTL_SECONDS, PROMPT_RATE } from "./config.ts";
import type { GrantUse, QuotaStore } from "./store.ts";

export interface Grant {
  id: string;
  expiresAt: number;
}

export type StartPrompt =
  | { ok: true; grant: Grant; remaining: number }
  | { ok: false; error: "rate_limited" | "no_prompts_left"; remaining: number };

export function newGrantId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return "g_" + Buffer.from(bytes).toString("base64url");
}

export async function promptsLeft(store: QuotaStore, userId: string): Promise<number> {
  return store.remaining(userId, FREE_PROMPTS);
}

export async function startPrompt(store: QuotaStore, userId: string, now = Date.now()): Promise<StartPrompt> {
  if (!await store.hit(`prompts:${userId}`, PROMPT_RATE.limit, PROMPT_RATE.windowSeconds))
    return { ok: false, error: "rate_limited", remaining: await promptsLeft(store, userId) };
  const id = newGrantId();
  const remaining = await store.consume(userId, FREE_PROMPTS, id, GRANT_TTL_SECONDS, GRANT_MAX_REQUESTS);
  if (remaining === null) return { ok: false, error: "no_prompts_left", remaining: 0 };
  return { ok: true, grant: { id, expiresAt: now + GRANT_TTL_SECONDS * 1000 }, remaining };
}

export async function useGrant(store: QuotaStore, grantId: string, userId: string): Promise<GrantUse> {
  if (!/^g_[A-Za-z0-9_-]{32}$/.test(grantId)) return "missing";
  return store.useGrant(grantId, userId);
}
