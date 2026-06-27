/**
 * OPPO MotionPhoto muxer (browser, pure TS — no exiftool dependency).
 *
 * Produces the same byte layout as the Python implementation:
 *
 *   [JPEG:
 *      SOI
 *      APP1 (EXIF — preserve source Make/Model + UserComment = "Oplus_8388608")
 *      APP1 (XMP — GCamera + OpCamera + Container/Item)
 *      APP2 (MPF — NumberOfImages = 1, Baseline MP Primary)
 *      ... rest of original JPEG ...
 *      EOI ]
 *   [ MP4 trailer ]
 *
 * Kept identical to Young-Spark/oppo-live-photo-maker upstream for feature-one reliability,
 * except EXIF camera tags are preserved when present (live-photo-conv / Python mux semantics).
 */

import piexif from "piexifjs";
import { insertAfterAppSegments, isExifApp1, scanJpegSegments, stripXmpAndMpf } from "./metadata/segments";

const enc = new TextEncoder();

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

function ensureOppoUserComment(jpeg: Uint8Array): Uint8Array {
  const hasExif = scanJpegSegments(jpeg).some((s) => isExifApp1(s));
  if (!hasExif) {
    return insertAfterAppSegments(jpeg, [buildExifApp1()]);
  }

  try {
    let binary = "";
    for (let i = 0; i < jpeg.length; i++) binary += String.fromCharCode(jpeg[i]);
    const dataUrl = `data:image/jpeg;base64,${btoa(binary)}`;
    const exifObj = piexif.load(dataUrl);
    if (!exifObj.Exif) exifObj.Exif = {};
    exifObj.Exif[piexif.ExifIFD.UserComment] = "ASCII\0\0\0Oplus_8388608";
    const dumped = piexif.dump(exifObj);
    const outUrl = piexif.insert(dumped, dataUrl);
    const comma = outUrl.indexOf(",");
    const outB64 = outUrl.slice(comma + 1);
    const raw = atob(outB64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  } catch {
    return insertAfterAppSegments(jpeg, [buildExifApp1()]);
  }
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

function buildExifApp1(): Uint8Array {
  const ASCII_PREFIX = enc.encode("ASCII\0\0\0");
  const COMMENT = enc.encode("Oplus_8388608");
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

export interface XmpFields {
  videoLength: number;
  presentationTimestampUs?: number;
}

function buildXmpPacket(fields: XmpFields): string {
  const ts = fields.presentationTimestampUs ?? 0;
  const tsMicro = ts === 0 ? -1 : ts;
  const len = fields.videoLength;
  return (
    `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>\n` +
    `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="oppo-live-photo-web">\n` +
    ` <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n` +
    `  <rdf:Description rdf:about=""\n` +
    `    xmlns:GCamera="http://ns.google.com/photos/1.0/camera/"\n` +
    `    xmlns:OpCamera="http://ns.oplus.com/photos/1.0/camera/"\n` +
    `    xmlns:Container="http://ns.google.com/photos/1.0/container/"\n` +
    `    xmlns:Item="http://ns.google.com/photos/1.0/container/item/"\n` +
    `    GCamera:MicroVideoVersion="1"\n` +
    `    GCamera:MicroVideo="1"\n` +
    `    GCamera:MicroVideoOffset="${len}"\n` +
    `    GCamera:MicroVideoPresentationTimestampUs="${tsMicro}"\n` +
    `    GCamera:MotionPhoto="1"\n` +
    `    GCamera:MotionPhotoVersion="1"\n` +
    `    GCamera:MotionPhotoPresentationTimestampUs="${tsMicro}"\n` +
    `    OpCamera:MotionPhotoPrimaryPresentationTimestampUs="${ts}"\n` +
    `    OpCamera:MotionPhotoOwner="oplus"\n` +
    `    OpCamera:OLivePhotoVersion="2"\n` +
    `    OpCamera:VideoLength="${len}"\n` +
    `    OpCamera:MotionPhotoFeatureFlag="1">\n` +
    `   <Container:Directory>\n` +
    `    <rdf:Seq>\n` +
    `     <rdf:li rdf:parseType="Resource">\n` +
    `      <Container:Item rdf:parseType="Resource">\n` +
    `       <Item:Mime>image/jpeg</Item:Mime>\n` +
    `       <Item:Semantic>Primary</Item:Semantic>\n` +
    `       <Item:Length>0</Item:Length>\n` +
    `       <Item:Padding>0</Item:Padding>\n` +
    `      </Container:Item>\n` +
    `     </rdf:li>\n` +
    `     <rdf:li rdf:parseType="Resource">\n` +
    `      <Container:Item rdf:parseType="Resource">\n` +
    `       <Item:Mime>video/mp4</Item:Mime>\n` +
    `       <Item:Semantic>MotionPhoto</Item:Semantic>\n` +
    `       <Item:Length>${len}</Item:Length>\n` +
    `       <Item:Padding>0</Item:Padding>\n` +
    `      </Container:Item>\n` +
    `     </rdf:li>\n` +
    `    </rdf:Seq>\n` +
    `   </Container:Directory>\n` +
    `  </rdf:Description>\n` +
    ` </rdf:RDF>\n` +
    `</x:xmpmeta>\n` +
    `<?xpacket end="w"?>`
  );
}

const XMP_NS_URI = "http://ns.adobe.com/xap/1.0/\0";

function buildXmpApp1(fields: XmpFields): Uint8Array {
  const xmp = buildXmpPacket(fields);
  const xmpBytes = enc.encode(xmp);
  const headerBytes = enc.encode(XMP_NS_URI);
  const body = concat(headerBytes, xmpBytes);
  if (body.length > 65533) {
    throw new Error("XMP packet exceeds APP1 size limit (extended XMP not supported)");
  }
  const segLen = body.length + 2;
  return concat(new Uint8Array([0xff, 0xe1]), writeU16BE(segLen), body);
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
}

/** Feature-one entry: video cover + clip → OPPO MotionPhoto (upstream-compatible). */
export function buildOppoMotionPhoto(
  coverJpeg: Uint8Array,
  videoMp4: Uint8Array,
  options: MuxOptions = {},
): Uint8Array {
  const baseJpeg = ensureOppoUserComment(stripXmpAndMpf(coverJpeg));
  const xmp = buildXmpApp1({
    videoLength: videoMp4.length,
    presentationTimestampUs: options.presentationTimestampUs ?? 0,
  });

  const insAfterSoi = findInsertionPoint(baseJpeg);
  const withMeta = concat(
    baseJpeg.subarray(0, insAfterSoi),
    xmp,
    baseJpeg.subarray(insAfterSoi),
  );

  const dummyMpf = buildMpfSegment(0);
  const finalSize = withMeta.length + dummyMpf.length;
  const mpf = buildMpfSegment(finalSize);
  if (mpf.length !== dummyMpf.length) {
    throw new Error("MPF segment size shifted during build");
  }

  const insAfterMeta = findInsertionPoint(withMeta);
  const finalJpeg = concat(
    withMeta.subarray(0, insAfterMeta),
    mpf,
    withMeta.subarray(insAfterMeta),
  );

  return concat(finalJpeg, videoMp4);
}

/**
 * Re-write MotionPhoto XMP on an existing JPEG (keep EXIF/IPTC).
 * Matches live-photo-conv GExiv2 export: GCamera MicroVideo + Container, no APP2 MPF.
 * Used after copy-img-meta on live.jpg so video size tags match appended MP4 tail.
 */
export function rebuildMotionPhotoXmpInJpeg(
  jpeg: Uint8Array,
  videoLength: number,
  options: MuxOptions = {},
): Uint8Array {
  const baseJpeg = stripXmpAndMpf(jpeg);
  const xmp = buildXmpApp1({
    videoLength,
    presentationTimestampUs: options.presentationTimestampUs ?? 0,
  });

  const insAfterSoi = findInsertionPoint(baseJpeg);
  return concat(
    baseJpeg.subarray(0, insAfterSoi),
    xmp,
    baseJpeg.subarray(insAfterSoi),
  );
}

export const _internal = {
  findInsertionPoint,
  stripExistingMetadata,
  stripXmpAndMpf,
  ensureOppoUserComment,
  buildMpfSegment,
  buildExifApp1,
  buildXmpApp1,
  buildXmpPacket,
};
