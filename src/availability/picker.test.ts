// F022.6 — the registry as a model picker reads it (scout's Admin › AI key).
//
// Scout measured on 0.61.1: listModels({provider:"openai"}) held only an embedding
// model, Anthropic stopped at opus-4-8, and no row said what it was or which one to
// pre-select. These tests hold the picker's contract, not today's model names.
import { expect, test } from "bun:test";
import { getPrice } from "../cost/pricing.js";
import { DEFAULT_TIER_MAP } from "../routing/tier-map.js";
import { listModels } from "./resolve.js";

const PICKER_PROVIDERS = ["anthropic", "openai", "mistral", "gemini"];

test("openai offers chat models — cheap, standard and strong — beside its embedding model", () => {
  const rows = listModels({ provider: "openai" });
  const chat = rows.filter((r) => r.kind === "chat");
  expect(chat.length).toBeGreaterThanOrEqual(3);
  expect(new Set(chat.map((r) => r.grade).filter(Boolean))).toEqual(new Set(["cheap", "standard", "strong"]));
  expect(rows.find((r) => r.id === "text-embedding-3-small")?.kind).toBe("embedding");
});

test("anthropic lists the live Claude 5 family (GET /v1/models, 2026-10-11) and keeps the old rows", () => {
  const ids = new Set(listModels({ provider: "anthropic" }).map((r) => r.id));
  for (const id of ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5", "claude-fable-5-1", "claude-opus-5", "claude-sonnet-5"]) {
    expect({ id, listed: ids.has(id) }).toEqual({ id, listed: true });
  }
  // Removing a row would turn a passing requireKnown gate into a refusal.
  for (const id of ["claude-haiku-4-5", "claude-sonnet-4-6", "claude-opus-4-8", "claude-fable-5"]) expect(ids.has(id)).toBe(true);
});

test("every row says what it is", () => {
  for (const r of listModels()) expect(["chat", "embedding", "judge"]).toContain(r.kind);
});

test("exactly one default per picker provider — priced, available, not floating", () => {
  for (const provider of PICKER_PROVIDERS) {
    const defaults = listModels({ provider }).filter((r) => r.default);
    expect({ provider, count: defaults.length }).toEqual({ provider, count: 1 });
    const d = defaults[0]!;
    expect(d.kind).toBe("chat");
    expect(d.available).toBe(true);
    expect(d.floating).toBeUndefined();
    expect({ id: d.id, priced: getPrice(provider, d.id) !== undefined }).toEqual({ id: d.id, priced: true });
  }
});

test("mistral's default is what the smart tier calls — one source", () => {
  const d = listModels({ provider: "mistral" }).find((r) => r.default)!;
  expect(d.id).toBe(DEFAULT_TIER_MAP.smart.model);
});

test("-latest ids are marked floating and are never a default (D-385d97)", () => {
  const latest = listModels().filter((r) => r.id.endsWith("-latest"));
  expect(latest.length).toBeGreaterThan(0); // mistral-*-latest and jev-latest exist today
  for (const r of latest) {
    expect({ id: r.id, floating: r.floating }).toEqual({ id: r.id, floating: true });
    expect(r.default).toBeUndefined();
  }
  for (const r of listModels().filter((r) => !r.id.endsWith("-latest"))) expect(r.floating).toBeUndefined();
});

test("every anthropic/openai chat row is priced — a picker must not offer a route that bills $0", () => {
  // computeCost returns 0 for an unpriced model, so an unpriced row passes every
  // budget (security review 2026-10-04, M2). Suspended rows are excluded: nobody
  // can call them.
  const unpriced = listModels()
    .filter((r) => (r.provider === "anthropic" || r.provider === "openai") && r.kind === "chat" && r.available)
    .filter((r) => getPrice(r.provider, r.id) === undefined)
    .map((r) => `${r.provider}:${r.id}`);
  expect({ unpriced }).toEqual({ unpriced: [] });
});

test("an OpenAI dated snapshot prices like its base model", () => {
  expect(getPrice("openai", "gpt-5.4-mini-2026-03-17")).toEqual(getPrice("openai", "gpt-5.4-mini"));
  expect(getPrice("openai", "gpt-5.4-mini-2026-03-17")?.inputPer1M).toBe(0.75);
  // The Anthropic form keeps working.
  expect(getPrice("anthropic", "claude-haiku-4-5-20251001")).toEqual(getPrice("anthropic", "claude-haiku-4-5"));
});

test("gemini rows carry grade and a default (F022.7, jam #3808)", () => {
  const g = Object.fromEntries(listModels({ provider: "gemini" }).map((r) => [r.id, { grade: r.grade, default: r.default }]));
  expect(g["gemini-2.5-flash-lite"]).toEqual({ grade: "cheap", default: undefined });
  expect(g["gemini-2.5-flash"]).toEqual({ grade: "standard", default: true });
});
