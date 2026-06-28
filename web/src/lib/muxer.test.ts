import { describe, expect, it } from "vitest";
import { rebuildMotionPhotoXmpInJpeg } from "@shared/motionPhotoXmp";
import { insertAfterAppSegments } from "./metadata/segments";
import { ensureIfd0MakeModel } from "./metadata/apply";
import { _internal, buildOppoMotionPhoto } from "./muxer";

const { buildMpfSegment, buildExifApp1, buildMotionPhotoXmpApp1, buildMotionPhotoXmpPacket } = _internal;

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
function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let i = 0;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
}

describe("MPF segment", () => {
  it("starts with APP2 marker", () => {
    const s = buildMpfSegment(12345);
    expect(s[0]).toBe(0xff);
    expect(s[1]).toBe(0xe2);
  });
});

describe("XMP packet (shared builder)", () => {
  it("contains required OPPO MotionPhoto fields in native mode", () => {
    const x = buildMotionPhotoXmpPacket({
      videoLength: 12345,
      presentationTimestampUs: 500000,
      mode: "native",
    });
    expect(x).toContain('GCamera:MotionPhoto="1"');
    expect(x).toContain('GCamera:MotionPhotoPresentationTimestampUs="500000"');
    expect(x).toContain('OpCamera:MotionPhotoPrimaryPresentationTimestampUs="500000"');
    expect(x).toContain('OpCamera:MotionPhotoOwner="oplus"');
    expect(x).not.toContain("MicroVideo");
  });
});

describe("APP1 EXIF segment", () => {
  it("contains the Oplus_8388608 user comment marker by default", () => {
    const segBytes = buildExifApp1();
    const text = new TextDecoder("latin1").decode(segBytes);
    expect(text).toContain("Oplus_8388608");
  });

  it("accepts custom user comment", () => {
    const segBytes = buildExifApp1("oplus_9127854112");
    const text = new TextDecoder("latin1").decode(segBytes);
    expect(text).toContain("oplus_9127854112");
  });
});

describe("buildOppoMotionPhoto end-to-end", () => {
  function tinyJpeg(): Uint8Array {
    const app0 = seg(0xe0, new TextEncoder().encode("JFIF\0\x01\x01\x00\x00\x01\x00\x01\x00\x00"));
    const dqt = seg(0xdb, new Uint8Array(64).fill(16));
    return concat(new Uint8Array([0xff, 0xd8]), app0, dqt, new Uint8Array([0xff, 0xd9]));
  }

  it("produces JPEG with MP4 trailer", () => {
    const mp4 = new Uint8Array(20);
    const out = buildOppoMotionPhoto(tinyJpeg(), mp4);
    expect(out[0]).toBe(0xff);
    expect(out[1]).toBe(0xd8);
    expect(Array.from(out.subarray(out.length - mp4.length))).toEqual(Array.from(mp4));
  });

  it("injects EXIF + XMP without MPF by default", () => {
    const out = buildOppoMotionPhoto(tinyJpeg(), new Uint8Array(20));
    const text = new TextDecoder("latin1").decode(out);
    expect(text).toContain("Oplus_8388608");
    expect(text).toContain("ns.oplus.com");
    expect(text).not.toContain("MPF\0");
  });

  it("optionally includes MPF", () => {
    const out = buildOppoMotionPhoto(tinyJpeg(), new Uint8Array(20), { includeMpf: true });
    expect(new TextDecoder("latin1").decode(out)).toContain("MPF\0");
  });

  it("preserves rich EXIF already on cover", () => {
    const cover = ensureIfd0MakeModel(tinyJpeg(), "OPPO", "OPPO Find X8 Ultra");
    const out = buildOppoMotionPhoto(cover, new Uint8Array(20));
    const text = new TextDecoder("latin1").decode(out);
    expect(text).toContain("OPPO Find X8 Ultra");
    expect(text).toContain("ns.oplus.com");
  });
});

describe("rebuildMotionPhotoXmpInJpeg", () => {
  function tinyJpeg(): Uint8Array {
    const app0 = seg(0xe0, new TextEncoder().encode("JFIF\0\x01\x01\x00\x00\x01\x00\x01\x00\x00"));
    const dqt = seg(0xdb, new Uint8Array(64).fill(16));
    return concat(new Uint8Array([0xff, 0xd8]), app0, dqt, new Uint8Array([0xff, 0xd9]));
  }

  it("compat mode rewrites MicroVideoOffset and VideoLength", () => {
    const mp4 = new Uint8Array(999);
    const jpeg = insertAfterAppSegments(tinyJpeg(), [
      buildMotionPhotoXmpApp1({ videoLength: 1, mode: "compat" }),
      buildMpfSegment(100),
    ]);
    const rebuilt = rebuildMotionPhotoXmpInJpeg(jpeg, mp4.length, { mode: "compat" });
    const text = new TextDecoder("latin1").decode(rebuilt);
    expect(text).toContain('GCamera:MicroVideoOffset="999"');
    expect(text).toContain('OpCamera:VideoLength="999"');
    expect(text).not.toContain("MPF\0");
  });
});
