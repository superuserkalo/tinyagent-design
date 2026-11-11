import { requestUser } from "@/lib/server/auth";
import { freePrompts, gatewayModel, modelLabel } from "@/lib/server/config";
import { quotaStore } from "@/lib/server/db";
import { json, sameOrigin } from "@/lib/server/origin";
import { promptsLeft } from "@/lib/server/quota";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The signed-in user, their free prompts left (the composer's pill) and the model the server runs. */
export async function GET(request: Request): Promise<Response> {
  if (!sameOrigin(request, { requireOrigin: false })) return json({ error: { code: "forbidden_origin", message: "Requests must come from this site." } }, 403);
  const base = { model: modelLabel(gatewayModel()), freePrompts: freePrompts() };
  const user = await requestUser(request);
  if (!user) return json({ ...base, user: null, promptsLeft: null });
  const left = await quotaStore().then((store) => promptsLeft(store, user.id)).catch(() => null);
  return json({ ...base, user: { id: user.id, email: user.email }, promptsLeft: left });
}
