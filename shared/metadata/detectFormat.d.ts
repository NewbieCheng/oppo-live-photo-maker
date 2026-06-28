/** Detect image format from magic bytes and optional filename. */
export type ImageFormat = "jpeg" | "heic" | "heif" | "png" | "webp" | "tiff" | "avif" | "unknown";
export declare function detectFormatFromBytes(bytes: Uint8Array, filename?: string): ImageFormat;
export declare function isJpegFormat(fmt: ImageFormat): boolean;
