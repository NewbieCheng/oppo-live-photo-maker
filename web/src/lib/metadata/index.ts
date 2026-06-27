export type { CoverMode, NativeMetadataBundle, PresentationOptions } from "./types";
export { computePresentationTimestampUs } from "./presentation";
export {
  METADATA_FIELD_GROUPS,
  OPPO_SYSTEM_FIELDS,
  emptyBundle,
  mergeBundles,
} from "./fields";
export { parseReferenceImage, parseReferenceImageSync, parseFromTagMap, flattenExifReaderTags, bundleHasEditableFields } from "./parse";
export type { ParseSummary } from "./parse";
export {
  detectReferenceFormat,
  formatLabel,
  isJpegFormat,
  isHeicFamily,
  REFERENCE_IMAGE_ACCEPT,
  type ReferenceImageFormat,
} from "./imageFormat";
export {
  loadReferenceImageFile,
  referenceJpegForMux,
  type LoadedReferenceImage,
} from "./referenceLoad";
export { applyNativeMetadata, buildSyntheticReferenceJpeg, applySourceMetadataEdits, OPPO_USER_COMMENT } from "./apply";
export { copyImageMetadata, type CopyMetadataOptions, type CopyMetadataResult, OPPO_COPY_PRESET } from "./copyMeta";
export {
  computeDirtyKeys,
  hasMetadataEdits,
  sourceEditsForCopy,
  buildEffectiveSourceBundle,
} from "./sourceMetadataEdits";
export {
  buildTagsFromFileArgs,
  validateCopyOptions as validateCopyMetadataOptions,
} from "./copyContract";
export { previewBlobForImageFile, rasterImageToJpegBytes } from "./imageToJpeg";
export { extractRawXmpPackets, buildXmpApp1Segment } from "./xmp";
