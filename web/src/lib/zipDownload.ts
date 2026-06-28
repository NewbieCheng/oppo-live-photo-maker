/** Minimal ZIP (store / no compression) for single-file browser downloads. */

const enc = new TextEncoder();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let j = 0; j < 8; j++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(n: number): Uint8Array {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n, true);
  return b;
}

function u32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, true);
  return b;
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

/** Pack one file into a ZIP archive (method 0 — preserves JPEG bytes exactly). */
export function createSingleFileZip(filename: string, data: Uint8Array): Uint8Array {
  const nameBytes = enc.encode(filename.replace(/\\/g, "/").split("/").pop() ?? "file");
  const checksum = crc32(data);
  const size = data.length;

  const localHeader = concat(
    u32(0x04034b50),
    u16(20),
    u16(0),
    u16(0),
    u16(0),
    u16(0),
    u32(checksum),
    u32(size),
    u32(size),
    u16(nameBytes.length),
    u16(0),
    nameBytes,
  );

  const localOffset = 0;
  const centralHeader = concat(
    u32(0x02014b50),
    u16(20),
    u16(20),
    u16(0),
    u16(0),
    u16(0),
    u16(0),
    u32(checksum),
    u32(size),
    u32(size),
    u16(nameBytes.length),
    u16(0),
    u16(0),
    u16(0),
    u16(0),
    u32(0),
    u32(localOffset),
    nameBytes,
  );

  const centralOffset = localHeader.length + data.length;
  const centralSize = centralHeader.length;

  const endRecord = concat(
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(1),
    u16(1),
    u32(centralSize),
    u32(centralOffset),
    u16(nameBytes.length),
  );

  return concat(localHeader, data, centralHeader, endRecord);
}

export function zipFilenameFor(fileName: string): string {
  const stem = fileName.replace(/\.[^.]+$/, "");
  return `${stem}.zip`;
}

export function triggerBrowserDownload(url: string, filename: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
