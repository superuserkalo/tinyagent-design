// Who is asking. A radian.sh session (the "hanko" cookie, checked with Hanko), or in
// `next dev` only, a named development user from the x-tinyagent-dev-user header, so
// the scripted mode and two-browser tests can run without signing in.
import { sessionUser, type SessionUser } from "./hanko.ts";
import { json, sameOrigin } from "./origin.ts";

export const DEV_USER_HEADER = "x-tinyagent-dev-user";

export async function requestUser(request: Request, lookup = sessionUser): Promise<SessionUser | null> {
  if (process.env.NODE_ENV === "development") {
    const name = request.headers.get(DEV_USER_HEADER);
    if (name && /^[a-z0-9-]{1,32}$/.test(name)) return { id: `dev:${name}`, email: `${name}@dev.local` };
  }
  return lookup(request);
}

/** The signed-in user, or the response that refuses the request. Writes must carry this site's Origin. */
export async function guard(request: Request, { write }: { write: boolean }): Promise<SessionUser | Response> {
  if (!sameOrigin(request, { requireOrigin: write })) return json({ error: { code: "forbidden_origin", message: "Requests must come from this site." } }, 403);
  const user = await requestUser(request);
  return user ?? json({ error: { code: "not_signed_in", message: "Sign in with your Radian account." } }, 401);
}

export function unavailable(): Response {
  return json({ error: { code: "storage_unavailable", message: "Chats are unavailable right now. Try again shortly." } }, 503);
}
