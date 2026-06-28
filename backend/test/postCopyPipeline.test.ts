import { describe, expect, it } from "vitest";
import { concatBytes, splitJpegAndAppendedTail } from "@shared/jpegTail.js";
import { postCopyPipeline } from "../src/postCopyPipeline.js";

function tinyLiveJpegWithMp4Tail(): { full: Uint8Array; trailing: Uint8Array } {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const mp4 = new Uint8Array([0, 0, 0, 8, 0x66, 0x74, 0x79, 0x70]);
  return { full: concatBytes(jpeg, mp4), trailing: mp4 };
}

describe("postCopyPipeline MotionPhoto XMP rebuild", () => {
  it("rebuilds MotionPhoto XMP when excludeXmp is true (Live target preset)", () => {
    const { full, trailing } = tinyLiveJpegWithMp4Tail();
    const { jpeg } = splitJpegAndAppendedTail(full);

    const result = postCopyPipeline(jpeg, "", trailing, { excludeXmp: true, excludeExif: true }, "test");

    const text = new TextDecoder("latin1").decode(result.jpeg);
    expect(text).toContain('GCamera:MotionPhoto="1"');
    expect(text).toContain('OpCamera:VideoLength="8"');
    expect(text).toContain("<Item:Length>8</Item:Length>");
    expect(text).not.toContain("MicroVideo");
  });

  it("rebuilds MotionPhoto XMP when excludeXmp is false (full copy preset)", () => {
    const { full, trailing } = tinyLiveJpegWithMp4Tail();
    const { jpeg } = splitJpegAndAppendedTail(full);

    const result = postCopyPipeline(jpeg, "", trailing, { excludeExif: true }, "test");

    const text = new TextDecoder("latin1").decode(result.jpeg);
    expect(text).toContain('OpCamera:VideoLength="8"');
  });
});
