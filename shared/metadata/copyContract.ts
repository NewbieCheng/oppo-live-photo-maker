/**
 * Shared copy-img-meta contract (live-photo-conv / CLI / backend / web).
 */
export interface CopyMetadataOptions {
  excludeExif?: boolean;
  excludeXmp?: boolean;
  excludeIptc?: boolean;
}

/** Aligns with live-photo-conv default: copy EXIF + XMP + IPTC. */
export const FULL_COPY_PRESET: CopyMetadataOptions = {};

/**
 * When the destination is (or will become) a MotionPhoto / live.jpg:
 * do not copy source XMP so mux-written MotionPhoto tags are not overwritten.
 * Matches live-photo-conv `--exclude-xmp` in its Android vendor FAQ workaround.
 */
export const LIVE_PHOTO_TARGET_PRESET: CopyMetadataOptions = {
  excludeXmp: true,
};

/** @deprecated Use LIVE_PHOTO_TARGET_PRESET */
export const OPPO_COPY_PRESET: CopyMetadataOptions = LIVE_PHOTO_TARGET_PRESET;

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

/** Safe filename for ExifTool WASM VFS (spaces/parens break FilenameSPrintf → EFile errors). */
export function vfsBasename(name: string): string {
  const base = name.replace(/^.*[/\\]/, "").trim();
  const safe = base
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return safe || "image.jpg";
}
