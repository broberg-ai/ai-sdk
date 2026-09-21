// F057.2 — the two tables must not disagree about DeepSeek.
//
// The bug: pricing.ts carried OFFICIAL DeepSeek rates and providers/deepseek.ts
// shipped an adapter (F030.2), while the availability registry had zero DeepSeek
// rows. Our own CLAUDE.md tells a gating consumer to pass `requireKnown: true` —
// and with that flag the gate refused a route we had built, priced and given an
// F-number. Reported by pitch (ref 28546) via components.
//
// Adding the rows fixes today. This file is what stops it coming back: the drift,
// not the rows, is the defect. Someone adding a price without a row is the exact
// move that created it.
import { expect, test } from "bun:test";
import { PRICING } from "../cost/pricing.js";
import { regionOfHost, regionOfProvider } from "../cost/region.js";
import { DEFAULT_BASE_URLS } from "../cost/default-hosts.js";
import { listModels, resolveModel } from "./resolve.js";

const priced = (provider: string): string[] =>
  Object.keys(PRICING)
    .filter((k) => k.startsWith(`${provider}:`))
    .map((k) => k.slice(provider.length + 1));

test("every priced deepseek: model has an availability-registry row", () => {
  const tracked = new Set(listModels({ provider: "deepseek" }).map((m) => m.id));
  const missing = priced("deepseek").filter((m) => !tracked.has(m));
  // Named in the failure on purpose — "0 !== 1" would send the next reader to the
  // wrong table. The fix is a row in availability/registry.ts, not a deleted price.
  expect({ missing }).toEqual({ missing: [] });
});

test("a gating consumer can reach DeepSeek — the reported defect", () => {
  for (const id of ["deepseek-chat", "deepseek-reasoner"]) {
    const r = resolveModel(id, { requireKnown: true });
    expect(r.ok).toBe(true);
    expect(r.provider).toBe("deepseek");
    expect(r.model).toBe(id);
  }
});

test("listModels surfaces DeepSeek for a UI picker, with the sunset in the note", () => {
  const rows = listModels({ provider: "deepseek" });
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    expect(row.provider).toBe("deepseek");
    // A picker that renders only id + available would hide that both ids were
    // documented to sunset. The note is the only place that can say it.
    expect(row.note).toContain("2026-07-24");
  }
});

test("fail-open for GENUINELY untracked ids is unchanged", () => {
  // The registry is a liveness view; an id we do not track must never be blocked
  // by default. Only requireKnown turns that into a refusal. Adding DeepSeek must
  // not have moved either half.
  expect(resolveModel("smrt", { requireKnown: true }).ok).toBe(false);
  expect(resolveModel("smrt").ok).toBe(true);
  expect(resolveModel("some-model-we-never-heard-of").status).toBe("unknown");
});

test("DeepSeek is still CN — this card must not make a non-EU route look EU-safe", () => {
  // The residency claim is read off the HOST, not off the provider's name: that is
  // the fleet rule, and regionOfProvider is the exported helper a consumer must NOT
  // build a guard on. Both are asserted so neither can drift into saying "eu".
  expect(regionOfHost(DEFAULT_BASE_URLS.deepseek)).toBe("cn");
  expect(regionOfProvider("deepseek")).toBe("cn");
  expect(regionOfHost("api.deepseek.com")).toBe("cn"); // bare hostname, v0.36.6+
});

test("deepseek-v4-flash on the DIRECT api stays refused while it has no price", () => {
  // Deliberate, not an oversight. providers/deepseek.ts recommends this id going
  // forward, but PRICING has no `deepseek:deepseek-v4-flash` entry — only the
  // openrouter one. A registry row would pass the gate for a route that bills
  // nothing, which is the same fail-green shape as the bug this card fixes.
  // When a real rate lands, add BOTH and delete this test.
  expect(PRICING["deepseek:deepseek-v4-flash"]).toBeUndefined();
  expect(resolveModel("deepseek-v4-flash", { requireKnown: true }).ok).toBe(false);
});
