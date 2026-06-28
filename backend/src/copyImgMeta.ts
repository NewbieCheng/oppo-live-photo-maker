import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { validateCopyOptions, type CopyMetadataOptions } from "@shared/copyContract.js";
import { detectFormatFromBytes, isJpegFormat } from "@shared/detectFormat.js";
import { concatBytes, splitJpegAndAppendedTail } from "@shared/jpegTail.js";
import { copyMetadataViaSegmentTransplantSync } from "@shared/segmentCopySync.js";
import { copyViaExiv2Wasm } from "./exiv2Copy.js";
import { getExiv2Module } from "./exiv2Module.js";
import { findExiftool, materializeMetadataJpeg, tagsFromFileCopyDest } from "./exiftoolCli.js";
import { postCopyPipeline, writeTempSource } from "./postCopyPipeline.js";

export interface CopyImgMetaResult {
  bytes: Uint8Array;
  backendUsed: string;
  colorOsIssues: string[];
}

export async function copyImgMeta(
  sourceBytes: Uint8Array,
  destBytes: Uint8Array,
  sourceName: string,
  destName: string,
  options: CopyMetadataOptions = {},
): Promise<CopyImgMetaResult> {
  validateCopyOptions(options);

  const sourceFmt = detectFormatFromBytes(sourceBytes, sourceName);
  const destFmt = detectFormatFromBytes(destBytes, destName);

  let destWorking = destBytes;
  let trailing = new Uint8Array(0);
  if (isJpegFormat(destFmt)) {
    const split = splitJpegAndAppendedTail(destBytes);
    destWorking = split.jpeg;
    trailing = split.trailing;
  }

  const { jpeg: sourceJpeg } = splitJpegAndAppendedTail(sourceBytes);
  const sourcePath = writeTempSource(sourceBytes, sourceName);
  const srcDir = path.dirname(sourcePath);

  try {
    let working = destWorking;
    let backendUsed: string;
    const bothJpeg = isJpegFormat(sourceFmt) && isJpegFormat(destFmt);

    if (bothJpeg) {
      if (findExiftool()) {
        working = tagsFromFileCopyDest(working, sourcePath, options, destName);
        backendUsed = "exiftool-tagsfromfile";
      } else {
        working = copyMetadataViaSegmentTransplantSync(working, sourceJpeg, options);
        backendUsed = "jpeg-segment-transplant";
      }
    } else {
      const exiv2 = await getExiv2Module();
      try {
        working = copyViaExiv2Wasm(exiv2, sourceBytes, destWorking, options);
        backendUsed = "exiv2-wasm";
      } catch {
        if (findExiftool()) {
          working = tagsFromFileCopyDest(working, sourcePath, options, destName);
          backendUsed = "exiftool-tagsfromfile";
        } else if (isJpegFormat(destFmt)) {
          const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "oppo-copy-"));
          const materializedSourcePath = path.join(tmpDir, sourceName);
          fs.writeFileSync(materializedSourcePath, sourceBytes);
          try {
            const canvas = materializeMetadataJpeg(materializedSourcePath, options);
            working = copyMetadataViaSegmentTransplantSync(working, canvas, options);
            backendUsed = "exiftool-materialize+segment";
          } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
          }
        } else {
          throw new Error(
            `无法复制元数据：目标为 ${destFmt}，需要 exiv2-wasm 或 ExifTool 支持该格式`,
          );
        }
      }
    }

    if (isJpegFormat(destFmt)) {
      const post = postCopyPipeline(working, sourcePath, trailing, options, backendUsed);
      working = post.jpeg;
      const finalBytes = trailing.length ? concatBytes(working, trailing) : working;
      return {
        bytes: finalBytes,
        backendUsed,
        colorOsIssues: post.colorOsValidation.issues,
      };
    }

    return {
      bytes: working,
      backendUsed,
      colorOsIssues: [],
    };
  } finally {
    fs.rmSync(srcDir, { recursive: true, force: true });
  }
}
