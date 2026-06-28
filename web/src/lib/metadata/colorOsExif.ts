/**
 * ColorOS Hasselblad watermark — re-export shared validation + web resync helper.
 */
export {
  validateColorOsExif,
  needsColorOsExifResync,
  hasExifApp1Segment,
  hasMpfApp2Segment,
  type ColorOsExifValidation,
  type ColorOsExifValidateOptions,
} from "@shared/colorOsValidate";
export { readExifByteOrder, type ExifByteOrder } from "@shared/exifByteOrder";

import { needsColorOsExifResync, type ColorOsExifValidateOptions } from "@shared/colorOsValidate";
import { syncFullExifFromSource } from "./exiftoolWasmRunner";

type TagMap = Record<string, unknown>;

/** Re-sync full EXIF block from source when ColorOS-critical structure is missing. */
export async function ensureColorOsExifFromSource(
  jpeg: Uint8Array,
  sourceFile: File,
  tags: TagMap = {},
  options: { requireMakerNotes?: boolean } = {},
): Promise<Uint8Array> {
  if (!needsColorOsExifResync(jpeg, tags, options)) return jpeg;
  return syncFullExifFromSource(jpeg, sourceFile);
}

export type { ColorOsExifValidateOptions as ColorOsExifValidateOptionsWeb };
