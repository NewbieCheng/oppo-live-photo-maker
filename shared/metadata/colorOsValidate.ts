/**
 * ColorOS EXIF validation (no ExifTool / WASM dependency).
 */
import { readExifByteOrder, type ExifByteOrder } from "./exifByteOrder.js";
import { isExifApp1, scanJpegSegments } from "./segments.js";
import type { MotionPhotoXmpMode } from "./motionPhotoXmp.js";

type TagMap = Record<string, unknown>;

export interface ColorOsExifValidation {
  ok: boolean;
  issues: string[];
  exifByteOrder: ExifByteOrder | null;
}

export interface ColorOsExifValidateOptions {
  motionPhoto?: boolean;
  trailingLength?: number;
  /** native = OPPO original (Container-only); compat = MicroVideo stack */
  xmpMode?: MotionPhotoXmpMode;
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

function inferXmpMode(tags: TagMap, options: ColorOsExifValidateOptions): MotionPhotoXmpMode {
  if (options.xmpMode) return options.xmpMode;
  const microVideo = tagValue(tags, "XMP-GCamera:MicroVideo", "MicroVideo");
  return microVideo != null ? "compat" : "native";
}

export function validateColorOsExif(
  jpeg: Uint8Array,
  tags: TagMap = {},
  options: ColorOsExifValidateOptions = {},
): ColorOsExifValidation {
  const issues: string[] = [];
  const exifByteOrder = readExifByteOrder(jpeg);

  if (exifByteOrder == null) {
    issues.push("缺少 EXIF APP1 或无法读取 ExifByteOrder");
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
    const xmpMode = inferXmpMode(tags, options);
    const motionPhoto = tagValue(tags, "XMP-GCamera:MotionPhoto", "MotionPhoto");
    const opVideoLength = tagValue(tags, "XMP-OpCamera:VideoLength", "VideoLength");
    const containerDir = tagValue(tags, "XMP-Container:Directory", "Container:Directory");

    if (motionPhoto == null) {
      issues.push("缺少 GCamera MotionPhoto XMP");
    }
    if (opVideoLength == null) {
      issues.push("缺少 OpCamera VideoLength XMP");
    }
    if (
      options.trailingLength != null &&
      opVideoLength != null &&
      Number(opVideoLength) !== options.trailingLength
    ) {
      issues.push(
        `OpCamera VideoLength (${opVideoLength}) 与 MP4 尾部 (${options.trailingLength}) 不一致`,
      );
    }

    if (xmpMode === "compat") {
      const microVideo = tagValue(tags, "XMP-GCamera:MicroVideo", "MicroVideo");
      const microOffset = tagValue(tags, "XMP-GCamera:MicroVideoOffset", "MicroVideoOffset");
      if (microVideo == null && microOffset == null) {
        issues.push("compat 模式缺少 GCamera MicroVideo / MicroVideoOffset XMP");
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
    } else if (containerDir == null) {
      issues.push("native 模式缺少 Container:Directory XMP");
    }
  }

  return { ok: issues.length === 0, issues, exifByteOrder };
}

export function needsColorOsExifResync(
  jpeg: Uint8Array,
  tags: TagMap = {},
  options: { requireMakerNotes?: boolean } = {},
): boolean {
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
