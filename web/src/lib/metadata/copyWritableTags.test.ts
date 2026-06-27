import { describe, expect, it } from "vitest";
import { OPPO_COPY_PRESET } from "./copyContract";
import { filterWritableTags } from "./copyWritableTags";

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
