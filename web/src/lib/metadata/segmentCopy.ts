/**
 * GExiv2-style metadata copy: transplant raw APP segments instead of rewriting EXIF in place.
 * Preserves little-endian (II) TIFF structure, MakerNotes binary, and Interop IFD.
 */
import { buildSyntheticReferenceJpeg } from "./apply";
import type { CopyMetadataOptions } from "./copyContract";
import { parsedExiftoolTagsToBundle } from "./copyWritableTags";
import { agentLog } from "./exiftoolDebug";
import { parseMetadataJson, syncFullExifFromSource } from "./exiftoolWasmRunner";
import { readExifByteOrder } from "./exifByteOrder";
import { isJpegFormat, type ReferenceImageFormat } from "./imageFormat";
import {
  extractMetadataSegments,
  insertAfterAppSegments,
  stripMetadataForCopy,
} from "./segments";

function segmentOptions(options: CopyMetadataOptions) {
  return {
    excludeExif: options.excludeExif,
    excludeXmp: options.excludeXmp,
    excludeIptc: options.excludeIptc,
  };
}

/** Materialize metadata APP segments from HEIC/PNG/WebP via piexif (ExifTool write breaks on canvas). */
async function materializeMetadataSegmentsFromSource(
  sourceFile: File,
  options: CopyMetadataOptions,
): Promise<Uint8Array[]> {
  const parsed = await parseMetadataJson<Record<string, unknown>[]>(sourceFile, [
    "-json",
    "-G1",
    "-U",
  ]);
  const tags = parsed[0] ?? {};
  const bundle = parsedExiftoolTagsToBundle(tags, options);
  const hasUserComment = Boolean(bundle.exif.UserComment);
  const canvas = buildSyntheticReferenceJpeg(bundle, !hasUserComment);
  agentLog("H3", "segmentCopy.ts:materializeMetadataSegmentsFromSource", "piexif canvas", {
    sourceOriginal: sourceFile.name,
    exifFields: Object.keys(bundle.exif).length,
    method: "piexif-synthetic",
    runId: "post-fix-v2",
  });
  return extractMetadataSegments(canvas, segmentOptions(options));
}

/**
 * Copy metadata by transplanting APP segments (matches live-photo-conv GExiv2 save_file).
 * JPEG sources use raw segment bytes; other formats materialize via piexif then transplant.
 */
export async function copyMetadataViaSegmentTransplant(
  destJpeg: Uint8Array,
  sourceFile: File,
  sourceBytes: Uint8Array,
  sourceFormat: ReferenceImageFormat,
  options: CopyMetadataOptions,
): Promise<Uint8Array> {
  const opts = segmentOptions(options);

  let segments: Uint8Array[];
  if (isJpegFormat(sourceFormat)) {
    segments = extractMetadataSegments(sourceBytes, opts);
  } else {
    segments = await materializeMetadataSegmentsFromSource(sourceFile, options);
  }

  if (segments.length === 0) {
    return destJpeg;
  }

  let working = stripMetadataForCopy(destJpeg, opts);
  working = insertAfterAppSegments(working, segments);

  if (!options.excludeExif && isJpegFormat(sourceFormat) && readExifByteOrder(working) === "MM") {
    working = await syncFullExifFromSource(working, sourceFile);
  }

  return working;
}
