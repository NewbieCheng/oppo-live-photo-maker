import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildTagsFromFileArgs, type CopyMetadataOptions } from "@shared/copyContract.js";
import { minimalJpeg } from "@shared/minimalJpeg.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

const EXIF_RESYNC_GROUPS = [
  "-IFD0:All",
  "-ExifIFD:All",
  "-InteropIFD:All",
  "-GPS:All",
  "-MakerNotes:All",
];

export function findExiftool(): string | null {
  const bundled = path.join(REPO_ROOT, "tools", "exiftool", "exiftool.exe");
  if (process.platform === "win32" && fs.existsSync(bundled)) return bundled;
  const which = process.env.PATH?.split(path.delimiter).flatMap((dir) => {
    const candidate = path.join(dir, process.platform === "win32" ? "exiftool.exe" : "exiftool");
    return fs.existsSync(candidate) ? [candidate] : [];
  });
  return which?.[0] ?? null;
}

function runExiftool(args: string[]): void {
  const exiftool = findExiftool();
  if (!exiftool) throw new Error("exiftool not found");
  execFileSync(exiftool, args, { stdio: ["ignore", "pipe", "pipe"] });
}

function withTempDir<T>(prefix: string, fn: (dir: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function readTagsJson(jpeg: Uint8Array): Record<string, unknown> {
  const exiftool = findExiftool();
  if (!exiftool) return {};
  return withTempDir("oppo-tags-", (dir) => {
    const probe = path.join(dir, "probe.jpg");
    fs.writeFileSync(probe, jpeg);
    const out = execFileSync(exiftool, ["-j", "-G1", "-U", "-n", probe], {
      encoding: "utf8",
    });
    const records = JSON.parse(out || "[]") as Record<string, unknown>[];
    return records[0] ?? {};
  });
}

export function getTagStats(jpeg: Uint8Array): {
  make: string;
  model: string;
  exifCount: number;
  fieldCount: number;
} {
  const record = readTagsJson(jpeg);
  const make = String(record["IFD0:Make"] ?? record["EXIF:Make"] ?? record["Make"] ?? "");
  const model = String(record["IFD0:Model"] ?? record["EXIF:Model"] ?? record["Model"] ?? "");
  let exifCount = 0;
  let fieldCount = 0;
  for (const key of Object.keys(record)) {
    if (key === "SourceFile" || key === "ExifToolVersion") continue;
    fieldCount++;
    if (
      key.startsWith("EXIF:") ||
      key.startsWith("IFD0:") ||
      key.startsWith("GPS:") ||
      key.startsWith("Composite:")
    ) {
      exifCount++;
    }
  }
  return { make, model, exifCount, fieldCount };
}

export function syncFullExifFromSource(
  destJpeg: Uint8Array,
  sourcePath: string,
): Uint8Array {
  const exiftool = findExiftool();
  if (!exiftool) return destJpeg;
  return withTempDir("oppo-sync-", (dir) => {
    const dest = path.join(dir, "dest.jpg");
    const out = path.join(dir, "out.jpg");
    fs.writeFileSync(dest, destJpeg);
    runExiftool([
      "-api",
      "ByteOrder=II",
      "-TagsFromFile",
      sourcePath,
      ...EXIF_RESYNC_GROUPS,
      "-o",
      out,
      dest,
    ]);
    return new Uint8Array(fs.readFileSync(out));
  });
}

export function materializeMetadataJpeg(
  sourcePath: string,
  options: CopyMetadataOptions,
): Uint8Array {
  const exiftool = findExiftool();
  if (!exiftool) throw new Error("exiftool required to materialize non-JPEG source metadata");
  return withTempDir("oppo-mat-", (dir) => {
    const canvas = path.join(dir, "canvas.jpg");
    fs.writeFileSync(canvas, minimalJpeg());
    runExiftool([
      "-api",
      "ByteOrder=II",
      "-overwrite_original",
      "-TagsFromFile",
      sourcePath,
      ...buildTagsFromFileArgs(options),
      canvas,
    ]);
    let data = new Uint8Array(fs.readFileSync(canvas));
    if (!options.excludeExif) {
      data = syncFullExifFromSource(data, sourcePath);
    }
    return data;
  });
}

export function tagsFromFileCopyDest(
  destJpeg: Uint8Array,
  sourcePath: string,
  options: CopyMetadataOptions,
): Uint8Array {
  const exiftool = findExiftool();
  if (!exiftool) return destJpeg;
  return withTempDir("oppo-tff-", (dir) => {
    const dest = path.join(dir, "dest.jpg");
    const out = path.join(dir, "out.jpg");
    fs.writeFileSync(dest, destJpeg);
    runExiftool([
      "-api",
      "ByteOrder=II",
      "-TagsFromFile",
      sourcePath,
      ...buildTagsFromFileArgs(options),
      "-o",
      out,
      dest,
    ]);
    let result = new Uint8Array(fs.readFileSync(out));
    if (!options.excludeExif) {
      result = syncFullExifFromSource(result, sourcePath);
    }
    return result;
  });
}
