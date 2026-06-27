/** Detect image format from magic bytes and optional filename. */
export type ImageFormat =
  | "jpeg"
  | "heic"
  | "heif"
  | "png"
  | "webp"
  | "tiff"
  | "avif"
  | "unknown";

function hasFtypBrand(bytes: Uint8Array, brand: string): boolean {
  if (bytes.length < 12) return false;
  if (bytes[4] !== 0x66 || bytes[5] !== 0x74 || bytes[6] !== 0x79 || bytes[7] !== 0x70) {
    return false;
  }
  const major = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
  return major === brand;
}

export function detectFormatFromBytes(bytes: Uint8Array, filename = ""): ImageFormat {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) return "jpeg";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "png";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "webp";
  }
  if (bytes.length >= 4 && (bytes[0] === 0x49 || bytes[0] === 0x4d) && bytes[1] === bytes[0]) {
    if (bytes[2] === 0x2a && bytes[3] === 0x00) return "tiff";
  }
  if (hasFtypBrand(bytes, "heic") || hasFtypBrand(bytes, "heix") || hasFtypBrand(bytes, "mif1")) {
    return "heic";
  }
  if (hasFtypBrand(bytes, "heif") || hasFtypBrand(bytes, "hevc")) return "heif";
  if (hasFtypBrand(bytes, "avif") || hasFtypBrand(bytes, "avis")) return "avif";

  const lower = filename.toLowerCase();
  const ext = lower.includes(".") ? lower.slice(lower.lastIndexOf(".")) : "";
  if ([".jpg", ".jpeg", ".jpe"].includes(ext)) return "jpeg";
  if ([".heic", ".hif"].includes(ext)) return "heic";
  if (ext === ".heif") return "heif";
  if (ext === ".png") return "png";
  if (ext === ".webp") return "webp";
  if ([".tif", ".tiff"].includes(ext)) return "tiff";
  if (ext === ".avif") return "avif";
  return "unknown";
}

export function isJpegFormat(fmt: ImageFormat): boolean {
  return fmt === "jpeg";
}
