/**
 * Extended mux with reference EXIF transplant (desktop-style).
 * Not used by feature-one; only for metadata workflows / tests.
 */
import { buildOppoMotionPhoto } from "../muxer";
import { applyNativeMetadata } from "./apply";
import type { NativeMetadataBundle } from "./types";

export interface NativeMuxOptions {
  presentationTimestampUs?: number;
  nativeMetadata?: NativeMetadataBundle;
  referenceJpeg?: Uint8Array;
}

export function buildOppoMotionPhotoWithNative(
  coverJpeg: Uint8Array,
  videoMp4: Uint8Array,
  options: NativeMuxOptions = {},
): Uint8Array {
  let cover = coverJpeg;
  if (options.nativeMetadata || options.referenceJpeg) {
    cover = applyNativeMetadata(cover, options.nativeMetadata, options.referenceJpeg);
  }
  return buildOppoMotionPhoto(cover, videoMp4, {
    presentationTimestampUs: options.presentationTimestampUs,
  });
}
