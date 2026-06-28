import { describe, expect, it } from "vitest";
import { buildOppoMotionPhoto } from "../muxer";
import { createFindX8UltraTemplate } from "./metadataTemplate";
import { applySpoofAfterMotionPhotoMux } from "./spoofMetadata";

function tinyJpeg(): Uint8Array {
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
  const app0 = seg(0xe0, new TextEncoder().encode("JFIF\0\x01\x01\x00\x00\x01\x00\x01\x00\x00"));
  const dqt = seg(0xdb, new Uint8Array(64).fill(16));
  return new Uint8Array([0xff, 0xd8, ...app0, ...dqt, 0xff, 0xd9]);
}

describe("applySpoofAfterMotionPhotoMux", () => {
  it("keeps video-generated MotionPhoto XMP when adding EXIF", () => {
    const mp4 = new Uint8Array(32);
    const muxed = buildOppoMotionPhoto(tinyJpeg(), mp4, { presentationTimestampUs: 42_000 });
    const out = applySpoofAfterMotionPhotoMux(muxed, createFindX8UltraTemplate());
    const text = new TextDecoder("latin1").decode(out);
    expect(text).toContain("OPPO Find X8 Ultra");
    expect(text).toContain("MotionPhotoOwner");
    expect(text).toContain("PresentationTimestampUs=\"42000\"");
    expect(text).toContain("VideoLength=\"32\"");
  });
});
