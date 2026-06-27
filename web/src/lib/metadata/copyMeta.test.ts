import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildSyntheticReferenceJpeg } from "./apply";
import { buildTagsFromFileArgs, validateCopyOptions } from "./copyContract";
import { copyImageMetadata } from "./copyMeta";
import { insertAfterAppSegments } from "./segments";

function hasExiftool(): boolean {
  try {
    execFileSync("exiftool", ["-ver"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function seg(marker: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(2 + 2 + payload.length);
  out[0] = 0xff;
  out[1] = marker;
  const len = payload.length + 2;
  out[2] = (len >> 8) & 0xff;
  out[3] = len & 0xff;
  out.set(payload, 4);
  return out;
}

function tinyJpeg(): Uint8Array {
  const app0 = seg(0xe0, new TextEncoder().encode("JFIF\0\x01\x01\x00\x00\x01\x00\x01\x00\x00"));
  const dqt = seg(0xdb, new Uint8Array(64).fill(16));
  const parts = [new Uint8Array([0xff, 0xd8]), app0, dqt, new Uint8Array([0xff, 0xd9])];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let i = 0;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
}

function xmpSegment(mark: string): Uint8Array {
  const header = "http://ns.adobe.com/xap/1.0/\0";
  const xml = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF><rdf:Description dc:marker="${mark}"/></rdf:RDF></x:xmpmeta>`;
  return seg(0xe1, new TextEncoder().encode(header + xml));
}

function jpegWithXmp(mark: string): Uint8Array {
  return insertAfterAppSegments(tinyJpeg(), [xmpSegment(mark)]);
}

function toFile(bytes: Uint8Array, name: string, type = "image/jpeg"): File {
  return new File([bytes.buffer as ArrayBuffer], name, { type });
}

function exiftoolCopyCli(
  destPath: string,
  sourcePath: string,
  options: { excludeExif?: boolean; excludeXmp?: boolean; excludeIptc?: boolean },
): void {
  const args = [
    "-overwrite_original",
    "-TagsFromFile",
    sourcePath,
    ...buildTagsFromFileArgs(options),
    destPath,
  ];
  execFileSync("exiftool", args, { stdio: "ignore" });
}

function exiftoolJson(path: string): Record<string, unknown> {
  const out = execFileSync("exiftool", ["-j", "-G1", path], { encoding: "utf8" });
  return JSON.parse(out)[0] as Record<string, unknown>;
}

/** Vitest runs in Node where zeroperl WASM path breaks on Windows; use desktop exiftool for parity. */
const exiftoolCli = hasExiftool();

describe("copyImageMetadata validation", () => {
  it("rejects when all metadata types are excluded", async () => {
    const source = buildSyntheticReferenceJpeg({ exif: { Make: "X" }, iptc: {} });
    const dest = tinyJpeg();
    await expect(
      copyImageMetadata(toFile(dest, "dest.jpg"), toFile(source, "source.jpg"), {
        excludeExif: true,
        excludeXmp: true,
        excludeIptc: true,
      }),
    ).rejects.toThrow(/至少保留/);
    expect(() =>
      validateCopyOptions({ excludeExif: true, excludeXmp: true, excludeIptc: true }),
    ).toThrow(/至少保留/);
  });

  it("rejects unsupported destination format", async () => {
    const source = buildSyntheticReferenceJpeg({ exif: { Make: "X" }, iptc: {} });
    const dest = new File([new Uint8Array([0x00, 0x01, 0x02])], "dest.bmp", {
      type: "image/bmp",
    });
    await expect(copyImageMetadata(dest, toFile(source, "source.jpg"))).rejects.toThrow(/不支持/);
  });
});

describe.skipIf(!exiftoolCli)("copyImageMetadata (exiftool CLI parity)", () => {
  let dir: string;

  function writeJpeg(name: string, bytes: Uint8Array): string {
    const p = join(dir, name);
    writeFileSync(p, bytes);
    return p;
  }

  it("transplants Make/Model from JPEG source onto destination JPEG", () => {
    dir = mkdtempSync(join(tmpdir(), "copy-meta-"));
    const source = buildSyntheticReferenceJpeg({
      exif: { Make: "SourceMake", Model: "SourceModel" },
      iptc: {},
    });
    const dest = tinyJpeg();
    const sourcePath = writeJpeg("source.jpg", source);
    const destPath = writeJpeg("dest.jpg", dest);
    exiftoolCopyCli(destPath, sourcePath, {});
    const tags = exiftoolJson(destPath);
    expect(tags["EXIF:Make"]).toBe("SourceMake");
    expect(tags["EXIF:Model"]).toBe("SourceModel");
  });

  it("copies XMP by default", () => {
    dir = mkdtempSync(join(tmpdir(), "copy-meta-"));
    const mark = "CopyMetaTestXmpMarker";
    const sourcePath = writeJpeg("source.jpg", jpegWithXmp(mark));
    const destPath = writeJpeg("dest.jpg", tinyJpeg());
    exiftoolCopyCli(destPath, sourcePath, {});
    const raw = readFileSync(destPath);
    expect(new TextDecoder("latin1").decode(raw)).toContain(mark);
  });

  it("excludeXmp skips XMP", () => {
    dir = mkdtempSync(join(tmpdir(), "copy-meta-"));
    const mark = "SkipXmpMarker";
    const sourcePath = writeJpeg("source.jpg", jpegWithXmp(mark));
    const destPath = writeJpeg("dest.jpg", tinyJpeg());
    exiftoolCopyCli(destPath, sourcePath, { excludeXmp: true });
    const raw = readFileSync(destPath);
    expect(new TextDecoder("latin1").decode(raw)).not.toContain(mark);
  });

  it("excludeExif keeps destination EXIF", () => {
    dir = mkdtempSync(join(tmpdir(), "copy-meta-"));
    const source = buildSyntheticReferenceJpeg({
      exif: { Make: "SourceMake", Model: "SourceModel" },
      iptc: {},
    });
    const dest = buildSyntheticReferenceJpeg({
      exif: { Make: "DestMake", Model: "DestModel" },
      iptc: {},
    });
    const sourcePath = writeJpeg("source.jpg", source);
    const destPath = writeJpeg("dest.jpg", dest);
    exiftoolCopyCli(destPath, sourcePath, { excludeExif: true });
    const tags = exiftoolJson(destPath);
    expect(tags["EXIF:Make"]).toBe("DestMake");
    expect(tags["EXIF:Model"]).toBe("DestModel");
  });

  it("OPPO preset copies EXIF but not XMP", () => {
    dir = mkdtempSync(join(tmpdir(), "copy-meta-"));
    const source = buildSyntheticReferenceJpeg({
      exif: { Make: "OPPO", Model: "Find X7" },
      iptc: {},
    });
    const sourcePath = writeJpeg("source.jpg", insertAfterAppSegments(source, [xmpSegment("OppoXmp")]));
    const destPath = writeJpeg("dest.jpg", tinyJpeg());
    exiftoolCopyCli(destPath, sourcePath, { excludeXmp: true });
    const tags = exiftoolJson(destPath);
    expect(tags["EXIF:Make"]).toBe("OPPO");
    const raw = readFileSync(destPath);
    expect(new TextDecoder("latin1").decode(raw)).not.toContain("OppoXmp");
  });
});
