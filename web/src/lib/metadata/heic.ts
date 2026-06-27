import { isHeicFamily, type ReferenceImageFormat } from "./imageFormat";

/** Decode HEIC/HEIF to JPEG blob for preview, canvas, and metadata fallback. */
export async function heicToJpegBlob(source: Blob): Promise<Blob> {
  const { default: heic2any } = await import("heic2any");
  const result = await heic2any({
    blob: source,
    toType: "image/jpeg",
    quality: 0.92,
  });
  const blob = Array.isArray(result) ? result[0] : result;
  if (!(blob instanceof Blob)) {
    throw new Error("HEIC 解码未返回有效图像");
  }
  return blob;
}

/** Return a blob browsers can display in <img> / createImageBitmap. */
export async function decodeReferenceForDisplay(
  file: Blob,
  format: ReferenceImageFormat,
): Promise<Blob> {
  if (isHeicFamily(format)) {
    return heicToJpegBlob(file);
  }
  return file;
}
