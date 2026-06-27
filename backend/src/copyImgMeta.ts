import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { validateCopyOptions, type CopyMetadataOptions } from "@shared/copyContract.js";
import { detectFormatFromBytes, isJpegFormat } from "@shared/detectFormat.js";
import { concatBytes, splitJpegAndAppendedTail } from "@shared/jpegTail.js";
import { copyMetadataViaSegmentTransplantSync } from "@shared/segmentCopySync.js";
import { copyViaExiv2Wasm } from "./exiv2Copy.js";
import { getExiv2Module } from "./exiv2Module.js";
import { materializeMetadataJpeg } from "./exiftoolCli.js";
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
  options: CopyMetadataOptions = {},
): Promise<CopyImgMetaResult> {
  validateCopyOptions(options);

  const { jpeg: destJpeg, trailing } = splitJpegAndAppendedTail(destBytes);
  const { jpeg: sourceJpeg } = splitJpegAndAppendedTail(sourceBytes);
  const sourceFmt = detectFormatFromBytes(sourceBytes, sourceName);

  let working = destJpeg;
  let backendUsed: string;

  if (isJpegFormat(sourceFmt)) {
    working = copyMetadataViaSegmentTransplantSync(working, sourceJpeg, options);
    backendUsed = "jpeg-segment-transplant";
  } else {
    const exiv2 = await getExiv2Module();
    try {
      working = copyViaExiv2Wasm(exiv2, sourceBytes, working, options);
      backendUsed = "exiv2-wasm";
    } catch {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "oppo-copy-"));
      const sourcePath = path.join(tmpDir, sourceName);
      fs.writeFileSync(sourcePath, sourceBytes);
      try {
        const canvas = materializeMetadataJpeg(sourcePath, options);
        const segments = copyMetadataViaSegmentTransplantSync(working, canvas, options);
        working = segments;
        backendUsed = "exiftool-materialize+segment";
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }
  }

  const sourcePath = writeTempSource(sourceBytes, sourceName);
  try {
    const post = postCopyPipeline(working, sourcePath, trailing, options, backendUsed);
    working = post.jpeg;
    const finalBytes = trailing.length ? concatBytes(working, trailing) : working;
    return {
      bytes: finalBytes,
      backendUsed,
      colorOsIssues: post.colorOsValidation.issues,
    };
  } finally {
    const srcDir = path.dirname(sourcePath);
    fs.rmSync(srcDir, { recursive: true, force: true });
  }
}
