import { emptyXmpBundle, type NativeMetadataBundle } from "./types";

export { emptyXmpBundle };

export interface MetadataFieldDef {
  key: string;
  label: string;
  placeholder?: string;
  iptc?: boolean;
  xmp?: "gcamera" | "opcamera" | "container" | "hdrgm" | "coloros";
}

export interface MetadataFieldGroup {
  id: string;
  title: string;
  fields: MetadataFieldDef[];
}

export const METADATA_FIELD_GROUPS: MetadataFieldGroup[] = [
  {
    id: "camera",
    title: "相机",
    fields: [
      { key: "Make", label: "品牌 (Make)" },
      { key: "Model", label: "型号 (Model)" },
      { key: "Software", label: "软件 (Software)" },
      { key: "LensModel", label: "镜头 (LensModel)" },
      { key: "Orientation", label: "方向 (Orientation)" },
    ],
  },
  {
    id: "exposure",
    title: "曝光",
    fields: [
      { key: "FNumber", label: "光圈 (FNumber)" },
      { key: "ExposureTime", label: "快门 (ExposureTime)" },
      { key: "ISOSpeedRatings", label: "ISO" },
      { key: "FocalLength", label: "焦距 (FocalLength)" },
      { key: "Flash", label: "闪光灯 (Flash)" },
      { key: "WhiteBalance", label: "白平衡 (WhiteBalance)" },
    ],
  },
  {
    id: "datetime",
    title: "时间",
    fields: [
      { key: "DateTimeOriginal", label: "拍摄时间", placeholder: "2024:01:01 12:00:00" },
      { key: "CreateDate", label: "创建时间" },
      { key: "ModifyDate", label: "修改时间" },
      { key: "OffsetTimeOriginal", label: "时区偏移", placeholder: "+08:00" },
    ],
  },
  {
    id: "location",
    title: "位置",
    fields: [
      { key: "GPSLatitude", label: "纬度 (GPSLatitude)" },
      { key: "GPSLongitude", label: "经度 (GPSLongitude)" },
      { key: "GPSAltitude", label: "海拔 (GPSAltitude)" },
      { key: "GPSDateStamp", label: "GPS 日期" },
    ],
  },
  {
    id: "coloros",
    title: "ColorOS 结构",
    fields: [
      { key: "InteropIndex", label: "InteropIndex", placeholder: "R98", xmp: "coloros" },
      { key: "InteropVersion", label: "InteropVersion", placeholder: "0100", xmp: "coloros" },
      { key: "YCbCrPositioning", label: "YCbCrPositioning", placeholder: "Centered", xmp: "coloros" },
      { key: "ExifImageWidth", label: "ExifImageWidth", xmp: "coloros" },
      { key: "ExifImageHeight", label: "ExifImageHeight", xmp: "coloros" },
    ],
  },
  {
    id: "oppo_exif",
    title: "OPPO EXIF",
    fields: [
      {
        key: "UserComment",
        label: "UserComment（OPPO 识别）",
        placeholder: "oplus_9127854112 或 Oplus_8388608",
      },
    ],
  },
  {
    id: "gcamera",
    title: "GCamera XMP",
    fields: [
      { key: "MotionPhoto", label: "MotionPhoto", placeholder: "1", xmp: "gcamera" },
      { key: "MotionPhotoVersion", label: "MotionPhotoVersion", placeholder: "1", xmp: "gcamera" },
      {
        key: "MotionPhotoPresentationTimestampUs",
        label: "PresentationTimestampUs (μs)",
        xmp: "gcamera",
      },
      { key: "MicroVideo", label: "MicroVideo (compat)", placeholder: "1", xmp: "gcamera" },
      { key: "MicroVideoVersion", label: "MicroVideoVersion", placeholder: "1", xmp: "gcamera" },
      { key: "MicroVideoOffset", label: "MicroVideoOffset", xmp: "gcamera" },
    ],
  },
  {
    id: "opcamera",
    title: "OpCamera XMP",
    fields: [
      { key: "MotionPhotoOwner", label: "MotionPhotoOwner", placeholder: "oplus", xmp: "opcamera" },
      { key: "OLivePhotoVersion", label: "OLivePhotoVersion", placeholder: "2", xmp: "opcamera" },
      { key: "VideoLength", label: "VideoLength (bytes)", xmp: "opcamera" },
      { key: "MotionPhotoFeatureFlag", label: "MotionPhotoFeatureFlag", placeholder: "1", xmp: "opcamera" },
      {
        key: "MotionPhotoPrimaryPresentationTimestampUs",
        label: "PrimaryPresentationTimestampUs",
        xmp: "opcamera",
      },
    ],
  },
  {
    id: "container",
    title: "Container XMP",
    fields: [
      { key: "gainMapLength", label: "GainMap Length (bytes)", xmp: "container" },
      { key: "videoLength", label: "MotionPhoto Length (bytes)", xmp: "container" },
    ],
  },
  {
    id: "hdrgm",
    title: "HDR (hdrgm)",
    fields: [{ key: "version", label: "hdrgm:Version", placeholder: "1.0", xmp: "hdrgm" }],
  },
  {
    id: "iptc",
    title: "IPTC",
    fields: [
      { key: "Keywords", label: "关键词", iptc: true },
      { key: "Caption-Abstract", label: "说明", iptc: true },
      { key: "CopyrightNotice", label: "版权", iptc: true },
    ],
  },
];

export const ALL_EDITABLE_EXIF_KEYS = METADATA_FIELD_GROUPS.flatMap((g) =>
  g.fields.filter((f) => !f.iptc && !f.xmp).map((f) => f.key),
);

export const ALL_EDITABLE_IPTC_KEYS = METADATA_FIELD_GROUPS.find((g) => g.id === "iptc")!.fields.map(
  (f) => f.key,
);

export function emptyBundle(): NativeMetadataBundle {
  return { exif: {}, iptc: {}, xmp: emptyXmpBundle() };
}

export function mergeBundles(
  base: NativeMetadataBundle,
  edits: NativeMetadataBundle,
): NativeMetadataBundle {
  return {
    exif: { ...base.exif, ...edits.exif },
    iptc: { ...base.iptc, ...edits.iptc },
    xmp: {
      gcamera: { ...base.xmp?.gcamera, ...edits.xmp?.gcamera },
      opcamera: { ...base.xmp?.opcamera, ...edits.xmp?.opcamera },
      container: { ...base.xmp?.container, ...edits.xmp?.container },
      hdrgm: { ...base.xmp?.hdrgm, ...edits.xmp?.hdrgm },
      mode: edits.xmp?.mode ?? base.xmp?.mode ?? "native",
    },
    makerNoteJson: edits.makerNoteJson ?? base.makerNoteJson,
    presentationTimestampUs: edits.presentationTimestampUs ?? base.presentationTimestampUs,
    presentationTimestampUserSet:
      edits.presentationTimestampUserSet ?? base.presentationTimestampUserSet,
  };
}
