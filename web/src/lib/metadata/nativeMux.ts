/**
 * Feature-one mux with optional reference EXIF transplant + custom XMP/EXIF.
 */
import { buildOppoMotionPhoto, type MuxOptions } from "../muxer";
import { applyNativeMetadata, buildSyntheticReferenceJpeg } from "./apply";
import { mergeBundles } from "./fields";
import { computePresentationTimestampUs } from "./presentation";
import type { LoadedReferenceImage } from "./referenceLoad";
import { applySpoofAfterMotionPhotoMux } from "./spoofMetadata";
import type { CoverMode, NativeMetadataBundle } from "./types";

export interface NativeMuxOptions extends MuxOptions {
  nativeMetadata?: NativeMetadataBundle;
  referenceJpeg?: Uint8Array;
  coverTime?: number;
  segmentStart?: number;
  coverMode?: CoverMode;
}

/** Build mux options from merged metadata bundle (XMP mode, UserComment, timestamps). */
export function muxOptionsFromBundle(
  bundle: NativeMetadataBundle | undefined,
  coverTime = 0,
  segmentStart = 0,
  coverMode: CoverMode = "videoFrame",
): MuxOptions {
  if (!bundle) {
    return {
      presentationTimestampUs: Math.max(0, Math.round((coverTime - segmentStart) * 1_000_000)),
      xmpMode: "native",
    };
  }

  const gainMapRaw = bundle.xmp?.container?.gainMapLength;
  const gainMapLength =
    gainMapRaw != null && gainMapRaw !== "" && Number.isFinite(Number(gainMapRaw))
      ? Number(gainMapRaw)
      : undefined;

  return {
    presentationTimestampUs: computePresentationTimestampUs({
      coverMode,
      coverTime,
      start: segmentStart,
      referenceTimestampUs: bundle.presentationTimestampUs,
      userOverrideUs: bundle.presentationTimestampUs,
      userSet: bundle.presentationTimestampUserSet ?? false,
    }),
    xmpMode: bundle.xmp?.mode ?? "native",
    gainMapLength,
    hdrgmVersion: bundle.xmp?.hdrgm?.version,
    userComment: bundle.exif.UserComment,
    includeMpf: false,
  };
}

export function mergeReferenceEdits(
  loaded: LoadedReferenceImage | null,
  edits: NativeMetadataBundle,
): NativeMetadataBundle | undefined {
  if (!loaded) return undefined;
  return mergeBundles(loaded.bundle, edits);
}

/** JPEG bytes for EXIF segment transplant or synthetic reference canvas. */
export function referenceJpegBytesForMux(
  loaded: LoadedReferenceImage,
  merged: NativeMetadataBundle,
): Uint8Array | undefined {
  if (loaded.useSegmentTransplant) return loaded.originalBytes;
  return buildSyntheticReferenceJpeg(merged, false);
}

export function buildOppoMotionPhotoWithNative(
  coverJpeg: Uint8Array,
  videoMp4: Uint8Array,
  options: NativeMuxOptions = {},
): Uint8Array {
  const coverTime = options.coverTime ?? 0;
  const segmentStart = options.segmentStart ?? 0;
  const coverMode = options.coverMode ?? "videoFrame";
  const muxOpts = muxOptionsFromBundle(options.nativeMetadata, coverTime, segmentStart, coverMode);

  let cover = coverJpeg;
  if (options.nativeMetadata || options.referenceJpeg) {
    cover = applyNativeMetadata(cover, options.nativeMetadata, options.referenceJpeg, {
      injectOppoMarker: !options.nativeMetadata?.exif?.UserComment,
    });
  }

  return buildOppoMotionPhoto(cover, videoMp4, {
    ...muxOpts,
    ...options,
    presentationTimestampUs: options.presentationTimestampUs ?? muxOpts.presentationTimestampUs,
    xmpMode: options.xmpMode ?? muxOpts.xmpMode,
    gainMapLength: options.gainMapLength ?? muxOpts.gainMapLength,
    hdrgmVersion: options.hdrgmVersion ?? muxOpts.hdrgmVersion,
    userComment: options.userComment ?? muxOpts.userComment,
  });
}

export function buildLivePhotoFromReference(
  coverJpeg: Uint8Array,
  videoMp4: Uint8Array,
  loaded: LoadedReferenceImage | null,
  edits: NativeMetadataBundle,
  coverTime: number,
  segmentStart: number,
  coverMode: CoverMode = "videoFrame",
): Uint8Array {
  const merged = mergeReferenceEdits(loaded, edits);
  const referenceJpeg =
    loaded && merged ? referenceJpegBytesForMux(loaded, merged) : undefined;

  return buildOppoMotionPhotoWithNative(coverJpeg, videoMp4, {
    nativeMetadata: merged,
    referenceJpeg,
    coverTime,
    segmentStart,
    coverMode,
  });
}

/** Feature-one: video mux first, then optional EXIF/IPTC spoof (MotionPhoto XMP untouched). */
export function buildLivePhotoWithMetadata(
  coverJpeg: Uint8Array,
  videoMp4: Uint8Array,
  options: {
    reference?: LoadedReferenceImage | null;
    metadata?: NativeMetadataBundle;
    coverTime: number;
    segmentStart: number;
    coverMode?: CoverMode;
    useReferenceSegments?: boolean;
  },
): Uint8Array {
  const { reference, metadata, coverTime, segmentStart, coverMode = "videoFrame" } = options;

  const output = buildOppoMotionPhotoWithNative(coverJpeg, videoMp4, {
    coverTime,
    segmentStart,
    coverMode,
    ...muxOptionsFromBundle(undefined, coverTime, segmentStart, coverMode),
  });

  if (!metadata) return output;

  const referenceJpeg =
    options.useReferenceSegments && reference?.useSegmentTransplant
      ? referenceJpegBytesForMux(reference, metadata)
      : undefined;

  return applySpoofAfterMotionPhotoMux(output, metadata, referenceJpeg);
}
