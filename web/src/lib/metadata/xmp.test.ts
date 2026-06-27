import { describe, expect, it } from "vitest";
import {
  buildXmpApp1Segment,
  extractRawXmpPackets,
  filterXmpPackets,
} from "./xmp";

describe("extractRawXmpPackets", () => {
  it("finds xpacket-wrapped XMP in binary", () => {
    const xmp =
      '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>' +
      '<x:xmpmeta><rdf:RDF><rdf:Description dc:test="hello"/></rdf:RDF></x:xmpmeta>' +
      '<?xpacket end="w"?>';
    const bytes = new TextEncoder().encode(`prefix${xmp}suffix`);
    const found = extractRawXmpPackets(bytes);
    expect(found.length).toBeGreaterThan(0);
    expect(found[0]).toContain("dc:test");
  });

  it("finds bare x:xmpmeta blocks", () => {
    const xml = '<x:xmpmeta xmlns:x="adobe:ns:meta/"><marker>HEIC-XMP</marker></x:xmpmeta>';
    const bytes = new TextEncoder().encode(`noise${xml}tail`);
    const found = extractRawXmpPackets(bytes);
    expect(found.some((p) => p.includes("HEIC-XMP"))).toBe(true);
  });
});

describe("filterXmpPackets", () => {
  it("can exclude motion-photo XMP", () => {
    const motion = '<x:xmpmeta GCamera:MotionPhoto="1"></x:xmpmeta>';
    const plain = '<x:xmpmeta><dc:creator>me</dc:creator></x:xmpmeta>';
    const out = filterXmpPackets([motion, plain], { excludeMotion: true });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("dc:creator");
  });
});

describe("buildXmpApp1Segment", () => {
  it("produces valid APP1 marker", () => {
    const seg = buildXmpApp1Segment("<x:xmpmeta/>");
    expect(seg[0]).toBe(0xff);
    expect(seg[1]).toBe(0xe1);
    const text = new TextDecoder("latin1").decode(seg);
    expect(text).toContain("http://ns.adobe.com/xap/1.0/");
  });
});
