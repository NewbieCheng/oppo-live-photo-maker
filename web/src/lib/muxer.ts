/**
 * OPPO MotionPhoto muxer (browser, pure TS — no exiftool dependency).
 *
 *   [JPEG: SOI + APP1 EXIF + APP1 XMP + optional APP2 MPF + ... + EOI]
 *   [ MP4 trailer ]
 */
import {
  buildMotionPhotoXmpApp1,
  buildMotionPhotoXmpPacket,
  rebuildMotionPhotoXmpInJpeg,
  type MotionPhotoXmpMode,
} from "@shared/motionPhotoXmp";
import { isExifApp1, scanJpegSegments } from "@shared/segments";

export { rebuildMotionPhotoXmpInJpeg };

const enc = new TextEncoder();
const DEFAULT_USER_COMMENT = "Oplus_8388608";

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let i = 0;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
}

function writeU16BE(value: number): Uint8Array {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, value, false);
  return b;
}

function findInsertionPoint(jpeg: Uint8Array): number {
  if (jpeg.length < 2 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) {
    throw new Error("Not a JPEG: missing SOI marker");
  }
  let i = 2;
  let lastAppEnd = 2;
  const n = jpeg.length;
  while (i < n - 1) {
    while (i < n && jpeg[i] === 0xff && i + 1 < n && jpeg[i + 1] === 0xff) {
      i++;
    }
    if (i >= n - 1 || jpeg[i] !== 0xff) return lastAppEnd;
    const marker = jpeg[i + 1];
    if (marker === 0xda || marker === 0xd9) return lastAppEnd;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return lastAppEnd;
    }
    if (marker === 0xdb || marker === 0xc4) return lastAppEnd;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    if (i + 4 > n) return lastAppEnd;
    const segLen = (jpeg[i + 2] << 8) | jpeg[i + 3];
    if (segLen < 2 || i + 2 + segLen > n) return lastAppEnd;
    i += 2 + segLen;
    lastAppEnd = i;
  }
  return lastAppEnd;
}

function stripExistingMetadata(jpeg: Uint8Array): Uint8Array {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) {
    throw new Error("Not a JPEG: missing SOI marker");
  }
  const out: number[] = [0xff, 0xd8];
  let i = 2;
  const n = jpeg.length;
  while (i < n - 1) {
    while (i < n && jpeg[i] === 0xff && i + 1 < n && jpeg[i + 1] === 0xff) i++;
    if (i >= n - 1 || jpeg[i] !== 0xff) break;
    const marker = jpeg[i + 1];
    if (marker === 0xda || marker === 0xd9) {
      for (let k = i; k < n; k++) out.push(jpeg[k]);
      return new Uint8Array(out);
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      out.push(0xff, marker);
      i += 2;
      continue;
    }
    if (i + 4 > n) break;
    const segLen = (jpeg[i + 2] << 8) | jpeg[i + 3];
    if (segLen < 2 || i + 2 + segLen > n) break;
    if (marker !== 0xe1 && marker !== 0xe2) {
      for (let k = i; k < i + 2 + segLen; k++) out.push(jpeg[k]);
    }
    i += 2 + segLen;
  }
  return jpeg;
}

/** Keep rich EXIF from cover when metadata was applied before mux. */
function extractExifApp1Segment(jpeg: Uint8Array): Uint8Array | null {
  for (const seg of scanJpegSegments(jpeg)) {
    if (isExifApp1(seg)) return seg.payload.slice();
  }
  return null;
}

function buildExifApp1(userComment = DEFAULT_USER_COMMENT): Uint8Array {
  const ASCII_PREFIX = enc.encode("ASCII\0\0\0");
  const COMMENT = enc.encode(userComment);
  const userCommentValue = concat(ASCII_PREFIX, COMMENT);

  const tiff: number[] = [0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00];

  const ifdEntries = (entries: { tag: number; type: number; count: number; value: Uint8Array }[]) => {
    const out: number[] = [];
    out.push(entries.length & 0xff, (entries.length >> 8) & 0xff);
    for (const e of entries) {
      out.push(e.tag & 0xff, (e.tag >> 8) & 0xff);
      out.push(e.type & 0xff, (e.type >> 8) & 0xff);
      const c = e.count;
      out.push(c & 0xff, (c >> 8) & 0xff, (c >> 16) & 0xff, (c >> 24) & 0xff);
      for (let k = 0; k < 4; k++) out.push(e.value[k] || 0);
    }
    out.push(0, 0, 0, 0);
    return out;
  };

  const IFD0_OFFSET = 8;
  const EXIF_IFD_OFFSET = IFD0_OFFSET + 2 + 12 + 4;
  const userCommentDataOffset = EXIF_IFD_OFFSET + 2 + 12 + 4;

  const u32le = (n: number): Uint8Array => {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, n, true);
    return b;
  };
  const ifd0 = ifdEntries([{ tag: 0x8769, type: 4, count: 1, value: u32le(EXIF_IFD_OFFSET) }]);
  const ucBytes = userCommentValue.length;
  const exifIfd = ifdEntries([{ tag: 0x9286, type: 7, count: ucBytes, value: u32le(userCommentDataOffset) }]);

  const tiffBlock = concat(
    new Uint8Array(tiff),
    new Uint8Array(ifd0),
    new Uint8Array(exifIfd),
    userCommentValue,
  );

  const exifHeader = enc.encode("Exif\0\0");
  const segBody = concat(exifHeader, tiffBlock);
  const segLen = segBody.length + 2;
  return concat(new Uint8Array([0xff, 0xe1]), writeU16BE(segLen), segBody);
}

function buildMpfSegment(imageSize: number): Uint8Array {
  const tiff = new Uint8Array([0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08]);
  const entries: number[] = [];
  entries.push(0xb0, 0x00, 0x00, 0x07);
  entries.push(0, 0, 0, 4);
  entries.push(0x30, 0x31, 0x30, 0x30);
  entries.push(0xb0, 0x01, 0x00, 0x04);
  entries.push(0, 0, 0, 1);
  entries.push(0, 0, 0, 1);
  const mpEntryOffset = 8 + 2 + 3 * 12 + 4;
  entries.push(0xb0, 0x02, 0x00, 0x07);
  entries.push(0, 0, 0, 16);
  entries.push(
    (mpEntryOffset >> 24) & 0xff,
    (mpEntryOffset >> 16) & 0xff,
    (mpEntryOffset >> 8) & 0xff,
    mpEntryOffset & 0xff,
  );

  const ifd: number[] = [];
  ifd.push(0, 3);
  ifd.push(...entries);
  ifd.push(0, 0, 0, 0);

  const mpEntry = new Uint8Array(16);
  const dv = new DataView(mpEntry.buffer);
  dv.setUint32(0, 0x00030000, false);
  dv.setUint32(4, imageSize, false);

  const body = concat(enc.encode("MPF\0"), tiff, new Uint8Array(ifd), mpEntry);
  const segLen = body.length + 2;
  return concat(new Uint8Array([0xff, 0xe2]), writeU16BE(segLen), body);
}

export interface MuxOptions {
  presentationTimestampUs?: number;
  xmpMode?: MotionPhotoXmpMode;
  gainMapLength?: number;
  hdrgmVersion?: string;
  userComment?: string;
  /** Legacy compat: insert APP2 MPF (OPPO native live photos typically omit MPF). */
  includeMpf?: boolean;
}

export function buildOppoMotionPhoto(
  coverJpeg: Uint8Array,
  videoMp4: Uint8Array,
  options: MuxOptions = {},
): Uint8Array {
  const preservedExif = extractExifApp1Segment(coverJpeg);
  const cleanJpeg = stripExistingMetadata(coverJpeg);
  const exif =
    preservedExif ?? buildExifApp1(options.userComment ?? DEFAULT_USER_COMMENT);
  const xmp = buildMotionPhotoXmpApp1({
    videoLength: videoMp4.length,
    presentationTimestampUs: options.presentationTimestampUs ?? 0,
    mode: options.xmpMode ?? "native",
    gainMapLength: options.gainMapLength,
    hdrgmVersion: options.hdrgmVersion,
  });

  const insAfterSoi = findInsertionPoint(cleanJpeg);
  let withMeta = concat(
    cleanJpeg.subarray(0, insAfterSoi),
    exif,
    xmp,
    cleanJpeg.subarray(insAfterSoi),
  );

  if (options.includeMpf) {
    const dummyMpf = buildMpfSegment(0);
    const finalSize = withMeta.length + dummyMpf.length;
    const mpf = buildMpfSegment(finalSize);
    if (mpf.length !== dummyMpf.length) {
      throw new Error("MPF segment size shifted during build");
    }
    const insAfterMeta = findInsertionPoint(withMeta);
    withMeta = concat(withMeta.subarray(0, insAfterMeta), mpf, withMeta.subarray(insAfterMeta));
  }

  return concat(withMeta, videoMp4);
}

export const _internal = {
  findInsertionPoint,
  stripExistingMetadata,
  buildMpfSegment,
  buildExifApp1,
  buildMotionPhotoXmpApp1,
  buildMotionPhotoXmpPacket,
};
