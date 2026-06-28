/**
 * MotionPhoto XMP rebuild — canonical builder (native + compat modes).
 */
import { scanJpegSegments, stripXmpAndMpf } from "./segments.js";

const enc = new TextEncoder();

export type MotionPhotoXmpMode = "native" | "compat";

export interface MotionPhotoXmpOptions {
  videoLength: number;
  presentationTimestampUs?: number;
  mode?: MotionPhotoXmpMode;
  gainMapLength?: number;
  hdrgmVersion?: string;
  motionPhotoOwner?: string;
  oLivePhotoVersion?: number;
  motionPhotoFeatureFlag?: number;
}

/** @deprecated Use MotionPhotoXmpOptions */
export interface XmpFields {
  videoLength: number;
  presentationTimestampUs?: number;
}

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

function containerItem(mime: string, semantic: string, length: number): string {
  return (
    `     <rdf:li rdf:parseType="Resource">\n` +
    `      <Container:Item rdf:parseType="Resource">\n` +
    `       <Item:Mime>${mime}</Item:Mime>\n` +
    `       <Item:Semantic>${semantic}</Item:Semantic>\n` +
    `       <Item:Length>${length}</Item:Length>\n` +
    `       <Item:Padding>0</Item:Padding>\n` +
    `      </Container:Item>\n` +
    `     </rdf:li>\n`
  );
}

/** Build MotionPhoto XMP packet XML (native or compat). */
export function buildMotionPhotoXmpPacket(options: MotionPhotoXmpOptions): string {
  const len = Math.max(0, options.videoLength);
  const ts = Math.max(0, options.presentationTimestampUs ?? 0);
  const mode = options.mode ?? "native";
  const owner = options.motionPhotoOwner ?? "oplus";
  const oLiveVer = options.oLivePhotoVersion ?? 2;
  const featureFlag = options.motionPhotoFeatureFlag ?? 1;
  const gainMapLen = Math.max(0, options.gainMapLength ?? 0);
  const hdrgmVersion = options.hdrgmVersion;

  const hdrgmNs = hdrgmVersion
    ? `    xmlns:hdrgm="http://ns.adobe.com/hdr-gain-map/1.0/"\n`
    : "";
  const hdrgmAttr = hdrgmVersion ? `    hdrgm:Version="${hdrgmVersion}"\n` : "";

  const microVideoAttrs =
    mode === "compat"
      ? (
          `    GCamera:MicroVideoVersion="1"\n` +
          `    GCamera:MicroVideo="1"\n` +
          `    GCamera:MicroVideoOffset="${len}"\n` +
          `    GCamera:MicroVideoPresentationTimestampUs="${ts}"\n`
        )
      : "";

  let containerItems = containerItem("image/jpeg", "Primary", 0);
  if (gainMapLen > 0) {
    containerItems += containerItem("image/jpeg", "GainMap", gainMapLen);
  }
  containerItems += containerItem("video/mp4", "MotionPhoto", len);

  return (
    `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>\n` +
    `<x:xmpmeta xmlns:x="adobe:ns:meta/">\n` +
    ` <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n` +
    `  <rdf:Description rdf:about=""\n` +
    hdrgmNs +
    `    xmlns:GCamera="http://ns.google.com/photos/1.0/camera/"\n` +
    `    xmlns:OpCamera="http://ns.oplus.com/photos/1.0/camera/"\n` +
    `    xmlns:Container="http://ns.google.com/photos/1.0/container/"\n` +
    `    xmlns:Item="http://ns.google.com/photos/1.0/container/item/"\n` +
    hdrgmAttr +
    `    GCamera:MotionPhoto="1"\n` +
    `    GCamera:MotionPhotoVersion="1"\n` +
    `    GCamera:MotionPhotoPresentationTimestampUs="${ts}"\n` +
    microVideoAttrs +
    `    OpCamera:MotionPhotoPrimaryPresentationTimestampUs="${ts}"\n` +
    `    OpCamera:MotionPhotoOwner="${owner}"\n` +
    `    OpCamera:OLivePhotoVersion="${oLiveVer}"\n` +
    `    OpCamera:VideoLength="${len}"\n` +
    `    OpCamera:MotionPhotoFeatureFlag="${featureFlag}">\n` +
    `   <Container:Directory>\n` +
    `    <rdf:Seq>\n` +
    containerItems +
    `    </rdf:Seq>\n` +
    `   </Container:Directory>\n` +
    `  </rdf:Description>\n` +
    ` </rdf:RDF>\n` +
    `</x:xmpmeta>\n` +
    `<?xpacket end="w"?>`
  );
}

const XMP_NS_URI = "http://ns.adobe.com/xap/1.0/\0";

/** Build APP1 segment carrying MotionPhoto XMP. */
export function buildMotionPhotoXmpApp1(options: MotionPhotoXmpOptions): Uint8Array {
  const xmpBytes = enc.encode(buildMotionPhotoXmpPacket(options));
  const headerBytes = enc.encode(XMP_NS_URI);
  const body = concat(headerBytes, xmpBytes);
  if (body.length > 65533) {
    throw new Error("XMP packet exceeds APP1 size limit");
  }
  const segLen = body.length + 2;
  return concat(new Uint8Array([0xff, 0xe1]), writeU16BE(segLen), body);
}

/** @deprecated Use buildMotionPhotoXmpApp1 */
function buildXmpApp1(fields: XmpFields): Uint8Array {
  return buildMotionPhotoXmpApp1({
    videoLength: fields.videoLength,
    presentationTimestampUs: fields.presentationTimestampUs,
    mode: "compat",
  });
}

/** Parse MotionPhoto-related values from existing XMP text (best-effort). */
export function parseMotionPhotoXmpFromText(xmpText: string): Partial<MotionPhotoXmpOptions> {
  const pick = (pattern: RegExp): string | undefined => {
    const m = xmpText.match(pattern);
    return m?.[1];
  };
  const pickNum = (pattern: RegExp): number | undefined => {
    const v = pick(pattern);
    if (v == null || v === "") return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };

  const videoLength = pickNum(/OpCamera:VideoLength="(\d+)"/);
  const ts =
    pickNum(/GCamera:MotionPhotoPresentationTimestampUs="(\d+)"/) ??
    pickNum(/OpCamera:MotionPhotoPrimaryPresentationTimestampUs="(\d+)"/);
  const gainMapMatch = xmpText.match(
    /Item:Semantic>GainMap<\/Item:Semantic>[\s\S]*?Item:Length>(\d+)</,
  );
  const gainMapLength = gainMapMatch ? Number(gainMapMatch[1]) : undefined;
  const hdrgmVersion = pick(/hdrgm:Version="([^"]+)"/);
  const motionPhotoOwner = pick(/OpCamera:MotionPhotoOwner="([^"]+)"/);
  const hasMicroVideo = /GCamera:MicroVideo="1"/.test(xmpText);

  return {
    videoLength,
    presentationTimestampUs: ts,
    gainMapLength: Number.isFinite(gainMapLength) ? gainMapLength : undefined,
    hdrgmVersion,
    motionPhotoOwner,
    mode: hasMicroVideo ? "compat" : "native",
    oLivePhotoVersion: pickNum(/OpCamera:OLivePhotoVersion="(\d+)"/),
    motionPhotoFeatureFlag: pickNum(/OpCamera:MotionPhotoFeatureFlag="(\d+)"/),
  };
}

export function rebuildMotionPhotoXmpInJpeg(
  jpeg: Uint8Array,
  videoLength: number,
  options: Omit<MotionPhotoXmpOptions, "videoLength"> = {},
): Uint8Array {
  const baseJpeg = stripXmpAndMpf(jpeg);

  let merged: MotionPhotoXmpOptions = {
    videoLength,
    mode: options.mode ?? "native",
    ...options,
  };

  for (const seg of scanJpegSegments(jpeg)) {
    if (seg.marker !== 0xe1) continue;
    const text = new TextDecoder("utf-8", { fatal: false }).decode(seg.payload);
    if (!text.includes("GCamera:MotionPhoto") && !text.includes("OpCamera:")) continue;
    const parsed = parseMotionPhotoXmpFromText(text);
    merged = {
      mode: options.mode ?? parsed.mode ?? "native",
      presentationTimestampUs:
        options.presentationTimestampUs ?? parsed.presentationTimestampUs ?? 0,
      gainMapLength: options.gainMapLength ?? parsed.gainMapLength,
      hdrgmVersion: options.hdrgmVersion ?? parsed.hdrgmVersion,
      motionPhotoOwner: options.motionPhotoOwner ?? parsed.motionPhotoOwner ?? "oplus",
      oLivePhotoVersion: options.oLivePhotoVersion ?? parsed.oLivePhotoVersion ?? 2,
      motionPhotoFeatureFlag: options.motionPhotoFeatureFlag ?? parsed.motionPhotoFeatureFlag ?? 1,
      videoLength,
    };
    break;
  }

  const xmp = buildMotionPhotoXmpApp1(merged);
  const insAfterSoi = findInsertionPoint(baseJpeg);
  return concat(baseJpeg.subarray(0, insAfterSoi), xmp, baseJpeg.subarray(insAfterSoi));
}

/** @internal for tests */
export const _internal = {
  findInsertionPoint,
  buildXmpApp1,
  buildMotionPhotoXmpPacket,
  buildMotionPhotoXmpApp1,
  scanJpegSegments,
  parseMotionPhotoXmpFromText,
};
