import { decodeReferenceForDisplay } from "./heic";
import { detectReferenceFormat, isJpegFormat, type ReferenceImageFormat } from "./imageFormat";

/** Blob browsers can render in `<img>` (HEIC → JPEG, others pass-through). */
export async function previewBlobForImageFile(file: File): Promise<Blob> {
  const format = detectReferenceFormat(file);
  return decodeReferenceForDisplay(file, format);
}

async function encodeBitmapAsJpeg(bitmap: ImageBitmap, quality: number): Promise<Uint8Array> {
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D 不可用");
  ctx.drawImage(bitmap, 0, 0);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("JPEG 编码失败"))),
      "image/jpeg",
      quality,
    );
  });
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Normalize any supported still image to standard JPEG bytes (pixels only).
 * JPEG inputs are kept as-is; HEIC/PNG/WebP are decoded and re-encoded.
 */
export async function rasterImageToJpegBytes(
  file: Blob,
  quality = 0.92,
): Promise<Uint8Array> {
  const format = detectReferenceFormat(file as File);
  if (isJpegFormat(format)) {
    return new Uint8Array(await file.arrayBuffer());
  }
  const displayBlob = await decodeReferenceForDisplay(file, format);
  const bitmap = await createImageBitmap(displayBlob);
  try {
    return await encodeBitmapAsJpeg(bitmap, quality);
  } finally {
    bitmap.close();
  }
}

export function isSupportedImageFormat(format: ReferenceImageFormat): boolean {
  return format !== "unknown";
}
