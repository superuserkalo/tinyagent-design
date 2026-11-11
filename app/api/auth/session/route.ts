import { sessionUser } from "@/lib/server/hanko";
import { json, sameOrigin } from "@/lib/server/origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** After Hanko's flow succeeds, the page asks whether the server sees the same session. */
export async function GET(request: Request): Promise<Response> {
  if (!sameOrigin(request, { requireOrigin: false })) return json({ authenticated: false }, 403);
  const user = await sessionUser(request);
  return user ? json({ authenticated: true, userId: user.id }) : json({ authenticated: false }, 401);
}
