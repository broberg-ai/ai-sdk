// F051 — the pronunciation dictionary. Every case here is one of cms's MEASURED
// mispronunciations on da-DK (jeppe/christel), not an invented example:
// "AI" → the word "aj", "broberg.ai" mangled, "webhook" unsayable, "native" → "nativ".
import { expect, test } from "bun:test";
import { azureAdapter } from "./azure.js";
import { elevenlabsAdapter } from "./elevenlabs.js";
import { applyPronunciations, assertPronunciations, xmlEscape } from "./pronunciation.js";

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
