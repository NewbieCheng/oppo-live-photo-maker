import { describe, expect, it } from "vitest";
import {
  OPPO_COPY_PRESET,
  buildTagsFromFileArgs,
  validateCopyOptions,
} from "./copyContract";

describe("copyContract", () => {
  it("buildTagsFromFileArgs defaults to -All:all only", () => {
    expect(buildTagsFromFileArgs({})).toEqual(["-All:all"]);
  });

  it("buildTagsFromFileArgs maps exclude flags to exiftool groups", () => {
    expect(buildTagsFromFileArgs({ excludeXmp: true })).toEqual(["-All:all", "--XMP:all"]);
    expect(buildTagsFromFileArgs({ excludeIptc: true, excludeExif: true })).toEqual([
      "-All:all",
      "--IPTC:all",
      "--EXIF:all",
    ]);
  });

  it("OPPO preset excludes XMP only", () => {
    expect(OPPO_COPY_PRESET).toEqual({ excludeXmp: true });
    expect(buildTagsFromFileArgs(OPPO_COPY_PRESET)).toEqual(["-All:all", "--XMP:all"]);
  });

  it("validateCopyOptions rejects all excluded", () => {
    expect(() =>
      validateCopyOptions({ excludeExif: true, excludeXmp: true, excludeIptc: true }),
    ).toThrow(/至少保留/);
  });
});
