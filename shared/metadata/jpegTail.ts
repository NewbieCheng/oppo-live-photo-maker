/** Split MotionPhoto / live.jpg (JPEG + appended MP4) for metadata-only passes. */

function hasMp4FtypNear(bytes: Uint8Array, offset: number): boolean {
  const scanEnd = Math.min(offset + 64, bytes.length - 4);
  for (let i = offset; i <= scanEnd; i++) {
    if (
      bytes[i] === 0x66 &&
      bytes[i + 1] === 0x74 &&
      bytes[i + 2] === 0x79 &&
      bytes[i + 3] === 0x70
    ) {
      return true;
    }
  }
  return false;
}

/** Last 0xFFD9 in file (unsafe when MP4 tail contains false EOI markers). */
export function splitAfterLastJpegEoi(bytes: Uint8Array): {
  jpeg: Uint8Array;
  trailing: Uint8Array;
} {
  for (let i = bytes.length - 2; i >= 0; i--) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0xd9) {
      return {
        jpeg: bytes.subarray(0, i + 2),
        trailing: bytes.subarray(i + 2),
      };
    }
  }
  return { jpeg: bytes, trailing: new Uint8Array(0) };
}

/**
 * Split JPEG from appended MP4 tail.
 * OPPO live photos place MP4 immediately after the first real EOI; the tail often
 * contains false 0xFFD9 bytes, so we must not use the last EOI in the file.
 */
export function splitJpegAndAppendedTail(bytes: Uint8Array): {
  jpeg: Uint8Array;
  trailing: Uint8Array;
} {
  for (let i = 2; i < bytes.length - 1; i++) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0xd9) {
      const afterEoi = i + 2;
      if (afterEoi < bytes.length && hasMp4FtypNear(bytes, afterEoi)) {
        return {
          jpeg: bytes.subarray(0, afterEoi),
          trailing: bytes.subarray(afterEoi),
        };
      }
    }
  }
  return splitAfterLastJpegEoi(bytes);
}

export function concatBytes(head: Uint8Array, tail: Uint8Array): Uint8Array {
  if (tail.length === 0) return head;
  const out = new Uint8Array(head.length + tail.length);
  out.set(head, 0);
  out.set(tail, head.length);
  return out;
}

export function hasLikelyAppendedMp4(trailing: Uint8Array): boolean {
  if (trailing.length < 8) return false;
  const scan = trailing.subarray(0, Math.min(64, trailing.length));
  for (let i = 0; i <= scan.length - 4; i++) {
    if (
      scan[i] === 0x66 &&
      scan[i + 1] === 0x74 &&
      scan[i + 2] === 0x79 &&
      scan[i + 3] === 0x70
    ) {
      return true;
    }
  }
  return trailing.length > 4096;
}
