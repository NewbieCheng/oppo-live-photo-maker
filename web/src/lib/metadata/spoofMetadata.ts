/**
 * Feature-one spoof layer: EXIF / IPTC / MakerNote on top of video-generated MotionPhoto XMP.
 * MotionPhoto XMP (GCamera, OpCamera, Container, timestamps) is never taken from reference/template.
 */
import {
  extractTransplantableSegments,
  scanJpegSegments,
  stripMetadataForCopy,
} from "./segments";
import { concatBytes, splitJpegAndAppendedTail } from "./jpegTail";
import type { NativeMetadataBundle } from "./types";
import {
  applyExifOverrides,
  buildExifApp1PayloadFromBundle,
  wrapApp1Segment,
  type ApplyMetadataOptions,
} from "./apply";
import piexif from "piexifjs";

type ExifDict = Record<string, Record<number, string | number | [number, number]>>;

function toDataUrl(jpeg: Uint8Array): string {
  let s = "";
  for (let i = 0; i < jpeg.length; i++) s += String.fromCharCode(jpeg[i]);
  return "data:image/jpeg;base64," + btoa(s);
}

function fromDataUrl(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(",")[1] ?? "";
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function insertAfterJfifApp(jpeg: Uint8Array, insert: Uint8Array[]): Uint8Array {
  let insertAt = 2;
  for (const seg of scanJpegSegments(jpeg)) {
    if (seg.marker === 0xe0) {
      insertAt = seg.end;
      break;
    }
    if (seg.marker >= 0xe0 && seg.marker <= 0xef) break;
  }
  const parts = [jpeg.subarray(0, insertAt), ...insert, jpeg.subarray(insertAt)];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let i = 0;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
}

function insertExifFromBundle(
  jpeg: Uint8Array,
  bundle: NativeMetadataBundle,
  injectOppoMarker: boolean,
): Uint8Array {
  const payload = buildExifApp1PayloadFromBundle(bundle, injectOppoMarker);
  if (!payload) return jpeg;
  return insertAfterJfifApp(jpeg, [wrapApp1Segment(payload)]);
}

/** Field groups editable in Feature 1 spoof mode (no MotionPhoto XMP). */
export const FEATURE_ONE_SPOOF_GROUP_IDS = new Set([
  "camera",
  "exposure",
  "datetime",
  "location",
  "coloros",
  "oppo_exif",
  "iptc",
]);

/** Strip MotionPhoto / presentation fields — only EXIF/IPTC spoof inputs. */
export function spoofBundleFrom(source: NativeMetadataBundle): NativeMetadataBundle {
  return {
    exif: { ...source.exif },
    iptc: { ...source.iptc },
    makerNoteJson: source.makerNoteJson,
  };
}

export function mergeSpoofBundles(
  base: NativeMetadataBundle,
  edits: NativeMetadataBundle,
): NativeMetadataBundle {
  return {
    exif: { ...base.exif, ...edits.exif },
    iptc: { ...base.iptc, ...edits.iptc },
    makerNoteJson: edits.makerNoteJson ?? base.makerNoteJson,
  };
}

export function computeSpoofDirtyKeys(
  reference: NativeMetadataBundle | null,
  edits: NativeMetadataBundle,
): Set<string> {
  const dirty = new Set<string>();
  const ref = reference ? spoofBundleFrom(reference) : null;

  if (!ref) {
    for (const key of Object.keys(edits.exif)) dirty.add(`exif:${key}`);
    for (const key of Object.keys(edits.iptc)) dirty.add(`iptc:${key}`);
    return dirty;
  }

  for (const key of Object.keys(edits.exif)) {
    const edited = edits.exif[key] ?? "";
    const original = ref.exif[key] ?? "";
    if (edited !== original) dirty.add(`exif:${key}`);
  }
  for (const key of Object.keys(edits.iptc)) {
    const edited = edits.iptc[key] ?? "";
    const original = ref.iptc[key] ?? "";
    if (edited !== original) dirty.add(`iptc:${key}`);
  }
  return dirty;
}

/** Replace EXIF/IPTC on JPEG while keeping video-generated MotionPhoto XMP intact. */
export function applyExifSpoofKeepingMotionXmp(
  jpeg: Uint8Array,
  bundle: NativeMetadataBundle,
  referenceJpeg?: Uint8Array,
  options: ApplyMetadataOptions = {},
): Uint8Array {
  const injectOppoMarker = options.injectOppoMarker !== false;
  let working = stripMetadataForCopy(jpeg, { excludeXmp: true });
  const toInsert: Uint8Array[] = [];

  if (referenceJpeg) {
    const { exifApp1, iptcApp13 } = extractTransplantableSegments(referenceJpeg);
    if (exifApp1) toInsert.push(exifApp1);
    if (iptcApp13) toInsert.push(iptcApp13);
  }

  if (toInsert.length) {
    working = insertAfterJfifApp(working, toInsert);
  }

  if (
    bundle &&
    (Object.keys(bundle.exif).length || Object.keys(bundle.iptc).length || !referenceJpeg)
  ) {
    if (referenceJpeg) {
      try {
        const dataUrl = toDataUrl(working);
        let exifObj: ExifDict = {};
        try {
          exifObj = piexif.load(dataUrl) as ExifDict;
        } catch {
          exifObj = { "0th": {}, Exif: {}, GPS: {} };
        }
        applyExifOverrides(exifObj, bundle, injectOppoMarker);
        working = fromDataUrl(piexif.insert(piexif.dump(exifObj), dataUrl));
      } catch {
        // Keep transplanted EXIF segment from reference.
      }
    } else {
      working = insertExifFromBundle(working, bundle, injectOppoMarker);
    }
  }

  return working;
}

/** Apply spoof metadata after live-photo mux (MotionPhoto XMP already written). */
export function applySpoofAfterMotionPhotoMux(
  livePhoto: Uint8Array,
  bundle: NativeMetadataBundle,
  referenceJpeg?: Uint8Array,
): Uint8Array {
  const spoof = spoofBundleFrom(bundle);
  const { jpeg, trailing } = splitJpegAndAppendedTail(livePhoto);
  const patched = applyExifSpoofKeepingMotionXmp(jpeg, spoof, referenceJpeg, {
    injectOppoMarker: !spoof.exif?.UserComment,
  });
  return concatBytes(patched, trailing);
}
