// Radian accounts: the same Hanko project as radian.sh (adapted from radian.sh's
// lib/hanko/server.ts and server-session.ts). The browser's Hanko SDK keeps the
// session token in the "hanko" cookie on this site; the server asks Hanko whether
// it is valid on every request that spends something.
import { HANKO_COOKIE_NAME, hankoApiUrl } from "../hanko-config.ts";

export interface HankoSessionClaims {
  subject?: string;
  email?: { address?: string; is_primary?: boolean; is_verified?: boolean };
  session_id?: string;
}

export interface HankoSession {
  is_valid: boolean;
  claims?: HankoSessionClaims;
  user_id?: string;
}

export interface SessionUser {
  id: string;
  email: string | null;
}

export type UserLookup = (request: Request) => Promise<SessionUser | null>;

const REQUEST_TIMEOUT_MS = 8_000;

// Server checks go to the browser's Hanko project unless HANKO_SERVER_API_URL points elsewhere
// (a local validator in tests). Leave it unset in deployments.
function serverApiUrl(): string | null {
  const value = process.env.HANKO_SERVER_API_URL?.trim();
  return value ? value.replace(/\/$/, "") : hankoApiUrl();
}

export async function validateHankoSessionToken(token: string | undefined, fetcher: typeof fetch = fetch): Promise<HankoSession | null> {
  const apiUrl = serverApiUrl();
  if (!apiUrl || !token || token.length > 4096) return null;
  try {
    const response = await fetcher(`${apiUrl}/sessions/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_token: token }),
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const session = (await response.json()) as HankoSession;
    return session.is_valid ? session : null;
  } catch {
    return null;
  }
}

export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) {
      const value = part.slice(index + 1).trim();
      try { return decodeURIComponent(value); } catch { return value; }
    }
  }
  return undefined;
}

/** The signed-in radian.sh user behind this request, or null. */
export const sessionUser: UserLookup = async (request) => {
  const session = await validateHankoSessionToken(readCookie(request, HANKO_COOKIE_NAME));
  const id = session?.claims?.subject || session?.user_id;
  if (!session || !id) return null;
  return { id, email: session.claims?.email?.address ?? null };
};
