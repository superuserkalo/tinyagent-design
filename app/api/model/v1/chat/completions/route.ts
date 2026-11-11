import { gatewayModel } from "@/lib/server/config";
import { gatewayCredential } from "@/lib/server/gateway";
import { sessionUser } from "@/lib/server/hanko";
import { handleModelRequest } from "@/lib/server/model-route";
import { quotaStore } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A long page streams for a while; the SDK's own timeout per request is 180 s.
export const maxDuration = 300;

export function POST(request: Request): Promise<Response> {
  return handleModelRequest(request, { user: sessionUser, store: quotaStore, credential: gatewayCredential, model: gatewayModel() });
}
