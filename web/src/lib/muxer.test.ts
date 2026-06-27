import { describe, expect, it } from "vitest";
import { insertAfterAppSegments } from "./metadata/segments";
import { _internal, buildOppoMotionPhoto, rebuildMotionPhotoXmpInJpeg } from "./muxer";

const { findInsertionPoint, buildMpfSegment, buildXmpPacket, buildExifApp1, buildXmpApp1 } =
  _internal;

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

  it("declares length matching the actual size", () => {
    const s = buildMpfSegment(12345);
    const declared = (s[2] << 8) | s[3];
    expect(declared).toBe(s.length - 2);
  });

  it("contains the MPF signature and BE TIFF header", () => {
    const s = buildMpfSegment(0);
    const body = s.subarray(4);
    expect(Array.from(body.subarray(0, 4))).toEqual([0x4d, 0x50, 0x46, 0x00]); // "MPF\0"
    expect(Array.from(body.subarray(4, 12))).toEqual([0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8]);
  });

  it("has length independent of recorded image size (two-pass safe)", () => {
    expect(buildMpfSegment(0).length).toBe(buildMpfSegment(99_999_999).length);
  });

  it("records the image size in the MP entry", () => {
    const size = 0x12345678;
    const s = buildMpfSegment(size);
    const mpEntry = s.subarray(s.length - 16);
    const dv = new DataView(mpEntry.buffer, mpEntry.byteOffset, mpEntry.byteLength);
    expect(dv.getUint32(0, false)).toBe(0x00030000); // Baseline Primary
    expect(dv.getUint32(4, false)).toBe(size);
  });
});

describe("JPEG insertion point", () => {
  it("rejects non-JPEG", () => {
    expect(() => findInsertionPoint(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toThrow();
  });

  it("returns offset 2 when no APP segments precede DQT", () => {
    const j = new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02, 0xff, 0xd9]);
    expect(findInsertionPoint(j)).toBe(2);
  });

  it("places after the last APP segment", () => {
    const app0 = seg(0xe0, new TextEncoder().encode("JFIF\0content"));
    const app1 = seg(0xe1, new TextEncoder().encode("Exif\0\0more"));
    const sos = new Uint8Array([0xff, 0xda, 0x00, 0x02]);
    const eoi = new Uint8Array([0xff, 0xd9]);
    const j = concat(new Uint8Array([0xff, 0xd8]), app0, app1, sos, eoi);
    expect(findInsertionPoint(j)).toBe(2 + app0.length + app1.length);
  });

  it("stops at DQT marker", () => {
    const app0 = seg(0xe0, new TextEncoder().encode("JFIF"));
    const dqt = seg(0xdb, new Uint8Array(64));
    const j = concat(new Uint8Array([0xff, 0xd8]), app0, dqt, new Uint8Array([0xff, 0xd9]));
    expect(findInsertionPoint(j)).toBe(2 + app0.length);
  });

  it("survives 0xFF padding between markers", () => {
    const app0 = seg(0xe0, new TextEncoder().encode("JFIF"));
    const padding = new Uint8Array([0xff, 0xff, 0xff]);
    const app1 = seg(0xe1, new TextEncoder().encode("Exif"));
    const tail = new Uint8Array([0xff, 0xda, 0x00, 0x02, 0xff, 0xd9]);
    const j = concat(new Uint8Array([0xff, 0xd8]), app0, padding, app1, tail);
    const pos = findInsertionPoint(j);
    expect(pos).toBeGreaterThanOrEqual(2 + app0.length + app1.length);
  });

  it("falls back safely on truncated APPn length", () => {
    const j = new Uint8Array([0xff, 0xd8, 0xff, 0xe1]);
    expect(findInsertionPoint(j)).toBe(2);
  });

  it("falls back safely on oversize APPn length", () => {
    const j = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xfe, 0, 0, 0, 0]);
    expect(findInsertionPoint(j)).toBe(2);
  });
});

describe("XMP packet", () => {
  it("contains all required OPPO MotionPhoto fields", () => {
    const x = buildXmpPacket({ videoLength: 12345, presentationTimestampUs: 500000 });
    expect(x).toContain('GCamera:MotionPhoto="1"');
    expect(x).toContain('GCamera:MicroVideo="1"');
    expect(x).toContain('GCamera:MicroVideoOffset="12345"');
    expect(x).toContain('GCamera:MicroVideoPresentationTimestampUs="500000"');
    expect(x).toContain('OpCamera:MotionPhotoOwner="oplus"');
    expect(x).toContain('OpCamera:OLivePhotoVersion="2"');
    expect(x).toContain('OpCamera:VideoLength="12345"');
    expect(x).toContain('OpCamera:MotionPhotoFeatureFlag="1"');
    expect(x).toContain("Container:Directory");
    expect(x).toContain("image/jpeg");
    expect(x).toContain("video/mp4");
    expect(x).toContain("Primary");
    expect(x).toContain("MotionPhoto");
  });
});

describe("APP1 EXIF segment", () => {
  it("contains the Oplus_8388608 user comment marker", () => {
    const seg = buildExifApp1();
    expect(seg[0]).toBe(0xff);
    expect(seg[1]).toBe(0xe1);
    const text = new TextDecoder("latin1").decode(seg);
    expect(text).toContain("Exif");
    expect(text).toContain("Oplus_8388608");
  });
});

describe("APP1 XMP segment", () => {
  it("starts with the XMP namespace URI", () => {
    const seg = buildXmpApp1({ videoLength: 1, presentationTimestampUs: 0 });
    const text = new TextDecoder("latin1").decode(seg);
    expect(text).toContain("http://ns.adobe.com/xap/1.0/");
  });
});

describe("buildOppoMotionPhoto end-to-end", () => {
  // Minimal but well-formed JPEG: SOI + APP0 (JFIF) + a small DQT + EOI.
  function tinyJpeg(): Uint8Array {
    const app0 = seg(0xe0, new TextEncoder().encode("JFIF\0\x01\x01\x00\x00\x01\x00\x01\x00\x00"));
    const dqt = seg(0xdb, new Uint8Array(64).fill(16));
    return concat(new Uint8Array([0xff, 0xd8]), app0, dqt, new Uint8Array([0xff, 0xd9]));
  }

  it("produces a JPEG starting with SOI and ending with the MP4 trailer", () => {
    const cover = tinyJpeg();
    // Pretend the MP4 starts with a tiny ftyp box.
    const mp4 = new Uint8Array([
      0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32,
      0, 0, 0, 0, 0x6d, 0x70, 0x34, 0x32, 0x69, 0x73, 0x6f, 0x6d,
    ]);
    const out = buildOppoMotionPhoto(cover, mp4);
    expect(out[0]).toBe(0xff);
    expect(out[1]).toBe(0xd8);
    // The MP4 must sit at the tail.
    expect(Array.from(out.subarray(out.length - mp4.length))).toEqual(Array.from(mp4));
  });

  it("injects EXIF + XMP + MPF segments", () => {
    const cover = tinyJpeg();
    const mp4 = new Uint8Array(20);
    const out = buildOppoMotionPhoto(cover, mp4);
    const text = new TextDecoder("latin1").decode(out);
    expect(text).toContain("Oplus_8388608");
    expect(text).toContain("MPF\0");
    expect(text).toContain("ns.oplus.com");
  });
});

describe("rebuildMotionPhotoXmpInJpeg", () => {
  function tinyJpeg(): Uint8Array {
    const app0 = seg(0xe0, new TextEncoder().encode("JFIF\0\x01\x01\x00\x00\x01\x00\x01\x00\x00"));
    const dqt = seg(0xdb, new Uint8Array(64).fill(16));
    return concat(new Uint8Array([0xff, 0xd8]), app0, dqt, new Uint8Array([0xff, 0xd9]));
  }

  it("rewrites MicroVideoOffset and VideoLength to match tail size", () => {
    const mp4 = new Uint8Array(999);
    mp4[4] = 0x66;
    mp4[5] = 0x74;
    mp4[6] = 0x79;
    mp4[7] = 0x70;
    const jpeg = insertAfterAppSegments(tinyJpeg(), [
      buildXmpApp1({ videoLength: 1, presentationTimestampUs: 0 }),
      buildMpfSegment(100),
    ]);
    const rebuilt = rebuildMotionPhotoXmpInJpeg(jpeg, mp4.length);
    const text = new TextDecoder("latin1").decode(rebuilt);
    expect(text).toContain('GCamera:MicroVideoOffset="999"');
    expect(text).toContain('OpCamera:VideoLength="999"');
    expect(text).toContain("<Item:Length>999</Item:Length>");
    expect(text).not.toContain('GCamera:MicroVideoOffset="1"');
    expect(text).not.toContain("MPF\0");
  });
});
