/**
 * ExifTool WASM runner with true -TagsFromFile (same as desktop / metadata.py).
 * Uses bundled exiftool.pl + @6over3/zeroperl-ts (separate from @uswriting/exiftool cache).
 */
import { MemoryFileSystem, ZeroPerl } from "@6over3/zeroperl-ts";
import {
  buildExiftoolSupplementArgs,
  hasColorOsExifSupplement,
  planColorOsExifSupplement,
} from "@shared/colorOsExifPatch";
import {
  inferCopyExifByteOrder,
  type ExifByteOrder,
} from "@shared/exifByteOrder";
import exiftoolScript from "../../assets/exiftool.pl?raw";
import type { CopyMetadataOptions } from "./copyContract";
import { vfsBasename } from "./copyContract";
import {
  filterResyncExifTags,
  filterWritableTags,
  writableTagsToExiftoolArgs,
} from "./copyWritableTags";
import { agentLog } from "./exiftoolDebug";
import { detectReferenceFormat, isJpegFormat } from "./imageFormat";

class StringBuilder {
  private parts: string[] = [];
  append(s: string): void {
    this.parts.push(s);
  }
  clear(): void {
    this.parts = [];
  }
  toString(): string {
    return this.parts.join("");
  }
}

const stdout = new StringBuilder();
const stderr = new StringBuilder();
const decoder = new TextDecoder();
const enc = new TextEncoder();

let binaryStdoutParts: Uint8Array[] = [];
let captureStdoutAsBinary = false;

function pushStdout(data: string | Uint8Array): void {
  if (captureStdoutAsBinary) {
    binaryStdoutParts.push(
      typeof data === "string" ? enc.encode(data) : data instanceof Uint8Array ? data.slice() : new Uint8Array(data),
    );
    return;
  }
  stdout.append(typeof data === "string" ? data : decoder.decode(data));
}

function concatUint8Arrays(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

let cachedPerlRef: WeakRef<ZeroPerl> | null = null;
let cachedFsRef: WeakRef<MemoryFileSystem> | null = null;

async function getZeroPerl(): Promise<{ perl: ZeroPerl; fileSystem: MemoryFileSystem }> {
  const cachedPerl = cachedPerlRef?.deref();
  const cachedFs = cachedFsRef?.deref();
  if (cachedPerl && cachedFs) {
    return { perl: cachedPerl, fileSystem: cachedFs };
  }

  const fileSystem = new MemoryFileSystem({ "/": "" });
  fileSystem.addFile("/exiftool", enc.encode(exiftoolScript));

  const perl = await ZeroPerl.create({
    fileSystem,
    stdout: (data) => {
      pushStdout(data);
    },
    stderr: (data) => {
      stderr.append(typeof data === "string" ? data : decoder.decode(data));
    },
  });

  cachedPerlRef = new WeakRef(perl);
  cachedFsRef = new WeakRef(fileSystem);
  return { perl, fileSystem };
}

function cleanupPaths(fileSystem: MemoryFileSystem, paths: string[]): void {
  for (const path of paths) {
    try {
      fileSystem.removeFile(path);
    } catch {
      /* ignore */
    }
  }
}

function readFileBytes(fileSystem: MemoryFileSystem, path: string): Uint8Array {
  const node = fileSystem.lookup(path);
  if (!node || node.type !== "file") {
    throw new Error(`ExifTool output not found: ${path}`);
  }
  if (node.content instanceof Blob) {
    throw new Error("Unexpected Blob content from MemoryFileSystem");
  }
  const buf = node.content.buffer as ArrayBuffer;
  return new Uint8Array(buf.slice(node.content.byteOffset, node.content.byteOffset + node.content.byteLength));
}

async function runExiftoolScript(
  op: string,
  hypothesisId: string,
  perl: ZeroPerl,
  args: string[],
  vfsPaths?: Record<string, string>,
): Promise<{ success: boolean; exitCode: number; stderr: string; perlError?: string }> {
  agentLog(hypothesisId, `exiftoolWasmRunner.ts:${op}:before`, `${op} start`, {
    args,
    vfsPaths,
    tagsFromFile: args.includes("-TagsFromFile"),
    resyncGroups: args.filter((a) => a.endsWith(":All")).length,
  });
  const result = await perl.runFile("/exiftool", args);
  perl.flush();
  const stderrText = stderr.toString();
  const perlError = perl.getLastError();
  agentLog(hypothesisId, `exiftoolWasmRunner.ts:${op}:after`, `${op} done`, {
    success: result.success,
    exitCode: result.exitCode,
    stderrHead: stderrText.slice(0, 500),
    perlError: perlError?.slice(0, 300),
    efileMentions: (stderrText.match(/EFile/g) || []).length,
  });
  return {
    success: result.success,
    exitCode: result.exitCode,
    stderr: stderrText,
    perlError: perlError || undefined,
  };
}

export interface RunExiftoolResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  error?: string;
}

export async function runExiftool(args: string[]): Promise<RunExiftoolResult> {
  const { perl } = await getZeroPerl();
  stdout.clear();
  stderr.clear();
  await perl.reset();

  const result = await perl.runFile("/exiftool", args);
  perl.flush();

  const stderrText = stderr.toString();
  const stdoutText = stdout.toString();
  const perlError = perl.getLastError();

  if (!result.success || result.exitCode !== 0) {
    return {
      success: false,
      stdout: stdoutText,
      stderr: stderrText,
      exitCode: result.exitCode,
      error: perlError || stderrText || "ExifTool failed",
    };
  }

  if (stderrText.trim()) {
    return {
      success: false,
      stdout: stdoutText,
      stderr: stderrText,
      exitCode: 0,
      error: stderrText,
    };
  }

  return {
    success: true,
    stdout: stdoutText,
    stderr: stderrText,
    exitCode: 0,
  };
}

const EXIF_RESYNC_GROUPS = [
  "-IFD0:All",
  "-ExifIFD:All",
  "-InteropIFD:All",
  "-GPS:All",
  "-MakerNotes:All",
];

async function inferByteOrderFromSource(sourceFile: File): Promise<ExifByteOrder> {
  const parsed = await parseMetadataJson<Record<string, unknown>[]>(sourceFile, ["-json", "-G1", "-U"]);
  const sourceTags = parsed[0] ?? {};
  const sourceBytes = new Uint8Array(await sourceFile.arrayBuffer());
  return inferCopyExifByteOrder(sourceTags, sourceBytes);
}

/** WASM-safe metadata copy when source is HEIC/PNG/WebP (TagsFromFile breaks in zeroperl). */
export async function copyTagsOntoDestViaParsedSource(
  destFile: File,
  sourceFile: File,
  options: CopyMetadataOptions = {},
): Promise<Uint8Array> {
  const parsed = await parseMetadataJson<Record<string, unknown>[]>(sourceFile, [
    "-json",
    "-G1",
    "-U",
  ]);
  const tags = parsed[0] ?? {};
  const sourceBytes = new Uint8Array(await sourceFile.arrayBuffer());
  const byteOrder = inferCopyExifByteOrder(tags, sourceBytes);
  const writable = filterWritableTags(tags, options);
  const writeArgs = writableTagsToExiftoolArgs(writable, byteOrder);
  agentLog("H3", "exiftoolWasmRunner.ts:copyTagsOntoDestViaParsedSource", "parsed-tag copy", {
    sourceOriginal: sourceFile.name,
    destOriginal: destFile.name,
    tagCount: Object.keys(writable).length,
    byteOrder,
    runId: "post-fix",
  });
  if (writeArgs.length <= 1) {
    return new Uint8Array(await destFile.arrayBuffer());
  }
  return writeMetadataWithExiftool(destFile, writeArgs);
}

export async function tagsFromFileCopyWithFormat(
  destFile: File,
  sourceFile: File,
  tagsFromFileArgs: string[],
  options: CopyMetadataOptions = {},
): Promise<Uint8Array> {
  if (!isJpegFormat(detectReferenceFormat(sourceFile))) {
    return copyTagsOntoDestViaParsedSource(destFile, sourceFile, options);
  }
  return tagsFromFileCopy(destFile, sourceFile, tagsFromFileArgs);
}

/**
 * Re-sync full EXIF block from source with source byte order (OPPO originals use MM).
 */
export async function syncFullExifFromSource(
  jpegBytes: Uint8Array,
  sourceFile: File,
  byteOrder?: ExifByteOrder,
): Promise<Uint8Array> {
  if (!isJpegFormat(detectReferenceFormat(sourceFile))) {
    const parsed = await parseMetadataJson<Record<string, unknown>[]>(sourceFile, [
      "-json",
      "-G1",
      "-U",
    ]);
    const tags = parsed[0] ?? {};
    const sourceBytes = new Uint8Array(await sourceFile.arrayBuffer());
    const order = byteOrder ?? inferCopyExifByteOrder(tags, sourceBytes);
    const resync = filterResyncExifTags(tags);
    const writeArgs = writableTagsToExiftoolArgs(resync, order);
    agentLog("H2", "exiftoolWasmRunner.ts:syncFullExifFromSource", "parsed-tag resync", {
      sourceOriginal: sourceFile.name,
      tagCount: Object.keys(resync).length,
      byteOrder: order,
    });
    if (writeArgs.length <= 1) return jpegBytes;
    return writeMetadataWithExiftool(
      new File([jpegBytes.slice()], "dest.jpg", { type: "image/jpeg" }),
      writeArgs,
    );
  }

  const { perl, fileSystem } = await getZeroPerl();
  stdout.clear();
  stderr.clear();
  await perl.reset();

  const destPath = `/dest_${vfsBasename("dest.jpg")}`;
  const sourcePath = `/source_${vfsBasename(sourceFile.name)}`;
  const outPath = `/out_${crypto.randomUUID().replace(/-/g, "")}.jpg`;
  const tempPaths = [destPath, sourcePath, outPath];

  try {
    fileSystem.addFile(destPath, new File([jpegBytes.slice()], "dest.jpg", { type: "image/jpeg" }));
    fileSystem.addFile(sourcePath, sourceFile);

    const order = byteOrder ?? (await inferByteOrderFromSource(sourceFile));
    const args = [
      "-api",
      `ByteOrder=${order}`,
      "-TagsFromFile",
      sourcePath,
      ...EXIF_RESYNC_GROUPS,
      "-m",
      "-o",
      outPath,
      destPath,
    ];

    const result = await runExiftoolScript("syncFullExif", "H2", perl, args, {
      destPath,
      sourcePath,
      outPath,
      sourceOriginal: sourceFile.name,
      sourceSafe: vfsBasename(sourceFile.name),
    });

    const stderrText = result.stderr;
    if (!result.success || result.exitCode !== 0) {
      throw new Error(result.perlError || stderrText || "IFD0/Interop sync failed");
    }
    if (stderrText.trim()) {
      throw new Error(stderrText);
    }

    return readFileBytes(fileSystem, outPath);
  } finally {
    cleanupPaths(fileSystem, tempPaths);
  }
}

/** Copy metadata via -TagsFromFile (live-photo-conv / metadata.py semantics). */
export async function tagsFromFileCopy(
  destFile: File,
  sourceFile: File,
  tagsFromFileArgs: string[],
): Promise<Uint8Array> {
  const { perl, fileSystem } = await getZeroPerl();
  stdout.clear();
  stderr.clear();
  await perl.reset();

  const destPath = `/dest_${vfsBasename(destFile.name)}`;
  const sourcePath = `/source_${vfsBasename(sourceFile.name)}`;
  const outPath = `/out_${crypto.randomUUID().replace(/-/g, "")}.jpg`;
  const tempPaths = [destPath, sourcePath, outPath];

  try {
    fileSystem.addFile(destPath, destFile);
    fileSystem.addFile(sourcePath, sourceFile);

    const order = await inferByteOrderFromSource(sourceFile);
    const args = [
      "-api",
      `ByteOrder=${order}`,
      "-TagsFromFile",
      sourcePath,
      ...tagsFromFileArgs,
      "-m",
      "-o",
      outPath,
      destPath,
    ];

    const result = await runExiftoolScript("tagsFromFileCopy", "H3", perl, args, {
      destPath,
      sourcePath,
      outPath,
      destOriginal: destFile.name,
      sourceOriginal: sourceFile.name,
      destSafe: vfsBasename(destFile.name),
      sourceSafe: vfsBasename(sourceFile.name),
    });

    const stderrText = result.stderr;
    if (!result.success || result.exitCode !== 0) {
      throw new Error(result.perlError || stderrText || "TagsFromFile failed");
    }
    if (stderrText.trim()) {
      throw new Error(stderrText);
    }

    return readFileBytes(fileSystem, outPath);
  } finally {
    cleanupPaths(fileSystem, tempPaths);
  }
}

export async function parseMetadataJson<T>(file: File, extraArgs: string[] = []): Promise<T> {
  const { perl, fileSystem } = await getZeroPerl();
  stdout.clear();
  stderr.clear();
  await perl.reset();

  const path = `/read_${vfsBasename(file.name)}`;
  try {
    fileSystem.addFile(path, file);
    const args = [...extraArgs, path];
    const result = await runExiftoolScript("parseMetadataJson", "H1", perl, args, {
      path,
      fileOriginal: file.name,
      fileSafe: vfsBasename(file.name),
    });

    const stderrText = result.stderr;
    if (!result.success || result.exitCode !== 0) {
      throw new Error(result.perlError || stderrText || "parse failed");
    }
    if (stderrText.trim()) {
      throw new Error(stderrText);
    }

    const stdoutText = stdout.toString().trim();
    if (!stdoutText) {
      throw new Error("No output from ExifTool");
    }
    return JSON.parse(stdoutText) as T;
  } finally {
    cleanupPaths(fileSystem, [path]);
  }
}

function tagMapHasMakerNotes(tags: Record<string, unknown>): boolean {
  if (tags["MakerNotes"] != null && tags["MakerNotes"] !== "") return true;
  for (const key of Object.keys(tags)) {
    if (tags[key] == null || tags[key] === "") continue;
    if (key.startsWith("MakerNotes:")) return true;
    if (/MakerNote/i.test(key)) return true;
  }
  return false;
}

const MAKERNOTE_BINARY_EXTRACT_ARGS = [
  ["-b", "-MakerNotes"],
  ["-b", "-MakerNoteUnknownText"],
  ["-b", "-UnknownText"],
] as const;

async function extractBinaryFromSource(sourceFile: File, extractArgs: readonly string[]): Promise<Uint8Array | null> {
  const { perl, fileSystem } = await getZeroPerl();
  stdout.clear();
  stderr.clear();
  binaryStdoutParts = [];
  captureStdoutAsBinary = true;
  await perl.reset();

  const path = `/extract_${vfsBasename(sourceFile.name)}`;
  try {
    fileSystem.addFile(path, sourceFile);
    const result = await runExiftoolScript("extractBinary", "H7", perl, [...extractArgs, path], {
      path,
      tag: extractArgs[1],
    });
    if (!result.success || result.exitCode !== 0) return null;
    if (binaryStdoutParts.length === 0) return null;
    const bytes = concatUint8Arrays(binaryStdoutParts);
    return bytes.length > 0 ? bytes : null;
  } finally {
    captureStdoutAsBinary = false;
    binaryStdoutParts = [];
    cleanupPaths(fileSystem, [path]);
  }
}

/** Extract OPPO/ColorOS MakerNotes binary from HEIC/PNG/WebP (JSON parse skips binary). */
export async function extractMakerNotesBinary(sourceFile: File): Promise<Uint8Array | null> {
  for (const extractArgs of MAKERNOTE_BINARY_EXTRACT_ARGS) {
    const bytes = await extractBinaryFromSource(sourceFile, extractArgs);
    if (bytes) {
      agentLog("H7", "exiftoolWasmRunner.ts:extractMakerNotesBinary", "extracted", {
        tag: extractArgs[1],
        bytes: bytes.length,
      });
      return bytes;
    }
  }
  agentLog("H7", "exiftoolWasmRunner.ts:extractMakerNotesBinary", "extract-empty", {
    source: sourceFile.name,
  });
  return null;
}

export async function injectMakerNotesBinary(
  jpegBytes: Uint8Array,
  makerNotes: Uint8Array,
  byteOrder: ExifByteOrder = "II",
): Promise<Uint8Array> {
  if (makerNotes.length === 0) return jpegBytes;

  const { perl, fileSystem } = await getZeroPerl();
  stdout.clear();
  stderr.clear();
  await perl.reset();

  const inPath = `/in_mn_${crypto.randomUUID().replace(/-/g, "")}.jpg`;
  const binPath = `/mn_${crypto.randomUUID().replace(/-/g, "")}.bin`;
  const outPath = `/out_mn_${crypto.randomUUID().replace(/-/g, "")}.jpg`;
  const tempPaths = [inPath, binPath, outPath];

  try {
    fileSystem.addFile(inPath, new File([jpegBytes.slice()], "dest.jpg", { type: "image/jpeg" }));
    fileSystem.addFile(binPath, makerNotes);
    const args = ["-api", `ByteOrder=${byteOrder}`, "-m", `-MakerNotes<=${binPath}`, "-o", outPath, inPath];
    const result = await runExiftoolScript("injectMakerNotes", "H7", perl, args, {
      inPath,
      binPath,
      outPath,
      mnBytes: String(makerNotes.length),
      byteOrder,
    });

    const stderrText = result.stderr;
    if (!result.success || result.exitCode !== 0) {
      throw new Error(result.perlError || stderrText || "MakerNotes inject failed");
    }
    if (stderrText.trim()) {
      throw new Error(stderrText);
    }

    return readFileBytes(fileSystem, outPath);
  } finally {
    cleanupPaths(fileSystem, tempPaths);
  }
}

/** Copy binary MakerNotes from non-JPEG source onto JPEG when parsed/segment copy omitted them. */
export async function copyMakerNotesFromNonJpegSource(
  jpegBytes: Uint8Array,
  sourceFile: File,
  byteOrder: ExifByteOrder = "II",
): Promise<Uint8Array> {
  const probe = await parseMetadataJson<Record<string, unknown>[]>(
    new File([jpegBytes.slice()], "mn-probe.jpg", { type: "image/jpeg" }),
    ["-json", "-G1", "-U"],
  );
  const tags = probe[0] ?? {};
  if (tagMapHasMakerNotes(tags)) {
    agentLog("H7", "exiftoolWasmRunner.ts:copyMakerNotesFromNonJpegSource", "already-present", {});
    return jpegBytes;
  }

  const makerNotes = await extractMakerNotesBinary(sourceFile);
  if (!makerNotes) return jpegBytes;

  const injected = await injectMakerNotesBinary(jpegBytes, makerNotes, byteOrder);
  const verify = await parseMetadataJson<Record<string, unknown>[]>(
    new File([injected.slice()], "mn-verify.jpg", { type: "image/jpeg" }),
    ["-json", "-G1", "-U"],
  );
  agentLog("H7", "exiftoolWasmRunner.ts:copyMakerNotesFromNonJpegSource", "inject-done", {
    bytes: makerNotes.length,
    hasMakerNotes: tagMapHasMakerNotes(verify[0] ?? {}),
  });
  return injected;
}

/** Patch Interop IFD + ExifImage dimensions + byte order aligned with source. */
export async function supplementColorOsExif(
  jpegBytes: Uint8Array,
  tags?: Record<string, unknown>,
  sourceTags?: Record<string, unknown>,
  sourceJpeg?: Uint8Array,
): Promise<Uint8Array> {
  const tagMap =
    tags ??
    (
      await parseMetadataJson<Record<string, unknown>[]>(
        new File([jpegBytes.slice()], "supp-probe.jpg", { type: "image/jpeg" }),
        ["-json", "-G1", "-U"],
      )
    )[0] ??
    {};
  const plan = planColorOsExifSupplement(jpegBytes, tagMap, sourceTags, sourceJpeg);
  agentLog("H4", "exiftoolWasmRunner.ts:supplementColorOsExif", "supplement plan", { plan });
  if (!hasColorOsExifSupplement(plan)) return jpegBytes;
  return writeMetadataWithExiftool(
    new File([jpegBytes.slice()], "supp.jpg", { type: "image/jpeg" }),
    buildExiftoolSupplementArgs(plan),
  );
}

export async function warmupExiftoolRuntime(): Promise<void> {
  const result = await runExiftool(["-ver"]);
  if (!result.success) {
    throw new Error(result.error || "ExifTool warmup failed");
  }
}

export async function writeMetadataWithExiftool(
  file: File,
  writeArgs: string[],
): Promise<Uint8Array> {
  const { perl, fileSystem } = await getZeroPerl();
  stdout.clear();
  stderr.clear();
  await perl.reset();

  const inPath = `/in_${vfsBasename(file.name)}`;
  const ext = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".")) : ".jpg";
  const outPath = `/out_${crypto.randomUUID().replace(/-/g, "")}${ext}`;
  const tempPaths = [inPath, outPath];

  try {
    fileSystem.addFile(inPath, file);
    const args = [...writeArgs, "-o", outPath, inPath];
    const result = await runExiftoolScript("writeMetadata", "H4", perl, args, {
      inPath,
      outPath,
      fileOriginal: file.name,
      fileSafe: vfsBasename(file.name),
    });

    const stderrText = result.stderr;
    if (!result.success || result.exitCode !== 0) {
      throw new Error(result.perlError || stderrText || "metadata write failed");
    }
    if (stderrText.trim()) {
      throw new Error(stderrText);
    }

    return readFileBytes(fileSystem, outPath);
  } finally {
    cleanupPaths(fileSystem, tempPaths);
  }
}

export async function disposeWasmRunner(): Promise<void> {
  const perl = cachedPerlRef?.deref();
  if (perl) {
    perl.dispose();
    cachedPerlRef = null;
    cachedFsRef = null;
  }
}
