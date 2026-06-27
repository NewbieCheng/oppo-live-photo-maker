import { describe, expect, it } from "vitest";
import { detectReferenceFormat, isHeicFamily, isJpegFormat } from "./imageFormat";

function file(name: string, type = ""): File {
  return new File([new Uint8Array(8)], name, { type });
}

describe("detectReferenceFormat", () => {
  it("detects HEIC by extension", () => {
    expect(detectReferenceFormat(file("IMG20260627124620.heic"))).toBe("heic");
    expect(detectReferenceFormat(file("photo.heif"))).toBe("heif");
  });

  it("detects JPEG and PNG", () => {
    expect(detectReferenceFormat(file("ref.JPG"))).toBe("jpeg");
    expect(detectReferenceFormat(file("ref.jpeg"))).toBe("jpeg");
    expect(detectReferenceFormat(file("ref.png", "image/png"))).toBe("png");
  });

  it("detects HEIC by mime", () => {
    expect(detectReferenceFormat(file("x", "image/heic"))).toBe("heic");
  });
});

describe("format helpers", () => {
  it("classifies HEIC family", () => {
    expect(isHeicFamily("heic")).toBe(true);
    expect(isHeicFamily("heif")).toBe(true);
    expect(isHeicFamily("jpeg")).toBe(false);
  });

  it("classifies JPEG", () => {
    expect(isJpegFormat("jpeg")).toBe(true);
    expect(isJpegFormat("heic")).toBe(false);
  });
});
