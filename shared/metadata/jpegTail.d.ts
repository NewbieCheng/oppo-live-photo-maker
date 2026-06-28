/** Split MotionPhoto / live.jpg (JPEG + appended MP4) for metadata-only passes. */
/** Last 0xFFD9 in file (unsafe when MP4 tail contains false EOI markers). */
export declare function splitAfterLastJpegEoi(bytes: Uint8Array): {
    jpeg: Uint8Array;
    trailing: Uint8Array;
};
/**
 * Split JPEG from appended MP4 tail.
 * OPPO live photos place MP4 immediately after the first real EOI; the tail often
 * contains false 0xFFD9 bytes, so we must not use the last EOI in the file.
 */
export declare function splitJpegAndAppendedTail(bytes: Uint8Array): {
    jpeg: Uint8Array;
    trailing: Uint8Array;
};
export declare function concatBytes(head: Uint8Array, tail: Uint8Array): Uint8Array;
export declare function hasLikelyAppendedMp4(trailing: Uint8Array): boolean;
