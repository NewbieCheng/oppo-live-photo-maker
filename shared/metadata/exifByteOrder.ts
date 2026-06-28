/** Read TIFF byte order from JPEG EXIF APP1. */
import { isExifApp1, scanJpegSegments } from "./segments.js";

export type ExifByteOrder = "II" | "MM";

type TagMap = Record<string, unknown>;

/** Return TIFF byte order from first EXIF APP1, or null when absent. */
export function readExifByteOrder(jpeg: Uint8Array): ExifByteOrder | null {
  for (const seg of scanJpegSegments(jpeg)) {
    if (!isExifApp1(seg)) continue;
    const payload = seg.payload;
    if (payload.length < 12) return null;
    if (payload[10] === 0x49 && payload[11] === 0x49) return "II";
    if (payload[10] === 0x4d && payload[11] === 0x4d) return "MM";
    return null;
  }
  return null;
}

/** Parse ExifTool ExifByteOrder label or raw II/MM. */
export function parseExifByteOrderLabel(value: unknown): ExifByteOrder | null {
  if (value == null || value === "") return null;
  const s = String(value).trim().toUpperCase();
  if (s === "II" || s.includes("INTEL") || s.includes("LITTLE")) return "II";
  if (s === "MM" || s.includes("MOTOROLA") || s.includes("BIG")) return "MM";
  return null;
}

function tagValue(tags: TagMap, ...keys: string[]): unknown {
  for (const key of keys) {
    const v = tags[key];
    if (v != null && v !== "") return v;
  }
  return undefined;
}

/**
 * Byte order to use when copying / patching EXIF onto dest.
 * Prefer source metadata; OPPO Find X8 live-photo samples use II (little-endian).
 */
export function inferCopyExifByteOrder(
  sourceTags: TagMap = {},
  sourceJpeg?: Uint8Array,
): ExifByteOrder {
  const fromTags = parseExifByteOrderLabel(
    tagValue(sourceTags, "File:ExifByteOrder", "ExifByteOrder"),
  );
  if (fromTags) return fromTags;
  if (sourceJpeg) {
    const fromBytes = readExifByteOrder(sourceJpeg);
    if (fromBytes) return fromBytes;
  }
  const make = String(tagValue(sourceTags, "IFD0:Make", "EXIF:Make", "Make") ?? "");
  if (/oppo/i.test(make)) return "II";
  return "II";
}
