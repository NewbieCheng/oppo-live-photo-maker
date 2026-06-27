import ExifReader from "exifreader";
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

function loadTags(bytes: Uint8Array): TagMap {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return ExifReader.load(buffer, { expanded: true }) as TagMap;
}

function parseFromTags(tags: TagMap): NativeMetadataBundle {
  const exif: Record<string, string> = {};
  for (const key of ALL_EDITABLE_EXIF_KEYS) {
    const val = tagValue(tags[key]);
    if (val !== undefined) exif[key] = val;
  }
  for (const key of ["Make", "Model", "Software", "Orientation"] as const) {
    if (!exif[key]) {
      const val = tagValue(tags[key]);
      if (val !== undefined) exif[key] = val;
    }
  }

  const iptc: Record<string, string> = {};
  for (const key of ALL_EDITABLE_IPTC_KEYS) {
    const val = tagValue(tags[key]);
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

/** Parse reference JPEG into an editable metadata bundle. */
export async function parseReferenceImage(bytes: Uint8Array): Promise<NativeMetadataBundle> {
  return parseFromTags(loadTags(bytes));
}

export function parseReferenceImageSync(bytes: Uint8Array): NativeMetadataBundle {
  return parseFromTags(loadTags(bytes));
}
