import { describe, expect, it } from "vitest";
import { applySourceMetadataEdits, buildSyntheticReferenceJpeg } from "./apply";
import { emptyBundle, mergeBundles } from "./fields";
import {
  buildEffectiveSourceBundle,
  computeDirtyKeys,
  hasMetadataEdits,
  sourceEditsForCopy,
} from "./sourceMetadataEdits";

describe("sourceMetadataEdits", () => {
  const reference = {
    exif: { Make: "OPPO", Model: "Find X7", FNumber: "1.8" },
    iptc: { Keywords: "test" },
  };

  it("computeDirtyKeys detects changed EXIF and IPTC fields", () => {
    const edits = {
      exif: { Make: "Edited", FNumber: "1.8" },
      iptc: { Keywords: "new" },
    };
    const dirty = computeDirtyKeys(reference, edits);
    expect(dirty.has("exif:Make")).toBe(true);
    expect(dirty.has("exif:FNumber")).toBe(false);
    expect(dirty.has("iptc:Keywords")).toBe(true);
  });

  it("buildEffectiveSourceBundle merges reference with edits", () => {
    const edits = { exif: { Make: "Edited" }, iptc: {} };
    const merged = buildEffectiveSourceBundle(reference, edits);
    expect(merged.exif.Make).toBe("Edited");
    expect(merged.exif.Model).toBe("Find X7");
  });

  it("sourceEditsForCopy returns undefined when nothing changed", () => {
    expect(sourceEditsForCopy(reference, emptyBundle())).toBeUndefined();
    expect(hasMetadataEdits(reference, emptyBundle())).toBe(false);
  });

  it("sourceEditsForCopy returns merged bundle when user edited", () => {
    const edits = { exif: { Model: "Find X8 Ultra" }, iptc: {} };
    const out = sourceEditsForCopy(reference, edits);
    expect(out?.exif.Make).toBe("OPPO");
    expect(out?.exif.Model).toBe("Find X8 Ultra");
  });
});

describe("applySourceMetadataEdits", () => {
  it("overrides Make/Model on copied JPEG bytes", () => {
    const source = buildSyntheticReferenceJpeg({
      exif: { Make: "SourceMake", Model: "SourceModel" },
      iptc: {},
    });
    const patched = applySourceMetadataEdits(source, {
      exif: { Make: "EditedMake", Model: "EditedModel" },
      iptc: {},
    });
    const text = new TextDecoder("latin1").decode(patched);
    expect(text).toContain("EditedMake");
    expect(text).toContain("EditedModel");
  });

  it("overrides Make/Model on minimal JPEG without prior EXIF", () => {
    function tinyJpeg(): Uint8Array {
      function seg(marker: number, payload: Uint8Array): Uint8Array {
        const out = new Uint8Array(2 + 2 + payload.length);
        out[0] = 0xff;
        out[1] = marker;
        const len = payload.length + 2;
        out[2] = (len >> 8) & 0xff;
        out[3] = len & 0xff;
        out.set(payload, 4);
        return out;
      }
      const app0 = seg(0xe0, new TextEncoder().encode("JFIF\0\x01\x01\x00\x00\x01\x00\x01\x00\x00"));
      const dqt = seg(0xdb, new Uint8Array(64).fill(16));
      const parts = [new Uint8Array([0xff, 0xd8]), app0, dqt, new Uint8Array([0xff, 0xd9])];
      const total = parts.reduce((n, p) => n + p.length, 0);
      const out = new Uint8Array(total);
      let i = 0;
      for (const p of parts) {
        out.set(p, i);
        i += p.length;
      }
      return out;
    }
    const source = tinyJpeg();
    const patched = applySourceMetadataEdits(source, {
      exif: { Make: "EditedMake", Model: "EditedModel" },
      iptc: {},
    });
    const text = new TextDecoder("latin1").decode(patched);
    expect(text).toContain("EditedMake");
    expect(text).toContain("EditedModel");
  });

  it("no-ops when bundle has no fields", () => {
    const source = buildSyntheticReferenceJpeg({
      exif: { Make: "X" },
      iptc: {},
    });
    const out = applySourceMetadataEdits(source, emptyBundle());
    expect(out).toBe(source);
  });
});

describe("mergeBundles with cleared edit keys", () => {
  it("keeps reference when edit removes a key", () => {
    const reference = { exif: { Make: "OPPO" }, iptc: {} };
    const edits = { exif: {}, iptc: {} };
    expect(mergeBundles(reference, edits).exif.Make).toBe("OPPO");
  });
});
