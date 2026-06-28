/**
 * Tags eligible for writeMetadata (mirrors ExifTool -TagsFromFile -All:all semantics).
 * Read-only groups from -json -G1 are excluded.
 */
import { type CopyMetadataOptions } from "./copyContract";

const NON_COPYABLE_GROUPS = new Set([
  "ExifTool",
  "System",
  "File",
  "Composite",
  "QuickTime",
  "Meta",
]);

function tagGroup(key: string): string {
  return key.includes(":") ? key.split(":")[0]! : "";
}

function isNonCopyableGroup(group: string): boolean {
  if (!group) return true;
  if (NON_COPYABLE_GROUPS.has(group)) return true;
  if (group.startsWith("ICC")) return true;
  if (group === "IFD1") return true;
  return false;
}

function isCopyableGroup(group: string, options: CopyMetadataOptions): boolean {
  if (isNonCopyableGroup(group)) return false;

  const isXmp = group === "XMP" || group.startsWith("XMP-");
  const isIptc = group === "IPTC";
  const isExif =
    group === "EXIF" ||
    group === "IFD0" ||
    group === "ExifIFD" ||
    group === "GPS" ||
    group === "MakerNotes";

  if (options.excludeExif && isExif) return false;
  if (options.excludeIptc && isIptc) return false;
  if (options.excludeXmp && isXmp) return false;

  return isExif || isIptc || isXmp;
}

export function normalizeTagWriteValue(
  value: unknown,
): string | number | boolean | string[] | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) =>
      typeof item === "string" || typeof item === "number" || typeof item === "boolean"
        ? String(item)
        : String(item),
    );
  }
  return String(value);
}

function shouldSkipParsedTagWrite(key: string, value: unknown): boolean {
  if (
    key === "IFD0:ImageWidth" ||
    key === "IFD0:ImageHeight" ||
    key === "ExifIFD:ExifImageWidth" ||
    key === "ExifIFD:ExifImageHeight"
  ) {
    return true;
  }
  // Rationals / derived tags that break when round-tripped via -json → -Tag=value in WASM.
  if (
    key === "IFD0:XResolution" ||
    key === "IFD0:YResolution" ||
    key === "IFD0:ResolutionUnit" ||
    key === "ExifIFD:ApertureValue" ||
    key === "ExifIFD:MaxApertureValue" ||
    key === "ExifIFD:BrightnessValue" ||
    key === "ExifIFD:ShutterSpeedValue" ||
    key === "ExifIFD:DigitalZoomRatio" ||
    key === "ExifIFD:SubSecTime" ||
    key === "ExifIFD:SubSecTimeOriginal" ||
    key === "ExifIFD:SubSecTimeDigitized" ||
    key === "ExifIFD:ComponentsConfiguration" ||
    key === "ExifIFD:SensingMethod" ||
    key === "ExifIFD:SceneType" ||
    key === "ExifIFD:FlashpixVersion" ||
    key === "ExifIFD:ExifVersion"
  ) {
    return true;
  }
  if (/MakerNote/i.test(key)) return true;
  if (typeof value === "string" && /\(Binary data/i.test(value)) return true;
  return false;
}

function formatTagWriteValue(key: string, value: string | number | boolean): string {
  if (typeof value === "boolean") return value ? "True" : "False";
  const s = String(value);
  if (key.endsWith("InteropIndex")) return /^R98/i.test(s) ? "R98" : s;
  if (key.endsWith("InteropVersion")) return "0100";
  return s;
}

/** Filter parsed -json tags to writable metadata only (for writeMetadata). */
export function filterWritableTags(
  tags: Record<string, unknown>,
  options: CopyMetadataOptions,
): Record<string, string | number | boolean | string[]> {
  const out: Record<string, string | number | boolean | string[]> = {};
  for (const [key, raw] of Object.entries(tags)) {
    if (key === "SourceFile" || key === "ExifToolVersion") continue;
    if (shouldSkipParsedTagWrite(key, raw)) continue;
    const group = tagGroup(key);
    if (!isCopyableGroup(group, options)) continue;
    const value = normalizeTagWriteValue(raw);
    if (value === undefined) continue;
    out[key] = value;
  }
  return out;
}

const EXIF_RESYNC_GROUPS = new Set([
  "IFD0",
  "ExifIFD",
  "EXIF",
  "InteropIFD",
  "GPS",
  "MakerNotes",
]);

/** IFD0/ExifIFD/Interop/GPS/MakerNotes tags for ColorOS resync without TagsFromFile. */
export function filterResyncExifTags(
  tags: Record<string, unknown>,
): Record<string, string | number | boolean | string[]> {
  const out: Record<string, string | number | boolean | string[]> = {};
  for (const [key, raw] of Object.entries(tags)) {
    if (key === "SourceFile" || key === "ExifToolVersion") continue;
    if (shouldSkipParsedTagWrite(key, raw)) continue;
    const group = tagGroup(key);
    if (!EXIF_RESYNC_GROUPS.has(group)) continue;
    const value = normalizeTagWriteValue(raw);
    if (value === undefined) continue;
    out[key] = value;
  }
  return out;
}

/** Map ExifTool -G1 keys to NativeMetadataBundle.exif field names. */
const G1_TO_BUNDLE_FIELD: Record<string, string> = {
  "IFD0:Make": "Make",
  "IFD0:Model": "Model",
  "IFD0:Software": "Software",
  "IFD0:Orientation": "Orientation",
  "IFD0:ModifyDate": "ModifyDate",
  "IFD0:YCbCrPositioning": "YCbCrPositioning",
  "ExifIFD:DateTimeOriginal": "DateTimeOriginal",
  "ExifIFD:CreateDate": "CreateDate",
  "ExifIFD:OffsetTimeOriginal": "OffsetTimeOriginal",
  "ExifIFD:ExposureTime": "ExposureTime",
  "ExifIFD:FNumber": "FNumber",
  "ExifIFD:ISO": "ISO",
  "EXIF:ISO": "ISO",
  "ExifIFD:ExposureProgram": "ExposureProgram",
  "ExifIFD:ExposureCompensation": "ExposureCompensation",
  "ExifIFD:MeteringMode": "MeteringMode",
  "ExifIFD:Flash": "Flash",
  "ExifIFD:FocalLength": "FocalLength",
  "ExifIFD:FocalLengthIn35mmFormat": "FocalLengthIn35mmFormat",
  "ExifIFD:WhiteBalance": "WhiteBalance",
  "ExifIFD:ExposureMode": "ExposureMode",
  "ExifIFD:SceneCaptureType": "SceneCaptureType",
  "ExifIFD:ColorSpace": "ColorSpace",
  "ExifIFD:LensModel": "LensModel",
  "ExifIFD:UserComment": "UserComment",
  "GPS:GPSLatitude": "GPSLatitude",
  "GPS:GPSLongitude": "GPSLongitude",
  "GPS:GPSAltitude": "GPSAltitude",
  "GPS:GPSDateStamp": "GPSDateStamp",
};

function bundleFieldValue(field: string, value: string): string {
  if (field === "Orientation" && /horizontal.*normal/i.test(value)) return "1";
  return value;
}

/** Convert parsed ExifTool -json tags to a piexif-friendly bundle (HEIC materialize). */
export function parsedExiftoolTagsToBundle(
  tags: Record<string, unknown>,
  options: CopyMetadataOptions,
): import("./types").NativeMetadataBundle {
  const writable = filterWritableTags(tags, options);
  const exif: Record<string, string> = {};
  const iptc: Record<string, string> = {};
  for (const [key, raw] of Object.entries(writable)) {
    const group = tagGroup(key);
    const value = Array.isArray(raw) ? raw.join(", ") : String(raw);
    if (group === "IPTC") {
      const iptcField = key.replace(/^IPTC:/, "");
      iptc[iptcField] = value;
      continue;
    }
    const field = G1_TO_BUNDLE_FIELD[key] ?? key.replace(/^(IFD0|ExifIFD|EXIF):/, "");
    exif[bundleFieldValue(field, value)] = value;
  }
  return { exif, iptc };
}

/** Build ExifTool `-Group:Tag=value` args from parsed -json tags. */
export function writableTagsToExiftoolArgs(
  writable: Record<string, string | number | boolean | string[]>,
  byteOrder?: "II" | "MM",
): string[] {
  const args: string[] = ["-m"];
  if (byteOrder) {
    args.unshift(`ByteOrder=${byteOrder}`);
    args.unshift("-api");
  }
  for (const [key, value] of Object.entries(writable)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        args.push(`-${key}=${formatTagWriteValue(key, item)}`);
      }
    } else {
      args.push(`-${key}=${formatTagWriteValue(key, value)}`);
    }
  }
  return args;
}
