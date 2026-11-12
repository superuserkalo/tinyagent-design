import { after } from "next/server";
import { gatewayModel } from "@/lib/server/config";
import { gatewayCredential } from "@/lib/server/gateway";
import { requestUser } from "@/lib/server/auth";
import { handleModelRequest } from "@/lib/server/model-route";
import { quotaStore, sqlExecutor } from "@/lib/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The call runs to its end here even after the tab goes away; a long page with thinking
// fits well inside five minutes (the Hobby plan's limit).
export const maxDuration = 300;

export function POST(request: Request): Promise<Response> {
  return handleModelRequest(request, {
    user: (request) => requestUser(request),
    store: quotaStore,
    credential: gatewayCredential,
    model: gatewayModel(),
    calls: sqlExecutor,
    waitUntil: (work) => after(work),
  });
}
