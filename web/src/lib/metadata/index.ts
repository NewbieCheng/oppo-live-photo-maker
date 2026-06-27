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
export { applyNativeMetadata, buildSyntheticReferenceJpeg, OPPO_USER_COMMENT } from "./apply";
