/** Minimal valid JPEG used as metadata canvas. */
export function minimalJpeg(): Uint8Array {
  function seg(marker: number, payload: Uint8Array): Uint8Array {
    const out = new Uint8Array(2 + 2 + payload.length);
    out[0] = 0xff;
    out[1] = marker;
    const len = payload.length + 2;
    out[2] = (len >> 8) & 0xff;
    out[3] = len & 0xff;
    out.set(payload, 4);
    return out;
  }

  const app0 = seg(
    0xe0,
    new Uint8Array([
      0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    ]),
  );
  const dqt = seg(0xdb, new Uint8Array(65).fill(0x10));
  const sos = seg(0xda, new Uint8Array([0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00]));
  const eoi = new Uint8Array([0xff, 0xd9]);
  const parts = [new Uint8Array([0xff, 0xd8]), app0, dqt, sos, eoi];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let i = 0;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
}
