import piexif from "piexifjs";
import type { NativeMetadataBundle } from "./types";
import {
  concat,
  extractTransplantableSegments,
  insertAfterAppSegments,
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

type ExifDict = Record<string, Record<number, string | number>>;

function minimalJpeg(): Uint8Array {
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

function wrapApp1Segment(exifPayload: Uint8Array): Uint8Array {
  const segLen = exifPayload.length + 2;
  const out = new Uint8Array(4 + exifPayload.length);
  out[0] = 0xff;
  out[1] = 0xe1;
  out[2] = (segLen >> 8) & 0xff;
  out[3] = segLen & 0xff;
  out.set(exifPayload, 4);
  return out;
}

function exifDictFromBundle(bundle: NativeMetadataBundle): ExifDict {
  const exifObj: ExifDict = { "0th": {}, Exif: {}, GPS: {} };
  applyExifOverrides(exifObj, bundle);
  return exifObj;
}

/** Build raw APP1 payload bytes (Exif\\0\\0 + TIFF) from a metadata bundle. */
export function buildExifApp1PayloadFromBundle(bundle: NativeMetadataBundle): Uint8Array | null {
  try {
    return binaryStringToUint8(piexif.dump(exifDictFromBundle(bundle)));
  } catch {
    return null;
  }
}

function insertExifFromBundle(jpeg: Uint8Array, bundle: NativeMetadataBundle): Uint8Array {
  const payload = buildExifApp1PayloadFromBundle(bundle);
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

function applyExifOverrides(exifObj: ExifDict, bundle: NativeMetadataBundle): void {
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
    GPSLatitude: ["GPS", piexif.GPSIFD.GPSLatitude as number],
    GPSLongitude: ["GPS", piexif.GPSIFD.GPSLongitude as number],
    GPSAltitude: ["GPS", piexif.GPSIFD.GPSAltitude as number],
    GPSDateStamp: ["GPS", piexif.GPSIFD.GPSDateStamp as number],
  };

  const intTags = new Set(["Orientation", "Flash", "WhiteBalance", "ISOSpeedRatings", "ISO"]);
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

  if (!exifObj.Exif) exifObj.Exif = {};
  exifObj.Exif[piexif.ExifIFD.UserComment as number] = OPPO_USER_COMMENT;
}

/** Apply native metadata onto cover JPEG bytes (EXIF/IPTC transplant). */
export function applyNativeMetadata(
  coverJpeg: Uint8Array,
  bundle: NativeMetadataBundle | undefined,
  referenceJpeg?: Uint8Array,
): Uint8Array {
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
        applyExifOverrides(exifObj, bundle);
        const outUrl = piexif.insert(piexif.dump(exifObj), dataUrl);
        working = fromDataUrl(outUrl);
      } catch {
        // Keep segment-only transplant from reference.
      }
    } else {
      working = insertExifFromBundle(working, bundle);
    }
  } else if (!referenceJpeg) {
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

/**
 * Build a minimal JPEG whose EXIF APP1 carries parsed field values.
 * Used for HEIC/PNG/WebP references where segment copy from source is impossible.
 */
export function buildSyntheticReferenceJpeg(bundle: NativeMetadataBundle): Uint8Array {
  const payload = buildExifApp1PayloadFromBundle(bundle);
  if (!payload) return minimalJpeg();
  return insertAfterAppSegments(minimalJpeg(), [wrapApp1Segment(payload)]);
}

export { concat };
