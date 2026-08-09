// Pulls one file out of a zip without ever holding the zip in memory.
//
// The Apple Health export is a zip whose export.xml is routinely several
// hundred megabytes and can pass a gigabyte. Reading it the obvious way, into
// an ArrayBuffer, kills mobile Safari on the spot. So nothing here reads the
// archive as a whole: the directory is found by seeking to the end, and the
// entry itself is handed back as a stream that decompresses in flight.
//
// Only the parts of the zip format Apple actually emits are implemented —
// stored and deflated entries, with Zip64 for the archives that pass 4 GB.

const EOCD = 0x06054b50;
const EOCD64 = 0x06064b50;
const EOCD64_LOCATOR = 0x07064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

const STORED = 0;
const DEFLATED = 8;

/** The end-of-directory record sits after a comment of up to 64 KB. */
const TAIL = 66560;

export class ZipError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ZipError';
  }
}

async function view(blob, start, end) {
  const slice = blob.slice(Math.max(0, start), Math.min(blob.size, end));
  return new DataView(await slice.arrayBuffer());
}

/** Last offset in `dv` carrying `signature`, or -1. Searched backwards. */
function findSignature(dv, signature) {
  for (let i = dv.byteLength - 4; i >= 0; i--) {
    if (dv.getUint32(i, true) === signature) return i;
  }
  return -1;
}

/** Where the central directory starts, following the Zip64 record if present. */
async function directoryStart(file) {
  const tailStart = Math.max(0, file.size - TAIL);
  const tail = await view(file, tailStart, file.size);
  const eocd = findSignature(tail, EOCD);
  if (eocd < 0) throw new ZipError('That does not look like a zip file.');

  const entries = tail.getUint16(eocd + 10, true);
  const offset = tail.getUint32(eocd + 16, true);
  if (offset !== 0xffffffff && entries !== 0xffff) return { offset, entries };

  // Zip64. The locator sits immediately before the record just found.
  const locator = findSignature(
    new DataView(tail.buffer, tail.byteOffset, eocd), EOCD64_LOCATOR
  );
  if (locator < 0) throw new ZipError('Zip64 archive with no locator.');
  const at = Number(tail.getBigUint64(locator + 8, true));
  const head = await view(file, at, at + 56);
  if (head.getUint32(0, true) !== EOCD64) throw new ZipError('Zip64 directory not found.');
  return {
    offset: Number(head.getBigUint64(48, true)),
    entries: Number(head.getBigUint64(32, true))
  };
}

/**
 * Zip64 parks the real sizes in an extra field once the 32-bit ones are
 * saturated. The values appear in a fixed order, but only those that overflowed
 * are present, so each is read only when its 32-bit counterpart said 0xffffffff.
 */
function readZip64Extra(dv, start, length, entry) {
  let at = start;
  const end = start + length;
  while (at + 4 <= end) {
    const id = dv.getUint16(at, true);
    const size = dv.getUint16(at + 2, true);
    if (id === 0x0001) {
      let f = at + 4;
      if (entry.uncompressedSize === 0xffffffff) { entry.uncompressedSize = Number(dv.getBigUint64(f, true)); f += 8; }
      if (entry.compressedSize === 0xffffffff) { entry.compressedSize = Number(dv.getBigUint64(f, true)); f += 8; }
      if (entry.headerOffset === 0xffffffff) { entry.headerOffset = Number(dv.getBigUint64(f, true)); f += 8; }
      return;
    }
    at += 4 + size;
  }
}

/**
 * Every entry in the archive, name and location only.
 * @returns {Promise<Array<{name:string, method:number, compressedSize:number, uncompressedSize:number, headerOffset:number}>>}
 */
export async function listEntries(file) {
  const { offset, entries } = await directoryStart(file);
  // The whole directory at once. Even a huge export has a few hundred entries,
  // so this is kilobytes, not the archive.
  const dv = await view(file, offset, file.size);
  const decoder = new TextDecoder();
  const out = [];
  let at = 0;

  for (let i = 0; i < entries; i++) {
    if (at + 46 > dv.byteLength || dv.getUint32(at, true) !== CENTRAL) break;
    const nameLen = dv.getUint16(at + 28, true);
    const extraLen = dv.getUint16(at + 30, true);
    const commentLen = dv.getUint16(at + 32, true);
    const entry = {
      name: decoder.decode(new Uint8Array(dv.buffer, dv.byteOffset + at + 46, nameLen)),
      method: dv.getUint16(at + 10, true),
      compressedSize: dv.getUint32(at + 20, true),
      uncompressedSize: dv.getUint32(at + 24, true),
      headerOffset: dv.getUint32(at + 42, true)
    };
    readZip64Extra(dv, at + 46 + nameLen, extraLen, entry);
    out.push(entry);
    at += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/**
 * A stream of the entry's decompressed bytes.
 *
 * The local header repeats the name and carries its own extra field, and its
 * lengths are the ones that decide where the data begins — the central
 * directory's copy is not always the same size.
 */
export async function entryStream(file, entry) {
  const head = await view(file, entry.headerOffset, entry.headerOffset + 30);
  if (head.getUint32(0, true) !== LOCAL) throw new ZipError(`Entry ${entry.name} is not where the directory says.`);
  const start = entry.headerOffset + 30 + head.getUint16(26, true) + head.getUint16(28, true);
  const raw = file.slice(start, start + entry.compressedSize).stream();

  if (entry.method === STORED) return raw;
  if (entry.method !== DEFLATED) throw new ZipError(`${entry.name} uses an unsupported compression method.`);
  if (typeof DecompressionStream !== 'function') {
    throw new ZipError('This browser cannot unzip files. Safari 16.4 or newer can.');
  }
  return raw.pipeThrough(new DecompressionStream('deflate-raw'));
}

/** The named entry, matched on the end of its path. */
export function findEntry(entries, suffix) {
  return entries.find((e) => e.name.endsWith(suffix)) || null;
}
