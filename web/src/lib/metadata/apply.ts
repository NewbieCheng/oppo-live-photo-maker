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
    FocalLength: ["Exif", piexif.ExifIFD.FocalLength as number],
    Flash: ["Exif", piexif.ExifIFD.Flash as number],
    WhiteBalance: ["Exif", piexif.ExifIFD.WhiteBalance as number],
    LensModel: ["Exif", piexif.ExifIFD.LensModel as number],
    GPSLatitude: ["GPS", piexif.GPSIFD.GPSLatitude as number],
    GPSLongitude: ["GPS", piexif.GPSIFD.GPSLongitude as number],
    GPSAltitude: ["GPS", piexif.GPSIFD.GPSAltitude as number],
    GPSDateStamp: ["GPS", piexif.GPSIFD.GPSDateStamp as number],
  };

  for (const [key, value] of Object.entries(bundle.exif)) {
    const target = map[key];
    if (!target) continue;
    const [ifd, tag] = target;
    if (!exifObj[ifd]) exifObj[ifd] = {};
    if (key === "Orientation" || key === "Flash" || key === "WhiteBalance" || key === "ISOSpeedRatings") {
      exifObj[ifd][tag] = parseInt(value, 10) || value;
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

  if (bundle && (Object.keys(bundle.exif).length || !referenceJpeg)) {
    try {
      const dataUrl = toDataUrl(working);
      let exifObj: ExifDict = {};
      try {
        exifObj = piexif.load(dataUrl) as ExifDict;
      } catch {
        exifObj = { "0th": {}, Exif: {}, GPS: {} };
      }
      applyExifOverrides(exifObj, bundle);
      if (!Object.keys(bundle.exif).length) {
        if (!exifObj.Exif) exifObj.Exif = {};
        exifObj.Exif[piexif.ExifIFD.UserComment as number] = OPPO_USER_COMMENT;
      }
      const outUrl = piexif.insert(piexif.dump(exifObj), dataUrl);
      working = fromDataUrl(outUrl);
    } catch {
      // Fall back to segment-only transplant.
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

export { concat };
