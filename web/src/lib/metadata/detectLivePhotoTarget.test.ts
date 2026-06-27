import { describe, expect, it } from "vitest";
import { concatBytes } from "./jpegTail";
import {
  isLikelyLivePhotoBytes,
  isLikelyLivePhotoFilename,
  isLikelyLivePhotoTarget,
} from "./detectLivePhotoTarget";

describe("detectLivePhotoTarget", () => {
  it("detects .live.jpg filenames", () => {
    expect(isLikelyLivePhotoFilename("clip.live.jpg")).toBe(true);
    expect(isLikelyLivePhotoFilename("photo.jpg")).toBe(false);
  });

  it("detects appended MP4 tail", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const mp4 = new Uint8Array([0, 0, 0, 8, 0x66, 0x74, 0x79, 0x70]);
    expect(isLikelyLivePhotoBytes(concatBytes(jpeg, mp4))).toBe(true);
    expect(isLikelyLivePhotoBytes(jpeg)).toBe(false);
  });

  it("combines filename and bytes heuristics", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const file = new File([jpeg], "plain.jpg", { type: "image/jpeg" });
    expect(isLikelyLivePhotoTarget(file, jpeg)).toBe(false);

    const liveFile = new File([jpeg], "x.live.jpg", { type: "image/jpeg" });
    expect(isLikelyLivePhotoTarget(liveFile, jpeg)).toBe(true);
  });
});
