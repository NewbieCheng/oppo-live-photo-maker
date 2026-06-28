/**
 * GExiv2-style JPEG metadata copy via raw APP segment transplant (sync, no WASM).
 */
import type { CopyMetadataOptions } from "./copyContract.js";
export declare function copyMetadataViaSegmentTransplantSync(destJpeg: Uint8Array, sourceBytes: Uint8Array, options?: CopyMetadataOptions): Uint8Array;
