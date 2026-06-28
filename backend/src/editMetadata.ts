import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bundleToExiftoolWriteArgs, type MetadataWriteBundle } from "@shared/bundleToExiftoolArgs.js";
import { needsColorOsExifResync, validateColorOsExif } from "@shared/colorOsValidate.js";
import {
  concatBytes,
  hasLikelyAppendedMp4,
  splitJpegAndAppendedTail,
} from "@shared/jpegTail.js";
import { rebuildMotionPhotoXmpInJpeg } from "@shared/motionPhotoXmp.js";
import { stripMpfApp2 } from "@shared/segments.js";
import { detectFormatFromBytes, isJpegFormat } from "@shared/detectFormat.js";
import { findExiftool, readTagsJson, syncFullExifFromSource } from "./exiftoolCli.js";

function runExiftool(args: string[]): void {
  const exiftool = findExiftool();
  if (!exiftool) throw new Error("exiftool not found");
  execFileSync(exiftool, args, { stdio: ["ignore", "pipe", "pipe"] });
}

export interface EditMetadataResult {
  bytes: Uint8Array;
  colorOsIssues: string[];
  fieldsWritten: number;
}

export function editMetadataBytes(
  fileBytes: Uint8Array,
  filename: string,
  bundle: MetadataWriteBundle,
  dirtyKeys?: Set<string>,
): EditMetadataResult {
  const exiftool = findExiftool();
  if (!exiftool) throw new Error("exiftool not found");

  const writeArgs = bundleToExiftoolWriteArgs(bundle, dirtyKeys);
  if (writeArgs.length <= 3) throw new Error("没有可写入的字段");

  const format = detectFormatFromBytes(fileBytes, filename);
  let inputBytes = fileBytes;
  let trailing = new Uint8Array(0);
  let motionPhoto = false;

  if (isJpegFormat(format)) {
    const split = splitJpegAndAppendedTail(fileBytes);
    trailing = split.trailing;
    motionPhoto = trailing.length > 0 && hasLikelyAppendedMp4(trailing);
    if (motionPhoto) inputBytes = split.jpeg;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "oppo-edit-"));
  const inPath = path.join(tmpDir, filename);
  const outPath = path.join(tmpDir, `out${path.extname(filename) || ".jpg"}`);
  fs.writeFileSync(inPath, inputBytes);

  try {
    runExiftool([...writeArgs, "-o", outPath, inPath]);
    let working = new Uint8Array(fs.readFileSync(outPath));

    if (isJpegFormat(format)) {
      working = stripMpfApp2(working);
      let tags = readTagsJson(working);
      if (needsColorOsExifResync(working, tags, { requireMakerNotes: true })) {
        working = syncFullExifFromSource(working, inPath);
        working = stripMpfApp2(working);
        const midPath = path.join(tmpDir, "mid.jpg");
        fs.writeFileSync(midPath, working);
        runExiftool([...writeArgs, "-o", outPath, midPath]);
        working = stripMpfApp2(new Uint8Array(fs.readFileSync(outPath)));
      }
    }

    if (motionPhoto && dirtyKeys?.has("presentationTimestampUs")) {
      working = rebuildMotionPhotoXmpInJpeg(working, trailing.length);
    }

    const tags = readTagsJson(working);
    const colorOs = validateColorOsExif(working, tags, {
      motionPhoto,
      trailingLength: motionPhoto ? trailing.length : undefined,
    });

    const finalBytes = trailing.length ? concatBytes(working, trailing) : working;
    return {
      bytes: finalBytes,
      colorOsIssues: colorOs.issues,
      fieldsWritten: dirtyKeys?.size ?? 0,
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
