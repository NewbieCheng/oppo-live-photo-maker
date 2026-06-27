/** Read TIFF byte order from JPEG EXIF APP1 (ColorOS requires II on OPPO devices). */
import { isExifApp1, scanJpegSegments } from "./segments";

export type ExifByteOrder = "II" | "MM";

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
