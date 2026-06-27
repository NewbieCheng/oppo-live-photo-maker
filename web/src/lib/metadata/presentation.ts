import type { PresentationOptions } from "./types";

/** Compute MotionPhoto presentation timestamp (microseconds). */
export function computePresentationTimestampUs(opts: PresentationOptions): number {
  if (opts.userSet && opts.userOverrideUs !== undefined) {
    return Math.max(0, Math.round(opts.userOverrideUs));
  }
  if (opts.referenceTimestampUs !== undefined && opts.referenceTimestampUs >= 0) {
    return Math.round(opts.referenceTimestampUs);
  }
  if (opts.coverMode === "videoFrame") {
    return Math.max(0, Math.round((opts.coverTime - opts.start) * 1_000_000));
  }
  return 0;
}
