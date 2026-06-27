import type { Exiv2Module } from "exiv2-wasm";
import type { CopyMetadataOptions } from "@shared/copyContract.js";

const EXIF_PREFIX = "Exif.";
const IPTC_PREFIX = "Iptc.";
const XMP_PREFIX = "Xmp.";

function isObjectRecord(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

function flattenMetadata(
  tree: Record<string, unknown> | undefined,
  prefix: string,
): string[] {
  if (!tree) return [];
  const keys: string[] = [];
  for (const [k, v] of Object.entries(tree)) {
    const full = `${prefix}${k}`;
    if (isObjectRecord(v)) {
      keys.push(...flattenMetadata(v, `${full}.`));
    } else {
      keys.push(full);
    }
  }
  return keys;
}

function collectKeys(meta: ReturnType<Exiv2Module["read"]>, options: CopyMetadataOptions): string[] {
  const keys: string[] = [];
  if (!options.excludeExif) {
    keys.push(...flattenMetadata(meta.exif as Record<string, unknown> | undefined, EXIF_PREFIX));
  }
  if (!options.excludeIptc) {
    keys.push(...flattenMetadata(meta.iptc as Record<string, unknown> | undefined, IPTC_PREFIX));
  }
  if (!options.excludeXmp) {
    keys.push(...flattenMetadata(meta.xmp as Record<string, unknown> | undefined, XMP_PREFIX));
  }
  return keys;
}

/** Known binary tags that must use readTagBytes/writeBytes. */
const BINARY_TAG_HINTS = [
  "Exif.MakerNote",
  "Exif.Photo.MakerNote",
  "Exif.Photo.UserComment",
];

function preferBytes(key: string): boolean {
  return BINARY_TAG_HINTS.some((h) => key.includes("MakerNote") || key === h) || key.includes("UserComment");
}

/**
 * Copy metadata from source to dest using exiv2-wasm (non-JPEG sources).
 * Matches copy-img-meta semantics: preserve dest pixels, overwrite metadata groups.
 */
export function copyViaExiv2Wasm(
  exiv2: Exiv2Module,
  sourceBytes: Uint8Array,
  destBytes: Uint8Array,
  options: CopyMetadataOptions = {},
): Uint8Array {
  const meta = exiv2.read(sourceBytes);
  const keys = collectKeys(meta, options);
  if (keys.length === 0) return destBytes;

  let out = destBytes;
  for (const key of keys) {
    try {
      if (preferBytes(key)) {
        const bytes = exiv2.readTagBytes(sourceBytes, key);
        if (bytes && bytes.length > 0) {
          out = exiv2.writeBytes(out, key, bytes);
        }
        continue;
      }
      const text = exiv2.readTagText(sourceBytes, key);
      if (text != null && text !== "") {
        out = exiv2.writeString(out, key, text);
      }
    } catch {
      /* skip unsupported tag on dest format */
    }
  }
  return out;
}
