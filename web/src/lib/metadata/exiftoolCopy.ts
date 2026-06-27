/**
 * copy-img-meta via segment transplant (GExiv2) + ExifTool WASM for HEIC materialize.
 */
import { rebuildMotionPhotoXmpInJpeg } from "../muxer";
import { applySourceMetadataEdits } from "./apply";
import {
  ensureColorOsExifFromSource,
  hasExifApp1Segment,
  needsColorOsExifResync,
  validateColorOsExif,
  type ColorOsExifValidation,
} from "./colorOsExif";
import { buildTagsFromFileArgs, type CopyMetadataOptions } from "./copyContract";
import { readExifByteOrder } from "./exifByteOrder";
import { debugLog, wasmInFlightEnter, wasmInFlightLeave, wasmInFlightCount } from "./exiftoolDebug";
import {
  concatBytes,
  hasLikelyAppendedMp4,
  splitJpegAndAppendedTail,
} from "./jpegTail";
import {
  parseMetadataJson,
  syncFullExifFromSource,
  tagsFromFileCopy,
  warmupExiftoolRuntime,
} from "./exiftoolWasmRunner";
import { withExiftoolLock } from "./exiftoolQueue";
import { detectReferenceFormat } from "./imageFormat";
import { bundleHasEditableFields } from "./parse";
import { copyMetadataViaSegmentTransplant } from "./segmentCopy";

type TagMap = Record<string, unknown>;

function pickMakeModel(tags: TagMap): { make?: string; model?: string } {
  return {
    make:
      (tags["IFD0:Make"] as string | undefined) ??
      (tags["EXIF:Make"] as string | undefined) ??
      (tags["QuickTime:Make"] as string | undefined),
    model:
      (tags["IFD0:Model"] as string | undefined) ??
      (tags["EXIF:Model"] as string | undefined) ??
      (tags["QuickTime:Model"] as string | undefined) ??
      (tags["IFD0:CameraModelName"] as string | undefined) ??
      (tags["EXIF:CameraModelName"] as string | undefined),
  };
}

function modelRelatedKeys(tags: TagMap): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(tags)) {
    if (value == null) continue;
    if (/make|model|maker|camera|lens/i.test(key)) out[key] = value;
  }
  return out;
}

export interface CopyViaExiftoolResult {
  bytes: Uint8Array;
  sourceTags: TagMap;
  outputTags: TagMap;
  colorOsExif: ColorOsExifValidation;
}

/** Copy metadata from source onto dest pixels (live-photo-conv copy-img-meta semantics). */
export async function copyViaExiftool(
  destFile: File,
  sourceFile: File,
  options: CopyMetadataOptions = {},
): Promise<CopyViaExiftoolResult> {
  debugLog("A", "exiftoolCopy.ts:copyViaExiftool", "start", {
    inFlight: wasmInFlightCount(),
    source: sourceFile.name,
    dest: destFile.name,
    mode: "segment-transplant",
  });

  return withExiftoolLock(async () => {
    wasmInFlightEnter("tags-from-file-read");
    let sourceTags: TagMap;
    try {
      const parsed = await parseMetadataJson<TagMap[]>(sourceFile, ["-json", "-G1", "-U"]);
      sourceTags = parsed[0] ?? {};
      wasmInFlightLeave("tags-from-file-read", true);
    } catch (e) {
      wasmInFlightLeave("tags-from-file-read", false, (e as Error).message);
      throw e;
    }

    wasmInFlightEnter("tags-from-file-write");
    try {
      const destBytes = new Uint8Array(await destFile.arrayBuffer());
      const sourceBytes = new Uint8Array(await sourceFile.arrayBuffer());
      const sourceFormat = detectReferenceFormat(sourceFile);

      const { jpeg: jpegPart, trailing } = splitJpegAndAppendedTail(destBytes);
      const motionPhotoDest = trailing.length > 0 && hasLikelyAppendedMp4(trailing);
      const destJpeg = motionPhotoDest ? jpegPart : destBytes;

      debugLog("G", "exiftoolCopy.ts:copyViaExiftool", "dest-shape", {
        destBytes: destBytes.byteLength,
        jpegBytes: jpegPart.byteLength,
        trailingBytes: trailing.length,
        motionPhotoDest,
        sourceFormat,
      });

      let copiedJpeg = await copyMetadataViaSegmentTransplant(
        destJpeg,
        sourceFile,
        sourceBytes,
        sourceFormat,
        options,
      );

      if (!options.excludeExif && !hasExifApp1Segment(copiedJpeg)) {
        debugLog("G", "exiftoolCopy.ts:copyViaExiftool", "segment-fallback", {
          reason: "no EXIF APP1 after transplant",
        });
        const destForCopy = new File([copiedJpeg.slice()], destFile.name, {
          type: destFile.type || "image/jpeg",
        });
        copiedJpeg = await tagsFromFileCopy(
          destForCopy,
          sourceFile,
          buildTagsFromFileArgs(options),
        );
        copiedJpeg = await syncFullExifFromSource(copiedJpeg, sourceFile);
      }

      if (
        options.sourceEdits &&
        bundleHasEditableFields(options.sourceEdits) &&
        !options.excludeExif
      ) {
        copiedJpeg = applySourceMetadataEdits(copiedJpeg, options.sourceEdits);
        debugLog("G", "exiftoolCopy.ts:copyViaExiftool", "source-edits-applied", {
          exifKeys: Object.keys(options.sourceEdits.exif),
        });
      }

      if (motionPhotoDest && trailing.length > 0) {
        copiedJpeg = rebuildMotionPhotoXmpInJpeg(copiedJpeg, trailing.length);
        debugLog("I", "exiftoolCopy.ts:copyViaExiftool", "xmp-sync", {
          videoLength: trailing.length,
        });
      }

      let colorOsExif: ColorOsExifValidation = { ok: true, issues: [], exifByteOrder: null };

      if (!options.excludeExif) {
        let preCheck = await parseMetadataJson<Record<string, unknown>[]>(
          new File([copiedJpeg.slice()], "pre-coloros.jpg", { type: "image/jpeg" }),
          ["-json", "-G1", "-U"],
        );
        let preTags = preCheck[0] ?? {};
        if (
          needsColorOsExifResync(copiedJpeg, preTags, { requireMakerNotes: true })
        ) {
          debugLog("G", "exiftoolCopy.ts:copyViaExiftool", "coloros-exif-resync", {
            byteOrder: readExifByteOrder(copiedJpeg),
            interop: preTags["EXIF:InteropIndex"],
            ycbcr: preTags["IFD0:YCbCrPositioning"],
          });
          copiedJpeg = await ensureColorOsExifFromSource(copiedJpeg, sourceFile, preTags, {
            requireMakerNotes: true,
          });
          preCheck = await parseMetadataJson<Record<string, unknown>[]>(
            new File([copiedJpeg.slice()], "post-coloros.jpg", { type: "image/jpeg" }),
            ["-json", "-G1", "-U"],
          );
          preTags = preCheck[0] ?? {};
        }
      }

      const bytes = motionPhotoDest ? concatBytes(copiedJpeg, trailing) : copiedJpeg;

      const { make: srcMake, model: srcModel } = pickMakeModel(sourceTags);
      debugLog("H", "exiftoolCopy.ts:copyViaExiftool", "model-keys-source", {
        keys: modelRelatedKeys(sourceTags),
      });
      const outFull = await parseMetadataJson<Record<string, unknown>[]>(
        new File([copiedJpeg.slice()], "out-check.jpg", { type: "image/jpeg" }),
        ["-json", "-G1", "-U"],
      );
      const outputTags = outFull[0] ?? {};
      if (!options.excludeExif) {
        colorOsExif = validateColorOsExif(copiedJpeg, outputTags, {
          motionPhoto: motionPhotoDest,
          trailingLength: trailing.length,
        });
        if (!colorOsExif.ok) {
          debugLog("G", "exiftoolCopy.ts:copyViaExiftool", "coloros-exif-warning", {
            issues: colorOsExif.issues,
          });
        }
      }
      const exifByteOrder = readExifByteOrder(copiedJpeg);
      debugLog("H", "exiftoolCopy.ts:copyViaExiftool", "model-keys-output", {
        keys: modelRelatedKeys(outputTags),
        exifByteOrder,
      });

      let outputExifCount = 0;
      for (const key of Object.keys(outputTags)) {
        if (key === "SourceFile" || key === "ExifToolVersion") continue;
        const group = key.includes(":") ? key.split(":")[0] : "";
        if (group === "EXIF" || group === "IFD0" || group === "GPS" || group === "Composite") {
          outputExifCount++;
        }
      }
      const { make: outMake, model: outModel } = pickMakeModel(outputTags);
      debugLog("G", "exiftoolCopy.ts:copyViaExiftool", "out-exif", {
        make: outMake,
        model: outModel,
        byteOrder: outputTags["File:ExifByteOrder"] ?? outputTags["ExifByteOrder"],
        exifByteOrderRaw: exifByteOrder,
        outputExifCount,
        jpegOutBytes: copiedJpeg.byteLength,
        finalBytes: bytes.byteLength,
      });

      debugLog("F", "exiftoolCopy.ts:copyViaExiftool", "done", {
        sourceMake: srcMake,
        sourceModel: srcModel,
        outputMake: outMake,
        outputModel: outModel,
        outBytes: bytes.byteLength,
      });

      wasmInFlightLeave("tags-from-file-write", true);
      return { bytes, sourceTags, outputTags, colorOsExif };
    } catch (e) {
      wasmInFlightLeave("tags-from-file-write", false, (e as Error).message);
      throw e;
    }
  });
}

/** Preload WASM runtime (Feature 2 tab). */
export async function preloadExiftoolRuntime(): Promise<void> {
  debugLog("B", "exiftoolCopy.ts:preload", "start", { inFlight: wasmInFlightCount() });
  await withExiftoolLock(async () => {
    wasmInFlightEnter("preload");
    try {
      await warmupExiftoolRuntime();
      wasmInFlightLeave("preload", true);
    } catch (e) {
      wasmInFlightLeave("preload", false, (e as Error).message);
      throw e;
    }
  });
}

export async function disposeExiftoolRuntime(): Promise<void> {
  const { disposeWasmRunner } = await import("./exiftoolWasmRunner");
  await disposeWasmRunner();
  const mod = await import("@uswriting/exiftool");
  await mod.dispose();
}
