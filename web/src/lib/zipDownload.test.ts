import { describe, expect, it } from "vitest";
import { createSingleFileZip, zipFilenameFor } from "./zipDownload";

describe("createSingleFileZip", () => {
  it("produces valid local and central directory signatures", () => {
    const data = new TextEncoder().encode("hello live photo");
    const zip = createSingleFileZip("test.live.jpg", data);
    expect(zip[0]).toBe(0x50);
    expect(zip[1]).toBe(0x4b);
    expect(zip[2]).toBe(0x03);
    expect(zip[3]).toBe(0x04);
    const tail = zip.subarray(zip.length - 22);
    expect(tail[0]).toBe(0x50);
    expect(tail[1]).toBe(0x4b);
    expect(tail[2]).toBe(0x05);
    expect(tail[3]).toBe(0x06);
  });

  it("embeds file bytes unchanged after local header", () => {
    const data = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const zip = createSingleFileZip("x.jpg", data);
    const nameLen = zip[26] | (zip[27] << 8);
    const payloadStart = 30 + nameLen;
    expect(Array.from(zip.subarray(payloadStart, payloadStart + 4))).toEqual([0xff, 0xd8, 0xff, 0xd9]);
  });
});

describe("zipFilenameFor", () => {
  it("replaces extension with .zip", () => {
    expect(zipFilenameFor("clip.live.jpg")).toBe("clip.live.zip");
  });
});
