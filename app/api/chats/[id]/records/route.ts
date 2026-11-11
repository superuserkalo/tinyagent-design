import { guard, unavailable } from "@/lib/server/auth";
import { sessionStore } from "@/lib/server/db";
import { json } from "@/lib/server/origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** The chat's journal after `after`, a page at a time, and who is running it. */
export async function GET(request: Request, { params }: Context): Promise<Response> {
  const user = await guard(request, { write: false });
  if (user instanceof Response) return user;
  const { id } = await params;
  const after = Number(new URL(request.url).searchParams.get("after") ?? 0);
  if (!Number.isSafeInteger(after) || after < 0) return json({ error: { code: "invalid_request", message: "after must be a record number." } }, 400);
  try {
    const store = await sessionStore();
    const page = await store.load(user.id, id, after);
    if (!page) return json({ error: { code: "not_found", message: "No such chat." } }, 404);
    const chat = await store.chat(user.id, id);
    return json({ ...page, lease: chat?.lease ?? null, grant: chat?.grant ?? null, now: Date.now() });
  } catch {
    return unavailable();
  }
}

/**
 * Append one record (the SDK's Storage.append). It is written only if the journal has
 * exactly `expected` records and no other tab holds the chat: otherwise 409 fenced.
 */
export async function POST(request: Request, { params }: Context): Promise<Response> {
  const user = await guard(request, { write: true });
  if (user instanceof Response) return user;
  const { id } = await params;
  const body = await request.json().catch(() => null) as { expected?: unknown; record?: unknown; owner?: unknown } | null;
  if (!body || typeof body.expected !== "number" || typeof body.owner !== "string" || typeof body.record !== "object" || body.record === null || Array.isArray(body.record))
    return json({ error: { code: "invalid_request", message: "expected, owner and record are required." } }, 400);
  try {
    const result = await (await sessionStore()).append(user.id, id, body.expected, body.record as Record<string, unknown>, body.owner);
    if (result === "ok") return json({ sequence: body.expected + 1 });
    if (result === "fenced") return json({ error: { code: "session_fenced", message: "Another tab or device has written to this chat." } }, 409);
    return json({ error: { code: "not_found", message: "No such chat." } }, 404);
  } catch (error) {
    if (error instanceof RangeError) return json({ error: { code: "too_large", message: "This message is too large to save." } }, 413);
    return unavailable();
  }
}
