/**
 * ExifTool WASM runner with true -TagsFromFile (same as desktop / metadata.py).
 * Uses bundled exiftool.pl + @6over3/zeroperl-ts (separate from @uswriting/exiftool cache).
 */
import { MemoryFileSystem, ZeroPerl } from "@6over3/zeroperl-ts";
import exiftoolScript from "../../assets/exiftool.pl?raw";
import { vfsBasename } from "./copyContract";

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
      stdout.append(typeof data === "string" ? data : decoder.decode(data));
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

/**
 * Re-sync full EXIF block from source with II byte order (ColorOS watermark requirement).
 * Used after HEIC materialize when segment transplant still reports MM.
 */
export async function syncFullExifFromSource(
  jpegBytes: Uint8Array,
  sourceFile: File,
): Promise<Uint8Array> {
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

    const args = [
      "-api",
      "ByteOrder=II",
      "-TagsFromFile",
      sourcePath,
      ...EXIF_RESYNC_GROUPS,
      "-m",
      "-o",
      outPath,
      destPath,
    ];

    const result = await perl.runFile("/exiftool", args);
    perl.flush();

    const stderrText = stderr.toString();
    if (!result.success || result.exitCode !== 0) {
      throw new Error(perl.getLastError() || stderrText || "IFD0/Interop sync failed");
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

    const args = [
      "-api",
      "ByteOrder=II",
      "-TagsFromFile",
      sourcePath,
      ...tagsFromFileArgs,
      "-m",
      "-o",
      outPath,
      destPath,
    ];

    const result = await perl.runFile("/exiftool", args);
    perl.flush();

    const stderrText = stderr.toString();
    if (!result.success || result.exitCode !== 0) {
      throw new Error(perl.getLastError() || stderrText || "TagsFromFile failed");
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
    const result = await perl.runFile("/exiftool", args);
    perl.flush();

    const stderrText = stderr.toString();
    if (!result.success || result.exitCode !== 0) {
      throw new Error(perl.getLastError() || stderrText || "parse failed");
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

export async function warmupExiftoolRuntime(): Promise<void> {
  const result = await runExiftool(["-ver"]);
  if (!result.success) {
    throw new Error(result.error || "ExifTool warmup failed");
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
