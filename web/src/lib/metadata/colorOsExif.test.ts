import { describe, expect, it } from "vitest";
import {
  hasExifApp1Segment,
  hasMpfApp2Segment,
  needsColorOsExifResync,
  validateColorOsExif,
} from "./colorOsExif";
import { readExifByteOrder } from "./exifByteOrder";
import { insertAfterAppSegments } from "./segments";

function seg(marker: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(2 + 2 + payload.length);
  out[0] = 0xff;
  out[1] = marker;
  const len = payload.length + 2;
  out[2] = (len >> 8) & 0xff;
  out[3] = len & 0xff;
  out.set(payload, 4);
  return out;
}

function tinyJpeg(): Uint8Array {
  const app0 = seg(0xe0, new TextEncoder().encode("JFIF\0\x01\x01\x00\x00\x01\x00\x01\x00\x00"));
  const dqt = seg(0xdb, new Uint8Array(64).fill(16));
  const parts = [new Uint8Array([0xff, 0xd8]), app0, dqt, new Uint8Array([0xff, 0xd9])];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let i = 0;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
}

function exifApp1Ii(make: string, model: string): Uint8Array {
  const enc = new TextEncoder();
  const makeBytes = enc.encode(make + "\0");
  const modelBytes = enc.encode(model + "\0");
  const ifdCount = 2;
  const ifdBytes = 2 + ifdCount * 12 + 4;
  const makeOff = 8 + ifdBytes;
  const modelOff = makeOff + makeBytes.length;
  const total = modelOff + modelBytes.length;
  const tiff = new Uint8Array(total);
  const view = new DataView(tiff.buffer);
  tiff[0] = 0x49;
  tiff[1] = 0x49;
  view.setUint16(2, 0x002a, true);
  view.setUint32(4, 8, true);
  view.setUint16(8, ifdCount, true);
  view.setUint16(10, 0x010f, true);
  view.setUint16(12, 2, true);
  view.setUint32(14, makeBytes.length, true);
  view.setUint32(18, makeOff, true);
  view.setUint16(22, 0x0110, true);
  view.setUint16(24, 2, true);
  view.setUint32(26, modelBytes.length, true);
  view.setUint32(30, modelOff, true);
  tiff.set(makeBytes, makeOff);
  tiff.set(modelBytes, modelOff);
  const header = new TextEncoder().encode("Exif\0\0");
  const payload = new Uint8Array(header.length + tiff.length);
  payload.set(header, 0);
  payload.set(tiff, header.length);
  return seg(0xe1, payload);
}

describe("hasExifApp1Segment", () => {
  it("detects EXIF APP1", () => {
    const jpeg = insertAfterAppSegments(tinyJpeg(), [exifApp1Ii("OPPO", "Find")]);
    expect(hasExifApp1Segment(jpeg)).toBe(true);
  });

  it("returns false for bare JPEG", () => {
    expect(hasExifApp1Segment(tinyJpeg())).toBe(false);
  });
});

describe("needsColorOsExifResync", () => {
  it("flags MM byte order", () => {
    const segMm = exifApp1Ii("OPPO", "Find");
    segMm[10] = 0x4d;
    segMm[11] = 0x4d;
    const mm = insertAfterAppSegments(tinyJpeg(), [segMm]);
    expect(readExifByteOrder(mm)).toBe("MM");
    expect(needsColorOsExifResync(mm, { "EXIF:Make": "OPPO" })).toBe(true);
  });

  it("flags II EXIF missing Interop and YCbCr", () => {
    const ii = insertAfterAppSegments(tinyJpeg(), [exifApp1Ii("OPPO", "Find X8")]);
    expect(readExifByteOrder(ii)).toBe("II");
    expect(needsColorOsExifResync(ii, { "EXIF:Make": "OPPO" })).toBe(true);
  });

  it("accepts II EXIF with Interop and YCbCr", () => {
    const ii = insertAfterAppSegments(tinyJpeg(), [exifApp1Ii("OPPO", "Find X8")]);
    expect(
      needsColorOsExifResync(ii, {
        "EXIF:InteropIndex": "R98 - DCF basic file (sRGB)",
        "IFD0:YCbCrPositioning": "Centered",
      }),
    ).toBe(false);
  });

  it("requires MakerNotes when option set", () => {
    const ii = insertAfterAppSegments(tinyJpeg(), [exifApp1Ii("OPPO", "Find X8")]);
    expect(
      needsColorOsExifResync(
        ii,
        {
          "EXIF:InteropIndex": "R98",
          "IFD0:YCbCrPositioning": "Centered",
        },
        { requireMakerNotes: true },
      ),
    ).toBe(true);
  });
});

describe("validateColorOsExif", () => {
  it("reports MM byte order issue", () => {
    const segMm = exifApp1Ii("OPPO", "Find");
    segMm[10] = 0x4d;
    segMm[11] = 0x4d;
    const mm = insertAfterAppSegments(tinyJpeg(), [segMm]);
    const result = validateColorOsExif(mm, { "EXIF:Make": "OPPO" });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.includes("MM"))).toBe(true);
  });

  it("flags MicroVideoOffset mismatch on motion photos", () => {
    const ii = insertAfterAppSegments(tinyJpeg(), [exifApp1Ii("OPPO", "Find X8")]);
    const result = validateColorOsExif(
      ii,
      {
        "EXIF:InteropIndex": "R98",
        "IFD0:YCbCrPositioning": "Centered",
        "MakerNotes:Version": "1",
        "XMP-GCamera:MicroVideoOffset": 100,
      },
      { motionPhoto: true, trailingLength: 999 },
    );
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.includes("MicroVideoOffset"))).toBe(true);
  });
});

describe("hasMpfApp2Segment", () => {
  it("detects MPF APP2", () => {
    const mpf = seg(0xe2, new TextEncoder().encode("MPF\0\x00\x00"));
    const jpeg = insertAfterAppSegments(tinyJpeg(), [mpf]);
    expect(hasMpfApp2Segment(jpeg)).toBe(true);
  });
});
