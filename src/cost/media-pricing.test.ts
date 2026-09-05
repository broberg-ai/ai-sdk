// F050 — the media half of the price table, and the guard that keeps it the only half.
//
// super measured the state this closes against 0.38.0: pricingFreshness() answered
// {ageDays: 0, stale: false} about a table where per-second prices could not exist.
// "Covered and fresh" and "not covered at all" were the same answer from a call site.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MEDIA_PRICING,
  MEDIA_PRICING_CHECKED_AT,
  DEFAULT_CLIP_SEC,
  getMediaPrice,
  mediaUnitCounts,
} from "./media-pricing.js";
import { computeFreshness, pricingFreshness, getModelPrice, listMediaPrices, listModelPrices, PRICING_STALE_AFTER_DAYS } from "../catalogue/pricing-api.js";

const PROVIDERS = join(import.meta.dir, "..", "providers");

describe("F050 — the billed numbers did not move", () => {
  // The non-goal, pinned. A refactor that silently repriced a call would be a worse
  // bug than the blindness it fixes. Both numbers independently confirmed by super
  // on 0.38.0, BEFORE the move.
  test("Veo is still $0.40/s on both routes, Kling still $0.07/s", () => {
    expect(getMediaPrice("gemini", "veo-3.1-generate-preview")?.usd).toBe(0.4);
    expect(getMediaPrice("vertex", "veo-3.1-generate-preview")?.usd).toBe(0.4);
    expect(getMediaPrice("gemini", "veo-3.1-fast-generate-preview")?.usd).toBe(0.1);
    expect(getMediaPrice("gemini", "veo-3.1-lite-generate-preview")?.usd).toBe(0.05);
    expect(getMediaPrice("fal", "fal-ai/kling-video/v2.5-turbo/pro/image-to-video")?.usd).toBe(0.07);
    expect(getMediaPrice("bfl", "flux-pro-1.1-ultra-finetuned")?.usd).toBe(0.06);
    expect(getMediaPrice("fal", "fal-ai/flux/schnell")?.usd).toBe(0.003);
  });

  test("the two Veo routes read the SAME object — a correction cannot land on one and miss the other", () => {
    const veo = Object.entries(MEDIA_PRICING)
      .filter(([k, v]) => k.startsWith("gemini:veo-") && v.unit === "per_sec")
      .map(([k]) => k.slice("gemini:".length));
    expect(veo.length).toBeGreaterThan(0); // an empty loop asserts nothing
    for (const model of veo) {
      expect(getMediaPrice("vertex", model)?.usd).toBe(getMediaPrice("gemini", model)!.usd);
    }
  });

  test("an unknown model is undefined, never a fabricated 0", () => {
    expect(getMediaPrice("gemini", "veo-99-imaginary")).toBeUndefined();
    expect(getMediaPrice("fal", "fal-ai/nothing")).toBeUndefined();
  });
});

describe("F050 — no adapter may keep its own price table (the form is forbidden, not just today's copies)", () => {
  // AC1 asks for a test that forbids the SHAPE, not a grep run once. The four tables
  // this replaces were each individually reasonable; what made them a bug was that
  // there were four.
  const sources = readdirSync(PROVIDERS)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => ({ file: f, text: readFileSync(join(PROVIDERS, f), "utf8") }));

  /** Strip comments before scanning. Three times in this repo a rule's own prose
   *  failed the rule it was explaining — the ban lived in the comment describing it. */
  const stripComments = (s: string): string =>
    s.replace(/\/\*(?:(?!\*\/)[\s\S])*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

  test("no provider file declares a per-second or per-image price constant", () => {
    const offenders: string[] = [];
    for (const { file, text } of sources) {
      const code = stripComments(text);
      // A const whose NAME claims to hold a price, assigned a number or a numeric map.
      const re = /\bconst\s+([A-Za-z_$][\w$]*(?:PRICE|PRICING|PER_SEC|PER_IMAGE)[\w$]*)\s*(?::[^=]*)?=\s*(?:\{|[\d.])/g;
      for (const m of code.matchAll(re)) offenders.push(`${file}: ${m[1]}`);
    }
    expect(offenders).toEqual([]);
  });

  test("CONTROL — the scanner can actually see such a declaration", () => {
    // Without this, an over-eager comment-stripper that deleted the whole file would
    // pass the test above and prove nothing. This is the negative control for the
    // guard itself, not for the code it guards.
    const planted = `import x from "y";\nconst FAKE_VIDEO_PRICE_PER_SEC: Record<string, number> = {\n  "a": 0.4,\n};\n`;
    const re = /\bconst\s+([A-Za-z_$][\w$]*(?:PRICE|PRICING|PER_SEC|PER_IMAGE)[\w$]*)\s*(?::[^=]*)?=\s*(?:\{|[\d.])/g;
    expect([...stripComments(planted).matchAll(re)].map((m) => m[1])).toEqual(["FAKE_VIDEO_PRICE_PER_SEC"]);
  });

  test("every adapter that bills a non-token unit reads the shared table", () => {
    // Ten files, not the four on the card. The guard above found the other six.
    for (const file of ["gemini.ts", "vertex.ts", "fal.ts", "bfl.ts", "azure.ts",
                        "elevenlabs.ts", "deepl.ts", "mistral.ts", "openrouter.ts", "openai.ts"]) {
      const text = readFileSync(join(PROVIDERS, file), "utf8");
      expect(text).toContain("getMediaPrice");
    }
  });

  test("every ?? default-duration site is stamped, all THREE of them", () => {
    // AC5: fixing one of three is the "fix the instance, not the class" error this
    // repo made five times in a day. Asserted per file so a partial fix cannot pass.
    for (const file of ["gemini.ts", "vertex.ts", "fal.ts"]) {
      const text = readFileSync(join(PROVIDERS, file), "utf8");
      expect(text).toContain("DEFAULT_CLIP_SEC");
      expect(text).toContain('usage.costBasis = req.durationSec === undefined ? "estimated" : "computed"');
    }
  });
});

describe("F050 — freshness says what it COVERS", () => {
  const NOW = Date.parse("2026-09-05T00:00:00Z");
  const fresh = "2026-09-01";
  const ancient = "2025-01-01";

  test("a unit with ZERO rows produces a caveat naming it — the reported state", () => {
    const f = computeFreshness("2026-09-01", fresh, NOW, [
      { unit: "per_1m_tokens", count: 448, checkedAt: fresh },
      { unit: "per_sec", count: 0, checkedAt: fresh },
    ]);
    // The headline is still "fresh" — and that is precisely why the caveat must exist.
    expect(f.stale).toBe(false);
    expect(f.caveats).toHaveLength(1);
    expect(f.caveats[0]).toContain("per_sec");
    expect(f.caveats[0]).toContain("0 rows");
  });

  test("NEGATIVE CONTROL — a table covering every unit answers clean, no caveats", () => {
    // Without this the caveat could be unconditional noise, and noise gets ignored.
    const f = computeFreshness("2026-09-01", fresh, NOW, [
      { unit: "per_1m_tokens", count: 448, checkedAt: fresh },
      { unit: "per_sec", count: 6, checkedAt: fresh },
      { unit: "per_image", count: 6, checkedAt: fresh },
    ]);
    expect(f.caveats).toEqual([]);
    expect(f.units.every((u) => !u.stale)).toBe(true);
  });

  test("a COVERED but STALE unit gets a different caveat than an uncovered one", () => {
    // "We never priced this" and "our price is old" call for different actions.
    const f = computeFreshness("2026-09-01", fresh, NOW, [
      { unit: "per_sec", count: 6, checkedAt: ancient },
    ]);
    expect(f.caveats).toHaveLength(1);
    expect(f.caveats[0]).toContain("last verified 2025-01-01");
    expect(f.caveats[0]).not.toContain("0 rows");
    expect(f.units[0]!.stale).toBe(true);
  });

  test("a unit with no check date at all is stale, not fresh", () => {
    const f = computeFreshness("2026-09-01", fresh, NOW, [{ unit: "per_sec", count: 6, checkedAt: "" }]);
    expect(f.units[0]!.ageDays).toBeNull();
    expect(f.units[0]!.stale).toBe(true);
    expect(f.caveats[0]).toContain("never");
  });

  test("the SHIPPED table covers every unit the SDK can bill in, with no caveats", () => {
    const f = pricingFreshness();
    // Six media units + tokens. The form-forbidding test found ten hand-written price
    // constants beyond the four super reported; every one of them is a unit that would
    // otherwise have been "covered" by a freshness API that could not see it.
    expect(f.units.map((u) => u.unit).sort()).toEqual([
      "per_1k_chars", "per_1m_tokens", "per_image", "per_min", "per_page", "per_sec", "per_training",
    ]);
    // caveats FIRST, and asserted by VALUE: a bare `toBeGreaterThan(0)` on the count
    // goes red with "Expected: > 0, Received: 0" and never says WHICH unit is missing.
    // AC2 asks for a message that names it, so the failing assertion must print it.
    expect(f.caveats).toEqual([]);
    for (const u of f.units) expect(`${u.unit}=${u.count > 0}`).toBe(`${u.unit}=true`);
  });

  test("media rows carry their OWN check date, not the token snapshot's", () => {
    // Inheriting it would make an un-revised video price look freshly verified every
    // time the token job ran — the blindness wearing a check mark.
    const f = pricingFreshness();
    const perSec = f.units.find((u) => u.unit === "per_sec")!;
    expect(perSec.checkedAt).toBe(MEDIA_PRICING_CHECKED_AT);
    expect(perSec.checkedAt).not.toBe(f.checkedAt);
  });
});

describe("F050 — lookup vs listing", () => {
  test("getModelPrice finds a video model (it was undefined before)", () => {
    const p = getModelPrice("veo-3.1-generate-preview");
    expect(p?.unit).toBe("per_sec");
    if (!p || p.unit === "per_1m_tokens") throw new Error("expected a media row");
    expect(p.usd).toBe(0.4);
    expect(p.perSec).toBe(0.4);
    expect(p.checkedAt).toBe(MEDIA_PRICING_CHECKED_AT);
    // F050.2 — the token rates are GONE from a media row, not zeroed. super's finding:
    // "a field that does not apply and a price that is free are the same number".
    expect("inputPer1M" in p).toBe(false);
  });

  test("media rows stay OUT of listModelPrices — a 0 rate must never reach a price filter", () => {
    // The trap this avoids: findModelPrices({maxInputPer1M: 0.5}) handing back Veo
    // because its placeholder inputPer1M is 0, i.e. reading as free. A new wrong-layer
    // answer in the middle of fixing one.
    expect(listModelPrices().every((m) => m.unit === "per_1m_tokens")).toBe(true);
    const counts = mediaUnitCounts();
    expect(listMediaPrices().length).toBe(Object.values(counts).reduce((a, b) => a + b, 0));
    expect(listMediaPrices().some((m) => m.model === "veo-3.1-generate-preview")).toBe(true);
  });

  test("a token model keeps its own row — media is consulted LAST", () => {
    const p = getModelPrice("mistral-large-latest");
    expect(p?.unit).toBe("per_1m_tokens");
  });
});

describe("F050 — the table is maintainable by a human, because no job can refresh it", () => {
  test("MEDIA_PRICING_CHECKED_AT is a real date, not a placeholder", () => {
    expect(MEDIA_PRICING_CHECKED_AT).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Number.isFinite(Date.parse(MEDIA_PRICING_CHECKED_AT))).toBe(true);
  });

  test("every row names a source a human can re-check", () => {
    for (const [key, p] of Object.entries(MEDIA_PRICING)) {
      expect(p.source.length, `${key} has no source`).toBeGreaterThan(10);
      expect(p.checkedAt).toBe(MEDIA_PRICING_CHECKED_AT);
    }
  });

  test("the default clip length is the one the adapters bill", () => {
    expect(DEFAULT_CLIP_SEC).toBe(8);
  });

  test("the staleness threshold is the SAME one the token table uses", () => {
    // Two thresholds would drift until "stale" meant two things.
    expect(PRICING_STALE_AFTER_DAYS).toBe(35);
  });
});

describe("F050 — costBasis is stamped where the number is made", () => {
  test("a priced token model is 'computed'; an UNKNOWN one is 'unpriced', not a free 'computed'", async () => {
    const { freshUsage } = await import("./usage.js");
    const known = freshUsage({
      provider: "anthropic", model: "claude-haiku-4-5", transport: "http",
      capability: "chat", inputTokens: 1000, outputTokens: 100,
    });
    const unknown = freshUsage({
      provider: "anthropic", model: "no-such-model-9000", transport: "http",
      capability: "chat", inputTokens: 1000, outputTokens: 100,
    });
    expect(known.costBasis).toBe("computed");
    expect(known.costUsd).toBeGreaterThan(0);
    // The pair that used to be one value. Both cost 0-or-a-number; only the LABEL
    // separates "this was free" from "we have no idea".
    expect(unknown.costBasis).toBe("unpriced");
    expect(unknown.costUsd).toBe(0);
  });

  test("a Max-plan subprocess call is 'computed' — 0 is the real cost, not a gap", async () => {
    const { freshUsage } = await import("./usage.js");
    const u = freshUsage({
      provider: "anthropic", model: "whatever-cli", transport: "subprocess",
      capability: "chat", inputTokens: 5000, outputTokens: 500, subprocess: true,
    });
    expect(u.costUsd).toBe(0);
    expect(u.costBasis).toBe("computed");
  });

  test("the upmetrics sink forwards it as a tag, beside region", async () => {
    const { upmetricsSink } = await import("./sinks/upmetrics.js");
    let body: any;
    const sink = upmetricsSink({
      baseUrl: "https://upmetrics.org", apiKey: "uk_test", agentName: "t",
      fetch: (async (_u: string, init: RequestInit) => {
        body = JSON.parse(String(init.body));
        return new Response("{}", { status: 200 });
      }) as unknown as typeof fetch,
    });
    await sink.record({
      provider: "gemini", model: "veo-3.1-generate-preview", region: "us", transport: "http",
      inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0,
      costUsd: 3.2, costBasis: "estimated", latencyMs: 1, capability: "animate",
      ts: "2026-09-05T00:00:00.000Z",
    });
    // A DATA field, which was the whole point — a JSDoc note never reaches upmetrics.
    expect(body.tags.cost_basis).toBe("estimated");
    expect(body.cost_usd).toBe(3.2);
  });
});

describe("F050 — the two answers a media row must NOT give", () => {
  test("a bare id resolves to the SAME provider every time, not to spread order", async () => {
    const { getModelPrice } = await import("../catalogue/pricing-api.js");
    // Veo lives under gemini AND vertex with identical numbers. Last-write-wins made
    // the bare answer "vertex" for no reason a reader could infer.
    expect(getModelPrice("veo-3.1-generate-preview")?.provider).toBe("gemini");
    expect(getModelPrice("vertex:veo-3.1-generate-preview")?.provider).toBe("vertex");
    expect(getModelPrice("gemini:veo-3.1-generate-preview")?.provider).toBe("gemini");
    // …and whichever you get, the number is the same. That is what makes the bare
    // lookup safe to offer at all.
    const bare = getModelPrice("veo-3.1-generate-preview");
    const vx = getModelPrice("vertex:veo-3.1-generate-preview");
    if (!bare || bare.unit === "per_1m_tokens" || !vx || vx.unit === "per_1m_tokens") {
      throw new Error("expected media rows");
    }
    expect(bare.usd).toBe(vx.usd);
  });

  test("a media row's region is NOT a residency claim", async () => {
    const { getModelPrice } = await import("../catalogue/pricing-api.js");
    // vertex/bfl/fal take a configurable endpoint, so their region is a property of
    // the CALL. "other" is the honest answer here; a caller who reads it as a location
    // has used the wrong instrument, and the JSDoc says so at the field.
    expect(getModelPrice("vertex:veo-3.1-generate-preview")?.region).toBe("other");
    expect(getModelPrice("bfl:flux-pro-1.1-ultra-finetuned")?.region).toBe("other");
  });
});

describe("F050.2 — every media row is reachable by its own id, with its own unit", () => {
  // THE GUARD, not just the fix. Two defects shipped in 0.40.0 and both would have
  // been red here on the day: `perImage` carrying a per-minute price, and whisper-1
  // answered by a $0 token row so its per-minute price was unreachable.
  //
  // Same lesson as F050.1's form-forbidding scan, one storey down: ask about the
  // CLASS ("can every row be reached correctly?"), not about the instances you know.
  test("all 34 rows: same unit, same price, no alias from a foreign unit", async () => {
    const { getModelPrice } = await import("../catalogue/pricing-api.js");
    const wrong: string[] = [];
    for (const [key, expected] of Object.entries(MEDIA_PRICING)) {
      const got = getModelPrice(key);
      if (!got) { wrong.push(`${key}: not reachable at all`); continue; }
      // A model may be BOTH token- and media-priced (Gemini's image models). Then the
      // token row must CARRY the media price rather than hide it — the distinction
      // between that and whisper's fabricated $0 is the whole point of this guard.
      if (got.unit === "per_1m_tokens") {
        if (got.alsoBilled?.unit !== expected.unit || got.alsoBilled?.usd !== expected.usd) {
          wrong.push(`${key}: shadowed by a token row that does not carry the ${expected.unit} price`);
        }
        continue;
      }
      if (got.unit !== expected.unit) { wrong.push(`${key}: unit ${got.unit} ≠ ${expected.unit}`); continue; }
      if (got.usd !== expected.usd) wrong.push(`${key}: usd ${got.usd} ≠ ${expected.usd}`);
      // The alias fields may only ever appear on their OWN unit. This is the exact
      // assertion the two-armed ternary failed: it labelled per_min, per_page,
      // per_1k_chars and per_training rows as `perImage`.
      if ("perSec" in got && got.unit !== "per_sec") wrong.push(`${key}: perSec on a ${got.unit} row`);
      if ("perImage" in got && got.unit !== "per_image") wrong.push(`${key}: perImage on a ${got.unit} row`);
    }
    expect(wrong).toEqual([]);
  });

  test("CONTROL — the loop actually walks all six units, not just the two easy ones", () => {
    // Without this, a table that had lost every per_min row would pass the test above
    // by having nothing to check. "0 violations" and "never looked" again.
    const units = new Set(Object.values(MEDIA_PRICING).map((p) => p.unit));
    expect([...units].sort()).toEqual([
      "per_1k_chars", "per_image", "per_min", "per_page", "per_sec", "per_training",
    ]);
    expect(Object.keys(MEDIA_PRICING).length).toBeGreaterThan(30);
  });

  test("whisper-1 answers per-minute, not 'free' — it was shadowed by a $0 token row", async () => {
    const { getModelPrice } = await import("../catalogue/pricing-api.js");
    const p = getModelPrice("whisper-1");
    expect(p?.unit).toBe("per_min");
    if (!p || p.unit === "per_1m_tokens") throw new Error("still shadowed");
    expect(p.usd).toBe(0.006);
  });

  test("NEGATIVE CONTROL — removing it from the token table changed no BILLING", async () => {
    // computeCost answered 0 for whisper before (a 0/0 row) and answers 0 now (no row).
    // Same number, and transcribe overwrites it with the per-minute figure regardless —
    // so this fix moved only the public ANSWER, never a charge.
    const { computeCost } = await import("./usage.js");
    expect(computeCost("openai", "whisper-1", 1_000_000, 1_000_000)).toBe(0);
  });
});

describe("F050.2 — dual-priced models carry BOTH, they do not choose", () => {
  test("gemini image models keep real token rates AND expose the per-image price", async () => {
    const { getModelPrice } = await import("../catalogue/pricing-api.js");
    const p = getModelPrice("gemini-3-pro-image");
    if (p?.unit !== "per_1m_tokens") throw new Error("expected the token row");
    // Real, from OpenRouter's catalogue — these are NOT the fabricated 0 whisper had.
    expect(p.inputPer1M).toBeGreaterThan(0);
    // And the number that actually decides the bill for ai.image.
    expect(p.alsoBilled).toEqual({ unit: "per_image", usd: 0.134, checkedAt: MEDIA_PRICING_CHECKED_AT });
  });

  test("a token-only model has NO alsoBilled — the field is not decoration", async () => {
    const { getModelPrice } = await import("../catalogue/pricing-api.js");
    const p = getModelPrice("mistral-large-latest");
    if (p?.unit !== "per_1m_tokens") throw new Error("expected the token row");
    expect(p.alsoBilled).toBeUndefined();
  });
});
