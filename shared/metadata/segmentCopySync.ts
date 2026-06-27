/**
 * GExiv2-style JPEG metadata copy via raw APP segment transplant (sync, no WASM).
 */
import type { CopyMetadataOptions } from "./copyContract.js";
import {
  extractMetadataSegments,
  insertAfterAppSegments,
  stripMetadataForCopy,
} from "./segments.js";

export function copyMetadataViaSegmentTransplantSync(
  destJpeg: Uint8Array,
  sourceBytes: Uint8Array,
  options: CopyMetadataOptions = {},
): Uint8Array {
  const segments = extractMetadataSegments(sourceBytes, options);
  if (segments.length === 0) return destJpeg;
  const working = stripMetadataForCopy(destJpeg, options);
  return insertAfterAppSegments(working, segments);
}
