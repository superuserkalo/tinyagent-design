import { gatewayModel, modelLabel } from "@/lib/server/config";
import { sessionUser } from "@/lib/server/hanko";
import { json, sameOrigin } from "@/lib/server/origin";
import { promptsLeft } from "@/lib/server/quota";
import { quotaStore } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The signed-in radian.sh user and their free prompts left (the composer's pill). */
export async function GET(request: Request): Promise<Response> {
  if (!sameOrigin(request, { requireOrigin: false })) return json({ error: { code: "forbidden_origin", message: "Requests must come from this site." } }, 403);
  const model = modelLabel(gatewayModel());
  const user = await sessionUser(request);
  if (!user) return json({ user: null, promptsLeft: null, model });
  const left = await promptsLeft(quotaStore(), user.id).catch(() => null);
  return json({ user: { id: user.id, email: user.email }, promptsLeft: left, model });
}
