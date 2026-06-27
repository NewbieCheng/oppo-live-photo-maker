import ExifReader from "exifreader";
import type { ReferenceImageFormat } from "./imageFormat";
import type { NativeMetadataBundle } from "./types";
import { ALL_EDITABLE_EXIF_KEYS, ALL_EDITABLE_IPTC_KEYS } from "./fields";

const MOTION_XMP_MARKERS = [
  "MotionPhoto",
  "MicroVideo",
  "MotionPhotoOwner",
  "Container:Directory",
  "VideoLength",
  "OLivePhotoVersion",
];

const EXIF_GROUPS = new Set(["file", "exif", "iptc", "xmp", "gps", "mpf", "icc", "interop"]);

const EXIF_ALIASES: Record<string, string[]> = {
  Make: ["Make"],
  Model: ["Model"],
  Software: ["Software", "ProcessingSoftware"],
  Orientation: ["Orientation"],
  DateTimeOriginal: ["DateTimeOriginal", "Date Time Original", "Date/Time Original"],
  CreateDate: ["CreateDate", "Create Date"],
  ModifyDate: ["ModifyDate", "Modify Date"],
  ExposureTime: ["ExposureTime", "Exposure Time"],
  FNumber: ["FNumber", "F Number", "ApertureValue"],
  ISOSpeedRatings: ["ISOSpeedRatings", "ISO Speed Ratings", "ISO", "PhotographicSensitivity"],
  FocalLength: ["FocalLength", "Focal Length"],
  FocalLengthIn35mmFormat: ["FocalLengthIn35mmFormat", "Focal Length In 35mm Format"],
  LensModel: ["LensModel", "Lens Model"],
  LensMake: ["LensMake", "Lens Make"],
  ExposureProgram: ["ExposureProgram", "Exposure Program"],
  MeteringMode: ["MeteringMode", "Metering Mode"],
  Flash: ["Flash"],
  WhiteBalance: ["WhiteBalance", "White Balance"],
  ColorSpace: ["ColorSpace", "Color Space"],
  ImageWidth: ["ImageWidth", "Image Width", "PixelXDimension"],
  ImageHeight: ["ImageHeight", "Image Height", "PixelYDimension"],
  Artist: ["Artist"],
  Copyright: ["Copyright"],
  UserComment: ["UserComment", "User Comment"],
};

export interface ParseSummary {
  format: ReferenceImageFormat;
  formatLabel: string;
  fieldCount: number;
  make?: string;
  model?: string;
  dateTime?: string;
  hasGps: boolean;
}

type TagMap = Record<string, { description?: string; value?: unknown }>;

function readPresentationTimestampUs(tags: TagMap): number | undefined {
  const candidates = [
    tags["MotionPhotoPresentationTimestampUs"],
    tags["MicroVideoPresentationTimestampUs"],
  ];
  for (const tag of candidates) {
    if (!tag) continue;
    const raw = String(tag.description ?? tag.value ?? "").trim();
    if (raw && raw !== "-1") {
      const n = Number(raw);
      if (!Number.isNaN(n) && n >= 0) return Math.round(n);
    }
  }
  return undefined;
}

function tagValue(tag: { description?: string; value?: unknown } | undefined): string | undefined {
  if (!tag) return undefined;
  const v = tag.description ?? tag.value;
  if (v === undefined || v === null) return undefined;
  if (Array.isArray(v)) return v.map(String).join(", ");
  return String(v);
}

function pickTag(tags: TagMap, names: readonly string[]): string | undefined {
  for (const name of names) {
    const val = tagValue(tags[name]);
    if (val !== undefined && val !== "") return val;
  }
  return undefined;
}

function loadRawTags(bytes: Uint8Array): Record<string, unknown> {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return ExifReader.load(buffer, { expanded: true }) as Record<string, unknown>;
}

/** Flatten exifreader expanded groups into a single tag map. */
export function flattenExifReaderTags(raw: Record<string, unknown>): TagMap {
  const out: TagMap = {};
  for (const [key, value] of Object.entries(raw)) {
    if (EXIF_GROUPS.has(key) && value && typeof value === "object" && !("description" in value)) {
      for (const [inner, tag] of Object.entries(value as Record<string, unknown>)) {
        if (tag && typeof tag === "object") out[inner] = tag as TagMap[string];
      }
    } else if (value && typeof value === "object" && "description" in value) {
      out[key] = value as TagMap[string];
    }
  }
  return out;
}

function parseFromTags(tags: TagMap): NativeMetadataBundle {
  const exif: Record<string, string> = {};

  for (const key of ALL_EDITABLE_EXIF_KEYS) {
    const aliases = EXIF_ALIASES[key] ?? [key];
    const val = pickTag(tags, aliases);
    if (val !== undefined) exif[key] = val;
  }

  for (const [canonical, aliases] of Object.entries(EXIF_ALIASES)) {
    if (!exif[canonical]) {
      const val = pickTag(tags, aliases);
      if (val !== undefined) exif[canonical] = val;
    }
  }

  const iptc: Record<string, string> = {};
  for (const key of ALL_EDITABLE_IPTC_KEYS) {
    const val = pickTag(tags, [key, key.replace(/([A-Z])/g, " $1").trim()]);
    if (val !== undefined) iptc[key] = val;
  }

  for (const [name, tag] of Object.entries(tags)) {
    if (MOTION_XMP_MARKERS.some((m) => name.includes(m))) continue;
    if (name.startsWith("GPS") && !exif[name]) {
      const val = tagValue(tag);
      if (val !== undefined) exif[name] = val;
    }
  }

  return {
    exif,
    iptc,
    presentationTimestampUs: readPresentationTimestampUs(tags),
  };
}

/** Parse image bytes (JPEG / HEIC / PNG / WebP) into an editable metadata bundle. */
export function parseFromTagMap(bytes: Uint8Array): NativeMetadataBundle {
  return parseFromTags(flattenExifReaderTags(loadRawTags(bytes)));
}

/** Parse reference image into an editable metadata bundle. */
export async function parseReferenceImage(bytes: Uint8Array): Promise<NativeMetadataBundle> {
  return parseFromTagMap(bytes);
}

export function parseReferenceImageSync(bytes: Uint8Array): NativeMetadataBundle {
  return parseFromTagMap(bytes);
}
