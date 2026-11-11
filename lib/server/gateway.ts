import { getVercelOidcToken } from "@vercel/oidc";

/**
 * How this server authenticates to Vercel AI Gateway: AI_GATEWAY_API_KEY when set,
 * otherwise the project's OIDC token. On Vercel the OIDC token arrives with each
 * function invocation (x-vercel-oidc-token) and rotates, so it is read per request;
 * `vercel env pull` writes VERCEL_OIDC_TOKEN for local development.
 */
export async function gatewayCredential(): Promise<string | null> {
  const key = process.env.AI_GATEWAY_API_KEY?.trim();
  if (key) return key;
  try {
    return await getVercelOidcToken();
  } catch {
    return process.env.VERCEL_OIDC_TOKEN?.trim() || null;
  }
}
