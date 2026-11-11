// /api routes only answer this site. A browser names the page that sent a request in
// Origin (always for POST) and Sec-Fetch-Site; anything from another site is refused.

export function siteOrigin(request: Request): string {
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host;
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

function allowedOrigins(request: Request): Set<string> {
  const extra = (process.env.APP_ORIGINS ?? "").split(",").map((value) => value.trim().replace(/\/$/, "")).filter(Boolean);
  return new Set([siteOrigin(request), ...extra]);
}

/** POST and other writes must carry this site's Origin. Reads may omit it, but never name another site. */
export function sameOrigin(request: Request, { requireOrigin }: { requireOrigin: boolean }): boolean {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin) return !requireOrigin;
  return allowedOrigins(request).has(origin);
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store", ...headers } });
}
