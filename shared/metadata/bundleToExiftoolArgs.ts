/** Map editable metadata bundle fields to ExifTool `-Tag=value` write args. */

export interface MetadataWriteBundle {
  exif: Record<string, string>;
  iptc: Record<string, string>;
  presentationTimestampUs?: number;
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
};

const IPTC_TAG_MAP: Record<string, string> = {
  Keywords: "IPTC:Keywords",
  "Caption-Abstract": "IPTC:Caption-Abstract",
  CopyrightNotice: "IPTC:CopyrightNotice",
};

function shouldWriteKey(dirtyKeys: Set<string> | undefined, fieldKey: string): boolean {
  return !dirtyKeys || dirtyKeys.has(fieldKey);
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

  if (
    bundle.presentationTimestampUs != null &&
    shouldWriteKey(dirtyKeys, "presentationTimestampUs")
  ) {
    args.push(
      `-XMP-GCamera:MicroVideoPresentationTimestampUs=${bundle.presentationTimestampUs}`,
    );
  }

  return args;
}
