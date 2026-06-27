import { decodeReferenceForDisplay } from "./heic";
import {
  detectReferenceFormat,
  formatLabel,
  isHeicFamily,
  isJpegFormat,
  type ReferenceImageFormat,
} from "./imageFormat";
import { buildSyntheticReferenceJpeg } from "./apply";
import { bundleHasEditableFields, parseFromTagMap, type ParseSummary } from "./parse";
import type { NativeMetadataBundle } from "./types";

export interface LoadedReferenceImage {
  file: File;
  format: ReferenceImageFormat;
  /** Original file bytes (for JPEG segment transplant). */
  originalBytes: Uint8Array;
  /** JPEG bytes when format is JPEG or after HEIC decode (for segment fallback). */
  jpegBytes: Uint8Array | null;
  /** Object URL for preview (JPEG-compatible). */
  previewUrl: string;
  bundle: NativeMetadataBundle;
  summary: ParseSummary;
  /** True when EXIF APP1 segments can be copied from original JPEG. */
  useSegmentTransplant: boolean;
}

function toUint8Array(buf: ArrayBuffer): Uint8Array {
  return new Uint8Array(buf);
}

async function tryParseBytes(bytes: Uint8Array): Promise<NativeMetadataBundle | null> {
  try {
    return parseFromTagMap(bytes);
  } catch {
    return null;
  }
}

/**
 * Load a phone-native still (JPEG / HEIC / PNG / WebP), decode if needed,
 * and parse EXIF/IPTC/XMP fields in the browser.
 */
export async function loadReferenceImageFile(file: File): Promise<LoadedReferenceImage> {
  const format = detectReferenceFormat(file);
  const originalBytes = toUint8Array(await file.arrayBuffer());

  let bundle = await tryParseBytes(originalBytes);
  let jpegBytes: Uint8Array | null = isJpegFormat(format) ? originalBytes : null;

  if (!bundle || isHeicFamily(format)) {
    const displayBlob = await decodeReferenceForDisplay(file, format);
    const decoded = toUint8Array(await displayBlob.arrayBuffer());
    jpegBytes = decoded;
    const fromDecoded = await tryParseBytes(decoded);
    if (fromDecoded) {
      bundle = mergeBundlesPreferFilled(bundle, fromDecoded);
    }
  }

  if (!bundle || !bundleHasEditableFields(bundle)) {
    throw new Error(
      `${formatLabel(format)} 中未找到可读取的 EXIF/IPTC 元数据。` +
        (isHeicFamily(format)
          ? " HEIC 在浏览器内只能移植已解析的字段（非 exiftool 级全量复制）；请确认是机内直出原图，或使用桌面版 + exiftool。"
          : " 请换一张机内直出的原图试试。"),
    );
  }

  const previewBlob = jpegBytes
    ? new Blob([jpegBytes.slice()], { type: "image/jpeg" })
    : await decodeReferenceForDisplay(file, format);
  const previewUrl = URL.createObjectURL(previewBlob);

  const summary = summarizeBundle(bundle, format);

  return {
    file,
    format,
    originalBytes,
    jpegBytes,
    previewUrl,
    bundle,
    summary,
    useSegmentTransplant: isJpegFormat(format),
  };
}

function mergeBundlesPreferFilled(
  a: NativeMetadataBundle | null,
  b: NativeMetadataBundle,
): NativeMetadataBundle {
  if (!a) return b;
  return {
    exif: { ...a.exif, ...b.exif },
    iptc: { ...a.iptc, ...b.iptc },
    presentationTimestampUs: a.presentationTimestampUs ?? b.presentationTimestampUs,
    presentationTimestampUserSet: a.presentationTimestampUserSet ?? b.presentationTimestampUserSet,
  };
}

function summarizeBundle(
  bundle: NativeMetadataBundle,
  format: ReferenceImageFormat,
): ParseSummary {
  const fieldCount =
    Object.keys(bundle.exif).length + Object.keys(bundle.iptc).length;
  return {
    format,
    formatLabel: formatLabel(format),
    fieldCount,
    make: bundle.exif.Make,
    model: bundle.exif.Model,
    dateTime: bundle.exif.DateTimeOriginal ?? bundle.exif.CreateDate,
    hasGps: Boolean(bundle.exif.GPSLatitude || bundle.exif.GPSLongitude),
  };
}

export function referenceJpegForMux(loaded: LoadedReferenceImage | null): Uint8Array | undefined {
  if (!loaded) return undefined;
  if (loaded.useSegmentTransplant) return loaded.originalBytes;
  if (bundleHasEditableFields(loaded.bundle)) {
    return buildSyntheticReferenceJpeg(loaded.bundle);
  }
  return undefined;
}
