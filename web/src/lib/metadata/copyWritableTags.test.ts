import { describe, expect, it } from "vitest";
import { OPPO_COPY_PRESET } from "./copyContract";
import { filterWritableTags, writableTagsToExiftoolArgs } from "./copyWritableTags";

describe("filterWritableTags", () => {
  it("drops read-only File/System/QuickTime groups", () => {
    const tags = {
      "IFD0:Make": "OPPO",
      "File:FileSize": 12345,
      "System:FileAccessDate": "2026:01:01",
      "QuickTime:HandlerType": "vide",
      "Composite:ImageSize": "1920x1080",
    };
    const out = filterWritableTags(tags, {});
    expect(out).toEqual({ "IFD0:Make": "OPPO" });
  });

  it("skips source dimensions and binary MakerNote placeholders", () => {
    const out = filterWritableTags(
      {
        "IFD0:ImageWidth": 3072,
        "IFD0:Make": "OPPO",
        "ExifIFD:MakerNoteUnknownText": "(Binary data 329 bytes, use -b option to extract)",
      },
      {},
    );
    expect(out).toEqual({ "IFD0:Make": "OPPO" });
  });

  it("formats numeric tags without hash prefix", () => {
    const args = writableTagsToExiftoolArgs(
      { "ExifIFD:FNumber": 1.8, "ExifIFD:ISO": 3200, "ExifIFD:InteropIndex": "R98 - DCF" },
      "MM",
    );
    expect(args.some((a) => a === "-ExifIFD:FNumber=1.8")).toBe(true);
    expect(args.some((a) => a === "-ExifIFD:ISO=3200")).toBe(true);
    expect(args.some((a) => a.includes("#"))).toBe(false);
    expect(args.some((a) => a === "-ExifIFD:InteropIndex=R98")).toBe(true);
  });

  it("OPPO preset excludes XMP groups", () => {
    const tags = {
      "IFD0:Make": "OPPO",
      "XMP:Title": "test",
      "XMP-dc:Creator": "me",
    };
    const out = filterWritableTags(tags, OPPO_COPY_PRESET);
    expect(out).toEqual({ "IFD0:Make": "OPPO" });
  });
});
