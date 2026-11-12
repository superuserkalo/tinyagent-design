// An attached image as the composer sends it: at most 1568 px on a side, WebP (JPEG
// where the browser cannot encode WebP), around 260 KB. The same bytes go to the model
// and into the chat's journal.
import { MAX_IMAGES, MAX_IMAGE_SIDE, TARGET_IMAGE_BYTES } from "../images.ts";

export interface AttachedImage {
  mediaType: string;
  /** Base64, without the data: prefix. */
  data: string;
  /** A data: URL for display. */
  url: string;
  width: number;
  height: number;
}

export { MAX_IMAGES };

const MAX_SOURCE_BYTES = 40 * 1024 * 1024;
const MAX_SOURCE_PIXELS = 60_000_000;

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("unable to read the image."));
    reader.readAsDataURL(blob);
  });
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

export async function normalizeImage(file: File): Promise<AttachedImage> {
  if (!file.type.startsWith("image/")) throw new Error("only images can be attached.");
  if (file.size > MAX_SOURCE_BYTES) throw new Error("that image is larger than 40 MB.");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("this image format is not supported. Use PNG, JPEG, GIF or WebP.");
  }
  try {
    if (bitmap.width * bitmap.height > MAX_SOURCE_PIXELS) throw new Error("that image has too many pixels.");
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("unable to read the image.");
    let smallest: Blob | null = null;
    for (const side of [MAX_IMAGE_SIDE, 1280, 1024]) {
      const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      // White under transparency, so JPEG and WebP look the same as the original on white.
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.82, 0.7, 0.58]) {
        let blob = await toBlob(canvas, "image/webp", quality);
        if (!blob || blob.type !== "image/webp") blob = await toBlob(canvas, "image/jpeg", quality);
        if (!blob) continue;
        if (!smallest || blob.size < smallest.size) smallest = blob;
        if (blob.size <= TARGET_IMAGE_BYTES) return finish(blob, canvas.width, canvas.height);
      }
    }
    if (!smallest) throw new Error("unable to read the image.");
    return finish(smallest, canvas.width, canvas.height);
  } finally {
    bitmap.close();
  }
}

async function finish(blob: Blob, width: number, height: number): Promise<AttachedImage> {
  const url = await blobToDataUrl(blob);
  return { mediaType: blob.type, data: url.slice(url.indexOf(",") + 1), url, width, height };
}
