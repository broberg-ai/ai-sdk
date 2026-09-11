// F055.2 — the ZIP reader is proven against ZIPs this test BUILDS, so it is verified
// offline even though the network call that fetches the archive is not.
import { describe, expect, test } from "bun:test";
import { deflateRawSync } from "node:zlib";
import { readZipEntry, listZipEntries } from "./zip.js";

/** Build a real ZIP. Both methods, because Azure's archive mixes them: a .wav is stored
 *  (already compressed audio), a .json is deflated. */
function buildZip(files: { name: string; data: Uint8Array; deflate: boolean }[]): Uint8Array {
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const f of files) {
    const nameBytes = new TextEncoder().encode(f.name);
    const body = f.deflate ? new Uint8Array(deflateRawSync(f.data)) : f.data;
    const method = f.deflate ? 8 : 0;

    const local = new Uint8Array(30 + nameBytes.length + body.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, method, true);
    lv.setUint32(18, body.length, true); // compressed size
    lv.setUint32(22, f.data.length, true); // uncompressed size
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true); // extra len
    local.set(nameBytes, 30);
    local.set(body, 30 + nameBytes.length);
    locals.push(local);

    const cen = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, method, true);
    cv.setUint32(20, body.length, true);
    cv.setUint32(24, f.data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true); // local header offset
    cen.set(nameBytes, 46);
    central.push(cen);

    offset += local.length;
  }

  const cenSize = central.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cenSize, true);
  ev.setUint32(16, offset, true);

  const total = offset + cenSize + eocd.length;
  const out = new Uint8Array(total);
  let p = 0;
  for (const l of locals) { out.set(l, p); p += l.length; }
  for (const c of central) { out.set(c, p); p += c.length; }
  out.set(eocd, p);
  return out;
}

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

// Microsoft's own documented word.json example, verbatim.
const WORD_JSON = JSON.stringify([
  { Text: "The", AudioOffset: 50, Duration: 137 },
  { Text: "rainbow", AudioOffset: 200, Duration: 350 },
  { Text: ".", AudioOffset: 1700, Duration: 100 },
]);

describe("F055.2 — the ZIP reader", () => {
  test("reads a DEFLATED entry — the shape Azure's word.json arrives in", () => {
    const zip = buildZip([
      { name: "0001.wav", data: enc("RIFF....fake audio"), deflate: false },
      { name: "0001.word.json", data: enc(WORD_JSON), deflate: true },
      { name: "summary.json", data: enc('{"status":"Succeeded"}'), deflate: true },
    ]);
    expect(dec(readZipEntry(zip, "0001.word.json")!)).toBe(WORD_JSON);
    // …and round-trips to the real objects, not just to a matching string.
    expect(JSON.parse(dec(readZipEntry(zip, "0001.word.json")!))[1]).toEqual({
      Text: "rainbow", AudioOffset: 200, Duration: 350,
    });
  });

  test("reads a STORED entry — audio is already compressed, so Azure stores it", () => {
    const audio = enc("RIFF....fake audio");
    const zip = buildZip([{ name: "0001.wav", data: audio, deflate: false }]);
    expect(readZipEntry(zip, "0001.wav")).toEqual(audio);
  });

  test("a MISSING entry is undefined, not a throw", () => {
    // An archive synthesised without wordBoundaryEnabled genuinely has no word.json.
    // That is an answer, not a failure — the caller decides what it means.
    const zip = buildZip([{ name: "0001.wav", data: enc("x"), deflate: false }]);
    expect(readZipEntry(zip, "0001.word.json")).toBeUndefined();
  });

  test("listZipEntries names what IS there — so the error can say why", () => {
    // "0001.word.json not found" is a dead end. "the archive holds 0001.wav,
    // summary.json" tells the reader that boundaries were never requested.
    const zip = buildZip([
      { name: "0001.wav", data: enc("x"), deflate: false },
      { name: "summary.json", data: enc("{}"), deflate: true },
    ]);
    expect(listZipEntries(zip)).toEqual(["0001.wav", "summary.json"]);
  });

  test("the right entry is read when several share a prefix", () => {
    // 0001.word.json and 0001.wav both start "0001.w" — a prefix match would take either.
    const zip = buildZip([
      { name: "0001.wav", data: enc("AUDIO"), deflate: false },
      { name: "0001.word.json", data: enc("WORDS"), deflate: true },
      { name: "0001.sentence.json", data: enc("SENTENCES"), deflate: true },
    ]);
    expect(dec(readZipEntry(zip, "0001.word.json")!)).toBe("WORDS");
    expect(dec(readZipEntry(zip, "0001.wav")!)).toBe("AUDIO");
  });

  test("a NON-ZIP body throws, naming what it is — not a silent empty result", () => {
    // The likely real-world case: the SAS URL returned an HTML error page. An empty
    // result there would read as "no word boundaries" and send the reader hunting in
    // the wrong place.
    expect(() => readZipEntry(enc("<html>403 Forbidden</html>"), "0001.word.json")).toThrow(/not a ZIP archive/);
  });

  test("an unsupported compression method throws rather than returning bytes", () => {
    const zip = buildZip([{ name: "a.txt", data: enc("hello"), deflate: false }]);
    // Rewrite the method to 12 (bzip2) in BOTH headers.
    const v = new DataView(zip.buffer);
    v.setUint16(8, 12, true); // local
    const eocdAt = zip.length - 22;
    const cenOffset = v.getUint32(eocdAt + 16, true);
    v.setUint16(cenOffset + 10, 12, true); // central
    expect(() => readZipEntry(zip, "a.txt")).toThrow(/unsupported compression method 12/);
  });
});
