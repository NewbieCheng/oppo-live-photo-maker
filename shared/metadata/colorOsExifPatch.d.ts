/**
 * Patch ColorOS-critical EXIF after copy: Interop IFD, image size, byte order (match source).
 */
import { type ExifByteOrder } from "./exifByteOrder.js";
import type { CopyMetadataOptions } from "./copyContract.js";
type TagMap = Record<string, unknown>;
/** OPPO / DCF default InteropIndex when source lacks InteropIFD (common for HEIC). */
export declare const DEFAULT_COLOROS_INTEROP_INDEX = "R98";
export declare const DEFAULT_COLOROS_INTEROP_VERSION = "0100";
/** EXIF YCbCrPositioning: Centered */
export declare const DEFAULT_COLOROS_YCBCR_POSITIONING = 1;
export interface ColorOsExifSupplementPlan {
    byteOrder?: ExifByteOrder;
    interopIndex?: string;
    interopVersion?: string;
    ycbcrPositioning?: number;
    exifImageWidth?: number;
    exifImageHeight?: number;
}
/**
 * Plan missing ColorOS EXIF fields on dest, aligning byte order with source when provided.
 */
export declare function planColorOsExifSupplement(jpeg: Uint8Array, destTags?: TagMap, sourceTags?: TagMap, sourceJpeg?: Uint8Array): ColorOsExifSupplementPlan;
export declare function hasColorOsExifSupplement(plan: ColorOsExifSupplementPlan): boolean;
/** ExifTool CLI args to apply supplement plan (-m ignore minor errors). Byte order uses segment realign, not ExifTool. */
export declare function buildExiftoolSupplementArgs(plan: ColorOsExifSupplementPlan): string[];
/** Dest EXIF byte order differs from source (ExifTool JPEG writes often end up II). */
export declare function needsExifByteOrderRealign(destJpeg: Uint8Array, sourceTags?: TagMap, sourceJpeg?: Uint8Array): boolean;
/**
 * Replace metadata APP segments from a JPEG source (preserves MM/II structure from source).
 * Use when TagsFromFile rewrote EXIF as II but OPPO source is MM.
 */
export declare function realignExifFromJpegSource(destJpeg: Uint8Array, sourceJpeg: Uint8Array, options?: CopyMetadataOptions): Uint8Array;
/** Whether dest EXIF byte order matches source (or inferred OPPO default). */
export declare function destExifByteOrderMatchesSource(destJpeg: Uint8Array, destTags: TagMap, sourceTags: TagMap, sourceJpeg?: Uint8Array): boolean;
export {};
