// Same-origin JSON calls to this site's /api. In `next dev` a named development user
// (?as=name with ?scripted=1) is sent in a header the server honours only in development.
let devUser: string | null = null;

export function setDevUser(name: string | null): void {
  devUser = name;
}

export function apiHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  if (devUser) headers.set("x-tinyagent-dev-user", devUser);
  return headers;
}

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  body: T;
}

export async function api<T = Record<string, unknown>>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<ApiResult<T>> {
  const headers = apiHeaders(init.body === undefined ? undefined : { "Content-Type": "application/json" });
  const response = await fetch(path, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    credentials: "same-origin",
    cache: "no-store",
    signal: init.signal,
  });
  const body = await response.json().catch(() => ({})) as T;
  return { ok: response.ok, status: response.status, body };
}

export function errorMessage(body: unknown, fallback: string): string {
  const error = (body as { error?: { message?: unknown } } | null)?.error;
  return typeof error?.message === "string" ? error.message : fallback;
}
