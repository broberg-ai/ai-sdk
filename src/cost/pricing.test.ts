import { expect, test } from "bun:test";
import { getPrice } from "./pricing.js";
import { computeCost } from "./usage.js";
import { DEFAULT_TIER_MAP } from "../routing/tier-map.js";

test("pricing covers every model in DEFAULT_TIER_MAP", () => {
  for (const spec of Object.values(DEFAULT_TIER_MAP)) {
    expect(getPrice(spec.provider, spec.model)).toBeDefined();
  }
});

test("MiniMax M2.7 is priced via openrouter", () => {
  expect(getPrice("openrouter", "minimax/minimax-m2.7")).toBeDefined();
});

test("DeepSeek V4 is priced via openrouter (live rate, re-read 2026-10-02)", () => {
  // CN-hosted, non-GDPR — but a strong cheap route post-15-Jun. Must not log $0.
  expect(getPrice("openrouter", "deepseek/deepseek-v4-pro")).toBeDefined();
  expect(computeCost("openrouter", "deepseek/deepseek-v4-pro", 1_000_000, 1_000_000)).toBeCloseTo(
    0.6264, // $0.2088 in + $0.4176 out
    6,
  );
  expect(getPrice("openrouter", "deepseek/deepseek-v4-flash")).toBeDefined();
});

test("gemini-direct is priced under provider 'gemini' (not 'google')", () => {
  // The gemini adapter stamps usage.provider = "gemini"; the pricing key must
  // match or every gemini-direct call silently logs $0. Regression: was keyed
  // "google:" → getPrice("gemini", …) missed → cost under-counted.
  expect(getPrice("gemini", "gemini-2.5-flash")).toBeDefined();
  expect(computeCost("gemini", "gemini-2.5-flash", 1000, 500)).toBeCloseTo(0.00155, 9);
});

test("computeCost — sonnet 1M in + 1M out = $18.00", () => {
  expect(computeCost("anthropic", "claude-sonnet-4-6", 1_000_000, 1_000_000)).toBeCloseTo(
    18.0,
    6,
  );
});

test("computeCost — haiku 1000 in + 500 out = $0.0035", () => {
  // Was $0.0028, pinned against a table row that was WRONG: $0.80/$4.00 where
  // Anthropic publishes $1.00/$5.00 (F048). The test did its job — it pinned the
  // behaviour — and pinned an error, which is what a test does when the value it
  // guards was never checked against the source. 1000×$1 + 500×$5 per 1M = $0.0035.
  expect(computeCost("anthropic", "claude-haiku-4-5", 1000, 500)).toBeCloseTo(0.0035, 9);
});

test("computeCost — a DATED snapshot prices as its base model", () => {
  // The id upmetrics actually sent, 19,456 times. getPrice has handled this since F012;
  // the exported catalogue had not, which is the other half of F048.
  expect(computeCost("anthropic", "claude-haiku-4-5-20251001", 1000, 500)).toBeCloseTo(0.0035, 9);
});

test("computeCost — gpt-4o-mini 2000 in + 1000 out = $0.0009", () => {
  expect(computeCost("openai", "gpt-4o-mini", 2000, 1000)).toBeCloseTo(0.0009, 9);
});

test("computeCost — embedding 1M input = $0.02 (no output)", () => {
  expect(computeCost("openai", "text-embedding-3-small", 1_000_000, 0)).toBeCloseTo(0.02, 6);
});

test("computeCost — anthropic cache-read priced below input rate", () => {
  // sonnet: 1M cache-read tokens @ 0.3/1M = $0.30 (vs $3.00 at input rate)
  expect(computeCost("anthropic", "claude-sonnet-4-6", 0, 0, 1_000_000, 0)).toBeCloseTo(0.3, 6);
});

test("computeCost returns 0 for an unknown model (never throws)", () => {
  expect(computeCost("acme", "does-not-exist", 1000, 1000)).toBe(0);
});

test("every pricing entry carries a version", () => {
  const spec = DEFAULT_TIER_MAP.smart;
  expect(getPrice(spec.provider, spec.model)?.version).toBeString();
});

test("Mistral Large 4 is priced at LIST price, Large 3 unchanged (F074.1)", () => {
  // Measured 2026-10-08: docs.mistral.ai lists $1.36 / $0.14 cached (= 0.136 shown to the cent) / $4.18, with a 50%
  // preview sale we deliberately do not book (it would under-report the day it ends).
  for (const id of ["mistral-large-4", "mistral-large-4-0"]) {
    expect(computeCost("mistral", id, 1_000_000, 1_000_000)).toBeCloseTo(5.54, 9);
    expect(getPrice("mistral", id)?.cacheReadPer1M).toBe(0.136);
  }
  // `-latest` still answers as Large 3 (2512) — moving it is Christian's call, not a price edit.
  for (const id of ["mistral-large-latest", "mistral-large-2512"]) {
    expect(computeCost("mistral", id, 1_000_000, 1_000_000)).toBeCloseTo(2.0, 9);
  }
});

test("every model Anthropic lists for our key is priced (F075, list read 2026-10-08)", () => {
  const listed = [
    "claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5", "claude-fable-5-1", "claude-opus-5",
    "claude-sonnet-5", "claude-fable-5", "claude-opus-4-8", "claude-opus-4-7", "claude-sonnet-4-6",
    "claude-opus-4-6", "claude-opus-4-5-20251101", "claude-haiku-4-5-20251001", "claude-sonnet-4-5-20250929",
  ];
  expect(listed.filter((m) => !getPrice("anthropic", m))).toEqual([]);
});

test("cache-read is not 0.1x everywhere: Opus/Sonnet 5.5 at 0.05x, Fable 5.1 at 0.025x (F075)", () => {
  expect(getPrice("anthropic", "claude-opus-5-5")?.cacheReadPer1M).toBe(0.2);
  expect(getPrice("anthropic", "claude-sonnet-5-5")?.cacheReadPer1M).toBe(0.1);
  expect(getPrice("anthropic", "claude-fable-5-1")?.cacheReadPer1M).toBe(0.25);
});

test("Haiku 5.5 is priced by prompt length: 5x above 100k tokens (F075)", () => {
  // 50k in + 1k out at $0.10/$0.50 = 0.005 + 0.0005
  expect(computeCost("anthropic", "claude-haiku-5-5", 50_000, 1_000)).toBeCloseTo(0.0055, 12);
  // 150k in + 1k out at $0.50/$2.50 = 0.075 + 0.0025
  expect(computeCost("anthropic", "claude-haiku-5-5", 150_000, 1_000)).toBeCloseTo(0.0775, 12);
  // Cached parts count toward the prompt: 60k fresh + 60k cache-read crosses the line.
  expect(computeCost("anthropic", "claude-haiku-5-5", 60_000, 0, 60_000)).toBeCloseTo(0.03 + 0.003, 12);
  // Exactly at the line is still the low tier ("over 100,000").
  expect(computeCost("anthropic", "claude-haiku-5-5", 100_000, 0)).toBeCloseTo(0.01, 12);
});
