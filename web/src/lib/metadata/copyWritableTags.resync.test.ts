import { describe, expect, it } from "vitest";
import { filterResyncExifTags, writableTagsToExiftoolArgs } from "./copyWritableTags";

describe("filterResyncExifTags", () => {
  it("keeps EXIF resync groups only", () => {
    const out = filterResyncExifTags({
      "IFD0:Make": "OPPO",
      "ExifIFD:InteropIndex": "R98",
      "XMP:Title": "skip",
      "File:FileSize": 1,
    });
    expect(out).toEqual({
      "IFD0:Make": "OPPO",
      "ExifIFD:InteropIndex": "R98",
    });
    expect(writableTagsToExiftoolArgs(out, "MM")[0]).toBe("-api");
  });
});
