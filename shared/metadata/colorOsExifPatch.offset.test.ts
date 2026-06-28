import { describe, expect, it } from "vitest";
import { planColorOsExifSupplement } from "./colorOsExifPatch.js";

describe("planColorOsExifSupplement OffsetTimeOriginal", () => {
  it("copies OffsetTimeOriginal from source when dest lacks it", () => {
    const plan = planColorOsExifSupplement(
      new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
      {},
      { "EXIF:OffsetTimeOriginal": "+08:00" },
    );
    expect(plan.offsetTimeOriginal).toBe("+08:00");
  });
});
