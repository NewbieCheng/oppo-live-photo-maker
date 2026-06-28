/**
 * Read encoded image dimensions from JPEG SOF markers (no decode).
 */
export declare function readJpegDimensions(jpeg: Uint8Array): {
    width: number;
    height: number;
} | null;
