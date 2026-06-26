/**
 * OPPO MotionPhoto muxer (browser, pure TS — no exiftool dependency).
 *
 * Produces the same byte layout as the Python implementation:
 *
 *   [JPEG:
 *      SOI
 *      APP1 (EXIF with UserComment = "Oplus_8388608")
 *      APP1 (XMP — GCamera + OpCamera + Container/Item)
 *      APP2 (MPF — NumberOfImages = 1, Baseline MP Primary)
 *      ... rest of original JPEG ...
 *      EOI ]
 *   [ MP4 trailer ]
 */

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

// ---------- JPEG segment scanner ------------------------------------------

/**
 * Find a safe offset to insert APPn segments: right after SOI + any existing
 * APPn segments, before the first DQT/DHT/SOF/SOS marker.
 *
 * Mirrors the Python ``_find_app_insertion_point``.
 */
function findInsertionPoint(jpeg: Uint8Array): number {
  if (jpeg.length < 2 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) {
    throw new Error("Not a JPEG: missing SOI marker");
  }
  let i = 2;
  let lastAppEnd = 2;
  const n = jpeg.length;
  while (i < n - 1) {
    // Allow legal 0xFF padding before the next marker.
    while (i < n && jpeg[i] === 0xff && i + 1 < n && jpeg[i + 1] === 0xff) {
      i++;
    }
    if (i >= n - 1 || jpeg[i] !== 0xff) return lastAppEnd;
    const marker = jpeg[i + 1];
    if (marker === 0xda || marker === 0xd9) return lastAppEnd; // SOS / EOI
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return lastAppEnd; // SOF
    }
    if (marker === 0xdb || marker === 0xc4) return lastAppEnd; // DQT / DHT
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      // Standalone marker (TEM / RSTn) — no length bytes.
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

/** Strip any existing APP1/APP2 (EXIF/XMP/MPF) segments so re-muxing stays clean. */
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
      // From SOS onward copy the rest verbatim (entropy-coded data + EOI).
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
    // Drop APP1 (EXIF/XMP) and APP2 (MPF / FlashPix). Keep everything else.
    if (marker !== 0xe1 && marker !== 0xe2) {
      for (let k = i; k < i + 2 + segLen; k++) out.push(jpeg[k]);
    }
    i += 2 + segLen;
  }
  // Fallback (truncated input): return as-is.
  return jpeg;
}

// ---------- EXIF (UserComment = Oplus_8388608) ----------------------------

/**
 * Build a minimal APP1 EXIF segment containing only the UserComment tag set
 * to "Oplus_8388608" (ASCII). OPPO Photos requires this marker.
 */
function buildExifApp1(): Uint8Array {
  // 8-byte UserComment character-code prefix, ASCII variant.
  const ASCII_PREFIX = enc.encode("ASCII\0\0\0");
  const COMMENT = enc.encode("Oplus_8388608");
  const userCommentValue = concat(ASCII_PREFIX, COMMENT);

  // TIFF header (little-endian, IFD at offset 8).
  const tiff: number[] = [
    0x49, 0x49, 0x2a, 0x00,
    0x08, 0x00, 0x00, 0x00,
  ];

  // IFD0: 1 entry pointing to Exif IFD.
  const ifdEntries = (entries: { tag: number; type: number; count: number; value: Uint8Array }[]) => {
    // Each entry is 12 bytes: tag(2) type(2) count(4) value-or-offset(4).
    const out: number[] = [];
    out.push(entries.length & 0xff, (entries.length >> 8) & 0xff);
    for (const e of entries) {
      out.push(e.tag & 0xff, (e.tag >> 8) & 0xff);
      out.push(e.type & 0xff, (e.type >> 8) & 0xff);
      const c = e.count;
      out.push(c & 0xff, (c >> 8) & 0xff, (c >> 16) & 0xff, (c >> 24) & 0xff);
      for (let k = 0; k < 4; k++) out.push(e.value[k] || 0);
    }
    out.push(0, 0, 0, 0); // next IFD = 0
    return out;
  };

  // Layout offsets (from start of TIFF header):
  //   0..7   TIFF header
  //   8..    IFD0 (one entry, 12B + 2B count + 4B next = 18B)
  //   26..   Exif IFD (one entry: UserComment)
  //   ...    UserComment data
  const IFD0_OFFSET = 8;
  const EXIF_IFD_OFFSET = IFD0_OFFSET + 2 + 12 + 4; // = 26
  const userCommentDataOffset = EXIF_IFD_OFFSET + 2 + 12 + 4; // entries(2) + 1 entry(12) + next(4)

  // IFD0 entry: ExifOffset (0x8769), LONG, count=1, value=offset to Exif IFD.
  const u32le = (n: number): Uint8Array => {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, n, true);
    return b;
  };
  const ifd0 = ifdEntries([
    { tag: 0x8769, type: 4, count: 1, value: u32le(EXIF_IFD_OFFSET) },
  ]);

  // Exif IFD entry: UserComment (0x9286), UNDEFINED(7), count = bytes,
  //   value = offset to data block.
  const ucBytes = userCommentValue.length;
  const exifIfd = ifdEntries([
    { tag: 0x9286, type: 7, count: ucBytes, value: u32le(userCommentDataOffset) },
  ]);

  const tiffBlock = concat(
    new Uint8Array(tiff),
    new Uint8Array(ifd0),
    new Uint8Array(exifIfd),
    userCommentValue,
  );

  // APP1 segment: marker + length + "Exif\0\0" + TIFF block.
  const exifHeader = enc.encode("Exif\0\0");
  // Length is BIG ENDIAN even though the TIFF inside is little-endian.
  const segBody = concat(exifHeader, tiffBlock);
  const segLen = segBody.length + 2;
  return concat(new Uint8Array([0xff, 0xe1]), writeU16BE(segLen), segBody);
}

// ---------- XMP packet ----------------------------------------------------

export interface XmpFields {
  videoLength: number; // bytes
  presentationTimestampUs?: number;
}

function buildXmpPacket(fields: XmpFields): string {
  const ts = fields.presentationTimestampUs ?? 0;
  const len = fields.videoLength;
  // GContainer Item structures live in their own namespace.
  return (
    `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>\n` +
    `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="oppo-live-photo-web">\n` +
    ` <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n` +
    `  <rdf:Description rdf:about=""\n` +
    `    xmlns:GCamera="http://ns.google.com/photos/1.0/camera/"\n` +
    `    xmlns:OpCamera="http://ns.oplus.com/photos/1.0/camera/"\n` +
    `    xmlns:Container="http://ns.google.com/photos/1.0/container/"\n` +
    `    xmlns:Item="http://ns.google.com/photos/1.0/container/item/"\n` +
    `    GCamera:MotionPhoto="1"\n` +
    `    GCamera:MotionPhotoVersion="1"\n` +
    `    GCamera:MotionPhotoPresentationTimestampUs="${ts}"\n` +
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

const XMP_NS_URI = "http://ns.adobe.com/xap/1.0/\0"; // 29 bytes incl. null

function buildXmpApp1(fields: XmpFields): Uint8Array {
  const xmp = buildXmpPacket(fields);
  const xmpBytes = enc.encode(xmp);
  const headerBytes = enc.encode(XMP_NS_URI);
  const body = concat(headerBytes, xmpBytes);
  // APP1 segment max payload is 65533. A single XMP fits comfortably here.
  if (body.length > 65533) {
    throw new Error("XMP packet exceeds APP1 size limit (extended XMP not supported)");
  }
  const segLen = body.length + 2;
  return concat(new Uint8Array([0xff, 0xe1]), writeU16BE(segLen), body);
}

// ---------- MPF (Multi-Picture Format) APP2 segment -----------------------

function buildMpfSegment(imageSize: number): Uint8Array {
  // Big-endian TIFF header, IFD at offset 8.
  const tiff = new Uint8Array([0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08]);

  const entries: number[] = [];
  // 0xB000 MPFVersion, UNDEFINED(7), count=4, value="0100"
  entries.push(0xb0, 0x00, 0x00, 0x07);
  entries.push(0, 0, 0, 4);
  entries.push(0x30, 0x31, 0x30, 0x30);
  // 0xB001 NumberOfImages, LONG(4), count=1, value=1
  entries.push(0xb0, 0x01, 0x00, 0x04);
  entries.push(0, 0, 0, 1);
  entries.push(0, 0, 0, 1);
  // 0xB002 MPEntry, UNDEFINED(7), count=16, value=offset to MP entry block
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
  ifd.push(0, 3); // 3 entries (BE)
  ifd.push(...entries);
  ifd.push(0, 0, 0, 0); // next IFD = 0

  // MP entry data: image attribute (Baseline Primary) + size + 8 zero bytes.
  const mpEntry = new Uint8Array(16);
  const dv = new DataView(mpEntry.buffer);
  dv.setUint32(0, 0x00030000, false); // image attr
  dv.setUint32(4, imageSize, false);
  // dv[8..15] left zero (offset + dependent images).

  const body = concat(enc.encode("MPF\0"), tiff, new Uint8Array(ifd), mpEntry);
  const segLen = body.length + 2;
  return concat(new Uint8Array([0xff, 0xe2]), writeU16BE(segLen), body);
}

// ---------- Public API ----------------------------------------------------

export interface MuxOptions {
  presentationTimestampUs?: number;
}

export interface OPPOMetadata {
  gCameraMotionPhoto: string;
  gCameraMotionPhotoVersion: string;
  presentationTimestampUs: number;
  motionPhotoOwner: string;
  oLivePhotoVersion: string;
  videoLength: number;
  motionPhotoFeatureFlag: string;
}

/**
 * Combine a JPEG cover + an MP4 clip into an OPPO MotionPhoto JPEG.
 *
 * Returns `{ buffer, metadata }` containing the raw JPEG+MP4 bytes and
 * a structured metadata object for display.
 */
export function buildOppoMotionPhoto(
  coverJpeg: Uint8Array,
  videoMp4: Uint8Array,
  options: MuxOptions = {},
): { buffer: Uint8Array; metadata: OPPOMetadata } {
  const cleanJpeg = stripExistingMetadata(coverJpeg);
  const exif = buildExifApp1();
  const xmp = buildXmpApp1({
    videoLength: videoMp4.length,
    presentationTimestampUs: options.presentationTimestampUs ?? 0,
  });

  // Inject EXIF + XMP first (right after SOI), then re-scan to place the MPF
  // segment after them. The MPF length depends on the final JPEG size, but
  // its byte length is constant, so we can size it before computing.
  const insAfterSoi = findInsertionPoint(cleanJpeg);
  const withMeta = concat(
    cleanJpeg.subarray(0, insAfterSoi),
    exif,
    xmp,
    cleanJpeg.subarray(insAfterSoi),
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

  const ts = options.presentationTimestampUs ?? 0;
  const metadata: OPPOMetadata = {
    gCameraMotionPhoto: "1",
    gCameraMotionPhotoVersion: "1",
    presentationTimestampUs: ts,
    motionPhotoOwner: "oplus",
    oLivePhotoVersion: "2",
    videoLength: videoMp4.length,
    motionPhotoFeatureFlag: "1",
  };

  return { buffer: concat(finalJpeg, videoMp4), metadata };
}

// Internal helpers exported for tests.
export const _internal = {
  findInsertionPoint,
  stripExistingMetadata,
  buildMpfSegment,
  buildExifApp1,
  buildXmpApp1,
  buildXmpPacket,
};
