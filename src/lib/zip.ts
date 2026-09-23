// Minimal ZIP reader/writer for .docx, no dependencies. Works in browsers and Node 18+.
// Reads stored + deflated entries (DecompressionStream); writes stored entries (docx doesn't need compression).

export type Files = Map<string, Uint8Array>;

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
export function crc32(data: Uint8Array) {
  let c = 0xffffffff;
  for (const b of data) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function inflateRaw(data: Uint8Array) {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function readZip(buf: ArrayBuffer | Uint8Array): Promise<Files> {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = bytes.length - 22;
  while (eocd >= 0 && v.getUint32(eocd, true) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('Not a zip file');
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const files: Files = new Map();
  for (let i = 0; i < count; i++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('Corrupt zip central directory');
    const method = v.getUint16(p + 10, true), size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true), extraLen = v.getUint16(p + 30, true), commentLen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const raw = bytes.subarray(start, start + size);
    if (method !== 0 && method !== 8) throw new Error(`Unsupported zip compression in ${name}`);
    files.set(name, method === 8 ? await inflateRaw(raw) : raw.slice());
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

export function writeZip(files: Files): Uint8Array {
  const enc = new TextEncoder(), locals: Uint8Array[] = [], centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [name, data] of files) {
    const n = enc.encode(name), crc = crc32(data);
    const head = (sig: number, central: boolean) => {
      const h = new Uint8Array((central ? 46 : 30) + n.length), d = new DataView(h.buffer);
      d.setUint32(0, sig, true);
      const o = central ? 6 : 4; // central header has an extra "version made by" field
      if (central) d.setUint16(4, 20, true);
      d.setUint16(o, 20, true); d.setUint16(o + 2, 0x0800, true); // version needed, UTF-8 names
      d.setUint16(o + 4, 0, true); d.setUint16(o + 6, 0, true); d.setUint16(o + 8, 0x21, true); // stored, 1980-01-01
      d.setUint32(o + 10, crc, true); d.setUint32(o + 14, data.length, true); d.setUint32(o + 18, data.length, true);
      d.setUint16(o + 22, n.length, true);
      if (central) d.setUint32(42, offset, true);
      h.set(n, central ? 46 : 30);
      return h;
    };
    const local = head(0x04034b50, false);
    centrals.push(head(0x02014b50, true));
    locals.push(local, data);
    offset += local.length + data.length;
  }
  const cdSize = centrals.reduce((a, c) => a + c.length, 0);
  const end = new Uint8Array(22), d = new DataView(end.buffer);
  d.setUint32(0, 0x06054b50, true); d.setUint16(8, files.size, true); d.setUint16(10, files.size, true);
  d.setUint32(12, cdSize, true); d.setUint32(16, offset, true);
  const out = new Uint8Array(offset + cdSize + 22);
  let p = 0;
  for (const part of [...locals, ...centrals, end]) { out.set(part, p); p += part.length; }
  return out;
}
