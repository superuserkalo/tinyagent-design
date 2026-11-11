import { guard, unavailable } from "@/lib/server/auth";
import { sessionStore } from "@/lib/server/db";
import { json } from "@/lib/server/origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The chat's published versions, without their HTML. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await guard(request, { write: false });
  if (user instanceof Response) return user;
  try {
    return json({ designs: await (await sessionStore()).designs(user.id, (await params).id) });
  } catch {
    return unavailable();
  }
}
