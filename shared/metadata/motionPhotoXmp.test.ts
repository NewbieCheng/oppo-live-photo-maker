import { describe, expect, it } from "vitest";
import {
  _internal,
  buildMotionPhotoXmpApp1,
  buildMotionPhotoXmpPacket,
  parseMotionPhotoXmpFromText,
  rebuildMotionPhotoXmpInJpeg,
} from "./motionPhotoXmp.js";

const { buildMotionPhotoXmpPacket: buildPacket } = _internal;

describe("buildMotionPhotoXmpPacket", () => {
  it("native mode omits MicroVideo and uses same timestamp for GCamera and OpCamera", () => {
    const xml = buildPacket({
      videoLength: 7761252,
      presentationTimestampUs: 1213099,
      mode: "native",
    });
    expect(xml).toContain('GCamera:MotionPhotoPresentationTimestampUs="1213099"');
    expect(xml).toContain('OpCamera:MotionPhotoPrimaryPresentationTimestampUs="1213099"');
    expect(xml).not.toContain("MicroVideo");
    expect(xml).toContain('OpCamera:MotionPhotoOwner="oplus"');
    expect(xml).toContain("MotionPhoto");
  });

  it("compat mode includes MicroVideo stack", () => {
    const xml = buildPacket({
      videoLength: 5607009,
      presentationTimestampUs: 500000,
      mode: "compat",
    });
    expect(xml).toContain('GCamera:MicroVideo="1"');
    expect(xml).toContain('GCamera:MicroVideoOffset="5607009"');
  });

  it("native mode with GainMap and hdrgm writes three Container items", () => {
    const xml = buildPacket({
      videoLength: 100,
      mode: "native",
      gainMapLength: 469317,
      hdrgmVersion: "1.0",
    });
    expect(xml).toContain('hdrgm:Version="1.0"');
    expect(xml).toContain("GainMap");
    expect(xml).toContain("<Item:Length>469317</Item:Length>");
    expect(xml).toContain("<Item:Length>100</Item:Length>");
  });
});

describe("parseMotionPhotoXmpFromText", () => {
  it("detects native vs compat from existing packet", () => {
    const native = buildPacket({ videoLength: 1, mode: "native" });
    expect(parseMotionPhotoXmpFromText(native).mode).toBe("native");
    const compat = buildPacket({ videoLength: 1, mode: "compat" });
    expect(parseMotionPhotoXmpFromText(compat).mode).toBe("compat");
  });
});

describe("rebuildMotionPhotoXmpInJpeg", () => {
  function tinyJpeg(): Uint8Array {
    return new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  }

  it("preserves native mode when rebuilding from native source", () => {
    const xmp = buildMotionPhotoXmpApp1({ videoLength: 1, mode: "native" });
    const jpeg = new Uint8Array([0xff, 0xd8, ...xmp, 0xff, 0xd9]);
    const out = rebuildMotionPhotoXmpInJpeg(jpeg, 999, { mode: "native" });
    const text = new TextDecoder().decode(out);
    expect(text).toContain('OpCamera:VideoLength="999"');
    expect(text).not.toContain("MicroVideo");
  });

  it("upgrades to compat when requested", () => {
    const out = rebuildMotionPhotoXmpInJpeg(tinyJpeg(), 42, {
      mode: "compat",
      presentationTimestampUs: 100,
    });
    const text = new TextDecoder().decode(out);
    expect(text).toContain('GCamera:MicroVideoOffset="42"');
  });
});

describe("inferCopyExifByteOrder", () => {
  it("defaults OPPO Make to II", async () => {
    const { inferCopyExifByteOrder } = await import("./exifByteOrder.js");
    expect(inferCopyExifByteOrder({ Make: "OPPO" })).toBe("II");
  });
});
