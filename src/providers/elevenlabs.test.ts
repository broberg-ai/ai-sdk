import { expect, test } from "bun:test";
import { elevenlabsAdapter } from "./elevenlabs.js";
import { createAI } from "../client.js";

/** Fake fetch returning audio bytes + capturing the request. */
function audioFetch(bytes = new Uint8Array([1, 2, 3, 4])) {
  const seen: { url: string; headers: any; body: any }[] = [];
  const f = (async (url: string | URL, init?: RequestInit) => {
    seen.push({ url: String(url), headers: init!.headers, body: init!.body ? JSON.parse(init!.body as string) : null });
    return new Response(bytes, { status: 200, headers: { "content-type": "audio/mpeg" } });
  }) as unknown as typeof fetch;
  return { f, seen };
}

const spec = { provider: "elevenlabs", model: "eleven_v3", transport: "http" as const };

test("dialogue posts inputs[{text,voice_id}] + model_id with xi-api-key, prices per char", async () => {
  const { f, seen } = audioFetch();
  const adapter = elevenlabsAdapter({ apiKey: "k", fetch: f });
  const { audio, mimeType, usage } = await adapter.dialogue!({
    inputs: [
      { text: "Hej og velkommen.", voiceId: "voice-A" },
      { text: "Tak, dejligt at være her!", voiceId: "voice-B" },
    ],
    spec,
  });
  expect(seen[0]!.url).toBe("https://api.elevenlabs.io/v1/text-to-dialogue");
  expect((seen[0]!.headers as any)["xi-api-key"]).toBe("k");
  expect(seen[0]!.body.model_id).toBe("eleven_v3");
  expect(seen[0]!.body.inputs).toEqual([
    { text: "Hej og velkommen.", voice_id: "voice-A" },
    { text: "Tak, dejligt at være her!", voice_id: "voice-B" },
  ]);
  expect(mimeType).toBe("audio/mpeg");
  expect(audio).toBeInstanceOf(Uint8Array);
  expect(usage.capability).toBe("podcast");
  // 17 + 25 = 42 chars × $0.15/1k → non-zero
  expect(usage.costUsd).toBeGreaterThan(0);
});

test("ai.podcast maps speaker turns → voiceIds via the voices map", async () => {
  const { f, seen } = audioFetch();
  const ai = createAI({ providers: { elevenlabs: elevenlabsAdapter({ apiKey: "k", fetch: f }) } });
  const { audio, usage } = await ai.podcast({
    script: [
      { speaker: "vært", text: "Velkommen til afsnittet." },
      { speaker: "gæst", text: "Tak skal du have." },
    ],
    voices: { "vært": "soren-id", "gæst": "jesper-id" },
  });
  expect(seen[0]!.body.inputs).toEqual([
    { text: "Velkommen til afsnittet.", voice_id: "soren-id" },
    { text: "Tak skal du have.", voice_id: "jesper-id" },
  ]);
  expect(audio.length).toBe(4);
  expect(usage.provider).toBe("elevenlabs");
});

test("ai.podcast throws a clear error for an unmapped speaker", async () => {
  const { f } = audioFetch();
  const ai = createAI({ providers: { elevenlabs: elevenlabsAdapter({ apiKey: "k", fetch: f }) } });
  await expect(
    ai.podcast({ script: [{ speaker: "ukendt", text: "hej" }], voices: { "vært": "x" } }),
  ).rejects.toThrow(/no voice mapped for speaker "ukendt"/);
});
