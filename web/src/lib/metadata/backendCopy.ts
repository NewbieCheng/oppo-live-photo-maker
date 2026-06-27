/**
 * Backend API client — GExiv2 copy via local Python server (live-photo-conv path).
 */
import type { CopyMetadataOptions, CopyMetadataResult } from "./copyMeta";
import { validateCopyOptions } from "./copyContract";
import type { EditMetadataResult } from "./editMetadata";
import {
  dirtyBundleForWrite,
  hasMetadataEdits,
} from "./sourceMetadataEdits";
import type { NativeMetadataBundle } from "./types";

export const DEFAULT_BACKEND_URL = "http://localhost:28471";
const BACKEND_URL_STORAGE_KEY = "oppo-live-backend-url";

export interface BackendHealth {
  ok: boolean;
  status: string;
  version?: string;
  gexiv2?: {
    available: boolean;
    backend?: string | null;
    path?: string | null;
  };
  error?: string;
}

export const BACKEND_LABELS: Record<string, string> = {
  "exiv2-wasm": "Exiv2 WASM（全格式）",
  "exiftool-tagsfromfile": "ExifTool TagsFromFile",
  "jpeg-segment-transplant": "JPEG 段移植",
  "exiftool-materialize+segment": "ExifTool 物化 + 段移植",
  "exiftool-edit": "ExifTool 元信息编辑",
  "copy-img-meta": "copy-img-meta (GExiv2)",
  "pygobject-gexiv2": "PyGObject GExiv2",
};

export function loadBackendUrl(): string {
  try {
    return localStorage.getItem(BACKEND_URL_STORAGE_KEY) || DEFAULT_BACKEND_URL;
  } catch {
    return DEFAULT_BACKEND_URL;
  }
}

export function saveBackendUrl(url: string): void {
  try {
    localStorage.setItem(BACKEND_URL_STORAGE_KEY, url.replace(/\/+$/, ""));
  } catch {
    /* private mode */
  }
}

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "") || DEFAULT_BACKEND_URL;
}

function headerInt(res: Response, name: string): number {
  const raw = res.headers.get(name);
  if (!raw) return 0;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : 0;
}

function headerText(res: Response, name: string): string | undefined {
  const raw = res.headers.get(name)?.trim();
  if (!raw) return undefined;
  if (/^[\t\x20-\x7E]*$/.test(raw)) return raw;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function filenameFromDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const star = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1]);
    } catch {
      /* fall through */
    }
  }
  const plain = header.match(/filename="?([^";]+)"?/i);
  return plain?.[1]?.trim() || fallback;
}

function colorOsFromWarningHeader(res: Response) {
  const warning = headerText(res, "X-ColorOS-Warning");
  if (!warning) return undefined;
  return {
    ok: false as const,
    issues: warning.split("; ").filter(Boolean),
    exifByteOrder: null,
  };
}

export async function checkBackendHealth(baseUrl: string): Promise<BackendHealth> {
  const root = normalizeBaseUrl(baseUrl);
  try {
    const res = await fetch(`${root}/api/health`, {
      method: "GET",
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) {
      return { ok: false, status: "error", error: `HTTP ${res.status}` };
    }
    const data = (await res.json()) as {
      status?: string;
      version?: string;
      gexiv2?: BackendHealth["gexiv2"];
    };
    const gexiv2 = data.gexiv2;
    const available = gexiv2?.available === true;
    return {
      ok: available,
      status: data.status ?? "ok",
      version: data.version,
      gexiv2,
      error: available
        ? undefined
        : `本地服务不可用（需 copy-img-meta、PyGObject 或 ExifTool）`,
    };
  } catch (e) {
    return {
      ok: false,
      status: "offline",
      error: (e as Error).message ?? String(e),
    };
  }
}

export async function copyImageMetadataViaBackend(
  destFile: File,
  sourceFile: File,
  options: CopyMetadataOptions,
  baseUrl: string,
): Promise<CopyMetadataResult> {
  validateCopyOptions(options);
  const root = normalizeBaseUrl(baseUrl);
  const form = new FormData();
  form.append("source", sourceFile, sourceFile.name);
  form.append("dest", destFile, destFile.name);
  form.append("exclude_exif", String(options.excludeExif ?? false));
  form.append("exclude_xmp", String(options.excludeXmp ?? false));
  form.append("exclude_iptc", String(options.excludeIptc ?? false));

  const res = await fetch(`${root}/api/copy-metadata`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const err = (await res.json()) as { detail?: string };
      if (err.detail) detail = err.detail;
    } catch {
      const text = await res.text().catch(() => "");
      if (text) detail = text.slice(0, 400);
    }
    throw new Error(detail);
  }

  const bytes = new Uint8Array(await res.arrayBuffer());
  const dot = destFile.name.lastIndexOf(".");
  const fallbackName =
    dot > 0 ? `${destFile.name.slice(0, dot)}-meta${destFile.name.slice(dot)}` : `${destFile.name}-meta.jpg`;

  return {
    bytes,
    sourceFieldCount: headerInt(res, "X-Source-Field-Count"),
    xmpPacketCount: 0,
    sourceMake: headerText(res, "X-Source-Make"),
    sourceModel: headerText(res, "X-Source-Model"),
    outputMake: headerText(res, "X-Output-Make"),
    outputModel: headerText(res, "X-Output-Model"),
    outputExifCount: headerInt(res, "X-Output-Exif-Count"),
    destPreservedFormat: true,
    downloadName: filenameFromDisposition(res.headers.get("Content-Disposition"), fallbackName),
    backendUsed: headerText(res, "X-Backend-Used") ?? headerText(res, "X-Backend"),
  };
}

export async function editSourceMetadataViaBackend(
  file: File,
  referenceBundle: NativeMetadataBundle,
  edits: NativeMetadataBundle,
  baseUrl: string,
): Promise<EditMetadataResult> {
  if (!hasMetadataEdits(referenceBundle, edits)) {
    throw new Error("请先修改至少一项元数据");
  }

  const writeBundle = dirtyBundleForWrite(referenceBundle, edits);
  const root = normalizeBaseUrl(baseUrl);
  const form = new FormData();
  form.append("file", file, file.name);
  form.append("edits", JSON.stringify(writeBundle));

  const res = await fetch(`${root}/api/edit-metadata`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const err = (await res.json()) as { detail?: string };
      if (err.detail) detail = err.detail;
    } catch {
      const text = await res.text().catch(() => "");
      if (text) detail = text.slice(0, 400);
    }
    throw new Error(detail);
  }

  const bytes = new Uint8Array(await res.arrayBuffer());
  const dot = file.name.lastIndexOf(".");
  const fallbackName =
    dot > 0 ? `${file.name.slice(0, dot)}-edited${file.name.slice(dot)}` : `${file.name}-edited.jpg`;

  return {
    bytes,
    mime: file.type || "application/octet-stream",
    downloadName: filenameFromDisposition(res.headers.get("Content-Disposition"), fallbackName),
    fieldsWritten: headerInt(res, "X-Source-Field-Count"),
    colorOsExif: colorOsFromWarningHeader(res),
  };
}
