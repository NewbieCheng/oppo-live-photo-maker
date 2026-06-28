import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { copyImgMeta } from "../src/copyImgMeta.js";
import { findExiftool, readTagsJson } from "../src/exiftoolCli.js";
import { hasMpfApp2Segment } from "@shared/colorOsValidate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const FIXTURE = path.join(REPO_ROOT, "tests", "fixtures", "output2.jpg");

function motionVideoLength(tags: Record<string, unknown>): number {
  for (const key of [
    "XMP-OpCamera:VideoLength",
    "VideoLength",
    "EXIF:MicroVideoOffset",
    "XMP-GCamera:MicroVideoOffset",
    "MicroVideoOffset",
  ]) {
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

    const result = await copyImgMeta(sourceBytes, sourceBytes, "output2.jpg", "output2.jpg", {
      excludeXmp: true,
    });

    expect(result.bytes.length).toBeGreaterThanOrEqual(beforeSize * 0.95);
    expect(result.backendUsed).toBe("exiftool-tagsfromfile");

    const afterTags = readTagsJson(result.bytes);
    expect(afterTags["IFD0:Make"] ?? afterTags["EXIF:Make"]).toBe("OPPO");
    const byteOrder = String(afterTags["File:ExifByteOrder"] ?? afterTags["ExifByteOrder"] ?? "");
    expect(byteOrder.includes("Little-endian") || byteOrder === "II").toBe(true);
    expect(
      afterTags["ExifIFD:InteropIndex"] ?? afterTags["EXIF:InteropIndex"],
    ).toBeTruthy();
    expect(hasMpfApp2Segment(result.bytes)).toBe(false);
    expect(motionVideoLength(afterTags)).toBeGreaterThan(1_000_000);
    expect(motionVideoLength(afterTags)).toBe(motionVideoLength(beforeTags));
  });

  it("findExiftool locates bundled binary on Windows", () => {
    if (process.platform !== "win32") return;
    const et = findExiftool();
    expect(et).toBeTruthy();
    expect(fs.existsSync(et!)).toBe(true);
  });
});
