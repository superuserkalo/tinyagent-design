import { guard, unavailable } from "@/lib/server/auth";
import { sessionStore } from "@/lib/server/db";
import { json } from "@/lib/server/origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context): Promise<Response> {
  const user = await guard(request, { write: false });
  if (user instanceof Response) return user;
  try {
    const chat = await (await sessionStore()).chat(user.id, (await params).id);
    return chat ? json({ chat, now: Date.now() }) : json({ error: { code: "not_found", message: "No such chat." } }, 404);
  } catch {
    return unavailable();
  }
}

/** Rename or remove a chat. Its journal is never deleted. */
export async function PATCH(request: Request, { params }: Context): Promise<Response> {
  const user = await guard(request, { write: true });
  if (user instanceof Response) return user;
  const { id } = await params;
  const body = await request.json().catch(() => null) as { title?: unknown; hidden?: unknown } | null;
  try {
    const store = await sessionStore();
    if (!(await store.chat(user.id, id))) return json({ error: { code: "not_found", message: "No such chat." } }, 404);
    if (typeof body?.title === "string") await store.setTitle(user.id, id, body.title);
    if (body?.hidden === true) await store.hide(user.id, id);
    return json({ ok: true });
  } catch {
    return unavailable();
  }
}
