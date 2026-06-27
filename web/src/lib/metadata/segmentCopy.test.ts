import { describe, expect, it } from "vitest";
import { buildSyntheticReferenceJpeg } from "./apply";
import { readExifByteOrder } from "./exifByteOrder";
import {
  extractMetadataSegments,
  insertAfterAppSegments,
  stripMetadataForCopy,
} from "./segments";

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

describe("readExifByteOrder", () => {
  it("detects II from handcrafted EXIF APP1", () => {
    const jpeg = insertAfterAppSegments(tinyJpeg(), [exifApp1Ii("OPPO", "Find X8")]);
    expect(readExifByteOrder(jpeg)).toBe("II");
  });

  it("returns null when no EXIF APP1", () => {
    expect(readExifByteOrder(tinyJpeg())).toBeNull();
  });
});

describe("segment transplant (GExiv2-style)", () => {
  it("preserves source EXIF byte order on destination", () => {
    const source = insertAfterAppSegments(tinyJpeg(), [exifApp1Ii("OPPO", "Find X8 Ultra")]);
    const segments = extractMetadataSegments(source, {});
    expect(segments.length).toBeGreaterThan(0);
    const dest = stripMetadataForCopy(tinyJpeg(), {});
    const out = insertAfterAppSegments(dest, segments);
    expect(readExifByteOrder(out)).toBe("II");
  });

  it("copies Make/Model via raw APP1 transplant", () => {
    const source = buildSyntheticReferenceJpeg({
      exif: { Make: "OPPO", Model: "Find X7" },
      iptc: {},
    });
    const segments = extractMetadataSegments(source, { excludeXmp: true });
    const out = insertAfterAppSegments(stripMetadataForCopy(tinyJpeg(), { excludeXmp: true }), segments);
    expect(out.length).toBeGreaterThan(tinyJpeg().length);
    const text = new TextDecoder("latin1").decode(out);
    expect(text).toContain("OPPO");
    expect(text).toContain("Find X7");
  });
});
