import { guard, unavailable } from "@/lib/server/auth";
import { sessionStore } from "@/lib/server/db";
import { json } from "@/lib/server/origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The signed-in user's chats, newest first: the sidebar on every device. */
export async function GET(request: Request): Promise<Response> {
  const user = await guard(request, { write: false });
  if (user instanceof Response) return user;
  try {
    return json({ chats: await (await sessionStore()).list(user.id), now: Date.now() });
  } catch {
    return unavailable();
  }
}

/** Create a chat (if new) and take its lease: this tab will run it. */
export async function POST(request: Request): Promise<Response> {
  const user = await guard(request, { write: true });
  if (user instanceof Response) return user;
  const body = await request.json().catch(() => null) as { id?: unknown; owner?: unknown; title?: unknown } | null;
  if (typeof body?.id !== "string" || typeof body.owner !== "string") return json({ error: { code: "invalid_request", message: "id and owner are required." } }, 400);
  try {
    const result = await (await sessionStore()).claim(user.id, body.id, body.owner, typeof body.title === "string" ? body.title : undefined);
    if (!result.chat) return json({ error: { code: "not_found", message: "No such chat." } }, 404);
    return json(result, result.ok ? 200 : 409);
  } catch {
    return unavailable();
  }
}
