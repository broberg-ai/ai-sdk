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
