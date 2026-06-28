/** Map editable metadata bundle fields to ExifTool `-Tag=value` write args. */

export interface XmpWriteFields {
  gcamera?: Record<string, string | number>;
  opcamera?: Record<string, string | number>;
  container?: {
    gainMapLength?: number;
    videoLength?: number;
  };
  hdrgm?: {
    version?: string;
  };
  mode?: "native" | "compat";
}

export interface MetadataWriteBundle {
  exif: Record<string, string>;
  iptc: Record<string, string>;
  xmp?: XmpWriteFields;
  presentationTimestampUs?: number;
  /** When true, rebuild MotionPhoto XMP packet (Container structure). */
  rebuildXmp?: boolean;
}

const EXIF_TAG_MAP: Record<string, string> = {
  Make: "IFD0:Make",
  Model: "IFD0:Model",
  Software: "IFD0:Software",
  Orientation: "IFD0:Orientation",
  CreateDate: "IFD0:CreateDate",
  ModifyDate: "IFD0:ModifyDate",
  DateTimeOriginal: "EXIF:DateTimeOriginal",
  OffsetTimeOriginal: "EXIF:OffsetTimeOriginal",
  FNumber: "EXIF:FNumber",
  ExposureTime: "EXIF:ExposureTime",
  ISOSpeedRatings: "EXIF:ISO",
  ISO: "EXIF:ISO",
  FocalLength: "EXIF:FocalLength",
  Flash: "EXIF:Flash",
  WhiteBalance: "EXIF:WhiteBalance",
  LensModel: "EXIF:LensModel",
  GPSLatitude: "GPS:GPSLatitude",
  GPSLongitude: "GPS:GPSLongitude",
  GPSAltitude: "GPS:GPSAltitude",
  GPSDateStamp: "GPS:GPSDateStamp",
  UserComment: "EXIF:UserComment",
  InteropIndex: "InteropIFD:InteropIndex",
  InteropVersion: "InteropIFD:InteropVersion",
  YCbCrPositioning: "IFD0:YCbCrPositioning",
  ExifImageWidth: "ExifIFD:ExifImageWidth",
  ExifImageHeight: "ExifIFD:ExifImageHeight",
};

const IPTC_TAG_MAP: Record<string, string> = {
  Keywords: "IPTC:Keywords",
  "Caption-Abstract": "IPTC:Caption-Abstract",
  CopyrightNotice: "IPTC:CopyrightNotice",
};

const GCAMERA_XMP_MAP: Record<string, string> = {
  MotionPhoto: "XMP-GCamera:MotionPhoto",
  MotionPhotoVersion: "XMP-GCamera:MotionPhotoVersion",
  MotionPhotoPresentationTimestampUs: "XMP-GCamera:MotionPhotoPresentationTimestampUs",
  MicroVideo: "XMP-GCamera:MicroVideo",
  MicroVideoVersion: "XMP-GCamera:MicroVideoVersion",
  MicroVideoOffset: "XMP-GCamera:MicroVideoOffset",
  MicroVideoPresentationTimestampUs: "XMP-GCamera:MicroVideoPresentationTimestampUs",
};

const OPCAMERA_XMP_MAP: Record<string, string> = {
  MotionPhotoOwner: "XMP-OpCamera:MotionPhotoOwner",
  OLivePhotoVersion: "XMP-OpCamera:OLivePhotoVersion",
  VideoLength: "XMP-OpCamera:VideoLength",
  MotionPhotoFeatureFlag: "XMP-OpCamera:MotionPhotoFeatureFlag",
  MotionPhotoPrimaryPresentationTimestampUs:
    "XMP-OpCamera:MotionPhotoPrimaryPresentationTimestampUs",
};

function shouldWriteKey(dirtyKeys: Set<string> | undefined, fieldKey: string): boolean {
  return !dirtyKeys || dirtyKeys.has(fieldKey);
}

function appendXmpRecordArgs(
  args: string[],
  record: Record<string, string | number> | undefined,
  map: Record<string, string>,
  prefix: string,
  dirtyKeys?: Set<string>,
): void {
  if (!record) return;
  for (const [key, value] of Object.entries(record)) {
    if (value === "" || value == null) continue;
    const dirtyKey = `${prefix}:${key}`;
    if (!shouldWriteKey(dirtyKeys, dirtyKey)) continue;
    const tag = map[key] ?? `XMP-${prefix}:${key}`;
    args.push(`-${tag}=${value}`);
  }
}

/** Build ExifTool write arguments for in-place metadata editing. */
export function bundleToExiftoolWriteArgs(
  bundle: MetadataWriteBundle,
  dirtyKeys?: Set<string>,
): string[] {
  const args: string[] = ["-api", "ByteOrder=II", "-m"];

  for (const [key, value] of Object.entries(bundle.exif)) {
    if (!value) continue;
    if (!shouldWriteKey(dirtyKeys, `exif:${key}`)) continue;
    const tag = EXIF_TAG_MAP[key] ?? `EXIF:${key}`;
    args.push(`-${tag}=${value}`);
  }

  for (const [key, value] of Object.entries(bundle.iptc)) {
    if (!value) continue;
    if (!shouldWriteKey(dirtyKeys, `iptc:${key}`)) continue;
    const tag = IPTC_TAG_MAP[key] ?? `IPTC:${key}`;
    args.push(`-${tag}=${value}`);
  }

  appendXmpRecordArgs(args, bundle.xmp?.gcamera, GCAMERA_XMP_MAP, "gcamera", dirtyKeys);
  appendXmpRecordArgs(args, bundle.xmp?.opcamera, OPCAMERA_XMP_MAP, "opcamera", dirtyKeys);

  if (bundle.xmp?.hdrgm?.version && shouldWriteKey(dirtyKeys, "xmp:hdrgm:version")) {
    args.push(`-XMP-hdrgm:Version=${bundle.xmp.hdrgm.version}`);
  }

  if (
    bundle.presentationTimestampUs != null &&
    shouldWriteKey(dirtyKeys, "presentationTimestampUs")
  ) {
    const ts = bundle.presentationTimestampUs;
    args.push(`-XMP-GCamera:MotionPhotoPresentationTimestampUs=${ts}`);
    args.push(`-XMP-OpCamera:MotionPhotoPrimaryPresentationTimestampUs=${ts}`);
    if (bundle.xmp?.mode === "compat" || bundle.xmp?.gcamera?.MicroVideo != null) {
      args.push(`-XMP-GCamera:MicroVideoPresentationTimestampUs=${ts}`);
    }
  }

  return args;
}

/** Whether bundle edits require full MotionPhoto XMP rebuild (Container / GainMap). */
export function bundleNeedsXmpRebuild(
  bundle: MetadataWriteBundle,
  dirtyKeys?: Set<string>,
): boolean {
  if (bundle.rebuildXmp) return true;
  if (!dirtyKeys) return false;
  const structural = [
    "xmp:container:gainMapLength",
    "xmp:container:videoLength",
    "xmp:mode",
    "xmp:opcamera:VideoLength",
    "xmp:gcamera:MicroVideoOffset",
  ];
  return structural.some((k) => dirtyKeys.has(k));
}

/** Resolve video length for XMP rebuild from bundle edits. */
export function resolveXmpVideoLength(
  bundle: MetadataWriteBundle,
  trailingLength?: number,
): number | undefined {
  const fromContainer = bundle.xmp?.container?.videoLength;
  const fromOp = bundle.xmp?.opcamera?.VideoLength;
  const fromMicro = bundle.xmp?.gcamera?.MicroVideoOffset;
  const candidates = [fromContainer, fromOp, fromMicro, trailingLength];
  for (const v of candidates) {
    if (v == null || v === "") continue;
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return undefined;
}
