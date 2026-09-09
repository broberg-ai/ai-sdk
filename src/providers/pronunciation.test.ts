// F051 — the pronunciation dictionary. Every case here is one of cms's MEASURED
// mispronunciations on da-DK (jeppe/christel), not an invented example:
// "AI" → the word "aj", "broberg.ai" mangled, "webhook" unsayable, "native" → "nativ".
import { describe, expect, test } from "bun:test";
import { azureAdapter } from "./azure.js";
import { elevenlabsAdapter } from "./elevenlabs.js";
import { applyPronunciations, assertPronunciations, xmlEscape } from "./pronunciation.js";
import type { Pronunciation } from "./pronunciation.js";

const audio = new Uint8Array([1, 2, 3]);
function azureSpy() {
  const sent: string[] = [];
  const fetchImpl = (async (_u: string, init?: RequestInit) => {
    sent.push(String(init!.body));
    return new Response(audio, { status: 200, headers: { "content-type": "audio/mpeg" } });
  }) as unknown as typeof fetch;
  return { sent, adapter: azureAdapter({ apiKey: "k", fetch: fetchImpl }) };
}
const spec = { provider: "azure", model: "tts", transport: "http" as const };

test("NEGATIVE CONTROL: without the dictionary the SSML is unchanged", async () => {
  // The load-bearing control. A substitution that ran unconditionally would satisfy
  // every other test here and quietly rewrite every existing caller's audio.
  const a = azureSpy();
  await a.adapter.tts!({ text: "Hej med dig", voiceId: "christel", spec } as never);
  expect(a.sent[0]).toContain(">Hej med dig<");
  expect(a.sent[0]).not.toContain("<sub");
  expect(a.sent[0]).not.toContain("<phoneme");
});

test("alias and ipa render as the SSML Azure understands", async () => {
  const a = azureSpy();
  await a.adapter.tts!({
    text: "AI og native kode", voiceId: "christel", spec,
    pronunciations: [{ word: "AI", alias: "A I" }, { word: "native", ipa: "ˈneɪtɪv" }],
  } as never);
  expect(a.sent[0]).toContain("<sub alias='A I'>AI</sub>");
  expect(a.sent[0]).toContain("<phoneme alphabet='ipa' ph='ˈneɪtɪv'>native</phoneme>");
});

test("THE DOOR IS ESCAPED TOO — alias is an attribute value", async () => {
  // cms did not mention this, and it is the obvious way to build the feature wrongly.
  // The whole point of doing this adapter-side is that `text` cannot inject markup;
  // an unescaped alias would just move the injection to the other input.
  const a = azureSpy();
  await a.adapter.tts!({
    text: "AI", voiceId: "christel", spec,
    pronunciations: [{ word: "AI", alias: `" onload="evil` }],
  } as never);
  expect(a.sent[0]).toContain("&quot; onload=&quot;evil");
  expect(a.sent[0]).not.toContain(`alias='" onload="evil'`);
});

test("the text field still cannot inject — both doors, one test", async () => {
  const a = azureSpy();
  await a.adapter.tts!({ text: "<speak>evil</speak> & co", voiceId: "christel", spec } as never);
  expect(a.sent[0]).toContain("&lt;speak&gt;evil&lt;/speak&gt; &amp; co");
});

test("LONGEST WINS: broberg.ai is not eaten by the AI rule", () => {
  // cms's two real entries overlap. Sequential replaces would rewrite "AI" inside
  // "broberg.ai" first and destroy the longer match.
  const out = applyPronunciations(
    "Skriv til broberg.ai om AI",
    [{ word: "AI", alias: "A I" }, { word: "broberg.ai", alias: "broberg dot A I" }],
    (p, m) => `[${p.alias}|${m}]`,
  );
  expect(out).toBe("Skriv til [broberg dot A I|broberg.ai] om [A I|AI]");
});

test("whole-word only: AI does not fire inside SAID", () => {
  const out = applyPronunciations("SAID and AI", [{ word: "AI", alias: "A I" }], (p) => p.alias!);
  expect(out).toBe("SAID and A I");
});

test("a rule cannot match inside markup an earlier rule just wrote", () => {
  // "sub" and "alias" are ordinary words. With sequential replaces the second rule
  // would rewrite the tag the first one emitted.
  const out = applyPronunciations(
    "AI sub",
    [{ word: "AI", alias: "A I" }, { word: "sub", alias: "abonnement" }],
    (p, m) => (p.word === "AI" ? `<sub alias='${p.alias}'>${m}</sub>` : p.alias!),
  );
  expect(out).toBe("<sub alias='A I'>AI</sub> abonnement");
});

test("the search word is escaped like the text — an & is findable", () => {
  const out = applyPronunciations(
    xmlEscape("R&D afdelingen"),
    [{ word: "R&D", alias: "R og D" }],
    (p) => p.alias!,
    xmlEscape,
  );
  expect(out).toBe("R og D afdelingen");
});

test("both alias AND ipa is refused, and the message names the word", () => {
  expect(() => assertPronunciations([{ word: "AI", alias: "A I", ipa: "eɪ aɪ" }], "azure"))
    .toThrow(/"AI" sets BOTH alias and ipa/);
});

test("neither alias nor ipa is refused — there is nothing to say instead", () => {
  expect(() => assertPronunciations([{ word: "webhook" }], "azure"))
    .toThrow(/neither alias nor ipa/);
});

test("ElevenLabs applies alias in plain text", async () => {
  const sent: string[] = [];
  const fetchImpl = (async (_u: string, init?: RequestInit) => {
    sent.push(String(init!.body));
    return new Response(audio, { status: 200 });
  }) as unknown as typeof fetch;
  const a = elevenlabsAdapter({ apiKey: "k", fetch: fetchImpl });
  await a.tts!({
    text: "webhook og AI", voiceId: "v", spec: { provider: "elevenlabs", model: "eleven_multilingual_v2", transport: "http" },
    pronunciations: [{ word: "AI", alias: "A I" }],
  } as never);
  expect(JSON.parse(sent[0]!).text).toBe("webhook og A I");
});

test("ElevenLabs THROWS on an ipa rule — it must not go quiet", async () => {
  // The F049 lesson: a silently dropped instruction means the call succeeds, the word
  // is still mispronounced, and the caller believes it was fixed.
  const fetchImpl = (async () => new Response(audio, { status: 200 })) as unknown as typeof fetch;
  const a = elevenlabsAdapter({ apiKey: "k", fetch: fetchImpl });
  await expect(
    a.tts!({
      text: "native", voiceId: "v", spec: { provider: "elevenlabs", model: "eleven_multilingual_v2", transport: "http" },
      pronunciations: [{ word: "native", ipa: "ˈneɪtɪv" }],
    } as never),
  ).rejects.toThrow(/uses ipa, which needs SSML/);
});

// ── F051.3: Danish compounds. cms's own measured cases as test data ────────
// A rule for "AI" did not fire in "AI-agenter" — 60+ occurrences in their articles,
// every one read aloud as one mangled word. The hyphen in the old lookaround was a
// COINCIDENCE: the comment above it justifies avoiding \b on the DOT in "broberg.ai"
// and never mentioned `-` at all.
describe("F051.3 — matchInCompounds", () => {
  const sub = (list: Pronunciation[], text: string) =>
    applyPronunciations(text, list, (p) => `<${p.alias}>`);

  test("WITH the flag: AI fires inside AI-agenter, AI-native, HTML-filen", () => {
    const dict: Pronunciation[] = [
      { word: "AI", alias: "A I", matchInCompounds: true },
      { word: "HTML", alias: "H T M L", matchInCompounds: true },
    ];
    expect(sub(dict, "15+ AI-agenter")).toBe("15+ <A I>-agenter");
    expect(sub(dict, "en AI-native platform")).toBe("en <A I>-native platform");
    expect(sub(dict, "ret HTML-filen")).toBe("ret <H T M L>-filen");
    // and still the plain case
    expect(sub(dict, "Vi bruger AI")).toBe("Vi bruger <A I>");
  });

  test("WITHOUT the flag: unchanged from 0.42.1 — the compound is left alone", () => {
    const dict: Pronunciation[] = [{ word: "AI", alias: "A I" }];
    expect(sub(dict, "15+ AI-agenter")).toBe("15+ AI-agenter");
    expect(sub(dict, "Vi bruger AI")).toBe("Vi bruger <A I>");
  });

  test("THE PRICE, as a test rather than a note: 'mail' must not fire in 'e-mail'", () => {
    // @broberg/speech-dictionary ships the general loosening and pays exactly this.
    // It is why the flag is per entry and defaults to false.
    const dict: Pronunciation[] = [{ word: "mail", alias: "mejl" }];
    expect(sub(dict, "min e-mail virker")).toBe("min e-mail virker");
    expect(sub(dict, "send en mail")).toBe("send en <mejl>");
  });

  test("…and the flag IS what controls it — 'mail' with the flag DOES fire in 'e-mail'", () => {
    const dict: Pronunciation[] = [{ word: "mail", alias: "mejl", matchInCompounds: true }];
    expect(sub(dict, "min e-mail virker")).toBe("min e-<mejl> virker");
  });

  test("MIXED dictionary: one entry with the flag and one without, same call, same text", () => {
    // Without this a GLOBAL loosening disguised as per-entry would pass every test above.
    const dict: Pronunciation[] = [
      { word: "AI", alias: "A I", matchInCompounds: true },
      { word: "mail", alias: "mejl" },
    ];
    expect(sub(dict, "AI-agenter sender e-mail")).toBe("<A I>-agenter sender e-mail");
  });

  test("a hyphen BEFORE the word is refused too, not only after", () => {
    const dict: Pronunciation[] = [{ word: "AI", alias: "A I" }];
    expect(sub(dict, "bruger-AI her")).toBe("bruger-AI her");
  });

  test("longest-first still wins, and the dot in broberg.ai still works", () => {
    // The reason the lookaround is not \b in the first place. Unchanged by F051.3.
    const dict: Pronunciation[] = [
      { word: "broberg.ai", alias: "broberg punktum a i" },
      { word: "AI", alias: "A I" },
    ];
    expect(sub(dict, "se broberg.ai og AI")).toBe("se <broberg punktum a i> og <A I>");
  });
});

// ── F051.4: the dictionary reaches ai.podcast(), per LINE ─────────────────
// cms measured the gap: a two-host podcast could not get a dictionary at all, so
// "broberg.ai" was said wrong in every episode. They could fix the sponsor read and
// the host's hand-off (both ai.tts) and not the conversation — 95% of the audio.
//
// Their open question, answered by measurement: /text-to-dialogue takes inputs[].text
// SEPARATELY, so the substitution reuses tts's exactly. Composing the script into one
// string first would let a replacement run across a speaker boundary.
describe("F051.4 — pronunciations on dialogue", () => {
  const spec = { provider: "elevenlabs", model: "eleven_v3", transport: "http" as const };
  const turns = [
    { text: "Velkommen til broberg.ai", voiceId: "v1" },
    { text: "Ja, broberg.ai er stedet", voiceId: "v2" },
  ];

  async function sent(pron?: Pronunciation[]) {
    let body: any;
    const a = elevenlabsAdapter({
      apiKey: "k",
      fetch: (async (_u: string, init: RequestInit) => {
        body = JSON.parse(String(init.body));
        return new Response(new ArrayBuffer(4), { status: 200 });
      }) as unknown as typeof fetch,
    });
    await a.dialogue!({ inputs: turns, spec, ...(pron ? { pronunciations: pron } : {}) });
    return body;
  }

  test("every line is substituted — not just the first", async () => {
    // Their podcast has TWO hosts, so a half-applied fix is the likely wrong version.
    const body = await sent([{ word: "broberg.ai", alias: "broberg punktum a i" }]);
    expect(body.inputs.map((i: any) => i.text)).toEqual([
      "Velkommen til broberg punktum a i",
      "Ja, broberg punktum a i er stedet",
    ]);
    expect(body.inputs.map((i: any) => i.voice_id)).toEqual(["v1", "v2"]);
  });

  test("NEGATIVE CONTROL — without the field the posted body is unchanged", async () => {
    const body = await sent();
    expect(body.inputs.map((i: any) => i.text)).toEqual([
      "Velkommen til broberg.ai",
      "Ja, broberg.ai er stedet",
    ]);
  });

  test("an ipa entry THROWS here too — ElevenLabs has no SSML", async () => {
    // Same F049 lesson as tts: a silent skip leaves the consumer sure of a
    // pronunciation they did not get.
    await expect(sent([{ word: "native", ipa: "ˈneɪtɪv" }])).rejects.toThrow(/needs SSML/);
  });
});
