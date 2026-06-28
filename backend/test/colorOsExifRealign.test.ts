import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { realignExifFromJpegSource, planColorOsExifSupplement } from "@shared/colorOsExifPatch.js";
import { supplementColorOsExif, readTagsJson } from "../src/exiftoolCli.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..", "..");
const ET = path.join(REPO, "tools", "exiftool", "exiftool.exe");
const META = "C:\\Users\\Administrator\\Downloads\\images-meta.jpg";
const LIVE =
  "D:\\social tools\\xwechat_files\\wxid_wq09nrejrlhv12_066b\\msg\\file\\2026-06\\IMG20260628000929.jpg";

describe("realignExifFromJpegSource", () => {
  it("restores MM + Interop from OPPO live JPG then supplements dimensions", () => {
    if (!existsSync(ET) || !existsSync(META) || !existsSync(LIVE)) return;

    const meta = new Uint8Array(readFileSync(META));
    const live = new Uint8Array(readFileSync(LIVE));
    const realigned = realignExifFromJpegSource(meta, live, { excludeXmp: true });
    const realignedTags = readTagsJson(realigned);
    const liveTags = readTagsJson(live);
    const plan = planColorOsExifSupplement(realigned, realignedTags, liveTags, live);
    expect(plan.exifImageWidth).toBe(447);
    expect(plan.exifImageHeight).toBe(447);

    const patched = supplementColorOsExif(realigned, realignedTags, liveTags, live);
    const after = readTagsJson(patched);

    const byteOrder = String(after["File:ExifByteOrder"] ?? after["ExifByteOrder"] ?? "");
    expect(byteOrder.includes("Big-endian") || byteOrder === "MM").toBe(true);
    expect(after["InteropIFD:InteropIndex"] ?? after["EXIF:InteropIndex"]).toBeTruthy();
    expect(Number(after["ExifIFD:ExifImageWidth"] ?? after["EXIF:ExifImageWidth"])).toBe(447);
    expect(Number(after["ExifIFD:ExifImageHeight"] ?? after["EXIF:ExifImageHeight"])).toBe(447);
  });
});
