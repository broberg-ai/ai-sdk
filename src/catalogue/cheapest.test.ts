// F080.2 — cheapestModels answers the question asked: one vendor, one kind, priced and alive.
import { expect, test } from "bun:test";
import { cheapestModels } from "./pricing-api.js";

test("'cheapest from mistral' is a chat model that still exists — never moderation/embedding/gone", () => {
  const r = cheapestModels({ vendor: "mistral", limit: 50 });
  expect(r.results.length).toBeGreaterThan(0);
  for (const x of r.results) {
    expect(x.kind).toBe("chat");
    expect(x.upstream).not.toBe("gone");
    expect(x.model).not.toMatch(/moderation|embed/);
  }
  const b = r.results.map((x) => x.blendedPer1M);
  expect(b).toEqual([...b].sort((p, q) => p - q));
});

test("direct-only for mistral: the cheapest of OUR curated Mistral prices, callable as-is", () => {
  // Curated table (changed only by hand), so a strict answer is stable here.
  const top = cheapestModels({ vendor: "mistral", route: "direct" }).results[0]!;
  expect({ model: top.model, callAs: top.callAs, route: top.route, region: top.region }).toEqual({
    model: "mistralai/ministral-3b-2512", callAs: { provider: "mistral", model: "ministral-3b-2512" }, route: "direct", region: "eu",
  });
  expect(top.blendedPer1M).toBeCloseTo((3 * top.inputPer1M + top.outputPer1M) / 4, 12);
});

test("kind is honoured: mistral embedding → mistral-embed first", () => {
  expect(cheapestModels({ vendor: "mistral", kind: "embedding" }).results[0]!.model).toBe("mistral-embed");
});

test("every row carries price, source, date, route and caveats; OpenRouter-catalogue rows say so", () => {
  const rows = cheapestModels({ vendor: "openai", limit: 100 }).results;
  for (const x of rows) {
    for (const k of ["inputPer1M", "outputPer1M", "blendedPer1M", "source", "route", "region", "upstream"] as const) expect(x[k]).toBeDefined();
    expect(Array.isArray(x.caveats)).toBe(true);
  }
  const inv = rows.find((x) => x.source === "inventory")!;
  expect(inv.caveats).toContain("price from the OpenRouter catalogue (OpenRouter's rate), not the vendor's own price page");
  expect(rows.some((x) => x.model.endsWith(":batch"))).toBe(false);
});

test("a stale table says so on the answer", () => {
  const r = cheapestModels({ vendor: "mistral", nowMs: Date.parse("2030-01-01") });
  expect(r.stale).toBe(true);
  expect(r.caveats.some((c) => c.startsWith("price table is stale"))).toBe(true);
  expect(cheapestModels({ vendor: "mistral", nowMs: Date.parse(r.checkedAt) + 86_400_000 }).stale).toBe(false);
});

test("an unknown vendor returns nothing — not a near-miss from someone else", () => {
  const r = cheapestModels({ vendor: "nobody" });
  expect(r.results).toEqual([]);
  expect(r.caveats).toEqual(['no chat model priced for vendor "nobody" with these filters']);
});
