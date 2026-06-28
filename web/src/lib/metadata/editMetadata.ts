import {
  bundleNeedsXmpRebuild,
  bundleToExiftoolWriteArgs,
  resolveXmpVideoLength,
} from "@shared/bundleToExiftoolArgs.js";

import { rebuildMotionPhotoXmpInJpeg } from "../muxer";

import {
  ensureColorOsExifFromSource,
  needsColorOsExifResync,
  validateColorOsExif,
  type ColorOsExifValidation,
} from "./colorOsExif";

import { detectReferenceFormat, formatLabel, isJpegFormat } from "./imageFormat";

import {
  concatBytes,
  hasLikelyAppendedMp4,
  splitJpegAndAppendedTail,
} from "./jpegTail";

import {
  computeDirtyKeys,
  dirtyBundleForWrite,
  hasMetadataEdits,
} from "./sourceMetadataEdits";

import type { NativeMetadataBundle } from "./types";

import { parseMetadataJson, writeMetadataWithExiftool } from "./exiftoolWasmRunner";

import { withExiftoolLock } from "./exiftoolQueue";

import { preloadExiftoolRuntime } from "./exiftoolCopy";

import { stripMpfApp2 } from "./segments";

export interface EditMetadataResult {
  bytes: Uint8Array;
  mime: string;
  downloadName: string;
  fieldsWritten: number;
  colorOsExif?: ColorOsExifValidation;
}

function outputEditedName(name: string): string {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : ".jpg";
  return `${base}-edited${ext}`;
}

function mimeForFile(file: File): string {
  if (file.type) return file.type;
  const fmt = detectReferenceFormat(file);
  if (fmt === "heic" || fmt === "heif") return "image/heic";
  if (fmt === "png") return "image/png";
  if (fmt === "webp") return "image/webp";
  return "image/jpeg";
}

/** Apply user edits onto the uploaded original image (browser ExifTool WASM). */
export async function editSourceMetadata(
  file: File,
  referenceBundle: NativeMetadataBundle,
  edits: NativeMetadataBundle,
): Promise<EditMetadataResult> {
  if (!hasMetadataEdits(referenceBundle, edits)) {
    throw new Error("请先修改至少一项元数据");
  }

  await preloadExiftoolRuntime();

  const dirtyKeys = computeDirtyKeys(referenceBundle, edits);
  const writeBundle = dirtyBundleForWrite(referenceBundle, edits);
  const writeArgs = bundleToExiftoolWriteArgs(writeBundle, dirtyKeys);
  const needsXmpRebuild =
    bundleNeedsXmpRebuild(writeBundle, dirtyKeys) ||
    dirtyKeys.has("presentationTimestampUs") ||
    [...dirtyKeys].some((k) => k.startsWith("xmp:"));

  if (writeArgs.length <= 3 && !needsXmpRebuild) {
    throw new Error("没有可写入的字段");
  }

  const originalBytes = new Uint8Array(await file.arrayBuffer());
  const format = detectReferenceFormat(file);
  let inputFile = file;
  let trailing = new Uint8Array(0);
  let motionPhoto = false;

  if (isJpegFormat(format)) {
    const split = splitJpegAndAppendedTail(originalBytes);
    trailing = new Uint8Array(split.trailing);
    motionPhoto = trailing.length > 0 && hasLikelyAppendedMp4(trailing);
    if (motionPhoto) {
      inputFile = new File([split.jpeg.slice()], file.name, {
        type: file.type || "image/jpeg",
      });
    }
  }

  let working =
    writeArgs.length > 3
      ? await withExiftoolLock(() => writeMetadataWithExiftool(inputFile, writeArgs))
      : new Uint8Array(await inputFile.arrayBuffer());

  if (isJpegFormat(format)) {
    working = stripMpfApp2(working);
    let tags = await withExiftoolLock(() =>
      parseMetadataJson<Record<string, unknown>[]>(
        new File([working.slice()], "probe.jpg", { type: "image/jpeg" }),
        ["-j", "-G1", "-U"],
      ),
    );
    const preTags = tags[0] ?? {};
    if (needsColorOsExifResync(working, preTags, { requireMakerNotes: true })) {
      working = await withExiftoolLock(() =>
        ensureColorOsExifFromSource(working, inputFile, preTags, { requireMakerNotes: true }),
      );
      working = stripMpfApp2(working);
      if (writeArgs.length > 3) {
        working = await withExiftoolLock(() =>
          writeMetadataWithExiftool(
            new File([working.slice()], file.name, { type: file.type || "image/jpeg" }),
            writeArgs,
          ),
        );
        working = stripMpfApp2(working);
      }
    }
  }

  if (motionPhoto && needsXmpRebuild) {
    const videoLen = resolveXmpVideoLength(writeBundle, trailing.length) ?? trailing.length;
    const gainMap = writeBundle.xmp?.container?.gainMapLength;
    working = new Uint8Array(
      rebuildMotionPhotoXmpInJpeg(working.slice(), videoLen, {
        presentationTimestampUs: writeBundle.presentationTimestampUs,
        mode: writeBundle.xmp?.mode ?? "native",
        gainMapLength: gainMap != null ? Number(gainMap) : undefined,
        hdrgmVersion: writeBundle.xmp?.hdrgm?.version,
        motionPhotoOwner: writeBundle.xmp?.opcamera?.MotionPhotoOwner as string | undefined,
        oLivePhotoVersion:
          writeBundle.xmp?.opcamera?.OLivePhotoVersion != null
            ? Number(writeBundle.xmp.opcamera.OLivePhotoVersion)
            : undefined,
        motionPhotoFeatureFlag:
          writeBundle.xmp?.opcamera?.MotionPhotoFeatureFlag != null
            ? Number(writeBundle.xmp.opcamera.MotionPhotoFeatureFlag)
            : undefined,
      }),
    );
  }

  const tags = await withExiftoolLock(() =>
    parseMetadataJson<Record<string, unknown>[]>(
      new File([working.slice()], "probe.jpg", { type: "image/jpeg" }),
      ["-j", "-G1", "-U"],
    ),
  );
  const xmpMode = writeBundle.xmp?.mode ?? referenceBundle.xmp?.mode ?? "native";
  const colorOsExif = validateColorOsExif(working, tags[0] ?? {}, {
    motionPhoto,
    trailingLength: motionPhoto ? trailing.length : undefined,
    xmpMode,
  });

  const finalBytes = trailing.length ? concatBytes(working, trailing) : working;

  return {
    bytes: finalBytes,
    mime: mimeForFile(file),
    downloadName: outputEditedName(file.name),
    fieldsWritten: dirtyKeys.size,
    colorOsExif,
  };
}

export function editFormatHint(file: File | null): string {
  if (!file) return "";
  return `${formatLabel(detectReferenceFormat(file))} · 修改后下载为新文件，原图不会被覆盖`;
}
