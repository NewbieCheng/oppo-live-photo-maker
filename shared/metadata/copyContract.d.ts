/**
 * Shared copy-img-meta contract (live-photo-conv / CLI / backend / web).
 */
export interface CopyMetadataOptions {
    excludeExif?: boolean;
    excludeXmp?: boolean;
    excludeIptc?: boolean;
}
/** Aligns with live-photo-conv default: copy EXIF + XMP + IPTC. */
export declare const FULL_COPY_PRESET: CopyMetadataOptions;
/**
 * When the destination is (or will become) a MotionPhoto / live.jpg:
 * do not copy source XMP so mux-written MotionPhoto tags are not overwritten.
 * Matches live-photo-conv `--exclude-xmp` in its Android vendor FAQ workaround.
 */
export declare const LIVE_PHOTO_TARGET_PRESET: CopyMetadataOptions;
/** @deprecated Use LIVE_PHOTO_TARGET_PRESET */
export declare const OPPO_COPY_PRESET: CopyMetadataOptions;
export declare function validateCopyOptions(options: CopyMetadataOptions): void;
export declare function buildTagsFromFileArgs(options?: CopyMetadataOptions): string[];
export declare function vfsBasename(name: string): string;
