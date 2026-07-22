import type { GalleryImage } from "../../../shared/types";

export async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value);
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.readOnly = true;
  textarea.style.cssText = "position:fixed;opacity:0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Copy failed");
}

function mimeType(image: GalleryImage): string {
  return image.type === "jpeg" ? "image/jpeg" : `image/${image.type}`;
}

function supportsClipboardType(type: string): boolean {
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") return false;
  return typeof ClipboardItem.supports !== "function" || ClipboardItem.supports(type);
}

async function writeBlob(blob: Blob, type: string): Promise<void> {
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") throw new Error("Image clipboard is unavailable");
  await navigator.clipboard.write([new ClipboardItem({ [type]: blob })]);
}

async function pngBlob(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not prepare image");
    context.drawImage(bitmap, 0, 0);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(
      (value) => value ? resolve(value) : reject(new Error("Could not convert image")),
      "image/png",
    ));
  } finally {
    bitmap.close();
  }
}

export async function copyImage(image: GalleryImage, url: string): Promise<void> {
  const response = await fetch(url, { cache: "force-cache" });
  if (!response.ok) throw new Error(`Could not load image (${response.status})`);
  const blob = await response.blob();
  const type = blob.type || mimeType(image);
  if (supportsClipboardType(type)) {
    try {
      await writeBlob(blob, type);
      return;
    } catch {
      // Static formats receive a PNG fallback below.
    }
  }
  if (image.type === "gif") throw new Error("Animated GIF clipboard is unsupported");
  const png = type === "image/png" ? blob : await pngBlob(blob);
  await writeBlob(png, "image/png");
}
