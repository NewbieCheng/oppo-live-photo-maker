/**
 * Simulate web feature-2 segment copy against output2.jpg (working reference).
 * Run: node scripts/compare-output2.mjs
 */
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import piexif from "piexifjs";

const EXIFTOOL =
  "f:/Dev/Desktop-Projects/livephoto/oppo-live-photo-maker/tools/exiftool/exiftool.exe";
const REF = "C:/Users/Administrator/Downloads/output2.jpg";

function exifTags(path) {
  const out = execFileSync(EXIFTOOL, [
    "-ExifByteOrder",
    "-InteropIndex",
    "-YCbCrPositioning",
    "-OffsetTimeOriginal",
    "-Make",
    "-Model",
    "-UserComment",
    "-MicroVideoOffset",
    "-VideoLength",
    "-MPF:All",
    "-FileSize",
    path,
  ], { encoding: "utf8" });
  return out.trim();
}

function readExifByteOrder(buf) {
  for (let i = 0; i < buf.length - 12; i++) {
    if (buf[i] === 0xff && buf[i + 1] === 0xe1) {
      const payload = buf.subarray(i, i + 12);
      const sig = String.fromCharCode(...payload.subarray(4, 10));
      if (sig.startsWith("Exif")) {
        const b0 = payload[10];
        const b1 = payload[11];
        if (b0 === 0x49 && b1 === 0x49) return "II";
        if (b0 === 0x4d && b1 === 0x4d) return "MM";
      }
    }
  }
  return null;
}

function minimalJpeg() {
  function seg(marker, payload) {
    const out = Buffer.alloc(4 + payload.length);
    out[0] = 0xff;
    out[1] = marker;
    const len = payload.length + 2;
    out[2] = (len >> 8) & 0xff;
    out[3] = len & 0xff;
    payload.copy(out, 4);
    return out;
  }
  const app0 = seg(0xe0, Buffer.from("JFIF\0\x01\x01\x00\x00\x01\x00\x01\x00\x00"));
  const dqt = seg(0xdb, Buffer.alloc(64, 16));
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, dqt, Buffer.from([0xff, 0xd9])]);
}

function piexifDest() {
  // Valid 1x1 JPEG canvas (piexif rejects our marker-only minimal JPEG).
  const dataUrl =
    "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA8A/9k=";
  const exifObj = {
    "0th": {
      [piexif.ImageIFD.Make]: "OPPO",
      [piexif.ImageIFD.Model]: "OPPO Find X8 Ultra",
    },
    Exif: {
      [piexif.ExifIFD.UserComment]: "ASCII\0\0\0Oplus_8388608",
    },
  };
  const dumped = piexif.dump(exifObj);
  const out = piexif.insert(dumped, dataUrl);
  return Buffer.from(out.split(",")[1], "base64");
}

function extractExifApp1(jpeg) {
  for (let i = 0; i < jpeg.length - 4; i++) {
    if (jpeg[i] === 0xff && jpeg[i + 1] === 0xe1) {
      const len = (jpeg[i + 2] << 8) | jpeg[i + 3];
      const end = i + 2 + len;
      const sig = jpeg.subarray(i + 4, i + 10).toString("ascii");
      if (sig.startsWith("Exif")) return jpeg.subarray(i, end);
    }
  }
  return null;
}

function stripExif(jpeg) {
  const out = [0xff, 0xd8];
  let i = 2;
  while (i < jpeg.length - 1) {
    if (jpeg[i] !== 0xff) {
      i++;
      continue;
    }
    const m = jpeg[i + 1];
    if (m === 0xda) {
      out.push(...jpeg.subarray(i));
      return Buffer.from(out);
    }
    const ln = (jpeg[i + 2] << 8) | jpeg[i + 3];
    const end = i + 2 + ln;
    if (m === 0xe1) {
      const sig = jpeg.subarray(i + 4, i + 10).toString("ascii");
      if (sig.startsWith("Exif")) {
        i = end;
        continue;
      }
    }
    out.push(...jpeg.subarray(i, end));
    i = end;
  }
  return jpeg;
}

function insertAfterApp0(jpeg, segments) {
  let insertAt = 2;
  if (jpeg[2] === 0xff && jpeg[3] === 0xe0) {
    const ln = (jpeg[4] << 8) | jpeg[5];
    insertAt = 2 + 2 + ln;
  }
  return Buffer.concat([jpeg.subarray(0, insertAt), ...segments, jpeg.subarray(insertAt)]);
}

const ref = readFileSync(REF);
const exifSeg = extractExifApp1(ref);
console.log("=== Reference output2.jpg ===");
console.log(exifTags(REF));
console.log("readExifByteOrder:", readExifByteOrder(ref));
console.log("EXIF APP1 size:", exifSeg?.length ?? 0);

const destPiexif = piexifDest();
console.log("\n=== Simulated feature-1 dest (piexif MM) ===");
console.log("readExifByteOrder:", readExifByteOrder(destPiexif));

const dir = mkdtempSync(join(tmpdir(), "segcopy-"));
const destPath = join(dir, "dest.jpg");
const sourcePath = join(dir, "source.jpg");
const outPath = join(dir, "out-segment.jpg");
const outExifPath = join(dir, "out-exiftool.jpg");

writeFileSync(sourcePath, ref);
writeFileSync(destPath, destPiexif);

// Segment transplant (GExiv2 style)
const transplanted = insertAfterApp0(stripExif(destPiexif), [exifSeg]);
writeFileSync(outPath, transplanted);
console.log("\n=== After segment transplant ===");
console.log("readExifByteOrder:", readExifByteOrder(transplanted));
console.log(exifTags(outPath));

// ExifTool TagsFromFile + ByteOrder=II (old web path / fallback)
execFileSync(EXIFTOOL, [
  "-api", "ByteOrder=II",
  "-TagsFromFile", sourcePath,
  "-All:all", "--XMP:all",
  "-o", outExifPath,
  destPath,
], { stdio: "ignore" });
console.log("\n=== After ExifTool TagsFromFile (ByteOrder=II) ===");
console.log(exifTags(outExifPath));

// ExifTool sync full EXIF groups
const outSyncPath = join(dir, "out-sync.jpg");
execFileSync(EXIFTOOL, [
  "-api", "ByteOrder=II",
  "-TagsFromFile", sourcePath,
  "-IFD0:All", "-ExifIFD:All", "-InteropIFD:All", "-GPS:All", "-MakerNotes:All",
  "-m", "-o", outSyncPath, outPath,
], { stdio: "ignore" });
console.log("\n=== After syncFullExifFromSource on transplanted ===");
console.log(exifTags(outSyncPath));
