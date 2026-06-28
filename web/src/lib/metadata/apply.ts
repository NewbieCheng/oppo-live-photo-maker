import piexif from "piexifjs";
import { bundleHasEditableFields } from "./parse";
import type { NativeMetadataBundle } from "./types";
import {
  concat,
  extractTransplantableSegments,
  insertAfterAppSegments,
  isExifApp1,
  scanJpegSegments,
  stripMetadataSegments,
} from "./segments";

export const OPPO_USER_COMMENT = "Oplus_8388608";

function binaryToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function base64ToBinary(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function toDataUrl(jpeg: Uint8Array): string {
  return `data:image/jpeg;base64,${binaryToBase64(jpeg)}`;
}

function fromDataUrl(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) throw new Error("Invalid data URL from piexif");
  return base64ToBinary(dataUrl.slice(comma + 1));
}

type ExifDict = Record<string, Record<number, string | number | [number, number]>>;

/** Minimal JPEG canvas for piexif / segment materialize (no SOF scan data required). */
export function minimalJpeg(): Uint8Array {
  function seg(marker: number, payload: Uint8Array): Uint8Array {
    const out = new Uint8Array(2 + 2 + payload.length);
    out[0] = 0xff;
    out[1] = marker;
    const len = payload.length + 2;
    out[2] = (len >> 8) & 0xff;
    out[3] = len & 0xff;
    out.set(payload, 4);
    return out;
  }
  const app0 = seg(0xe0, new TextEncoder().encode("JFIF\0\x01\x01\x00\x00\x01\x00\x01\x00\x00"));
  const dqt = seg(0xdb, new Uint8Array(64).fill(16));
  return new Uint8Array([0xff, 0xd8, ...app0, ...dqt, 0xff, 0xd9]);
}

function binaryStringToUint8(binary: string): Uint8Array {
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i) & 0xff;
  return out;
}

export function wrapApp1Segment(exifPayload: Uint8Array): Uint8Array {
  const segLen = exifPayload.length + 2;
  const out = new Uint8Array(4 + exifPayload.length);
  out[0] = 0xff;
  out[1] = 0xe1;
  out[2] = (segLen >> 8) & 0xff;
  out[3] = segLen & 0xff;
  out.set(exifPayload, 4);
  return out;
}

function exifDictFromBundle(bundle: NativeMetadataBundle, injectOppoMarker = true): ExifDict {
  const exifObj: ExifDict = { "0th": {}, Exif: {}, GPS: {} };
  applyExifOverrides(exifObj, bundle, injectOppoMarker);
  return exifObj;
}

/** Build raw APP1 payload bytes (Exif\\0\\0 + TIFF) from a metadata bundle. */
export function buildExifApp1PayloadFromBundle(
  bundle: NativeMetadataBundle,
  injectOppoMarker = true,
): Uint8Array | null {
  try {
    return binaryStringToUint8(piexif.dump(exifDictFromBundle(bundle, injectOppoMarker)));
  } catch {
    return null;
  }
}

function insertExifFromBundle(
  jpeg: Uint8Array,
  bundle: NativeMetadataBundle,
  injectOppoMarker = true,
): Uint8Array {
  const payload = buildExifApp1PayloadFromBundle(bundle, injectOppoMarker);
  if (!payload) return jpeg;
  return insertAfterAppSegments(stripMetadataSegments(jpeg), [wrapApp1Segment(payload)]);
}

function parseRational(value: string): [number, number] | string {
  const slash = value.indexOf("/");
  if (slash > 0) {
    const num = parseInt(value.slice(0, slash), 10);
    const den = parseInt(value.slice(slash + 1), 10);
    if (den > 0) return [num, den];
  }
  return value;
}

export function applyExifOverrides(
  exifObj: ExifDict,
  bundle: NativeMetadataBundle,
  injectOppoMarker = true,
): void {
  const map: Record<string, [string, number]> = {
    Make: ["0th", piexif.ImageIFD.Make as number],
    Model: ["0th", piexif.ImageIFD.Model as number],
    Software: ["0th", piexif.ImageIFD.Software as number],
    Orientation: ["0th", piexif.ImageIFD.Orientation as number],
    DateTimeOriginal: ["Exif", piexif.ExifIFD.DateTimeOriginal as number],
    CreateDate: ["0th", piexif.ImageIFD.DateTime as number],
    ModifyDate: ["0th", piexif.ImageIFD.DateTime as number],
    ExposureTime: ["Exif", piexif.ExifIFD.ExposureTime as number],
    FNumber: ["Exif", piexif.ExifIFD.FNumber as number],
    ISOSpeedRatings: ["Exif", piexif.ExifIFD.ISOSpeedRatings as number],
    ISO: ["Exif", piexif.ExifIFD.ISOSpeedRatings as number],
    FocalLength: ["Exif", piexif.ExifIFD.FocalLength as number],
    Flash: ["Exif", piexif.ExifIFD.Flash as number],
    WhiteBalance: ["Exif", piexif.ExifIFD.WhiteBalance as number],
    LensModel: ["Exif", piexif.ExifIFD.LensModel as number],
    MeteringMode: ["Exif", piexif.ExifIFD.MeteringMode as number],
    GPSLatitude: ["GPS", piexif.GPSIFD.GPSLatitude as number],
    GPSLongitude: ["GPS", piexif.GPSIFD.GPSLongitude as number],
    GPSAltitude: ["GPS", piexif.GPSIFD.GPSAltitude as number],
    GPSDateStamp: ["GPS", piexif.GPSIFD.GPSDateStamp as number],
  };

  const intTags = new Set([
    "Orientation",
    "Flash",
    "WhiteBalance",
    "ISOSpeedRatings",
    "ISO",
    "MeteringMode",
  ]);
  const rationalTags = new Set(["ExposureTime", "FNumber", "FocalLength"]);

  for (const [key, value] of Object.entries(bundle.exif)) {
    const target = map[key];
    if (!target) continue;
    const [ifd, tag] = target;
    if (!exifObj[ifd]) exifObj[ifd] = {};
    if (intTags.has(key)) {
      exifObj[ifd][tag] = parseInt(value, 10) || value;
    } else if (rationalTags.has(key)) {
      exifObj[ifd][tag] = parseRational(value);
    } else {
      exifObj[ifd][tag] = value;
    }
  }

  const imageIfd = piexif.ImageIFD as Record<string, number>;
  const exifIfd = piexif.ExifIFD as Record<string, number>;
  const gpsIfd = piexif.GPSIFD as Record<string, number>;
  for (const [key, value] of Object.entries(bundle.exif)) {
    if (map[key]) continue;
    if (imageIfd[key] !== undefined) {
      if (!exifObj["0th"]) exifObj["0th"] = {};
      exifObj["0th"][imageIfd[key]] = intTags.has(key)
        ? parseInt(value, 10) || value
        : rationalTags.has(key)
          ? parseRational(value)
          : value;
    } else if (exifIfd[key] !== undefined) {
      if (!exifObj.Exif) exifObj.Exif = {};
      exifObj.Exif[exifIfd[key]] = intTags.has(key)
        ? parseInt(value, 10) || value
        : rationalTags.has(key)
          ? parseRational(value)
          : value;
    } else if (gpsIfd[key] !== undefined) {
      if (!exifObj.GPS) exifObj.GPS = {};
      exifObj.GPS[gpsIfd[key]] = value;
    }
  }

  if (!exifObj.Exif) exifObj.Exif = {};
  if (bundle.exif.UserComment) {
    exifObj.Exif[piexif.ExifIFD.UserComment as number] = bundle.exif.UserComment;
  } else if (injectOppoMarker) {
    exifObj.Exif[piexif.ExifIFD.UserComment as number] = OPPO_USER_COMMENT;
  }
}

export interface ApplyMetadataOptions {
  /** When false, skip OPPO UserComment (copy-img-meta mode). Default true. */
  injectOppoMarker?: boolean;
}

/** Apply native metadata onto cover JPEG bytes (EXIF/IPTC transplant). */
export function applyNativeMetadata(
  coverJpeg: Uint8Array,
  bundle: NativeMetadataBundle | undefined,
  referenceJpeg?: Uint8Array,
  options: ApplyMetadataOptions = {},
): Uint8Array {
  const injectOppoMarker = options.injectOppoMarker !== false;
  let working = stripMetadataSegments(coverJpeg);
  const toInsert: Uint8Array[] = [];

  if (referenceJpeg) {
    const { exifApp1, iptcApp13, extraApp1 } = extractTransplantableSegments(referenceJpeg);
    if (exifApp1) toInsert.push(exifApp1);
    for (const x of extraApp1) toInsert.push(x);
    if (iptcApp13) toInsert.push(iptcApp13);
  }

  if (toInsert.length) {
    working = insertAfterAppSegments(working, toInsert);
  }

  if (bundle && (Object.keys(bundle.exif).length || Object.keys(bundle.iptc).length || !referenceJpeg)) {
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
        const outUrl = piexif.insert(piexif.dump(exifObj), dataUrl);
        working = fromDataUrl(outUrl);
      } catch {
        // Keep segment-only transplant from reference.
      }
    } else {
      working = insertExifFromBundle(working, bundle, injectOppoMarker);
    }
  } else if (!referenceJpeg && injectOppoMarker) {
    try {
      const dataUrl = toDataUrl(working);
      const exifObj: ExifDict = {
        "0th": {},
        Exif: { [piexif.ExifIFD.UserComment as number]: OPPO_USER_COMMENT },
      };
      working = fromDataUrl(piexif.insert(piexif.dump(exifObj), dataUrl));
    } catch {
      // muxer will inject default EXIF APP1.
    }
  }

  return working;
}

function patchExifFromBundle(
  jpeg: Uint8Array,
  bundle: NativeMetadataBundle,
  injectOppoMarker = false,
): Uint8Array {
  const hasExif = scanJpegSegments(jpeg).some((s) => isExifApp1(s));
  if (!hasExif) {
    const payload = buildExifApp1PayloadFromBundle(bundle, injectOppoMarker);
    if (!payload) return jpeg;
    return insertAfterAppSegments(jpeg, [wrapApp1Segment(payload)]);
  }

  try {
    const dataUrl = toDataUrl(jpeg);
    const exifObj = piexif.load(dataUrl) as ExifDict;
    applyExifOverrides(exifObj, bundle, injectOppoMarker);
    return fromDataUrl(piexif.insert(piexif.dump(exifObj), dataUrl));
  } catch {
    if (bundle.exif.Make || bundle.exif.Model) {
      return ensureIfd0MakeModel(jpeg, bundle.exif.Make, bundle.exif.Model);
    }
    return jpeg;
  }
}

/** Force IFD0 Make/Model via piexif (ColorOS Hasselblad watermark reads 0th IFD). */
export function ensureIfd0MakeModel(
  jpeg: Uint8Array,
  make?: string,
  model?: string,
): Uint8Array {
  if (!make && !model) return jpeg;

  const exifFields: Record<string, string> = {};
  if (make) exifFields.Make = make;
  if (model) exifFields.Model = model;

  const hasExif = scanJpegSegments(jpeg).some((s) => isExifApp1(s));
  if (!hasExif) {
    const payload = buildExifApp1PayloadFromBundle(
      { exif: exifFields, iptc: {} },
      false,
    );
    if (!payload) return jpeg;
    return insertAfterAppSegments(jpeg, [wrapApp1Segment(payload)]);
  }

  try {
    const exifObj = piexif.load(toDataUrl(jpeg));
    if (!exifObj["0th"]) exifObj["0th"] = {};
    const imageIfd = piexif.ImageIFD as Record<string, number>;
    if (make) exifObj["0th"][imageIfd.Make] = make;
    if (model) exifObj["0th"][imageIfd.Model] = model;
    const dumped = piexif.dump(exifObj);
    return fromDataUrl(piexif.insert(dumped, toDataUrl(jpeg)));
  } catch {
    const payload = buildExifApp1PayloadFromBundle(
      { exif: exifFields, iptc: {} },
      false,
    );
    if (!payload) return jpeg;
    return insertAfterAppSegments(stripMetadataSegments(jpeg), [wrapApp1Segment(payload)]);
  }
}

/**
 * Build a minimal JPEG whose EXIF APP1 carries parsed field values.
 * Used for HEIC/PNG/WebP references where segment copy from source is impossible.
 */
export function buildSyntheticReferenceJpeg(
  bundle: NativeMetadataBundle,
  injectOppoMarker = true,
): Uint8Array {
  const payload = buildExifApp1PayloadFromBundle(bundle, injectOppoMarker);
  if (!payload) return minimalJpeg();
  return insertAfterAppSegments(minimalJpeg(), [wrapApp1Segment(payload)]);
}

/** Patch copied JPEG with user-edited EXIF from Feature 2 metadata panel. */
export function applySourceMetadataEdits(
  jpeg: Uint8Array,
  bundle: NativeMetadataBundle,
): Uint8Array {
  if (!bundleHasEditableFields(bundle)) return jpeg;
  return patchExifFromBundle(jpeg, bundle, false);
}

export { concat };
