import { describe, expect, it } from "vitest";
import {
  bundleHasEditableFields,
  flattenExifReaderTags,
} from "./parse";
import { buildSyntheticReferenceJpeg } from "./apply";
import { extractTransplantableSegments } from "./segments";

describe("flattenExifReaderTags", () => {
  it("merges nested exif and gps groups", () => {
    const flat = flattenExifReaderTags({
      file: { FileType: { description: "JPEG", value: "JPEG" } },
      exif: { Make: { description: "OPLUS", value: "OPLUS" } },
      gps: { GPSLatitude: { description: "31 deg", value: [31, 0, 0] } },
      composite: { "Composite:GPSLongitude": { description: "121", value: 121 } },
    });
    expect(flat.Make?.description).toBe("OPLUS");
    expect(flat.GPSLatitude?.description).toBe("31 deg");
    expect(flat["Composite:GPSLongitude"]?.description).toBe("121");
  });
});

describe("bundleHasEditableFields", () => {
  it("detects empty vs filled bundles", () => {
    expect(bundleHasEditableFields({ exif: {}, iptc: {} })).toBe(false);
    expect(bundleHasEditableFields({ exif: { Make: "X" }, iptc: {} })).toBe(true);
  });
});

describe("HEIC-style field path", () => {
  it("builds transplantable EXIF from parsed fields", () => {
    const synthetic = buildSyntheticReferenceJpeg({
      exif: { Make: "OPLUS", Model: "Find X7", ISOSpeedRatings: "100" },
      iptc: {},
    });
    const { exifApp1 } = extractTransplantableSegments(synthetic);
    expect(exifApp1).not.toBeNull();
    const text = new TextDecoder("latin1").decode(exifApp1!);
    expect(text).toContain("Exif");
    expect(text).toContain("OPLUS");
  });
});
