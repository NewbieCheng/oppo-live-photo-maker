export type ExifByteOrder = "II" | "MM";
type TagMap = Record<string, unknown>;
/** Return TIFF byte order from first EXIF APP1, or null when absent. */
export declare function readExifByteOrder(jpeg: Uint8Array): ExifByteOrder | null;
/** Parse ExifTool ExifByteOrder label or raw II/MM. */
export declare function parseExifByteOrderLabel(value: unknown): ExifByteOrder | null;
/**
 * Byte order to use when copying / patching EXIF onto dest.
 * Prefer source metadata; OPPO phone originals are typically MM.
 */
export declare function inferCopyExifByteOrder(sourceTags?: TagMap, sourceJpeg?: Uint8Array): ExifByteOrder;
export {};
