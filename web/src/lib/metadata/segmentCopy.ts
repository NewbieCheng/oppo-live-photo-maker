/**
 * GExiv2-style metadata copy: transplant raw APP segments instead of rewriting EXIF in place.
 * Preserves little-endian (II) TIFF structure, MakerNotes binary, and Interop IFD.
 */
import { minimalJpeg } from "./apply";
import { buildTagsFromFileArgs, type CopyMetadataOptions } from "./copyContract";
import { readExifByteOrder } from "./exifByteOrder";
import { syncFullExifFromSource, tagsFromFileCopy } from "./exiftoolWasmRunner";
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

/** Materialize metadata APP segments from HEIC/PNG/WebP via ExifTool on a minimal JPEG canvas. */
async function materializeMetadataSegmentsFromSource(
  sourceFile: File,
  options: CopyMetadataOptions,
): Promise<Uint8Array[]> {
  let canvas = await tagsFromFileCopy(
    new File([minimalJpeg().slice()], "canvas.jpg", { type: "image/jpeg" }),
    sourceFile,
    buildTagsFromFileArgs(options),
  );

  if (!options.excludeExif) {
    canvas = await syncFullExifFromSource(canvas, sourceFile);
  }

  return extractMetadataSegments(canvas, segmentOptions(options));
}

/**
 * Copy metadata by transplanting APP segments (matches live-photo-conv GExiv2 save_file).
 * JPEG sources use raw segment bytes; other formats materialize via ExifTool then transplant.
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

  if (!options.excludeExif && !isJpegFormat(sourceFormat)) {
    working = await syncFullExifFromSource(working, sourceFile);
  } else if (!options.excludeExif && readExifByteOrder(working) === "MM") {
    working = await syncFullExifFromSource(working, sourceFile);
  }

  return working;
}
