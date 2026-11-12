// Limits for images attached to a prompt, shared by the composer and the model route.
// Every model request re-sends the chat, so the budget is set by Vercel's 4.5 MB
// request limit: five images at about 260 KB each, plus text and the latest design.

export const MAX_IMAGES = 5;
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
/** Longest side the composer sends. */
export const MAX_IMAGE_SIDE = 1568;
/** What the composer aims for per image, encoded. */
export const TARGET_IMAGE_BYTES = 260 * 1024;
/** What the server accepts per image, decoded. */
export const MAX_IMAGE_BYTES = 700 * 1024;
/** Images in one model request, all user messages together, as base64 characters. */
export const MAX_REQUEST_IMAGE_CHARS = 2_200_000;

export type ImageType = (typeof IMAGE_TYPES)[number];

/** The type a file's first bytes say it is, or null. Declared types are not trusted. */
export function sniffImageType(bytes: Uint8Array): ImageType | null {
  const starts = (...values: number[]) => values.every((value, index) => bytes[index] === value);
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (starts(0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  return null;
}
