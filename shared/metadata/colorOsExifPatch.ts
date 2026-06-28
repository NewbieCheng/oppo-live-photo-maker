/**
 * Patch ColorOS-critical EXIF after copy: Interop IFD, image size, byte order (match source).
 */
import {
  inferCopyExifByteOrder,
  parseExifByteOrderLabel,
  readExifByteOrder,
  type ExifByteOrder,
} from "./exifByteOrder.js";
import type { CopyMetadataOptions } from "./copyContract.js";
import { readJpegDimensions } from "./jpegDimensions.js";
import { copyMetadataViaSegmentTransplantSync } from "./segmentCopySync.js";

type TagMap = Record<string, unknown>;

/** OPPO / DCF default InteropIndex when source lacks InteropIFD (common for HEIC). */
export const DEFAULT_COLOROS_INTEROP_INDEX = "R98";
export const DEFAULT_COLOROS_INTEROP_VERSION = "0100";
/** EXIF YCbCrPositioning: Centered */
export const DEFAULT_COLOROS_YCBCR_POSITIONING = 1;

export interface ColorOsExifSupplementPlan {
  byteOrder?: ExifByteOrder;
  interopIndex?: string;
  interopVersion?: string;
  ycbcrPositioning?: number;
  exifImageWidth?: number;
  exifImageHeight?: number;
  offsetTimeOriginal?: string;
}

function tagValue(tags: TagMap, ...keys: string[]): unknown {
  for (const key of keys) {
    const v = tags[key];
    if (v != null && v !== "") return v;
  }
  return undefined;
}

function numericTag(tags: TagMap, ...keys: string[]): number | undefined {
  const v = tagValue(tags, ...keys);
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Plan missing ColorOS EXIF fields on dest, aligning byte order with source when provided.
 */
export function planColorOsExifSupplement(
  jpeg: Uint8Array,
  destTags: TagMap = {},
  sourceTags?: TagMap,
  sourceJpeg?: Uint8Array,
): ColorOsExifSupplementPlan {
  const plan: ColorOsExifSupplementPlan = {};

  const desiredOrder =
    sourceTags != null
      ? inferCopyExifByteOrder(sourceTags, sourceJpeg)
      : inferCopyExifByteOrder(destTags, jpeg);
  const currentOrder = readExifByteOrder(jpeg);
  if (currentOrder != null && currentOrder !== desiredOrder) {
    plan.byteOrder = desiredOrder;
  } else if (currentOrder == null && desiredOrder) {
    plan.byteOrder = desiredOrder;
  }

  if (
    !tagValue(
      destTags,
      "InteropIFD:InteropIndex",
      "EXIF:InteropIndex",
      "InteropIndex",
      "ExifIFD:InteropIndex",
    )
  ) {
    const srcInterop = tagValue(
      sourceTags ?? {},
      "InteropIFD:InteropIndex",
      "EXIF:InteropIndex",
      "InteropIndex",
      "ExifIFD:InteropIndex",
    );
    plan.interopIndex =
      srcInterop != null
        ? String(srcInterop).startsWith("R98")
          ? "R98"
          : String(srcInterop)
        : DEFAULT_COLOROS_INTEROP_INDEX;
    const srcInteropVer = tagValue(
      sourceTags ?? {},
      "InteropIFD:InteropVersion",
      "EXIF:InteropVersion",
      "InteropVersion",
    );
    plan.interopVersion =
      srcInteropVer != null ? String(srcInteropVer) : DEFAULT_COLOROS_INTEROP_VERSION;
  } else if (
    !tagValue(destTags, "InteropIFD:InteropVersion", "EXIF:InteropVersion", "InteropVersion")
  ) {
    const srcInteropVer = tagValue(
      sourceTags ?? {},
      "InteropIFD:InteropVersion",
      "EXIF:InteropVersion",
      "InteropVersion",
    );
    plan.interopVersion =
      srcInteropVer != null ? String(srcInteropVer) : DEFAULT_COLOROS_INTEROP_VERSION;
  }

  if (!tagValue(destTags, "IFD0:YCbCrPositioning", "EXIF:YCbCrPositioning", "YCbCrPositioning")) {
    plan.ycbcrPositioning = DEFAULT_COLOROS_YCBCR_POSITIONING;
  }

  const dims = readJpegDimensions(jpeg);
  if (dims) {
    const exifW = numericTag(
      destTags,
      "ExifIFD:ExifImageWidth",
      "EXIF:ExifImageWidth",
      "ExifImageWidth",
    );
    const exifH = numericTag(
      destTags,
      "ExifIFD:ExifImageHeight",
      "EXIF:ExifImageHeight",
      "ExifImageHeight",
    );
    if (exifW == null || exifW <= 0 || exifW !== dims.width) plan.exifImageWidth = dims.width;
    if (exifH == null || exifH <= 0 || exifH !== dims.height) plan.exifImageHeight = dims.height;
  }

  if (
    !tagValue(
      destTags,
      "ExifIFD:OffsetTimeOriginal",
      "EXIF:OffsetTimeOriginal",
      "OffsetTimeOriginal",
    )
  ) {
    const srcOffset = tagValue(
      sourceTags ?? {},
      "ExifIFD:OffsetTimeOriginal",
      "EXIF:OffsetTimeOriginal",
      "OffsetTimeOriginal",
    );
    if (srcOffset != null && String(srcOffset).trim()) {
      plan.offsetTimeOriginal = String(srcOffset).trim();
    }
  }

  return plan;
}

export function hasColorOsExifSupplement(plan: ColorOsExifSupplementPlan): boolean {
  return (
    plan.interopIndex != null ||
    plan.interopVersion != null ||
    plan.ycbcrPositioning != null ||
    plan.exifImageWidth != null ||
    plan.exifImageHeight != null ||
    plan.offsetTimeOriginal != null
  );
}

/** ExifTool CLI args to apply supplement plan (-m ignore minor errors). Byte order uses segment realign, not ExifTool. */
export function buildExiftoolSupplementArgs(plan: ColorOsExifSupplementPlan): string[] {
  const args: string[] = ["-api", "ByteOrder=II", "-m"];
  if (plan.interopIndex != null) {
    args.push(`-InteropIFD:InteropIndex=${plan.interopIndex}`);
  }
  if (plan.interopVersion != null) {
    args.push(`-InteropIFD:InteropVersion=${plan.interopVersion}`);
  }
  if (plan.ycbcrPositioning != null) {
    args.push(`-IFD0:YCbCrPositioning=${plan.ycbcrPositioning === 1 ? "Centered" : plan.ycbcrPositioning}`);
  }
  if (plan.exifImageWidth != null) args.push(`-ExifIFD:ExifImageWidth=${plan.exifImageWidth}`);
  if (plan.exifImageHeight != null) args.push(`-ExifIFD:ExifImageHeight=${plan.exifImageHeight}`);
  if (plan.offsetTimeOriginal != null) {
    args.push(`-ExifIFD:OffsetTimeOriginal=${plan.offsetTimeOriginal}`);
  }
  return args;
}

/** Dest EXIF byte order differs from source (ExifTool JPEG writes often end up II). */
export function needsExifByteOrderRealign(
  destJpeg: Uint8Array,
  sourceTags: TagMap = {},
  sourceJpeg?: Uint8Array,
): boolean {
  const desired = inferCopyExifByteOrder(sourceTags, sourceJpeg);
  const current = readExifByteOrder(destJpeg);
  return current != null && current !== desired;
}

/**
 * Replace metadata APP segments from a JPEG source (preserves MM/II structure from source).
 * Use when TagsFromFile rewrote EXIF as II but OPPO source is MM.
 */
export function realignExifFromJpegSource(
  destJpeg: Uint8Array,
  sourceJpeg: Uint8Array,
  options: CopyMetadataOptions = {},
): Uint8Array {
  return copyMetadataViaSegmentTransplantSync(destJpeg, sourceJpeg, options);
}

/** Whether dest EXIF byte order matches source (or inferred OPPO default). */
export function destExifByteOrderMatchesSource(
  destJpeg: Uint8Array,
  destTags: TagMap,
  sourceTags: TagMap,
  sourceJpeg?: Uint8Array,
): boolean {
  const desired = inferCopyExifByteOrder(sourceTags, sourceJpeg);
  const current = readExifByteOrder(destJpeg);
  if (current != null) return current === desired;
  const fromTags = parseExifByteOrderLabel(
    tagValue(destTags, "File:ExifByteOrder", "ExifByteOrder"),
  );
  return fromTags === desired;
}
