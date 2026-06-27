import { describe, expect, it } from "vitest";
import { computePresentationTimestampUs } from "./presentation";

describe("computePresentationTimestampUs", () => {
  it("uses user override when set", () => {
    expect(
      computePresentationTimestampUs({
        coverMode: "videoFrame",
        coverTime: 2,
        start: 0,
        userOverrideUs: 999,
        userSet: true,
      }),
    ).toBe(999);
  });

  it("preserves reference timestamp when present", () => {
    expect(
      computePresentationTimestampUs({
        coverMode: "videoFrame",
        coverTime: 2,
        start: 0,
        referenceTimestampUs: 123456,
      }),
    ).toBe(123456);
  });

  it("computes from cover and start for video frame mode", () => {
    expect(
      computePresentationTimestampUs({
        coverMode: "videoFrame",
        coverTime: 1.5,
        start: 0.5,
      }),
    ).toBe(1_000_000);
  });

  it("returns zero for reference cover without timestamps", () => {
    expect(
      computePresentationTimestampUs({
        coverMode: "referenceImage",
        coverTime: 0,
        start: 0,
      }),
    ).toBe(0);
  });
});
