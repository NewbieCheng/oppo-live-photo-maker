/**
 * ColorOS EXIF validation (no ExifTool / WASM dependency).
 */
import { type ExifByteOrder } from "./exifByteOrder.js";
type TagMap = Record<string, unknown>;
export interface ColorOsExifValidation {
    ok: boolean;
    issues: string[];
    exifByteOrder: ExifByteOrder | null;
}
export interface ColorOsExifValidateOptions {
    motionPhoto?: boolean;
    trailingLength?: number;
}
export declare function hasMpfApp2Segment(jpeg: Uint8Array): boolean;
export declare function validateColorOsExif(jpeg: Uint8Array, tags?: TagMap, options?: ColorOsExifValidateOptions): ColorOsExifValidation;
export declare function needsColorOsExifResync(jpeg: Uint8Array, tags?: TagMap, options?: {
    requireMakerNotes?: boolean;
}): boolean;
export declare function hasExifApp1Segment(jpeg: Uint8Array): boolean;
export {};
