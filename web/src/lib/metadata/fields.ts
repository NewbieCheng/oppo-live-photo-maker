export interface MetadataFieldDef {
  key: string;
  label: string;
  placeholder?: string;
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
      { key: "OffsetTimeOriginal", label: "时区偏移" },
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
    id: "other",
    title: "其他",
    fields: [{ key: "UserComment", label: "UserComment（OPPO 识别）" }],
  },
  {
    id: "iptc",
    title: "IPTC",
    fields: [
      { key: "Keywords", label: "关键词" },
      { key: "Caption-Abstract", label: "说明" },
      { key: "CopyrightNotice", label: "版权" },
    ],
  },
];

export const OPPO_SYSTEM_FIELDS = [
  {
    key: "UserComment",
    label: "UserComment（OPPO 识别标记）",
    value: "Oplus_8388608",
    readonly: true,
  },
] as const;

export const ALL_EDITABLE_EXIF_KEYS = METADATA_FIELD_GROUPS.flatMap((g) =>
  g.id === "iptc" ? [] : g.fields.map((f) => f.key),
);

export const ALL_EDITABLE_IPTC_KEYS = METADATA_FIELD_GROUPS.find((g) => g.id === "iptc")!.fields.map(
  (f) => f.key,
);

export function emptyBundle(): NativeMetadataBundle {
  return { exif: {}, iptc: {} };
}

import type { NativeMetadataBundle } from "./types";

export function mergeBundles(
  base: NativeMetadataBundle,
  edits: NativeMetadataBundle,
): NativeMetadataBundle {
  return {
    exif: { ...base.exif, ...edits.exif },
    iptc: { ...base.iptc, ...edits.iptc },
    presentationTimestampUs: edits.presentationTimestampUserSet
      ? edits.presentationTimestampUs
      : base.presentationTimestampUs ?? edits.presentationTimestampUs,
    presentationTimestampUserSet:
      edits.presentationTimestampUserSet ?? base.presentationTimestampUserSet,
  };
}
