/**
 * copy-img-meta (browser) — ExifTool WASM TagsFromFile, aligned with live-photo-conv.
 */
import {
  validateCopyOptions,
  type CopyMetadataOptions,
} from "./copyContract";
import { copyViaExiftool } from "./exiftoolCopy";
import type { ColorOsExifValidation } from "./colorOsExif";
import { debugLog } from "./exiftoolDebug";
import { detectReferenceFormat } from "./imageFormat";
import { isSupportedImageFormat } from "./imageToJpeg";

export type { CopyMetadataOptions } from "./copyContract";
export { OPPO_COPY_PRESET } from "./copyContract";

export interface CopyMetadataResult {
  bytes: Uint8Array;
  sourceFieldCount: number;
  xmpPacketCount: number;
  /** Make/Model read from source (before copy). */
  sourceMake?: string;
  sourceModel?: string;
  /** Make/Model verified on output JPEG after copy. */
  outputMake?: string;
  outputModel?: string;
  outputExifCount: number;
  /** ColorOS native parser compatibility (II EXIF, Interop, MotionPhoto XMP). */
  colorOsExif?: ColorOsExifValidation;
  /** True when output keeps the destination file extension (ExifTool in-place semantics). */
  destPreservedFormat: boolean;
  /** Suggested download filename (backend may set via Content-Disposition). */
  downloadName?: string;
  /** Backend engine id when copied via local service. */
  backendUsed?: string;
}

type TagStats = {
  fieldCount: number;
  xmpPacketCount: number;
  make?: string;
  model?: string;
  exifCount: number;
};

function pickMakeModel(tags: Record<string, unknown>): { make?: string; model?: string } {
  return {
    make:
      (tags["IFD0:Make"] as string | undefined) ??
      (tags["EXIF:Make"] as string | undefined) ??
      (tags["QuickTime:Make"] as string | undefined),
    model:
      (tags["IFD0:Model"] as string | undefined) ??
      (tags["EXIF:Model"] as string | undefined) ??
      (tags["QuickTime:Model"] as string | undefined),
  };
}

function computeTagStats(
  tags: Record<string, unknown>,
  options: CopyMetadataOptions,
): TagStats {
  let fieldCount = 0;
  let xmpPacketCount = 0;
  let exifCount = 0;

  for (const [key, value] of Object.entries(tags)) {
    if (key === "SourceFile" || key === "ExifToolVersion" || value === undefined || value === null) {
      continue;
    }
    const group = key.includes(":") ? key.split(":")[0] : "";
    if (options.excludeExif && (group === "EXIF" || group === "Composite" || group === "GPS" || group === "IFD0")) {
      continue;
    }
    if (options.excludeIptc && group === "IPTC") continue;
    if (options.excludeXmp && group === "XMP") continue;
    if (group === "XMP") xmpPacketCount++;
    if (group === "EXIF" || group === "IFD0" || group === "GPS" || group === "Composite") {
      exifCount++;
    }
    fieldCount++;
  }

  const { make, model } = options.excludeExif ? {} : pickMakeModel(tags);
  return { fieldCount, xmpPacketCount, make, model, exifCount };
}

/**
 * Copy metadata from *sourceFile* onto *destFile* pixels (live-photo-conv copy-img-meta).
 * Destination container format is preserved (JPEG / PNG / WebP / HEIC).
 */
export async function copyImageMetadata(
  destFile: File,
  sourceFile: File,
  options: CopyMetadataOptions = {},
): Promise<CopyMetadataResult> {
  validateCopyOptions(options);

  const destFormat = detectReferenceFormat(destFile);
  const sourceFormat = detectReferenceFormat(sourceFile);
  if (!isSupportedImageFormat(destFormat)) {
    throw new Error("目标图格式不支持，请使用 JPG / HEIC / PNG / WebP");
  }
  if (!isSupportedImageFormat(sourceFormat)) {
    throw new Error("源图格式不支持，请使用 JPG / HEIC / PNG / WebP");
  }

  const { bytes, sourceTags, outputTags, colorOsExif } = await copyViaExiftool(destFile, sourceFile, options);
  const sourceStats = computeTagStats(sourceTags, options);
  const outputStats = computeTagStats(outputTags, options);

  debugLog("C", "copyMeta.ts:copyImageMetadata", "done", {
    byteLength: bytes.byteLength,
    sourceMake: sourceStats.make,
    outputMake: outputStats.make,
    outputExifCount: outputStats.exifCount,
  });

  return {
    bytes,
    sourceFieldCount: sourceStats.fieldCount,
    xmpPacketCount: sourceStats.xmpPacketCount,
    sourceMake: sourceStats.make,
    sourceModel: sourceStats.model,
    outputMake: outputStats.make,
    outputModel: outputStats.model,
    outputExifCount: outputStats.exifCount,
    colorOsExif,
    destPreservedFormat: true,
  };
}
