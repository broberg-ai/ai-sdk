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
