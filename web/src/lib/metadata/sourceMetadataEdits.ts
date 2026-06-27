import { mergeBundles } from "./fields";
import { bundleHasEditableFields } from "./parse";
import type { NativeMetadataBundle } from "./types";

export function metadataFieldKey(key: string, iptc = false): string {
  return iptc ? `iptc:${key}` : `exif:${key}`;
}

/** Keys the user changed relative to the parsed source bundle. */
export function computeDirtyKeys(
  reference: NativeMetadataBundle | null,
  edits: NativeMetadataBundle,
): Set<string> {
  const dirty = new Set<string>();
  if (!reference) {
    for (const key of Object.keys(edits.exif)) dirty.add(metadataFieldKey(key));
    for (const key of Object.keys(edits.iptc)) dirty.add(metadataFieldKey(key, true));
    if (edits.presentationTimestampUserSet) dirty.add("presentationTimestampUs");
    return dirty;
  }

  for (const key of Object.keys(edits.exif)) {
    const edited = edits.exif[key] ?? "";
    const original = reference.exif[key] ?? "";
    if (edited !== original) dirty.add(metadataFieldKey(key));
  }
  for (const key of Object.keys(edits.iptc)) {
    const edited = edits.iptc[key] ?? "";
    const original = reference.iptc[key] ?? "";
    if (edited !== original) dirty.add(metadataFieldKey(key, true));
  }
  if (edits.presentationTimestampUserSet) {
    const edited = edits.presentationTimestampUs;
    const original = reference.presentationTimestampUs;
    if (edited !== original) dirty.add("presentationTimestampUs");
  }
  return dirty;
}

export function hasMetadataEdits(
  reference: NativeMetadataBundle | null,
  edits: NativeMetadataBundle,
): boolean {
  return computeDirtyKeys(reference, edits).size > 0;
}

/** Merge parsed source values with user edits for copy output patching. */
export function buildEffectiveSourceBundle(
  reference: NativeMetadataBundle,
  edits: NativeMetadataBundle,
): NativeMetadataBundle {
  return mergeBundles(reference, edits);
}

export function sourceEditsForCopy(
  reference: NativeMetadataBundle | null,
  edits: NativeMetadataBundle,
): NativeMetadataBundle | undefined {
  if (!reference || !hasMetadataEdits(reference, edits)) return undefined;
  const merged = buildEffectiveSourceBundle(reference, edits);
  return bundleHasEditableFields(merged) ? merged : undefined;
}
