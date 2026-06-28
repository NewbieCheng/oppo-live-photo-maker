/**
 * MotionPhoto XMP rebuild (GCamera MicroVideo, no APP2 MPF) — shared by backend.
 */
import { scanJpegSegments } from "./segments.js";
declare function findInsertionPoint(jpeg: Uint8Array): number;
interface XmpFields {
    videoLength: number;
    presentationTimestampUs?: number;
}
declare function buildXmpApp1(fields: XmpFields): Uint8Array;
export declare function rebuildMotionPhotoXmpInJpeg(jpeg: Uint8Array, videoLength: number, options?: {
    presentationTimestampUs?: number;
}): Uint8Array;
/** @internal for tests */
export declare const _internal: {
    findInsertionPoint: typeof findInsertionPoint;
    buildXmpApp1: typeof buildXmpApp1;
    scanJpegSegments: typeof scanJpegSegments;
};
export {};
