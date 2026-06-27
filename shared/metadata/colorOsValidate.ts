/**
 * ColorOS EXIF validation (no ExifTool / WASM dependency).
 */
import { readExifByteOrder, type ExifByteOrder } from "./exifByteOrder.js";
import { isExifApp1, scanJpegSegments } from "./segments.js";

type TagMap = Record<string, unknown>;

export interface ColorOsExifValidation {
  ok: boolean;
  issues: string[];
  exifByteOrder: ExifByteOrder | null;
}

export interface ColorOsExifValidateOptions {
  motionPhoto?: boolean;
  trailingLength?: number;
}

function tagValue(tags: TagMap, ...keys: string[]): unknown {
  for (const key of keys) {
    const v = tags[key];
    if (v != null && v !== "") return v;
  }
  return undefined;
}

function hasMakerNotesInTags(tags: TagMap): boolean {
  if (tagValue(tags, "MakerNotes") != null) return true;
  for (const key of Object.keys(tags)) {
    if (tags[key] == null || tags[key] === "") continue;
    if (key.startsWith("MakerNotes:")) return true;
    if (/MakerNote/i.test(key)) return true;
  }
  return false;
}

function hasMpfApp2(jpeg: Uint8Array): boolean {
  for (const seg of scanJpegSegments(jpeg)) {
    if (seg.marker !== 0xe2 || seg.payload.length < 8) continue;
    const sig = new TextDecoder("ascii").decode(seg.payload.subarray(4, 8));
    if (sig === "MPF\0") return true;
  }
  return false;
}

export function hasMpfApp2Segment(jpeg: Uint8Array): boolean {
  return hasMpfApp2(jpeg);
}

export function validateColorOsExif(
  jpeg: Uint8Array,
  tags: TagMap = {},
  options: ColorOsExifValidateOptions = {},
): ColorOsExifValidation {
  const issues: string[] = [];
  const exifByteOrder = readExifByteOrder(jpeg);

  if (exifByteOrder !== "II") {
    issues.push(
      exifByteOrder === "MM"
        ? "ExifByteOrder 为大端 (MM)，ColorOS 需要小端 (II)"
        : "缺少 EXIF APP1 或无法读取 ExifByteOrder",
    );
  }
  if (!tagValue(tags, "EXIF:InteropIndex", "InteropIndex", "ExifIFD:InteropIndex")) {
    issues.push("缺少 InteropIndex（Interop IFD）");
  }
  if (!tagValue(tags, "IFD0:YCbCrPositioning", "EXIF:YCbCrPositioning", "YCbCrPositioning")) {
    issues.push("缺少 YCbCrPositioning");
  }
  if (!hasMakerNotesInTags(tags)) {
    issues.push("缺少 MakerNotes（ColorOS 机型水印可能失败）");
  }
  const comment = tagValue(tags, "EXIF:UserComment", "UserComment");
  if (comment && !/^oplus_/i.test(String(comment))) {
    issues.push("UserComment 缺少 oplus_ 前缀");
  }
  if (hasMpfApp2(jpeg)) {
    issues.push("存在 APP2 MPF 段（OPPO 原片通常无 MPF）");
  }

  if (options.motionPhoto) {
    const microVideo = tagValue(tags, "XMP-GCamera:MicroVideo", "MicroVideo");
    const microOffset = tagValue(tags, "XMP-GCamera:MicroVideoOffset", "MicroVideoOffset");
    const opVideoLength = tagValue(tags, "XMP-OpCamera:VideoLength", "VideoLength");
    if (microVideo == null && microOffset == null) {
      issues.push("缺少 GCamera MicroVideo / MicroVideoOffset XMP");
    }
    if (
      options.trailingLength != null &&
      microOffset != null &&
      Number(microOffset) !== options.trailingLength
    ) {
      issues.push(
        `MicroVideoOffset (${microOffset}) 与 MP4 尾部 (${options.trailingLength}) 不一致`,
      );
    }
    if (opVideoLength != null && microVideo == null) {
      issues.push("存在 OpCamera VideoLength 但缺少 GCamera MicroVideo XMP");
    }
  }

  return { ok: issues.length === 0, issues, exifByteOrder };
}

export function needsColorOsExifResync(
  jpeg: Uint8Array,
  tags: TagMap = {},
  options: { requireMakerNotes?: boolean } = {},
): boolean {
  if (readExifByteOrder(jpeg) !== "II") return true;
  if (!tagValue(tags, "EXIF:InteropIndex", "InteropIndex", "ExifIFD:InteropIndex")) {
    return true;
  }
  if (!tagValue(tags, "IFD0:YCbCrPositioning", "EXIF:YCbCrPositioning", "YCbCrPositioning")) {
    return true;
  }
  if (options.requireMakerNotes && !hasMakerNotesInTags(tags)) return true;
  if (hasMpfApp2(jpeg)) return true;
  return false;
}

export function hasExifApp1Segment(jpeg: Uint8Array): boolean {
  return scanJpegSegments(jpeg).some((s) => isExifApp1(s));
}
