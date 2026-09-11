// F055.2 — a minimal ZIP reader, because Azure's batch synthesis returns results.zip
// and neither Node nor Bun ships one.
//
// Deliberately minimal: it reads the central directory and inflates the entries we ask
// for. No writing, no encryption, no ZIP64, no streaming. A dependency for this would be
// a third-party package in the hot path of a customer-facing feature, to do ~80 lines.
//
// This half IS fully testable offline — a test builds a ZIP with zlib and reads it back —
// which is the difference between it and the network call that fetches the archive.
import { inflateRawSync } from "node:zlib";

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;

/** Read one named entry out of a ZIP. Returns undefined when the name is not present.
 *
 *  `undefined` rather than a throw: a caller asking for `0001.word.json` in an archive
 *  synthesised WITHOUT `wordBoundaryEnabled` is not an error, it is the honest answer
 *  that the file was not requested. The caller decides what that means. */
export function readZipEntry(zip: Uint8Array, name: string): Uint8Array | undefined {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);

  // The end-of-central-directory record sits at the end, after a comment of unknown
  // length, so it is found by scanning backwards for its signature.
  let eocd = -1;
  for (let i = zip.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error("readZipEntry: not a ZIP archive (no end-of-central-directory record)");

  const entryCount = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true); // offset of the central directory

  for (let n = 0; n < entryCount; n++) {
    if (view.getUint32(p, true) !== CEN_SIG) {
      throw new Error(`readZipEntry: corrupt central directory at entry ${n}`);
    }
    const method = view.getUint16(p + 10, true);
    const compressedSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const entryName = new TextDecoder().decode(zip.subarray(p + 46, p + 46 + nameLen));

    if (entryName === name) {
      // The LOCAL header's name/extra lengths differ from the central one, so the data
      // offset must be read from the local header rather than assumed.
      const lNameLen = view.getUint16(localOffset + 26, true);
      const lExtraLen = view.getUint16(localOffset + 28, true);
      const start = localOffset + 30 + lNameLen + lExtraLen;
      const raw = zip.subarray(start, start + compressedSize);
      if (method === 0) return new Uint8Array(raw); // stored
      if (method === 8) return new Uint8Array(inflateRawSync(raw)); // deflate
      throw new Error(`readZipEntry: "${name}" uses unsupported compression method ${method}`);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return undefined;
}

/** Every entry name in the archive — for an error message that says what WAS there.
 *
 *  "0001.word.json not found" is a dead end; "not found; the archive holds 0001.wav,
 *  summary.json" tells the reader that word boundaries were never requested. */
export function listZipEntries(zip: Uint8Array): string[] {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let eocd = -1;
  for (let i = zip.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error("listZipEntries: not a ZIP archive (no end-of-central-directory record)");
  const entryCount = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const names: string[] = [];
  for (let n = 0; n < entryCount; n++) {
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    names.push(new TextDecoder().decode(zip.subarray(p + 46, p + 46 + nameLen)));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}
