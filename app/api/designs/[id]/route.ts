import { guard, unavailable } from "@/lib/server/auth";
import { sessionStore } from "@/lib/server/db";
import { json } from "@/lib/server/origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** One published page. */
export async function GET(request: Request, { params }: Context): Promise<Response> {
  const user = await guard(request, { write: false });
  if (user instanceof Response) return user;
  try {
    const design = await (await sessionStore()).design(user.id, decodeURIComponent((await params).id));
    return design ? json(design, 200, { "Cache-Control": "private, max-age=31536000, immutable" }) : json({ error: { code: "not_found", message: "No such design." } }, 404);
  } catch {
    return unavailable();
  }
}

/** Store a page under its publish_design executionId. Idempotent: a rerun overwrites. */
export async function PUT(request: Request, { params }: Context): Promise<Response> {
  const user = await guard(request, { write: true });
  if (user instanceof Response) return user;
  const body = await request.json().catch(() => null) as { title?: unknown; html?: unknown } | null;
  if (typeof body?.title !== "string" || typeof body.html !== "string") return json({ error: { code: "invalid_request", message: "title and html are required." } }, 400);
  try {
    const ok = await (await sessionStore()).putDesign(user.id, decodeURIComponent((await params).id), body.title, body.html);
    return ok ? json({ ok: true }) : json({ error: { code: "not_found", message: "No such chat." } }, 404);
  } catch {
    return unavailable();
  }
}
