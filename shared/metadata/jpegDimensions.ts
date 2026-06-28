/**
 * Read encoded image dimensions from JPEG SOF markers (no decode).
 */
export function readJpegDimensions(jpeg: Uint8Array): { width: number; height: number } | null {
  let i = 2;
  while (i < jpeg.length - 1) {
    if (jpeg[i] !== 0xff) {
      i++;
      continue;
    }
    const m = jpeg[i + 1];
    if (m === 0xd9 || m === 0xda) break;
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
      i += 2;
      continue;
    }
    if (
      (m >= 0xc0 && m <= 0xc3) ||
      (m >= 0xc5 && m <= 0xc7) ||
      (m >= 0xc9 && m <= 0xcb) ||
      (m >= 0xcd && m <= 0xcf)
    ) {
      if (i + 8 >= jpeg.length) return null;
      const height = (jpeg[i + 5] << 8) | jpeg[i + 6];
      const width = (jpeg[i + 7] << 8) | jpeg[i + 8];
      if (width > 0 && height > 0) return { width, height };
      return null;
    }
    if (i + 3 >= jpeg.length) break;
    const len = (jpeg[i + 2] << 8) | jpeg[i + 3];
    if (len < 2) break;
    i += 2 + len;
  }
  return null;
}
