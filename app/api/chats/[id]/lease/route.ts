import { guard, unavailable } from "@/lib/server/auth";
import { sessionStore } from "@/lib/server/db";
import { json } from "@/lib/server/origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/**
 * Take, renew or give back the right to run this chat. Only one tab, on one device,
 * runs a chat at a time; the others watch. A lease lapses if it is not renewed.
 */
export async function POST(request: Request, { params }: Context): Promise<Response> {
  const user = await guard(request, { write: true });
  if (user instanceof Response) return user;
  const { id } = await params;
  const body = await request.json().catch(() => null) as { owner?: unknown; release?: unknown; grant?: { id?: unknown; expiresAt?: unknown } } | null;
  if (typeof body?.owner !== "string") return json({ error: { code: "invalid_request", message: "owner is required." } }, 400);
  try {
    const store = await sessionStore();
    if (body.release === true) {
      await store.release(user.id, id, body.owner);
      return json({ ok: true });
    }
    const result = await store.claim(user.id, id, body.owner);
    if (!result.chat) return json({ error: { code: "not_found", message: "No such chat." } }, 404);
    if (result.ok && typeof body.grant?.id === "string" && typeof body.grant.expiresAt === "number")
      await store.setGrant(user.id, id, { id: body.grant.id, expiresAt: body.grant.expiresAt });
    return json({ ok: result.ok, chat: result.chat, now: Date.now() }, result.ok ? 200 : 409);
  } catch {
    return unavailable();
  }
}
