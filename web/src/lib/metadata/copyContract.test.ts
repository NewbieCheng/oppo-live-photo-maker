import { describe, expect, it } from "vitest";
import {
  FULL_COPY_PRESET,
  LIVE_PHOTO_TARGET_PRESET,
  OPPO_COPY_PRESET,
  buildTagsFromFileArgs,
  validateCopyOptions,
} from "./copyContract";

describe("copyContract", () => {
  it("buildTagsFromFileArgs defaults to -All:all only", () => {
    expect(buildTagsFromFileArgs({})).toEqual(["-All:all"]);
    expect(buildTagsFromFileArgs(FULL_COPY_PRESET)).toEqual(["-All:all"]);
  });

  it("buildTagsFromFileArgs maps exclude flags to exiftool groups", () => {
    expect(buildTagsFromFileArgs({ excludeXmp: true })).toEqual(["-All:all", "--XMP:all"]);
    expect(buildTagsFromFileArgs({ excludeIptc: true, excludeExif: true })).toEqual([
      "-All:all",
      "--IPTC:all",
      "--EXIF:all",
    ]);
  });

  it("Live target preset excludes source XMP only", () => {
    expect(LIVE_PHOTO_TARGET_PRESET).toEqual({ excludeXmp: true });
    expect(buildTagsFromFileArgs(LIVE_PHOTO_TARGET_PRESET)).toEqual(["-All:all", "--XMP:all"]);
    expect(OPPO_COPY_PRESET).toEqual(LIVE_PHOTO_TARGET_PRESET);
  });

  it("validateCopyOptions rejects all excluded", () => {
    expect(() =>
      validateCopyOptions({ excludeExif: true, excludeXmp: true, excludeIptc: true }),
    ).toThrow(/至少保留/);
  });
});
