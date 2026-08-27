// F040.2 — OpenAI's automatic prompt caching. Measured 2026-08-27 against the real
// API: an identical 7,615-token prefix reported cached_tokens 0 on call 1 and 7,552
// on calls 2-5, so prompt_tokens INCLUDES the cached ones (the shared
// openai-compatible path already subtracts them).
import { describe, expect, test } from "bun:test";
import { computeCost } from "../cost/usage.js";
import { PRICING } from "../cost/pricing.js";

describe("OpenAI cached input is 50% — NOT the 10% Mistral and Gemini charge", () => {
  test("gpt-4o and gpt-4o-mini carry exactly half their input rate", () => {
    // The single most important assertion in this file. Assuming one uniform
    // cross-provider discount would have understated OpenAI's cost by 4x on the
    // cached half — the rates were read per provider, not generalised.
    expect(PRICING["openai:gpt-4o"]!.cacheReadPer1M).toBe(1.25);
    expect(PRICING["openai:gpt-4o-mini"]!.cacheReadPer1M).toBe(0.075);
    for (const k of ["openai:gpt-4o", "openai:gpt-4o-mini"]) {
      const p = PRICING[k]!;
      expect({ k, half: p.cacheReadPer1M }).toEqual({ k, half: p.inputPer1M * 0.5 });
    }
  });

  test("openai's rate is NOT gemini's — the two must not converge by a later edit", () => {
    const openai = PRICING["openai:gpt-4o"]!;
    const gemini = PRICING["gemini:gemini-2.5-flash"]!;
    expect(openai.cacheReadPer1M! / openai.inputPer1M).toBeCloseTo(0.5, 6);
    expect(gemini.cacheReadPer1M! / gemini.inputPer1M).toBeCloseTo(0.1, 6);
  });

  test("each rate's version string names where the number came from", () => {
    expect(PRICING["openai:gpt-4o"]!.version).toContain("openai.com");
    expect(PRICING["openai:gpt-4o-mini"]!.version).toContain("openai.com");
  });

  test("embeddings deliberately have NO cached price — they do not cache", () => {
    // An absent row here is a decision, not an omission: OpenAI's pricing page
    // lists no cached rate for them, so inventing one would be the error this
    // whole card exists to close.
    expect(PRICING["openai:text-embedding-3-small"]!.cacheReadPer1M).toBeUndefined();
    expect(PRICING["openai:text-embedding-3-large"]!.cacheReadPer1M).toBeUndefined();
  });

  test("the discount is real, computed on the measured token split", () => {
    // The live numbers: prompt 7615, of which 7552 cached.
    const uncached = computeCost("openai", "gpt-4o-mini", 7615, 2, 0);
    const cached = computeCost("openai", "gpt-4o-mini", 63, 2, 7552);
    expect(uncached).toBeCloseTo(7615 * 0.15e-6 + 2 * 0.6e-6, 12);
    expect(cached).toBeCloseTo(63 * 0.15e-6 + 7552 * 0.075e-6 + 2 * 0.6e-6, 12);
    expect(cached).toBeLessThan(uncached);
    // Half off the prompt, not 90% — a weaker discount than Mistral's, correctly.
    expect(cached / uncached).toBeGreaterThan(0.4);
    expect(cached / uncached).toBeLessThan(0.6);
  });
});
