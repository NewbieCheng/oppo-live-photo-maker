/**
 * Shared copy-img-meta contract + web-only sourceEdits.
 */
import type { CopyMetadataOptions as BaseCopyMetadataOptions } from "@shared/copyContract";
import type { NativeMetadataBundle } from "./types";

export type { CopyMetadataOptions as BaseCopyMetadataOptions } from "@shared/copyContract";

export interface CopyMetadataOptions extends BaseCopyMetadataOptions {
  sourceEdits?: NativeMetadataBundle;
}

export {
  OPPO_COPY_PRESET,
  LIVE_PHOTO_TARGET_PRESET,
  FULL_COPY_PRESET,
  validateCopyOptions,
  buildTagsFromFileArgs,
  vfsBasename,
} from "@shared/copyContract";
