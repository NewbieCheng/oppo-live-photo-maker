import { describe, expect, it } from "vitest";
import {
  DEFAULT_COLOROS_INTEROP_INDEX,
  planColorOsExifSupplement,
} from "@shared/colorOsExifPatch";
import { inferCopyExifByteOrder } from "@shared/exifByteOrder";
import { readJpegDimensions } from "@shared/jpegDimensions";

function tinyJpegWithSof(width: number, height: number): Uint8Array {
  const sofPayload = new Uint8Array([
    8,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    3,
    1,
    0x11,
    0,
    2,
    0x11,
    0,
    3,
    0x11,
    0,
  ]);
  const sofLen = sofPayload.length + 2;
  const sof = new Uint8Array(2 + 2 + sofPayload.length);
  sof[0] = 0xff;
  sof[1] = 0xc0;
  sof[2] = (sofLen >> 8) & 0xff;
  sof[3] = sofLen & 0xff;
  sof.set(sofPayload, 4);
  return new Uint8Array([0xff, 0xd8, ...sof, 0xff, 0xd9]);
}

describe("readJpegDimensions", () => {
  it("reads width and height from SOF0", () => {
    const jpeg = tinyJpegWithSof(447, 447);
    expect(readJpegDimensions(jpeg)).toEqual({ width: 447, height: 447 });
  });
});

describe("planColorOsExifSupplement", () => {
  it("plans Interop and dimensions when missing (HEIC copy case)", () => {
    const jpeg = tinyJpegWithSof(1920, 1440);
    const plan = planColorOsExifSupplement(jpeg, {
      "IFD0:Make": "OPPO",
      "IFD0:Model": "OPPO Find X8 Ultra",
      "IFD0:YCbCrPositioning": "Centered",
      "EXIF:ExifImageWidth": 0,
      "EXIF:ExifImageHeight": 0,
    });
    expect(plan.interopIndex).toBe(DEFAULT_COLOROS_INTEROP_INDEX);
    expect(plan.interopVersion).toBe("0100");
    expect(plan.exifImageWidth).toBe(1920);
    expect(plan.exifImageHeight).toBe(1440);
    expect(plan.ycbcrPositioning).toBeUndefined();
  });

  it("detects byte order mismatch vs OPPO MM source", () => {
    const jpeg = tinyJpegWithSof(447, 447);
    const sourceTags = {
      "File:ExifByteOrder": "Big-endian (Motorola, MM)",
      "IFD0:Make": "OPPO",
    };
    const plan = planColorOsExifSupplement(jpeg, { "IFD0:YCbCrPositioning": "Centered" }, sourceTags);
    expect(plan.byteOrder).toBe("MM");
    expect(inferCopyExifByteOrder(sourceTags)).toBe("MM");
  });

  it("skips fields already present", () => {
    const jpeg = tinyJpegWithSof(800, 600);
    const plan = planColorOsExifSupplement(jpeg, {
      "InteropIFD:InteropIndex": "R98 - DCF basic file (sRGB)",
      "InteropIFD:InteropVersion": "0100",
      "EXIF:ExifImageWidth": 800,
      "EXIF:ExifImageHeight": 600,
      "IFD0:YCbCrPositioning": "Centered",
    });
    expect(plan.interopIndex).toBeUndefined();
    expect(plan.exifImageWidth).toBeUndefined();
    expect(plan.exifImageHeight).toBeUndefined();
  });
});
