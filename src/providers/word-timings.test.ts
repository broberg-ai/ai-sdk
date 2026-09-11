// F055.1 — every case here is a trap the walk has to survive, not an illustration.
// The dictionary entries are cms's own, from the text broberg.ai actually reads aloud.
import { describe, expect, test } from "bun:test";
import { alignWordTimings, type AzureWordBoundary } from "./word-timings.js";

/** A boundary list with plausible timings; ORDER and Text are what the walk reads. */
const say = (...spoken: string[]): AzureWordBoundary[] =>
  spoken.map((Text, i) => ({ Text, AudioOffset: i * 200, Duration: 150 }));

describe("F055.1 — the walk goes FORWARD", () => {
  test("a repeated word lands on its OWN occurrence, not back on the first", () => {
    // The mutation this exists for: searching from 0 each time passes every test with
    // distinct words and fails silently on real prose, where repetition is the norm.
    const text = "AI er AI og AI";
    const a = alignWordTimings(text, say("AI", "er", "AI", "og", "AI"));
    expect(a.words.map((w) => w.sourceStart)).toEqual([0, 3, 6, 9, 12]);
    for (const w of a.words) {
      expect(text.slice(w.sourceStart, w.sourceEnd).toLowerCase()).toBe(w.text.toLowerCase());
    }
    expect(a.unaligned).toEqual([]);
  });

  test("offsets are strictly increasing — a highlighter cannot jump backwards", () => {
    const text = "Vi bruger AI til at skrive om AI hver dag";
    const a = alignWordTimings(text, say(...text.split(" ")));
    const starts = a.words.map((w) => w.sourceStart);
    expect(starts).toEqual([...starts].sort((x, y) => x - y));
    expect(new Set(starts).size).toBe(starts.length);
  });
});

describe("F055.1 — a substitution is a RUN, and that is not a refinement", () => {
  // Azure speaks SSML. `<sub alias='broberg punktum a i'>broberg.ai</sub>` puts FOUR
  // words in the boundary list where the manuscript has ONE. cms uses `pronunciations`
  // and wants word highlighting on the same text, so this fires on every article.
  const text = "Læs mere på broberg.ai i dag";
  const spoken = say("Læs", "mere", "på", "broberg", "punktum", "a", "i", "i", "dag");
  const dict = [{ word: "broberg.ai", alias: "broberg punktum a i" }];

  test("all four alias words point at the ONE manuscript word", () => {
    const a = alignWordTimings(text, spoken, { pronunciations: dict });
    const span = (w: { sourceStart: number; sourceEnd: number }) => text.slice(w.sourceStart, w.sourceEnd);
    expect(a.words.map((w) => [w.text, span(w)])).toEqual([
      ["Læs", "Læs"],
      ["mere", "mere"],
      ["på", "på"],
      ["broberg", "broberg.ai"],
      ["punktum", "broberg.ai"],
      ["a", "broberg.ai"],
      ["i", "broberg.ai"],
      ["i", "i"], // ← the real Danish word, NOT swallowed by the alias
      ["dag", "dag"],
    ]);
    expect(a.unaligned).toEqual([]);
  });

  test("THE BUG A LOOKUP TABLE HAS, measured: the alias's 'i' eats the next real 'i'", () => {
    // The first design used a flat spoken→source map. Danish alias parts are ordinary
    // words — "a", "i", "punktum" — so the map fired on the manuscript's OWN words after
    // the substitution had ended. Consuming the run positionally is what fixes it, and
    // this asserts the difference rather than describing it: the standalone "i" must map
    // to the standalone "i", never to broberg.ai.
    const a = alignWordTimings(text, spoken, { pronunciations: dict });
    const standalone = a.words[7]!;
    expect(standalone.text).toBe("i");
    expect(text.slice(standalone.sourceStart, standalone.sourceEnd)).toBe("i");
    expect(standalone.sourceStart).toBeGreaterThan(a.words[6]!.sourceEnd - 1);
  });

  test("WITHOUT the dictionary the run is not repaired — this is what it costs", () => {
    // Asserted so the fix has something to be better than. The damage is not a clean
    // failure: "punktum" is lost, and the alias's letters match FRAGMENTS.
    const a = alignWordTimings(text, spoken);
    expect(a.unaligned).toEqual(["punktum"]);
    expect(text.slice(a.words[3]!.sourceStart, a.words[3]!.sourceEnd)).toBe("broberg"); // not broberg.ai
  });

  test("LONGEST ALIAS FIRST — a short alias that prefixes a longer one cannot claim the run", () => {
    // Same reasoning as F051's longest-first alternation, one layer along.
    const t = "Se broberg.ai her";
    const s = say("Se", "broberg", "punktum", "a", "i", "her");
    const a = alignWordTimings(t, s, {
      pronunciations: [
        { word: "broberg", alias: "broberg" },
        { word: "broberg.ai", alias: "broberg punktum a i" },
      ],
    });
    expect(t.slice(a.words[1]!.sourceStart, a.words[1]!.sourceEnd)).toBe("broberg.ai");
    expect(a.words).toHaveLength(6);
  });

  test("a run is only consumed when the SOURCE word is really ahead of the cursor", () => {
    // Otherwise a coincidental word sequence would eat source text it never came from.
    const t = "her står punktum a i alene";
    const a = alignWordTimings(t, say("her", "står", "punktum", "a", "i", "alene"), {
      pronunciations: [{ word: "broberg.ai", alias: "punktum a i" }],
    });
    // No "broberg.ai" in the source, so the three words align individually.
    expect(a.words.map((w) => t.slice(w.sourceStart, w.sourceEnd))).toEqual([
      "her", "står", "punktum", "a", "i", "alene",
    ]);
    expect(a.unaligned).toEqual([]);
  });

  test("the alias words keep their OWN audio times — they are separate highlights", () => {
    // They share a source span; they must not share a clock, or the highlight would sit
    // still through all four syllables.
    const a = alignWordTimings(text, spoken, { pronunciations: dict });
    const run = a.words.slice(3, 7);
    expect(new Set(run.map((w) => w.sourceStart)).size).toBe(1);
    expect(new Set(run.map((w) => w.startMs)).size).toBe(4);
    expect(run.map((w) => w.startMs)).toEqual([...run.map((w) => w.startMs)].sort((x, y) => x - y));
  });

  test("an ipa-only entry contributes no run — <phoneme> keeps the spelling", () => {
    // A rule with nothing to fire on is worse than no rule: it looks like coverage.
    const t = "det er native";
    const a = alignWordTimings(t, say("det", "er", "native"), {
      pronunciations: [{ word: "native", alias: undefined }],
    });
    expect(t.slice(a.words[2]!.sourceStart, a.words[2]!.sourceEnd)).toBe("native");
    expect(a.unaligned).toEqual([]);
  });
});

describe("F055.1 — what it cannot place, it NAMES", () => {
  test("a spoken word absent from the source goes to unaligned, never a guessed offset", () => {
    const a = alignWordTimings("Vi bruger AI", say("Vi", "bruger", "kunstig", "AI"));
    expect(a.unaligned).toEqual(["kunstig"]);
    expect(a.words.map((w) => w.text)).toEqual(["Vi", "bruger", "AI"]);
  });

  test("NEGATIVE CONTROL — a clean text leaves unaligned EMPTY", () => {
    // Without this, `unaligned` could be unconditional noise, and noise gets ignored.
    const text = "Vi bruger det hver dag";
    const a = alignWordTimings(text, say(...text.split(" ")));
    expect(a.unaligned).toEqual([]);
    expect(a.words).toHaveLength(5);
  });
});

describe("F055.1 — punctuation and shape", () => {
  test("a standalone punctuation entry is dropped, not mis-placed", () => {
    // Microsoft's own example has "." as its own entry with AudioOffset 1700.
    const a = alignWordTimings("Vi bruger AI.", say("Vi", "bruger", "AI", "."));
    expect(a.words.map((w) => w.text)).toEqual(["Vi", "bruger", "AI"]);
    expect(a.unaligned).toEqual([]);
  });

  test("a word carrying a dot INSIDE it stays one word", () => {
    // Same reason F051's matcher refuses \b. A punctuation rule that stripped dots
    // would break broberg.ai here too.
    const text = "Læs mere på broberg.ai nu";
    const a = alignWordTimings(text, say("Læs", "mere", "på", "broberg.ai", "nu"));
    const w = a.words.find((x) => x.text === "broberg.ai")!;
    expect(text.slice(w.sourceStart, w.sourceEnd)).toBe("broberg.ai");
    expect(a.unaligned).toEqual([]);
  });

  test("case differences align — Azure may capitalise differently than the manuscript", () => {
    const text = "vi bruger ai";
    const a = alignWordTimings(text, say("Vi", "Bruger", "AI"));
    expect(a.words.map((w) => w.sourceStart)).toEqual([0, 3, 10]);
    expect(a.unaligned).toEqual([]);
  });

  test("audio times are carried through unchanged, end = offset + duration", () => {
    const a = alignWordTimings("Vi bruger AI", [
      { Text: "Vi", AudioOffset: 50, Duration: 137 },
      { Text: "bruger", AudioOffset: 200, Duration: 350 },
      { Text: "AI", AudioOffset: 562, Duration: 175 },
    ]);
    expect(a.words.map((w) => [w.startMs, w.endMs])).toEqual([
      [50, 187],
      [200, 550],
      [562, 737],
    ]);
  });

  test("an empty word list gives an empty result, not a throw", () => {
    expect(alignWordTimings("Vi bruger AI", [])).toEqual({ words: [], unaligned: [] });
  });
});

// ── F055.2 — the batch route, with an injected fetch ───────────────────────
// The NETWORK round-trip is not verified in this repo (no Azure key here, and none in
// the vault). What IS verified offline: the call sequence, that both routes send the
// SAME SSML, and that a missing word.json fails with a message naming what was present.
describe("F055.2 — the Azure batch route", () => {
  const spec = { provider: "azure", model: "tts", transport: "http" as const };
  const base = { text: "Læs mere på broberg.ai i dag", voiceId: "da-DK-JeppeNeural", spec };

  /** Build a results.zip the way the reader expects it. */
  async function zipWith(entries: { name: string; text: string }[]): Promise<Uint8Array> {
    const { deflateRawSync } = await import("node:zlib");
    const files = entries.map((e) => ({
      name: e.name,
      data: new TextEncoder().encode(e.text),
      body: new Uint8Array(deflateRawSync(new TextEncoder().encode(e.text))),
    }));
    const locals: Uint8Array[] = [];
    const central: Uint8Array[] = [];
    let offset = 0;
    for (const f of files) {
      const nb = new TextEncoder().encode(f.name);
      const local = new Uint8Array(30 + nb.length + f.body.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true); lv.setUint16(8, 8, true);
      lv.setUint32(18, f.body.length, true); lv.setUint32(22, f.data.length, true);
      lv.setUint16(26, nb.length, true);
      local.set(nb, 30); local.set(f.body, 30 + nb.length);
      locals.push(local);
      const cen = new Uint8Array(46 + nb.length);
      const cv = new DataView(cen.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(10, 8, true);
      cv.setUint32(20, f.body.length, true); cv.setUint32(24, f.data.length, true);
      cv.setUint16(28, nb.length, true); cv.setUint32(42, offset, true);
      cen.set(nb, 46); central.push(cen);
      offset += local.length;
    }
    const cenSize = central.reduce((n, c) => n + c.length, 0);
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true); ev.setUint32(12, cenSize, true);
    ev.setUint32(16, offset, true);
    const out = new Uint8Array(offset + cenSize + 22);
    let p = 0;
    for (const l of locals) { out.set(l, p); p += l.length; }
    for (const c of central) { out.set(c, p); p += c.length; }
    out.set(eocd, p);
    return out;
  }

  const WORDS = JSON.stringify([
    { Text: "Læs", AudioOffset: 50, Duration: 137 },
    { Text: "mere", AudioOffset: 200, Duration: 150 },
    { Text: "på", AudioOffset: 400, Duration: 120 },
    { Text: "broberg", AudioOffset: 550, Duration: 300 },
    { Text: "punktum", AudioOffset: 900, Duration: 200 },
    { Text: "a", AudioOffset: 1150, Duration: 100 },
    { Text: "i", AudioOffset: 1300, Duration: 100 },
    { Text: "i", AudioOffset: 1450, Duration: 90 },
    { Text: "dag", AudioOffset: 1600, Duration: 250 },
  ]);

  /** An adapter whose fetch replays the documented submit → poll → ZIP sequence. */
  async function adapterWith(entries: { name: string; text: string }[]) {
    const { azureAdapter } = await import("./azure.js");
    const zip = await zipWith(entries);
    const calls: { url: string; method: string; body?: string }[] = [];
    const a = azureAdapter({
      apiKey: "k",
      region: "westeurope",
      resource: "myres",
      batchPollMs: 1,
      fetch: (async (url: string, init?: RequestInit) => {
        calls.push({ url: String(url), method: init?.method ?? "GET", body: init?.body ? String(init.body) : undefined });
        if (init?.method === "PUT") return new Response(JSON.stringify({ id: "x", status: "Running" }), { status: 201 });
        if (String(url).includes("batchsyntheses/")) {
          // First poll Running, second Succeeded — so the loop is exercised, not skipped.
          const polls = calls.filter((c) => c.method === "GET" && c.url.includes("batchsyntheses/")).length;
          return new Response(
            JSON.stringify(
              polls < 2
                ? { status: "Running" }
                : { status: "Succeeded", outputs: { result: "https://blob.example/results.zip?sas" } },
            ),
            { status: 200 },
          );
        }
        return new Response(zip.slice().buffer, { status: 200 });
      }) as unknown as typeof fetch,
    });
    return { a, calls };
  }

  test("submit → poll → fetch, and the words map to the MANUSCRIPT", async () => {
    const { a, calls } = await adapterWith([
      { name: "0001.wav", text: "RIFFfake" },
      { name: "0001.word.json", text: WORDS },
    ]);
    const r = await a.tts!({ ...base, wordTimings: true, pronunciations: [{ word: "broberg.ai", alias: "broberg punktum a i" }] });

    expect(calls[0]!.method).toBe("PUT");
    expect(calls[0]!.url).toContain("/texttospeech/batchsyntheses/");
    expect(JSON.parse(calls[0]!.body!).properties.wordBoundaryEnabled).toBe(true);
    expect(JSON.parse(calls[0]!.body!).properties.concatenateResult).toBe(true);
    // It POLLED — a version that read the PUT response's status would skip this.
    expect(calls.filter((c) => c.method === "GET" && c.url.includes("batchsyntheses/")).length).toBe(2);

    const w = r.wordTimings!;
    const span = (i: number) => base.text.slice(w.words[i]!.sourceStart, w.words[i]!.sourceEnd);
    expect(span(3)).toBe("broberg.ai"); // the run
    expect(span(6)).toBe("broberg.ai");
    expect(span(7)).toBe("i"); // the real Danish word after it
    expect(w.unaligned).toEqual([]);
    expect(r.mimeType).toBe("audio/wav"); // batch returns riff PCM, not mp3
  });

  test("a missing word.json FAILS and names what the archive DID hold", async () => {
    // "not found" is a dead end; naming the contents tells the reader that boundaries
    // were never generated rather than that we looked in the wrong place.
    const { a } = await adapterWith([
      { name: "0001.wav", text: "RIFFfake" },
      { name: "summary.json", text: "{}" },
    ]);
    await expect(a.tts!({ ...base, wordTimings: true })).rejects.toThrow(/0001\.wav, summary\.json/);
  });

  test("NEGATIVE CONTROL — WITHOUT wordTimings the real-time route is used, unchanged", async () => {
    // The SSML builder was lifted out of the real-time path; this proves the old route
    // still goes to the old endpoint and returns no wordTimings field.
    const { azureAdapter } = await import("./azure.js");
    const urls: string[] = [];
    const a = azureAdapter({
      apiKey: "k", region: "westeurope",
      fetch: (async (url: string) => { urls.push(String(url)); return new Response(new ArrayBuffer(4), { status: 200 }); }) as unknown as typeof fetch,
    });
    const r = await a.tts!(base);
    expect(urls[0]).toContain("/cognitiveservices/v1");
    expect(urls.some((u) => u.includes("batchsyntheses"))).toBe(false);
    expect(r.wordTimings).toBeUndefined();
    expect(r.mimeType).toBe("audio/mpeg");
  });

  test("BOTH routes send the SAME SSML — one builder, or the words describe other audio", async () => {
    const { azureAdapter } = await import("./azure.js");
    const pron = [{ word: "broberg.ai", alias: "broberg punktum a i" }];
    let realtime = "";
    const rt = azureAdapter({
      apiKey: "k", region: "westeurope",
      fetch: (async (_u: string, init?: RequestInit) => { realtime = String(init?.body); return new Response(new ArrayBuffer(4), { status: 200 }); }) as unknown as typeof fetch,
    });
    await rt.tts!({ ...base, pronunciations: pron });

    const { a, calls } = await adapterWith([
      { name: "0001.wav", text: "RIFFfake" },
      { name: "0001.word.json", text: WORDS },
    ]);
    await a.tts!({ ...base, wordTimings: true, pronunciations: pron });
    const batchSsml = JSON.parse(calls[0]!.body!).inputs[0].content;

    expect(batchSsml).toBe(realtime);
    expect(batchSsml).toContain("<sub alias='broberg punktum a i'>broberg.ai</sub>");
  });
});
