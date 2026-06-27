/**
 * MotionPhoto XMP rebuild (GCamera MicroVideo, no APP2 MPF) — shared by backend.
 */
import { scanJpegSegments, stripXmpAndMpf } from "./segments.js";

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
    while (i < n && jpeg[i] === 0xff && i + 1 < n && jpeg[i + 1] === 0xff) i++;
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

interface XmpFields {
  videoLength: number;
  presentationTimestampUs?: number;
}

function buildXmpPacket(fields: XmpFields): string {
  const len = fields.videoLength;
  const ts = fields.presentationTimestampUs ?? 0;
  const tsMicro = Math.floor(ts / 1000);
  return (
    `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>\n` +
    `<x:xmpmeta xmlns:x="adobe:ns:meta/">\n` +
    ` <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n` +
    `  <rdf:Description rdf:about=""\n` +
    `    xmlns:GCamera="http://ns.google.com/photos/1.0/camera/"\n` +
    `    xmlns:OpCamera="http://ns.oplus.com/photos/1.0/camera/"\n` +
    `    xmlns:Container="http://ns.google.com/photos/1.0/container/"\n` +
    `    xmlns:Item="http://ns.google.com/photos/1.0/container/item/"\n` +
    `    GCamera:MotionPhoto="1"\n` +
    `    GCamera:MotionPhotoVersion="1"\n` +
    `    GCamera:MotionPhotoPresentationTimestampUs="${tsMicro}"\n` +
    `    GCamera:MicroVideoVersion="1"\n` +
    `    GCamera:MicroVideo="1"\n` +
    `    GCamera:MicroVideoOffset="${len}"\n` +
    `    GCamera:MicroVideoPresentationTimestampUs="${tsMicro}"\n` +
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
  const xmpBytes = enc.encode(buildXmpPacket(fields));
  const headerBytes = enc.encode(XMP_NS_URI);
  const body = concat(headerBytes, xmpBytes);
  if (body.length > 65533) {
    throw new Error("XMP packet exceeds APP1 size limit");
  }
  const segLen = body.length + 2;
  return concat(new Uint8Array([0xff, 0xe1]), writeU16BE(segLen), body);
}

export function rebuildMotionPhotoXmpInJpeg(
  jpeg: Uint8Array,
  videoLength: number,
  options: { presentationTimestampUs?: number } = {},
): Uint8Array {
  const baseJpeg = stripXmpAndMpf(jpeg);
  const xmp = buildXmpApp1({
    videoLength,
    presentationTimestampUs: options.presentationTimestampUs ?? 0,
  });
  const insAfterSoi = findInsertionPoint(baseJpeg);
  return concat(baseJpeg.subarray(0, insAfterSoi), xmp, baseJpeg.subarray(insAfterSoi));
}

/** @internal for tests */
export const _internal = { findInsertionPoint, buildXmpApp1, scanJpegSegments };
