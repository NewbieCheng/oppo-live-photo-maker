import { describe, expect, it } from "vitest";
import {
  concatBytes,
  hasLikelyAppendedMp4,
  splitAfterLastJpegEoi,
  splitJpegAndAppendedTail,
} from "./jpegTail";

describe("jpegTail", () => {
  it("splits after last EOI and preserves MP4 tail (simple file)", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const mp4 = new Uint8Array([0, 0, 0, 8, 0x66, 0x74, 0x79, 0x70]);
    const full = concatBytes(jpeg, mp4);
    const { jpeg: head, trailing } = splitJpegAndAppendedTail(full);
    expect(Array.from(head)).toEqual(Array.from(jpeg));
    expect(Array.from(trailing)).toEqual(Array.from(mp4));
    expect(hasLikelyAppendedMp4(trailing)).toBe(true);
  });

  it("uses first EOI before MP4 when tail contains false FFD9 markers", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const mp4Head = new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
    const mp4Body = new Uint8Array(5000).fill(0xab);
    mp4Body[mp4Body.length - 2] = 0xff;
    mp4Body[mp4Body.length - 1] = 0xd9;
    const mp4 = concatBytes(mp4Head, mp4Body);
    const full = concatBytes(jpeg, mp4);

    const naive = splitAfterLastJpegEoi(full);
    expect(naive.jpeg.length).toBeGreaterThan(jpeg.length);

    const split = splitJpegAndAppendedTail(full);
    expect(split.jpeg.length).toBe(jpeg.length);
    expect(split.trailing.length).toBe(mp4.length);
    expect(hasLikelyAppendedMp4(split.trailing)).toBe(true);
  });
});
