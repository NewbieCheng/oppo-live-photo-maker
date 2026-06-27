import { describe, expect, it } from "vitest";
import { applyNativeMetadata, OPPO_USER_COMMENT } from "./apply";
import { buildOppoMotionPhoto } from "../muxer";
import { extractTransplantableSegments } from "./segments";

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

function jpegWithExifSegment(make: string): Uint8Array {
  // Minimal Exif APP1 containing ASCII Make (not full IFD — enough for segment copy test).
  const body = new TextEncoder().encode(`Exif\0\0${make}`);
  const app1 = seg(0xe1, body);
  const base = tinyJpeg();
  return new Uint8Array([...base.subarray(0, 2), ...app1, ...base.subarray(2)]);
}

describe("extractTransplantableSegments", () => {
  it("copies EXIF APP1 from reference", () => {
    const ref = jpegWithExifSegment("OPLUS");
    const { exifApp1 } = extractTransplantableSegments(ref);
    expect(exifApp1).not.toBeNull();
    const text = new TextDecoder("latin1").decode(exifApp1!);
    expect(text).toContain("Exif");
    expect(text).toContain("OPLUS");
  });
});

describe("applyNativeMetadata", () => {
  it("does not throw on minimal JPEG with metadata bundle", () => {
    const cover = tinyJpeg();
    const out = applyNativeMetadata(cover, { exif: { Make: "Edited" }, iptc: {} });
    expect(out[0]).toBe(0xff);
    expect(out[1]).toBe(0xd8);
  });

  it("transplants reference EXIF segment", () => {
    const ref = jpegWithExifSegment("RefMake");
    const cover = tinyJpeg();
    const out = applyNativeMetadata(cover, { exif: {}, iptc: {} }, ref);
    const text = new TextDecoder("latin1").decode(out);
    expect(text).toContain("RefMake");
  });
});

describe("buildOppoMotionPhoto with native metadata", () => {
  it("still produces valid motion photo with metadata bundle", () => {
    const cover = tinyJpeg();
    const mp4 = new Uint8Array(16);
    const out = buildOppoMotionPhoto(cover, mp4, {
      nativeMetadata: { exif: { Make: "NativeMake" }, iptc: {} },
      presentationTimestampUs: 500_000,
    });
    expect(out[0]).toBe(0xff);
    expect(out[1]).toBe(0xd8);
    const text = new TextDecoder("latin1").decode(out);
    expect(text).toContain("Oplus_8388608");
    expect(text).toContain("MicroVideo");
    expect(text).toContain("500000");
  });
});

describe("OPPO_USER_COMMENT constant", () => {
  it("matches OPPO requirement", () => {
    expect(OPPO_USER_COMMENT).toBe("Oplus_8388608");
  });
});
