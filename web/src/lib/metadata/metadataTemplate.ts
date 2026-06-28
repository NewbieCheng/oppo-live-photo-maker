/**
 * OPPO Find X8 Ultra metadata template (from docs/oppo-find-x8-metadata-reference.md).
 * Used when Feature 1 has no reference image — EXIF/XMP scalars only (no MakerNote binary).
 */
import type { NativeMetadataBundle } from "./types";

export type MetadataSourceMode = "none" | "reference" | "template";

export const FIND_X8_ULTRA_TEMPLATE_LABEL = "OPPO Find X8 Ultra 模板";

/** Default template aligned with IMG20260626213341.heic EXIF + native live XMP structure. */
export function createFindX8UltraTemplate(): NativeMetadataBundle {
  return {
    exif: {
      Make: "OPPO",
      Model: "OPPO Find X8 Ultra",
      Orientation: "1",
      FNumber: "18/10",
      ExposureTime: "1/46",
      ISOSpeedRatings: "3200",
      FocalLength: "87/10",
      LensModel: "OPPO Find X8 Ultra back camera 2147483647mm f/1.8",
      MeteringMode: "5",
      UserComment: "Oplus_8388608",
    },
    iptc: {},
  };
}

export function metadataSourceLabel(mode: MetadataSourceMode): string {
  switch (mode) {
    case "reference":
      return "机内原图";
    case "template":
      return FIND_X8_ULTRA_TEMPLATE_LABEL;
    default:
      return "默认";
  }
}
