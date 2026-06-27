/**
 * Tags eligible for writeMetadata (mirrors ExifTool -TagsFromFile -All:all semantics).
 * Read-only groups from -json -G1 are excluded.
 */
import { type CopyMetadataOptions } from "./copyContract";

const NON_COPYABLE_GROUPS = new Set([
  "ExifTool",
  "System",
  "File",
  "Composite",
  "QuickTime",
  "Meta",
]);

function tagGroup(key: string): string {
  return key.includes(":") ? key.split(":")[0]! : "";
}

function isNonCopyableGroup(group: string): boolean {
  if (!group) return true;
  if (NON_COPYABLE_GROUPS.has(group)) return true;
  if (group.startsWith("ICC")) return true;
  if (group === "IFD1") return true;
  return false;
}

function isCopyableGroup(group: string, options: CopyMetadataOptions): boolean {
  if (isNonCopyableGroup(group)) return false;

  const isXmp = group === "XMP" || group.startsWith("XMP-");
  const isIptc = group === "IPTC";
  const isExif =
    group === "EXIF" ||
    group === "IFD0" ||
    group === "ExifIFD" ||
    group === "GPS" ||
    group === "MakerNotes";

  if (options.excludeExif && isExif) return false;
  if (options.excludeIptc && isIptc) return false;
  if (options.excludeXmp && isXmp) return false;

  return isExif || isIptc || isXmp;
}

export function normalizeTagWriteValue(
  value: unknown,
): string | number | boolean | string[] | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) =>
      typeof item === "string" || typeof item === "number" || typeof item === "boolean"
        ? String(item)
        : String(item),
    );
  }
  return String(value);
}

/** Filter parsed -json tags to writable metadata only (for writeMetadata). */
export function filterWritableTags(
  tags: Record<string, unknown>,
  options: CopyMetadataOptions,
): Record<string, string | number | boolean | string[]> {
  const out: Record<string, string | number | boolean | string[]> = {};
  for (const [key, raw] of Object.entries(tags)) {
    if (key === "SourceFile" || key === "ExifToolVersion") continue;
    const group = tagGroup(key);
    if (!isCopyableGroup(group, options)) continue;
    const value = normalizeTagWriteValue(raw);
    if (value === undefined) continue;
    out[key] = value;
  }
  return out;
}
