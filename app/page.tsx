import { connection } from "next/server";
import DesignApp from "@/components/design-app";
import { gatewayModel, modelLabel } from "@/lib/server/config";

export default async function Page() {
  // Rendered per request: the CSP nonce is new each time.
  await connection();
  return <DesignApp model={modelLabel(gatewayModel())} devTools={process.env.NODE_ENV === "development"} />;
}
