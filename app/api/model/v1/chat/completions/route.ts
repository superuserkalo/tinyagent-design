import { gatewayModel } from "@/lib/server/config";
import { gatewayCredential } from "@/lib/server/gateway";
import { requestUser } from "@/lib/server/auth";
import { handleModelRequest } from "@/lib/server/model-route";
import { quotaStore } from "@/lib/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A long page streams for a while; the SDK's own timeout per request is 180 s.
export const maxDuration = 300;

export function POST(request: Request): Promise<Response> {
  return handleModelRequest(request, { user: (request) => requestUser(request), store: quotaStore, credential: gatewayCredential, model: gatewayModel() });
}
