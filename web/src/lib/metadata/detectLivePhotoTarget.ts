import { hasLikelyAppendedMp4, splitJpegAndAppendedTail } from "./jpegTail";

/** Filename suggests a MotionPhoto output (e.g. video.live.jpg). */
export function isLikelyLivePhotoFilename(name: string): boolean {
  const lower = name.toLowerCase();
  return /\.live\.jpe?g$/i.test(lower) || lower.includes(".live.");
}

/** JPEG bytes with an appended MP4 tail (MotionPhoto / live.jpg). */
export function isLikelyLivePhotoBytes(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  try {
    const { trailing } = splitJpegAndAppendedTail(bytes);
    return trailing.length > 0 && hasLikelyAppendedMp4(trailing);
  } catch {
    return false;
  }
}

export function isLikelyLivePhotoTarget(file: File, bytes: Uint8Array): boolean {
  return isLikelyLivePhotoFilename(file.name) || isLikelyLivePhotoBytes(bytes);
}
