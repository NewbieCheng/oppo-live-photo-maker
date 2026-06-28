import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CopyMetadataOptions } from "@shared/copyContract.js";
import { isJpegFormat, detectFormatFromBytes } from "@shared/detectFormat.js";
import {
  hasExifApp1Segment,
  needsColorOsExifResync,
  validateColorOsExif,
} from "@shared/colorOsValidate.js";
import {
  needsExifByteOrderRealign,
  realignExifFromJpegSource,
} from "@shared/colorOsExifPatch.js";
import {
  concatBytes,
  hasLikelyAppendedMp4,
  splitJpegAndAppendedTail,
} from "@shared/jpegTail.js";
import { rebuildMotionPhotoXmpInJpeg } from "@shared/motionPhotoXmp.js";
import {
  extractMetadataSegments,
  insertAfterAppSegments,
  stripMetadataForCopy,
  stripMpfApp2,
} from "@shared/segments.js";
import {
  findExiftool,
  readTagsJson,
  supplementColorOsExif,
  syncFullExifFromSource,
  tagsFromFileCopyDest,
} from "./exiftoolCli.js";

export interface PostCopyResult {
  jpeg: Uint8Array;
  tags: Record<string, unknown>;
  colorOsValidation: ReturnType<typeof validateColorOsExif>;
}

export function postCopyPipeline(
  jpeg: Uint8Array,
  sourcePath: string,
  trailing: Uint8Array,
  options: CopyMetadataOptions,
  _backendUsed: string,
): PostCopyResult {
  let working = jpeg;
  const motionPhoto = trailing.length > 0 && hasLikelyAppendedMp4(trailing);

  if (!options.excludeExif && !hasExifApp1Segment(working) && findExiftool()) {
    working = tagsFromFileCopyDest(working, sourcePath, options);
  }

  if (!options.excludeExif) {
    working = stripMpfApp2(working);
  }

  let tags = readTagsJson(working);
  const exiftoolOk = !!findExiftool();
  const needsResync =
    !options.excludeExif &&
    exiftoolOk &&
    needsColorOsExifResync(working, tags, { requireMakerNotes: true });
  if (needsResync) {
    working = syncFullExifFromSource(working, sourcePath);
    working = stripMpfApp2(working);
    tags = readTagsJson(working);
  }

  if (!options.excludeExif && exiftoolOk) {
    let sourceTags: Record<string, unknown> = {};
    let sourceJpeg: Uint8Array | undefined;
    if (sourcePath && fs.existsSync(sourcePath)) {
      sourceJpeg = new Uint8Array(fs.readFileSync(sourcePath));
      sourceTags = readTagsJson(sourceJpeg);
      const sourceFmt = detectFormatFromBytes(sourceJpeg, path.basename(sourcePath));
      if (
        isJpegFormat(sourceFmt) &&
        needsExifByteOrderRealign(working, sourceTags, sourceJpeg)
      ) {
        working = realignExifFromJpegSource(working, sourceJpeg, options);
        working = stripMpfApp2(working);
        tags = readTagsJson(working);
      }
    }
    working = supplementColorOsExif(working, tags, sourceTags, sourceJpeg);
    tags = readTagsJson(working);
  }

  if (motionPhoto) {
    working = rebuildMotionPhotoXmpInJpeg(working, trailing.length);
    tags = readTagsJson(working);
  }

  const colorOsValidation = validateColorOsExif(working, tags, {
    motionPhoto,
    trailingLength: motionPhoto ? trailing.length : undefined,
  });

  return { jpeg: working, tags, colorOsValidation };
}

/** Write source bytes to temp file for exiftool paths. */
export function writeTempSource(sourceBytes: Uint8Array, filename: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oppo-src-"));
  const p = path.join(dir, filename);
  fs.writeFileSync(p, sourceBytes);
  return p;
}

export function transplantFromMaterializedCanvas(
  destJpeg: Uint8Array,
  canvasJpeg: Uint8Array,
  options: CopyMetadataOptions,
): Uint8Array {
  const segments = extractMetadataSegments(canvasJpeg, options);
  if (segments.length === 0) return destJpeg;
  const stripped = stripMetadataForCopy(destJpeg, options);
  return insertAfterAppSegments(stripped, segments);
}

export { concatBytes, splitJpegAndAppendedTail };
