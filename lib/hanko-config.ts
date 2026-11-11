// Shared by the browser and the server (adapted from radian.sh's lib/hanko/config.ts).
export const HANKO_COOKIE_NAME = "hanko";

export function hankoApiUrl(): string | null {
  const value = process.env.NEXT_PUBLIC_HANKO_API_URL?.trim();
  return value ? value.replace(/\/$/, "") : null;
}
