import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { supplementColorOsExif, readTagsJson } from "../src/exiftoolCli.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..", "..");
const ET = path.join(REPO, "tools", "exiftool", "exiftool.exe");
const META = "C:\\Users\\Administrator\\Downloads\\images-meta.jpg";
const SRC_HEIC = "C:\\Users\\Administrator\\Downloads\\IMG20260626213341 (1).heic";

describe("supplementColorOsExif", () => {
  it("fills Interop and ExifImage dimensions on real images-meta sample", () => {
    if (!existsSync(ET) || !existsSync(META) || !existsSync(SRC_HEIC)) return;

    const before = readTagsJson(new Uint8Array(readFileSync(META)));
    const sourceTags = readTagsJson(new Uint8Array(readFileSync(SRC_HEIC)));
    expect(before["InteropIFD:InteropIndex"] ?? before["EXIF:InteropIndex"]).toBeFalsy();
    expect(Number(before["EXIF:ExifImageWidth"] ?? 0)).toBe(0);

    const patched = supplementColorOsExif(
      new Uint8Array(readFileSync(META)),
      before,
      sourceTags,
      new Uint8Array(readFileSync(SRC_HEIC)),
    );
    const after = readTagsJson(patched);

    expect(after["InteropIFD:InteropIndex"] ?? after["EXIF:InteropIndex"]).toBeTruthy();
    const width = Number(
      after["ExifIFD:ExifImageWidth"] ?? after["EXIF:ExifImageWidth"] ?? after["ExifImageWidth"],
    );
    const height = Number(
      after["ExifIFD:ExifImageHeight"] ?? after["EXIF:ExifImageHeight"] ?? after["ExifImageHeight"],
    );
    expect(width).toBe(447);
    expect(height).toBe(447);
  });
});
