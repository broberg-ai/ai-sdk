import { expect, test } from "bun:test";
import { fetchOpenRouterCatalogue, fetchFullCatalogue } from "./fetchers.js";

function jsonFetch(payload: unknown, status = 200): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
}

test("fetchOpenRouterCatalogue normalizes per-token USD strings → per-1M numbers", async () => {
  const models = await fetchOpenRouterCatalogue({
    fetch: jsonFetch({
      data: [
        {
          id: "google/gemini-2.5-flash",
          context_length: 1_048_576,
          pricing: { prompt: "0.0000003", completion: "0.0000025" },
        },
      ],
    }),
  });
  expect(models).toHaveLength(1);
  expect(models[0]).toMatchObject({
    provider: "openrouter",
    model: "google/gemini-2.5-flash",
    contextLength: 1_048_576,
  });
  expect(models[0]!.inputPer1M).toBeCloseTo(0.3, 9);
  expect(models[0]!.outputPer1M).toBeCloseTo(2.5, 9);
});

test("fetchOpenRouterCatalogue omits price when the field is absent", async () => {
  const models = await fetchOpenRouterCatalogue({
    fetch: jsonFetch({ data: [{ id: "some/model" }] }),
  });
  expect(models[0]!.inputPer1M).toBeUndefined();
  expect(models[0]!.outputPer1M).toBeUndefined();
});

test("fetchFullCatalogue is isolation-safe: openrouter still lands even if a direct provider fails", async () => {
  // OpenRouter needs no key and always returns; direct providers either error on
  // a missing key or parse to empty against this payload — none of which may
  // reject the aggregate.
  const result = await fetchFullCatalogue({
    fetch: jsonFetch({ data: [{ id: "anthropic/claude-haiku-4-5", pricing: { prompt: "0.0000008", completion: "0.000004" } }] }),
  });
  expect(result.fetched).toContain("openrouter");
  expect(result.models.some((m) => m.provider === "openrouter")).toBe(true);
  // The call resolves to a structured result, never throws.
  expect(typeof result.errors).toBe("object");
});

// ── F067.1 — direct lists for every provider with a list API ─────────────
import { fetchElevenLabsCatalogue, fetchMistralCatalogue, MissingKeyError } from "./fetchers.js";
import { diffCatalogue } from "./diff.js";

test("ElevenLabs: an unknown model (eleven_v4) is reported as new; the routed ones are not", async () => {
  const models = await fetchElevenLabsCatalogue({
    apiKey: "k",
    fetch: jsonFetch([{ model_id: "eleven_v4" }, { model_id: "eleven_v3" }, { model_id: "eleven_multilingual_v2" }]),
  });
  const diff = diffCatalogue(models, { fetchedProviders: ["elevenlabs"] });
  expect(diff.added.map((m) => m.model)).toEqual(["eleven_v4"]);
});

test("Mistral: an alias group is reported once, and not at all when any member is known", async () => {
  const models = await fetchMistralCatalogue({
    apiKey: "k",
    fetch: jsonFetch({
      data: [
        { id: "mistral-large-2512", aliases: ["mistral-large-latest"] },
        { id: "mistral-large-latest", aliases: ["mistral-large-2512"] },
        { id: "voxtral-mini-tts-2603", aliases: ["voxtral-mini-tts-latest"] },
        { id: "voxtral-mini-tts-latest", aliases: ["voxtral-mini-tts-2603"] },
        { id: "old-thing-2401", aliases: [], deprecation: "2026-01-01" },
      ],
    }),
  });
  const diff = diffCatalogue(models, { fetchedProviders: ["mistral"] });
  expect(diff.added.map((m) => m.model)).toEqual(["voxtral-mini-tts-2603"]);
  // A priced key listed only as an ALIAS is not "gone upstream".
  expect(diff.removedUpstream).not.toContain("mistral:mistral-large-latest");
});

test("a missing key is recorded as missingKeys (with the env var), never as an error", async () => {
  const saved = process.env.ELEVENLABS_API_KEY;
  delete process.env.ELEVENLABS_API_KEY;
  try {
    await expect(fetchElevenLabsCatalogue({ fetch: jsonFetch([]) })).rejects.toBeInstanceOf(MissingKeyError);
    const result = await fetchFullCatalogue({ fetch: jsonFetch({ data: [] }) });
    expect(result.missingKeys.elevenlabs).toBe("ELEVENLABS_API_KEY");
    expect(result.errors.elevenlabs).toBeUndefined();
  } finally {
    if (saved !== undefined) process.env.ELEVENLABS_API_KEY = saved;
  }
});
