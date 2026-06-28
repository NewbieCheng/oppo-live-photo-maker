export type { CoverMode, NativeMetadataBundle, PresentationOptions } from "./types";
export { computePresentationTimestampUs } from "./presentation";
export {
  METADATA_FIELD_GROUPS,
  emptyBundle,
  mergeBundles,
  type MetadataFieldDef,
} from "./fields";
export { parseReferenceImage, parseReferenceImageSync, parseFromTagMap, flattenExifReaderTags, bundleHasEditableFields, parseMakerNoteJson } from "./parse";
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
export { copyImageMetadata, type CopyMetadataOptions, type CopyMetadataResult, OPPO_COPY_PRESET, LIVE_PHOTO_TARGET_PRESET, FULL_COPY_PRESET } from "./copyMeta";
export {
  computeDirtyKeys,
  dirtyBundleForWrite,
  hasMetadataEdits,
  sourceEditsForCopy,
  buildEffectiveSourceBundle,
} from "./sourceMetadataEdits";
export { editSourceMetadata, editFormatHint, type EditMetadataResult } from "./editMetadata";
export {
  buildTagsFromFileArgs,
  validateCopyOptions as validateCopyMetadataOptions,
} from "./copyContract";
export { previewBlobForImageFile, rasterImageToJpegBytes } from "./imageToJpeg";
export { extractRawXmpPackets, buildXmpApp1Segment } from "./xmp";
export {
  buildOppoMotionPhotoWithNative,
  buildLivePhotoFromReference,
  buildLivePhotoWithMetadata,
  mergeReferenceEdits,
  muxOptionsFromBundle,
} from "./nativeMux";
export {
  createFindX8UltraTemplate,
  FIND_X8_ULTRA_TEMPLATE_LABEL,
  metadataSourceLabel,
  type MetadataSourceMode,
} from "./metadataTemplate";
export {
  applySpoofAfterMotionPhotoMux,
  applyExifSpoofKeepingMotionXmp,
  computeSpoofDirtyKeys,
  FEATURE_ONE_SPOOF_GROUP_IDS,
  mergeSpoofBundles,
  spoofBundleFrom,
} from "./spoofMetadata";
