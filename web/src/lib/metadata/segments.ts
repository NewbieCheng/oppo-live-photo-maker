/** JPEG APP segment helpers (copy-img-meta style block transplant). */

export function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let i = 0;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
}

export interface JpegSegment {
  marker: number;
  payload: Uint8Array;
  start: number;
  end: number;
}

/** Iterate JPEG markers after SOI. */
export function scanJpegSegments(jpeg: Uint8Array): JpegSegment[] {
  if (jpeg.length < 2 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) {
    throw new Error("Not a JPEG: missing SOI marker");
  }
  const segments: JpegSegment[] = [];
  let i = 2;
  const n = jpeg.length;
  while (i < n - 1) {
    while (i < n && jpeg[i] === 0xff && i + 1 < n && jpeg[i + 1] === 0xff) i++;
    if (i >= n - 1 || jpeg[i] !== 0xff) break;
    const marker = jpeg[i + 1];
    const start = i;
    if (marker === 0xda || marker === 0xd9) {
      segments.push({ marker, payload: jpeg.subarray(i), start, end: n });
      break;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      segments.push({ marker, payload: new Uint8Array([0xff, marker]), start, end: i + 2 });
      i += 2;
      continue;
    }
    if (i + 4 > n) break;
    const segLen = (jpeg[i + 2] << 8) | jpeg[i + 3];
    if (segLen < 2 || i + 2 + segLen > n) break;
    const end = i + 2 + segLen;
    segments.push({
      marker,
      payload: jpeg.subarray(i, end),
      start,
      end,
    });
    i = end;
  }
  return segments;
}

function isExifApp1(seg: JpegSegment): boolean {
  if (seg.marker !== 0xe1 || seg.payload.length < 6) return false;
  const sig = new TextDecoder("ascii").decode(seg.payload.subarray(4, 10));
  return sig.startsWith("Exif");
}

function isIptcApp13(seg: JpegSegment): boolean {
  if (seg.marker !== 0xed || seg.payload.length < 16) return false;
  const sig = new TextDecoder("ascii").decode(seg.payload.subarray(4, 18));
  return sig.startsWith("Photoshop 3.0");
}

function isMotionXmpApp1(seg: JpegSegment): boolean {
  if (seg.marker !== 0xe1 || seg.payload.length < 30) return false;
  const text = new TextDecoder("latin1").decode(seg.payload);
  return (
    text.includes("http://ns.adobe.com/xap/1.0/") &&
    (text.includes("GCamera:MotionPhoto") ||
      text.includes("GCamera:MicroVideo") ||
      text.includes("OpCamera:MotionPhotoOwner") ||
      text.includes("Container:Directory"))
  );
}

function isMpfApp2(seg: JpegSegment): boolean {
  if (seg.marker !== 0xe2 || seg.payload.length < 8) return false;
  const sig = new TextDecoder("ascii").decode(seg.payload.subarray(4, 8));
  return sig === "MPF\0";
}

/** Extract EXIF APP1, IPTC APP13, and benign XMP APP1 from reference JPEG. */
export function extractTransplantableSegments(referenceJpeg: Uint8Array): {
  exifApp1: Uint8Array | null;
  iptcApp13: Uint8Array | null;
  extraApp1: Uint8Array[];
} {
  const segments = scanJpegSegments(referenceJpeg);
  let exifApp1: Uint8Array | null = null;
  let iptcApp13: Uint8Array | null = null;
  const extraApp1: Uint8Array[] = [];

  for (const seg of segments) {
    if (isExifApp1(seg)) {
      exifApp1 = seg.payload;
    } else if (isIptcApp13(seg)) {
      iptcApp13 = seg.payload;
    } else if (seg.marker === 0xe1 && !isMotionXmpApp1(seg)) {
      const text = new TextDecoder("latin1").decode(seg.payload);
      if (text.includes("http://ns.adobe.com/xap/1.0/")) {
        extraApp1.push(seg.payload);
      }
    }
  }
  return { exifApp1, iptcApp13, extraApp1 };
}

/** Remove APP1/APP2 metadata segments; keep image data intact. */
export function stripMetadataSegments(jpeg: Uint8Array): Uint8Array {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) {
    throw new Error("Not a JPEG: missing SOI marker");
  }
  const out: number[] = [0xff, 0xd8];
  for (const seg of scanJpegSegments(jpeg)) {
    if (seg.marker === 0xda) {
      for (let k = seg.start; k < jpeg.length; k++) out.push(jpeg[k]);
      return new Uint8Array(out);
    }
    if (seg.marker === 0xe1 || seg.marker === 0xe2) {
      if (isMpfApp2(seg)) continue;
      if (seg.marker === 0xe1) continue;
    }
    for (let k = seg.start; k < seg.end; k++) out.push(jpeg[k]);
  }
  return jpeg;
}

/** Insert segments after SOI / existing APPn, before DQT/SOF/SOS. */
export function insertAfterAppSegments(jpeg: Uint8Array, insert: Uint8Array[]): Uint8Array {
  const segments = scanJpegSegments(jpeg);
  let insertAt = 2;
  for (const seg of segments) {
    if (seg.marker >= 0xe0 && seg.marker <= 0xef) {
      insertAt = seg.end;
    } else {
      break;
    }
  }
  const parts = [jpeg.subarray(0, insertAt), ...insert, jpeg.subarray(insertAt)];
  return concat(...parts);
}
