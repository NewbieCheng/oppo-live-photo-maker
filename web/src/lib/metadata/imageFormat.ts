/** Supported reference still formats for metadata import. */
export type ReferenceImageFormat = "jpeg" | "heic" | "heif" | "png" | "webp" | "unknown";

const HEIC_EXT = new Set([".heic", ".heif", ".hif"]);
const JPEG_EXT = new Set([".jpg", ".jpeg", ".jpe"]);
const PNG_EXT = new Set([".png"]);
const WEBP_EXT = new Set([".webp"]);

export function detectReferenceFormat(file: File): ReferenceImageFormat {
  const name = file.name.toLowerCase();
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
  if (HEIC_EXT.has(ext)) return ext === ".heif" ? "heif" : "heic";
  if (JPEG_EXT.has(ext)) return "jpeg";
  if (PNG_EXT.has(ext)) return "png";
  if (WEBP_EXT.has(ext)) return "webp";
  const mime = (file.type || "").toLowerCase();
  if (mime.includes("heic") || mime.includes("heif")) return "heic";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpeg";
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  return "unknown";
}

export function isJpegFormat(fmt: ReferenceImageFormat): boolean {
  return fmt === "jpeg";
}

export function isHeicFamily(fmt: ReferenceImageFormat): boolean {
  return fmt === "heic" || fmt === "heif";
}

export const REFERENCE_IMAGE_ACCEPT =
  "image/jpeg,image/jpg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif";

export function formatLabel(fmt: ReferenceImageFormat): string {
  switch (fmt) {
    case "jpeg":
      return "JPEG";
    case "heic":
    case "heif":
      return "HEIC";
    case "png":
      return "PNG";
    case "webp":
      return "WEBP";
    default:
      return "图片";
  }
}
