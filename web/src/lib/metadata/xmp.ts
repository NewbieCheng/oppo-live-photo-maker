/** Extract and embed XMP APP1 segments (works on HEIC/PNG/JPEG binary). */

const XMP_NS_URI = "http://ns.adobe.com/xap/1.0/\0";
const MOTION_XMP_MARKERS = [
  "GCamera:MotionPhoto",
  "GCamera:MicroVideo",
  "OpCamera:MotionPhotoOwner",
  "Container:Directory",
  "MotionPhotoPresentationTimestampUs",
  "MicroVideoOffset",
];

function isMotionXmpPacket(xml: string): boolean {
  return MOTION_XMP_MARKERS.some((m) => xml.includes(m));
}

/** Scan file bytes for embedded XMP packets (format-agnostic). */
export function extractRawXmpPackets(bytes: Uint8Array): string[] {
  const found = new Set<string>();
  for (const encoding of ["utf-8", "latin1"] as const) {
    const text = new TextDecoder(encoding, { fatal: false }).decode(bytes);
    collectXmpPacketsFromText(text, found);
  }
  return [...found];
}

function collectXmpPacketsFromText(text: string, out: Set<string>): void {
  let idx = 0;
  while (idx < text.length) {
    const start = text.indexOf("<?xpacket begin", idx);
    if (start < 0) break;
    const end = text.indexOf("<?xpacket end=", start);
    if (end < 0) break;
    const endTag = text.indexOf("?>", end);
    if (endTag < 0) break;
    out.add(text.slice(start, endTag + 2));
    idx = endTag + 2;
  }

  idx = 0;
  while (idx < text.length) {
    const start = text.indexOf("<x:xmpmeta", idx);
    if (start < 0) break;
    const end = text.indexOf("</x:xmpmeta>", start);
    if (end < 0) break;
    const packet = text.slice(start, end + "</x:xmpmeta>".length);
    if (![...out].some((p) => p.includes(packet))) {
      out.add(packet);
    }
    idx = end + 12;
  }
}

export function filterXmpPackets(
  packets: string[],
  options: { excludeMotion?: boolean } = {},
): string[] {
  if (!options.excludeMotion) return packets;
  return packets.filter((p) => !isMotionXmpPacket(p));
}

/** Build a complete APP1 segment (0xFFE1) carrying an XMP packet. */
export function buildXmpApp1Segment(xmpXml: string): Uint8Array {
  const body = new TextEncoder().encode(XMP_NS_URI + xmpXml);
  if (body.length > 65533) {
    throw new Error("XMP 数据超过 APP1 段上限");
  }
  const segLen = body.length + 2;
  const out = new Uint8Array(4 + body.length);
  out[0] = 0xff;
  out[1] = 0xe1;
  out[2] = (segLen >> 8) & 0xff;
  out[3] = segLen & 0xff;
  out.set(body, 4);
  return out;
}
