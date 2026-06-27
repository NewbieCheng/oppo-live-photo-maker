import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { copyImgMeta } from "../src/copyImgMeta.js";
import { findExiftool, readTagsJson } from "../src/exiftoolCli.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const FIXTURE = path.join(REPO_ROOT, "tests", "fixtures", "output2.jpg");

function microVideoOffset(tags: Record<string, unknown>): number {
  for (const key of ["EXIF:MicroVideoOffset", "XMP-GCamera:MicroVideoOffset", "MicroVideoOffset"]) {
    const v = tags[key];
    if (v != null) return Number(v);
  }
  return 0;
}

describe("copyImgMeta output2 self-copy", () => {
  it.skipIf(!fs.existsSync(FIXTURE))("preserves live photo size and ColorOS EXIF", async () => {
    const sourceBytes = new Uint8Array(fs.readFileSync(FIXTURE));
    const beforeTags = readTagsJson(sourceBytes);
    const beforeSize = sourceBytes.length;

    const result = await copyImgMeta(sourceBytes, sourceBytes, "output2.jpg", {
      excludeXmp: true,
    });

    expect(result.bytes.length).toBeGreaterThanOrEqual(beforeSize * 0.95);
    expect(result.backendUsed).toBe("jpeg-segment-transplant");

    const afterTags = readTagsJson(result.bytes);
    expect(afterTags["IFD0:Make"] ?? afterTags["EXIF:Make"]).toBe("OPPO");
    const byteOrder = String(afterTags["File:ExifByteOrder"] ?? afterTags["ExifByteOrder"] ?? "");
    expect(byteOrder.includes("Little-endian") || byteOrder === "II").toBe(true);
    expect(
      afterTags["ExifIFD:InteropIndex"] ?? afterTags["EXIF:InteropIndex"],
    ).toBeTruthy();
    expect(microVideoOffset(afterTags)).toBeGreaterThan(1_000_000);
    expect(microVideoOffset(afterTags)).toBe(microVideoOffset(beforeTags));
  });

  it("findExiftool locates bundled binary on Windows", () => {
    if (process.platform !== "win32") return;
    const et = findExiftool();
    expect(et).toBeTruthy();
    expect(fs.existsSync(et!)).toBe(true);
  });
});
