import type { MetadataWriteBundle } from "@shared/bundleToExiftoolArgs.js";
import { mergeBundles } from "./fields";
import { bundleHasEditableFields } from "./parse";
import type { NativeMetadataBundle } from "./types";

export function metadataFieldKey(key: string, iptc = false): string {
  return iptc ? `iptc:${key}` : `exif:${key}`;
}

export function xmpFieldKey(
  section: "gcamera" | "opcamera" | "container" | "hdrgm",
  key: string,
): string {
  return `xmp:${section}:${key}`;
}

function xmpContainerForWrite(
  container: { gainMapLength?: string; videoLength?: string } | undefined,
): { gainMapLength?: number; videoLength?: number } | undefined {
  if (!container) return undefined;
  const gainMapLength =
    container.gainMapLength != null && container.gainMapLength !== ""
      ? Number(container.gainMapLength)
      : undefined;
  const videoLength =
    container.videoLength != null && container.videoLength !== ""
      ? Number(container.videoLength)
      : undefined;
  return {
    gainMapLength: Number.isFinite(gainMapLength!) ? gainMapLength : undefined,
    videoLength: Number.isFinite(videoLength!) ? videoLength : undefined,
  };
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
    if (edits.xmp?.gcamera) {
      for (const key of Object.keys(edits.xmp.gcamera)) {
        dirty.add(xmpFieldKey("gcamera", key));
      }
    }
    if (edits.xmp?.opcamera) {
      for (const key of Object.keys(edits.xmp.opcamera)) {
        dirty.add(xmpFieldKey("opcamera", key));
      }
    }
    if (edits.xmp?.container) {
      for (const key of Object.keys(edits.xmp.container)) {
        if (edits.xmp.container[key as keyof typeof edits.xmp.container]) {
          dirty.add(xmpFieldKey("container", key));
        }
      }
    }
    if (edits.xmp?.hdrgm?.version) dirty.add(xmpFieldKey("hdrgm", "version"));
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

  for (const section of ["gcamera", "opcamera"] as const) {
    const editedSection = edits.xmp?.[section] ?? {};
    const refSection = reference.xmp?.[section] ?? {};
    for (const key of new Set([...Object.keys(editedSection), ...Object.keys(refSection)])) {
      const edited = editedSection[key] ?? "";
      const original = refSection[key] ?? "";
      if (edited !== original) dirty.add(xmpFieldKey(section, key));
    }
  }

  for (const key of ["gainMapLength", "videoLength"] as const) {
    const edited = edits.xmp?.container?.[key] ?? "";
    const original = reference.xmp?.container?.[key] ?? "";
    if (edited !== original) dirty.add(xmpFieldKey("container", key));
  }

  const editedHdr = edits.xmp?.hdrgm?.version ?? "";
  const refHdr = reference.xmp?.hdrgm?.version ?? "";
  if (editedHdr !== refHdr) dirty.add(xmpFieldKey("hdrgm", "version"));

  if (
    reference.xmp?.mode != null &&
    edits.xmp?.mode != null &&
    edits.xmp.mode !== reference.xmp.mode
  ) {
    dirty.add("xmp:mode");
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

/** Only changed fields for in-place metadata write (Feature 3). */
export function dirtyBundleForWrite(
  reference: NativeMetadataBundle,
  edits: NativeMetadataBundle,
): MetadataWriteBundle {
  const dirtyKeys = computeDirtyKeys(reference, edits);
  const exif: Record<string, string> = {};
  const iptc: Record<string, string> = {};

  for (const key of dirtyKeys) {
    if (key.startsWith("exif:")) {
      const field = key.slice(5);
      const value = edits.exif[field] ?? reference.exif[field];
      if (value) exif[field] = value;
    } else if (key.startsWith("iptc:")) {
      const field = key.slice(5);
      const value = edits.iptc[field] ?? reference.iptc[field];
      if (value) iptc[field] = value;
    }
  }

  const merged = mergeBundles(reference, edits);
  const bundle: MetadataWriteBundle = {
    exif,
    iptc,
    xmp: merged.xmp
      ? {
          gcamera: { ...merged.xmp.gcamera },
          opcamera: { ...merged.xmp.opcamera },
          container: xmpContainerForWrite(merged.xmp.container),
          hdrgm: { ...merged.xmp.hdrgm },
          mode: merged.xmp.mode,
        }
      : undefined,
  };

  if (dirtyKeys.has("presentationTimestampUs")) {
    bundle.presentationTimestampUs =
      edits.presentationTimestampUs ?? reference.presentationTimestampUs;
  }

  return bundle;
}
