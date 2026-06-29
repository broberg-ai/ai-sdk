import { expect, test } from "bun:test";
import { azureAdapter, AZURE_DANISH_VOICES, AZURE_DANISH_VOICE_LIST, listAzureDanishVoices, resolveAzureVoice } from "./azure.js";

const spec = { provider: "azure", model: "neural", transport: "http" as const };

function azureFetch(capture: { url?: string; body?: string; headers?: Headers }, mp3 = new Uint8Array([0x49, 0x44, 0x33])) {
  return (async (url: string, init?: RequestInit) => {
    capture.url = url;
    capture.body = String(init?.body);
    capture.headers = new Headers(init?.headers);
    return new Response(mp3, { status: 200, headers: { "content-type": "audio/mpeg" } });
  }) as unknown as typeof fetch;
}

test("tts: SSML + EU host + key header + MP3 out + per-char cost", async () => {
  const cap: { url?: string; body?: string; headers?: Headers } = {};
  // Explicit region so the test is hermetic (independent of any ambient AZURE_SPEECH_REGION).
  const adapter = azureAdapter({ apiKey: "k", region: "westeurope", fetch: azureFetch(cap) });
  const { audio, mimeType, usage } = await adapter.tts!({ text: "Hej fra planen", voiceId: "christel", spec });

  expect(mimeType).toBe("audio/mpeg");
  expect(audio).toEqual(new Uint8Array([0x49, 0x44, 0x33]));
  // EU-pinned host + cognitiveservices path
  expect(cap.url).toBe("https://westeurope.tts.speech.microsoft.com/cognitiveservices/v1");
  // curated friendly name resolved to the full Azure voice + locale derived
  expect(cap.body).toContain("<voice name='da-DK-ChristelNeural'>");
  expect(cap.body).toContain("xml:lang='da-DK'");
  expect(cap.body).toContain("Hej fra planen");
  // Azure auth header + SSML content-type + output format
  expect(cap.headers!.get("Ocp-Apim-Subscription-Key")).toBe("k");
  expect(cap.headers!.get("Content-Type")).toBe("application/ssml+xml");
  expect(cap.headers!.get("X-Microsoft-OutputFormat")).toBe("audio-24khz-48kbitrate-mono-mp3");
  // cost-tracked: per-character, provider/capability stamped
  expect(usage.provider).toBe("azure");
  expect(usage.capability).toBe("tts");
  expect(usage.costUsd).toBeCloseTo(("Hej fra planen".length / 1000) * 0.016, 9);
});

test("region + format + explicit lang overrides; raw voice name passes through", async () => {
  const cap: { url?: string; body?: string; headers?: Headers } = {};
  const adapter = azureAdapter({ apiKey: "k", region: "northeurope", fetch: azureFetch(cap) });
  await adapter.tts!({ text: "x", voiceId: "da-DK-JeppeNeural", lang: "da-DK", format: "riff-24khz-16bit-mono-pcm", spec });
  expect(cap.url).toContain("https://northeurope.tts.speech.microsoft.com/");
  expect(cap.body).toContain("<voice name='da-DK-JeppeNeural'>");
  expect(cap.headers!.get("X-Microsoft-OutputFormat")).toBe("riff-24khz-16bit-mono-pcm");
});

test("rate: explicit wins; else per-voice default (Christel 0.85, Jeppe normal)", async () => {
  // explicit rate is honoured
  const ex: { url?: string; body?: string; headers?: Headers } = {};
  await azureAdapter({ apiKey: "k", fetch: azureFetch(ex) }).tts!({ text: "hej", voiceId: "christel", rate: 0.9, spec });
  expect(ex.body).toContain("<prosody rate='0.9'>hej</prosody>");

  // no explicit rate → Christel's own default 0.85 applies
  const chr: { url?: string; body?: string; headers?: Headers } = {};
  await azureAdapter({ apiKey: "k", fetch: azureFetch(chr) }).tts!({ text: "hej", voiceId: "christel", spec });
  expect(chr.body).toContain("<prosody rate='0.85'>hej</prosody>");

  // Jeppe has no default → normal speed, no prosody wrapper
  const jep: { url?: string; body?: string; headers?: Headers } = {};
  await azureAdapter({ apiKey: "k", fetch: azureFetch(jep) }).tts!({ text: "hej", voiceId: "jeppe", spec });
  expect(jep.body).not.toContain("prosody");

  // an explicit rate of 1 overrides the per-voice default → no wrapper
  const one: { url?: string; body?: string; headers?: Headers } = {};
  await azureAdapter({ apiKey: "k", fetch: azureFetch(one) }).tts!({ text: "hej", voiceId: "christel", rate: 1, spec });
  expect(one.body).not.toContain("prosody");
});

test("XML-escapes the text so & and < can't break the SSML", async () => {
  const cap: { url?: string; body?: string; headers?: Headers } = {};
  const adapter = azureAdapter({ apiKey: "k", fetch: azureFetch(cap) });
  await adapter.tts!({ text: "A&B <plan> \"q\"", voiceId: "jeppe", spec });
  expect(cap.body).toContain("A&amp;B &lt;plan&gt; &quot;q&quot;");
  expect(cap.body).not.toContain("<plan>");
});

test("ship-dark: no key → throws only when called (no import-time crash)", async () => {
  const prev = process.env.AZURE_SPEECH_KEY;
  delete process.env.AZURE_SPEECH_KEY;
  try {
    const adapter = azureAdapter(); // no throw at construction
    await expect(adapter.tts!({ text: "hej", voiceId: "christel", spec })).rejects.toThrow(/AZURE_SPEECH_KEY/);
  } finally {
    if (prev !== undefined) process.env.AZURE_SPEECH_KEY = prev;
  }
});

test("non-200 surfaces the Azure error body", async () => {
  const adapter = azureAdapter({
    apiKey: "k",
    fetch: (async () => new Response("Unauthorized", { status: 401 })) as unknown as typeof fetch,
  });
  await expect(adapter.tts!({ text: "hej", voiceId: "christel", spec })).rejects.toThrow(/azure tts 401/);
});

test("resolveAzureVoice + curated map", () => {
  expect(resolveAzureVoice("christel")).toBe("da-DK-ChristelNeural");
  expect(resolveAzureVoice("jeppe")).toBe("da-DK-JeppeNeural");
  expect(resolveAzureVoice("da-DK-ChristelNeural")).toBe("da-DK-ChristelNeural"); // passthrough
  expect(AZURE_DANISH_VOICES.christel).toBe("da-DK-ChristelNeural");
});

test("listAzureDanishVoices exposes 3 female + 3 male (2 native), all resolvable", () => {
  const voices = listAzureDanishVoices();
  expect(voices.filter((v) => v.gender === "female")).toHaveLength(3);
  expect(voices.filter((v) => v.gender === "male")).toHaveLength(3);
  expect(voices.filter((v) => v.native)).toHaveLength(2); // only Christel + Jeppe are native da-DK
  // every listed name resolves to its full Azure voice + has a display label
  for (const v of voices) {
    expect(resolveAzureVoice(v.name)).toBe(v.voiceId);
    expect(v.display.length).toBeGreaterThan(0);
  }
  expect(AZURE_DANISH_VOICE_LIST.map((v) => v.name)).toContain("seraphina");
});

test("ai.tts routes to azure via override + passes lang/format through", async () => {
  const { createAI } = await import("../client.js");
  const cap: { url?: string; body?: string; headers?: Headers } = {};
  const ai = createAI({ providers: { azure: azureAdapter({ apiKey: "k", fetch: azureFetch(cap) }) } });
  const { usage } = await ai.tts({ text: "Goddag", voice: "christel", lang: "da-DK", override: { provider: "azure", model: "neural" } });
  expect(usage.provider).toBe("azure");
  expect(usage.model).toBe("neural");
  expect(cap.body).toContain("<voice name='da-DK-ChristelNeural'>");
  expect(cap.body).toContain("Goddag");
});

// ── Speech-to-text (F029) ────────────────────────────────────────────────────
function sttFetch(cap: { url?: string; form?: FormData; headers?: Headers }, payload: unknown) {
  return (async (url: string, init?: RequestInit) => {
    cap.url = url;
    cap.form = init?.body as FormData;
    cap.headers = new Headers(init?.headers);
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
}

test("transcribe: forces da-DK locale, sends multipart + auth, parses combinedPhrases, costs per minute", async () => {
  const cap: { url?: string; form?: FormData; headers?: Headers } = {};
  const adapter = azureAdapter({
    apiKey: "k",
    region: "swedencentral",
    fetch: sttFetch(cap, { combinedPhrases: [{ text: "Hej med dig" }], durationMilliseconds: 120000 }),
  });
  const { text, usage } = await adapter.transcribe!({ audio: new Uint8Array([1, 2, 3]), language: "da", spec });

  expect(text).toBe("Hej med dig");
  // regional STT host (default) + fast-transcription path
  expect(cap.url).toBe("https://swedencentral.api.cognitive.microsoft.com/speechtotext/transcriptions:transcribe?api-version=2025-10-15");
  expect(cap.headers!.get("Ocp-Apim-Subscription-Key")).toBe("k");
  // multipart definition carries the forced da-DK locale (Voxtral's gap)
  expect(JSON.parse(cap.form!.get("definition") as string)).toEqual({ locales: ["da-DK"] });
  expect(cap.form!.get("audio")).toBeInstanceOf(Blob);
  // cost from the API's real duration: 2 min × $0.0167
  expect(usage.provider).toBe("azure");
  expect(usage.capability).toBe("transcribe");
  expect(usage.costUsd).toBeCloseTo(2 * 0.0167, 6);
});

test("transcribe: omitted language defaults to da-DK; full locale passes through", async () => {
  const cap: { url?: string; form?: FormData; headers?: Headers } = {};
  const adapter = azureAdapter({ apiKey: "k", fetch: sttFetch(cap, { combinedPhrases: [{ text: "x" }] }) });
  await adapter.transcribe!({ audio: new Uint8Array([1]), spec });
  expect(JSON.parse(cap.form!.get("definition") as string)).toEqual({ locales: ["da-DK"] });
  await adapter.transcribe!({ audio: new Uint8Array([1]), language: "en-GB", spec });
  expect(JSON.parse(cap.form!.get("definition") as string)).toEqual({ locales: ["en-GB"] });
});

test("transcribe: a resource name switches to the custom-domain host", async () => {
  const cap: { url?: string; form?: FormData; headers?: Headers } = {};
  const adapter = azureAdapter({ apiKey: "k", resource: "broberg-tts", fetch: sttFetch(cap, { combinedPhrases: [{ text: "x" }] }) });
  await adapter.transcribe!({ audio: new Uint8Array([1]), language: "da", spec });
  expect(cap.url).toContain("https://broberg-tts.cognitiveservices.azure.com/speechtotext/");
});

test("transcribe ship-dark: no key → throws only when called", async () => {
  const prev = process.env.AZURE_SPEECH_KEY;
  delete process.env.AZURE_SPEECH_KEY;
  try {
    const adapter = azureAdapter();
    await expect(adapter.transcribe!({ audio: new Uint8Array([1]), language: "da", spec })).rejects.toThrow(/AZURE_SPEECH_KEY/);
  } finally {
    if (prev !== undefined) process.env.AZURE_SPEECH_KEY = prev;
  }
});

test("transcribe: phrases → definition.phraseList biasing; absent → no phraseList key", async () => {
  const cap: { url?: string; form?: FormData; headers?: Headers } = {};
  const adapter = azureAdapter({ apiKey: "k", fetch: sttFetch(cap, { combinedPhrases: [{ text: "x" }] }) });
  await adapter.transcribe!({ audio: new Uint8Array([1]), language: "da", phrases: ["cardmem", "Pins", "cb-2"], spec });
  const def = JSON.parse(cap.form!.get("definition") as string);
  expect(def.phraseList.phrases).toEqual(["cardmem", "Pins", "cb-2"]);
  expect(def.phraseList.biasingWeight).toBe(1.5);

  await adapter.transcribe!({ audio: new Uint8Array([1]), language: "da", spec });
  expect(JSON.parse(cap.form!.get("definition") as string).phraseList).toBeUndefined();
});
