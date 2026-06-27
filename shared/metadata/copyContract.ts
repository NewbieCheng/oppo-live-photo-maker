/**
 * Shared copy-img-meta contract (live-photo-conv / CLI / backend / web).
 */
export interface CopyMetadataOptions {
  excludeExif?: boolean;
  excludeXmp?: boolean;
  excludeIptc?: boolean;
}

export const OPPO_COPY_PRESET: CopyMetadataOptions = {
  excludeXmp: true,
};

export function validateCopyOptions(options: CopyMetadataOptions): void {
  if (options.excludeExif && options.excludeXmp && options.excludeIptc) {
    throw new Error("至少保留一种元数据类型（EXIF / XMP / IPTC）");
  }
}

export function buildTagsFromFileArgs(options: CopyMetadataOptions = {}): string[] {
  const args = ["-All:all"];
  if (options.excludeXmp) args.push("--XMP:all");
  if (options.excludeIptc) args.push("--IPTC:all");
  if (options.excludeExif) args.push("--EXIF:all");
  return args;
}

export function vfsBasename(name: string): string {
  const base = name.replace(/^.*[/\\]/, "").trim();
  return base || "image.jpg";
}
