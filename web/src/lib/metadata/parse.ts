import ExifReader from "exifreader";
import type { ReferenceImageFormat } from "./imageFormat";
import type { NativeMetadataBundle, XmpMetadataBundle } from "./types";
import { ALL_EDITABLE_EXIF_KEYS, ALL_EDITABLE_IPTC_KEYS, emptyXmpBundle } from "./fields";
import { extractRawXmpPackets } from "./xmp";
import { parseMotionPhotoXmpFromText } from "@shared/motionPhotoXmp";

const MOTION_XMP_MARKERS = [
  "MotionPhoto",
  "MicroVideo",
  "MotionPhotoOwner",
  "Container:Directory",
  "VideoLength",
  "OLivePhotoVersion",
];

const EXIF_ALIASES: Record<string, string[]> = {
  Make: ["Make"],
  Model: ["Model"],
  Software: ["Software", "ProcessingSoftware"],
  Orientation: ["Orientation"],
  DateTimeOriginal: ["DateTimeOriginal", "Date Time Original", "Date/Time Original"],
  CreateDate: ["CreateDate", "Create Date"],
  ModifyDate: ["ModifyDate", "Modify Date"],
  OffsetTimeOriginal: ["OffsetTimeOriginal", "Offset Time Original"],
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
  InteropIndex: ["InteropIndex", "Interop Index"],
  InteropVersion: ["InteropVersion", "Interop Version"],
  YCbCrPositioning: ["YCbCrPositioning", "YCbCr Positioning"],
  ExifImageWidth: ["ExifImageWidth", "Exif Image Width"],
  ExifImageHeight: ["ExifImageHeight", "Exif Image Height"],
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

function readPresentationTimestampUs(tags: TagMap, xmpParsed?: ReturnType<typeof parseMotionPhotoXmpFromText>): number | undefined {
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
  if (xmpParsed?.presentationTimestampUs != null) return xmpParsed.presentationTimestampUs;
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

function isTagObject(value: unknown): value is TagMap[string] {
  return !!value && typeof value === "object" && ("description" in value || "value" in value);
}

function isTagGroup(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || isTagObject(value)) return false;
  return Object.values(value).some(isTagObject);
}

export function flattenExifReaderTags(raw: Record<string, unknown>): TagMap {
  const out: TagMap = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === "Thumbnail") continue;
    if (isTagGroup(value)) {
      for (const [inner, tag] of Object.entries(value)) {
        if (isTagObject(tag)) out[inner] = tag;
      }
      continue;
    }
    if (isTagObject(value)) out[key] = value;
  }
  return out;
}

/** Try decode OPPO MakerNote bytes as JSON for read-only UI display. */
export function parseMakerNoteJson(tags: TagMap): string | undefined {
  const raw = tags.MakerNote ?? tags["Maker Notes"];
  if (!raw) return undefined;
  const bytes =
    raw.value instanceof ArrayBuffer
      ? new Uint8Array(raw.value)
      : raw.value instanceof Uint8Array
        ? raw.value
        : null;
  if (!bytes || bytes.length === 0) return undefined;
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const jsonStart = text.indexOf("{");
  if (jsonStart < 0) return text.slice(0, 512);
  const jsonSlice = text.slice(jsonStart);
  try {
    const parsed = JSON.parse(jsonSlice);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return jsonSlice.slice(0, 512);
  }
}

function parseXmpFromBytes(bytes: Uint8Array): XmpMetadataBundle {
  const xmp = emptyXmpBundle();
  const packets = extractRawXmpPackets(bytes);
  for (const packet of packets) {
    if (!MOTION_XMP_MARKERS.some((m) => packet.includes(m))) continue;
    const parsed = parseMotionPhotoXmpFromText(packet);
    xmp.mode = parsed.mode ?? "native";
    if (parsed.motionPhotoOwner) xmp.opcamera.MotionPhotoOwner = parsed.motionPhotoOwner;
    if (parsed.oLivePhotoVersion != null) {
      xmp.opcamera.OLivePhotoVersion = String(parsed.oLivePhotoVersion);
    }
    if (parsed.motionPhotoFeatureFlag != null) {
      xmp.opcamera.MotionPhotoFeatureFlag = String(parsed.motionPhotoFeatureFlag);
    }
    if (parsed.videoLength != null) {
      xmp.opcamera.VideoLength = String(parsed.videoLength);
      xmp.container.videoLength = String(parsed.videoLength);
    }
    if (parsed.presentationTimestampUs != null) {
      const ts = String(parsed.presentationTimestampUs);
      xmp.gcamera.MotionPhotoPresentationTimestampUs = ts;
      xmp.opcamera.MotionPhotoPrimaryPresentationTimestampUs = ts;
    }
    if (parsed.gainMapLength != null && parsed.gainMapLength > 0) {
      xmp.container.gainMapLength = String(parsed.gainMapLength);
    }
    if (parsed.hdrgmVersion) xmp.hdrgm.version = parsed.hdrgmVersion;

    xmp.gcamera.MotionPhoto = packet.includes('GCamera:MotionPhoto="1"') ? "1" : xmp.gcamera.MotionPhoto;
    xmp.gcamera.MotionPhotoVersion = packet.match(/GCamera:MotionPhotoVersion="(\d+)"/)?.[1] ?? xmp.gcamera.MotionPhotoVersion;
    if (parsed.mode === "compat" || packet.includes("GCamera:MicroVideo")) {
      xmp.mode = "compat";
      xmp.gcamera.MicroVideo = "1";
      xmp.gcamera.MicroVideoVersion = "1";
      if (parsed.videoLength != null) {
        xmp.gcamera.MicroVideoOffset = String(parsed.videoLength);
      }
    }
    break;
  }
  return xmp;
}

export function bundleHasEditableFields(bundle: NativeMetadataBundle): boolean {
  const xmpFilled =
    bundle.xmp &&
    (Object.keys(bundle.xmp.gcamera).length > 0 ||
      Object.keys(bundle.xmp.opcamera).length > 0 ||
      Object.keys(bundle.xmp.container).length > 0 ||
      Object.keys(bundle.xmp.hdrgm).length > 0);
  return Object.keys(bundle.exif).length + Object.keys(bundle.iptc).length + (xmpFilled ? 1 : 0) > 0;
}

function parseFromTags(tags: TagMap, bytes?: Uint8Array): NativeMetadataBundle {
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

  if (!exif.GPSLatitude) {
    const lat = pickTag(tags, ["GPSLatitude", "Composite:GPSLatitude"]);
    if (lat) exif.GPSLatitude = lat;
  }
  if (!exif.GPSLongitude) {
    const lon = pickTag(tags, ["GPSLongitude", "Composite:GPSLongitude"]);
    if (lon) exif.GPSLongitude = lon;
  }
  if (!exif.GPSAltitude) {
    const alt = pickTag(tags, ["GPSAltitude", "Composite:GPSAltitude"]);
    if (alt) exif.GPSAltitude = alt;
  }

  const xmpParsed = bytes ? parseXmpFromBytes(bytes) : emptyXmpBundle();
  const xmpFromText = bytes
    ? parseMotionPhotoXmpFromText(extractRawXmpPackets(bytes).join("\n"))
    : undefined;

  return {
    exif,
    iptc,
    xmp: xmpParsed,
    makerNoteJson: parseMakerNoteJson(tags),
    presentationTimestampUs: readPresentationTimestampUs(tags, xmpFromText),
  };
}

export function parseFullMetadataBundle(bytes: Uint8Array): NativeMetadataBundle {
  const tags = flattenExifReaderTags(loadRawTags(bytes));
  const base = parseFromTags(tags, bytes);
  const exif = { ...base.exif };

  const skipNames = new Set(["Thumbnail", "Images", "MakerNote", "UserComment", "PrintIM"]);

  for (const [name, tag] of Object.entries(tags)) {
    if (skipNames.has(name)) continue;
    if (MOTION_XMP_MARKERS.some((m) => name.includes(m))) continue;
    if (exif[name]) continue;
    const val = tagValue(tag);
    if (val === undefined || val.length === 0 || val.length > 2048) continue;
    if (/^GPS/.test(name) || /^[A-Z]/.test(name)) {
      exif[name] = val;
    }
  }

  return { ...base, exif };
}

export function parseFromTagMap(bytes: Uint8Array): NativeMetadataBundle {
  return parseFullMetadataBundle(bytes);
}

export async function parseReferenceImage(bytes: Uint8Array): Promise<NativeMetadataBundle> {
  return parseFromTagMap(bytes);
}

export function parseReferenceImageSync(bytes: Uint8Array): NativeMetadataBundle {
  return parseFromTagMap(bytes);
}
