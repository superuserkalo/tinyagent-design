// Images in a model request: only base64 data URLs of real PNG, JPEG, GIF or WebP files,
// at most five per user message, each and all together within the limits in lib/images.ts.
import { IMAGE_TYPES, MAX_IMAGES, MAX_IMAGE_BYTES, MAX_REQUEST_IMAGE_CHARS, sniffImageType } from "../images.ts";

const DATA_URL = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/;

export function validateImages(messages: { role: string; content?: unknown }[]): string | null {
  let total = 0;
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue;
    let count = 0;
    for (const part of message.content as { type?: unknown; image_url?: { url?: unknown } }[]) {
      if (part?.type !== "image_url") continue;
      if (message.role !== "user") return "images are only accepted in user messages";
      count += 1;
      if (count > MAX_IMAGES) return `a message can carry at most ${MAX_IMAGES} images`;
      const url = part.image_url?.url;
      const match = typeof url === "string" ? DATA_URL.exec(url) : null;
      if (!match) return "images must be base64 data URLs";
      const [, declared, data] = match;
      if (!(IMAGE_TYPES as readonly string[]).includes(declared)) return "images must be PNG, JPEG, GIF or WebP";
      total += data.length;
      if (total > MAX_REQUEST_IMAGE_CHARS) return "the images in this request are too large together";
      const bytes = Buffer.from(data, "base64");
      if (bytes.length > MAX_IMAGE_BYTES) return `an image is larger than ${Math.round(MAX_IMAGE_BYTES / 1024)} KB`;
      if (sniffImageType(bytes) !== declared) return `an image is not the ${declared} it claims to be`;
    }
  }
  return null;
}
