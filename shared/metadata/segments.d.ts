/** JPEG APP segment helpers (copy-img-meta style block transplant). */
export declare function concat(...parts: Uint8Array[]): Uint8Array;
export interface JpegSegment {
    marker: number;
    payload: Uint8Array;
    start: number;
    end: number;
}
/** Iterate JPEG markers after SOI. */
export declare function scanJpegSegments(jpeg: Uint8Array): JpegSegment[];
export declare function isExifApp1(seg: JpegSegment): boolean;
/** copy-img-meta style include/exclude flags (default: copy all). */
export interface MetadataSegmentOptions {
    excludeExif?: boolean;
    excludeXmp?: boolean;
    excludeIptc?: boolean;
}
/** Extract EXIF APP1, IPTC APP13, and benign XMP APP1 from reference JPEG. */
export declare function extractTransplantableSegments(referenceJpeg: Uint8Array): {
    exifApp1: Uint8Array | null;
    iptcApp13: Uint8Array | null;
    extraApp1: Uint8Array[];
};
/**
 * Extract metadata APP segments from source JPEG (copy-img-meta semantics).
 * Respects exclude flags; when XMP is included, motion-photo XMP blocks are copied too.
 */
export declare function extractMetadataSegments(referenceJpeg: Uint8Array, options?: MetadataSegmentOptions): Uint8Array[];
/** Remove metadata APP segments selected for replacement; keep image data intact. */
export declare function stripMetadataForCopy(jpeg: Uint8Array, options?: MetadataSegmentOptions): Uint8Array;
/** Remove APP2 MPF segments (dest cover JPGs often carry MPF; OPPO originals typically do not). */
export declare function stripMpfApp2(jpeg: Uint8Array): Uint8Array;
/** Strip MotionPhoto XMP + all XMP APP1 + MPF (matches mux -XMP:all=), keep EXIF/IPTC. */
export declare function stripXmpAndMpf(jpeg: Uint8Array): Uint8Array;
/** Remove APP1/APP2 metadata segments; keep image data intact. */
export declare function stripMetadataSegments(jpeg: Uint8Array): Uint8Array;
/** Insert segments after SOI / existing APPn, before DQT/SOF/SOS. */
export declare function insertAfterAppSegments(jpeg: Uint8Array, insert: Uint8Array[]): Uint8Array;
