import { guard, unavailable } from "@/lib/server/auth";
import { sqlExecutor } from "@/lib/server/db";
import { ModelCalls } from "@/lib/server/model-calls";
import { json } from "@/lib/server/origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** The stop button: end the chat's running model call on the server, not only in the tab. */
export async function POST(request: Request, { params }: Context): Promise<Response> {
  const user = await guard(request, { write: true });
  if (user instanceof Response) return user;
  try {
    await new ModelCalls(await sqlExecutor()).cancel(user.id, (await params).id);
    return json({ ok: true });
  } catch {
    return unavailable();
  }
}
