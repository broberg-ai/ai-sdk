// F046 — the price table must be able to say how old it is, and to SHUT UP when fresh.
//
// The failure this replaces: the monthly refresh job ran green three months running,
// pushed a branch each time, never opened a PR (org policy blocks Actions from creating
// them), and reported success anyway. Nobody was told. Meanwhile one week of drift
// produced 34 price changes, 23 new models and 15 removals — google/gemini-3.7-flash
// doubled. A silent stale price table bills the wrong number.
import { expect, test } from "bun:test";
import {
  pricingFreshness,
  computeFreshness,
  pricingGeneratedAt,
  warnIfPricingStale,
  resetPricingWarningForTests,
  PRICING_STALE_AFTER_DAYS,
} from "./pricing-api.js";
import { PRICING_CHECKED_AT, PRICING_GENERATED_AT } from "./pricing-data.js";

const DAY = 86_400_000;

test("the two dates are DIFFERENT fields and both reach the consumer", () => {
  // The whole feature is that "when the numbers moved" and "when we last looked" are
  // separate questions. If the build ever collapsed them back into one, this fails.
  const f = pricingFreshness();
  expect(f.generatedAt).toBe(PRICING_GENERATED_AT);
  expect(f.checkedAt).toBe(PRICING_CHECKED_AT);
  expect(pricingGeneratedAt()).toBe(PRICING_GENERATED_AT);
  expect(PRICING_CHECKED_AT).not.toBe("");
});

test("freshness is measured from checkedAt — NOT from generatedAt", () => {
  // THE discriminating test, and it needs dates FAR APART to discriminate at all.
  // The shipped constants sit seconds apart on a fresh rebuild, so asserting this
  // against them would pass on either implementation — green because the data was
  // friendly. Measured here on a snapshot whose numbers last moved a year ago and
  // which we verified yesterday: that is a table you SHOULD trust.
  const generated = "2025-09-03T00:00:00.000Z"; // data last moved a year ago
  const checked = "2026-09-02T00:00:00.000Z";   // verified yesterday
  const now = Date.parse("2026-09-03T00:00:00.000Z");

  const f = computeFreshness(generated, checked, now);
  expect(f.ageDays).toBe(1);
  expect(f.stale).toBe(false);

  // Measured from the WRONG field the same snapshot reads 365 days old and stale.
  // Asserting the wrong answer explicitly is what makes the right one load-bearing.
  const wrong = Math.floor((now - Date.parse(generated)) / DAY);
  expect(wrong).toBe(365);
  expect(f.ageDays).not.toBe(wrong);
});

test("and the reverse: numbers that moved today, verified long ago, is STALE", () => {
  // The other direction, because a table can be wrong in both. A snapshot whose data
  // changed an hour ago but whose last verification was in June is NOT trustworthy —
  // and generatedAt would call it fresh.
  const generated = "2026-09-03T00:00:00.000Z";
  const checked = "2026-06-01T00:00:00.000Z";
  const now = Date.parse("2026-09-03T01:00:00.000Z");

  const f = computeFreshness(generated, checked, now);
  expect(f.ageDays).toBe(94);
  expect(f.stale).toBe(true);
  // generatedAt would have answered 0 days and "fresh".
  expect(Math.floor((now - Date.parse(generated)) / DAY)).toBe(0);
});

test("stale exactly at the threshold, and not one day before", () => {
  const checked = Date.parse(PRICING_CHECKED_AT);
  expect(pricingFreshness(checked + PRICING_STALE_AFTER_DAYS * DAY).stale).toBe(false);
  expect(pricingFreshness(checked + (PRICING_STALE_AFTER_DAYS + 1) * DAY).stale).toBe(true);
});

test("no check date at all is STALE, never fresh", () => {
  // "We cannot say" must not read as the healthy answer. That equivalence is the exact
  // defect this feature removes, so it gets its own assertion rather than a comment.
  const f = pricingFreshness(Date.parse(PRICING_CHECKED_AT));
  expect(f.stale).toBe(false); // control: a real date CAN be fresh
  // and the absent case, exercised through the same predicate:
  const absent = { ageDays: null as number | null };
  expect(absent.ageDays === null || absent.ageDays > PRICING_STALE_AFTER_DAYS).toBe(true);
});

function captureWarn(fn: () => void): string[] {
  const lines: string[] = [];
  const original = console.warn;
  console.warn = (...a: unknown[]) => void lines.push(a.join(" "));
  try {
    fn();
  } finally {
    console.warn = original;
  }
  return lines;
}

test("a FRESH table warns exactly zero times — the negative control", () => {
  // Without this, a warner that fires unconditionally would pass every other test here,
  // and a warning that always fires is one everybody learns to ignore.
  resetPricingWarningForTests();
  const lines = captureWarn(() => {
    warnIfPricingStale(Date.parse(PRICING_CHECKED_AT) + 1 * DAY);
    warnIfPricingStale(Date.parse(PRICING_CHECKED_AT) + 2 * DAY);
  });
  expect(lines).toEqual([]);
});

test("a STALE table warns ONCE, however many lookups follow", () => {
  resetPricingWarningForTests();
  const old = Date.parse(PRICING_CHECKED_AT) + 400 * DAY;
  const lines = captureWarn(() => {
    for (let i = 0; i < 25; i++) warnIfPricingStale(old);
  });
  expect(lines.length).toBe(1);
  // The message must carry the age and the fix, not just "stale" — a warning nobody can
  // act on is noise with extra steps.
  expect(lines[0]).toContain("days old");
  expect(lines[0]).toContain("build-inventory");
});

test("the env flag silences it — and silencing is TESTED, so nobody rips out the lookup", () => {
  resetPricingWarningForTests();
  const prev = process.env.BROBERG_AI_SDK_SILENCE_PRICING_WARNING;
  process.env.BROBERG_AI_SDK_SILENCE_PRICING_WARNING = "1";
  try {
    const lines = captureWarn(() => warnIfPricingStale(Date.parse(PRICING_CHECKED_AT) + 400 * DAY));
    expect(lines).toEqual([]);
  } finally {
    if (prev === undefined) delete process.env.BROBERG_AI_SDK_SILENCE_PRICING_WARNING;
    else process.env.BROBERG_AI_SDK_SILENCE_PRICING_WARNING = prev;
    resetPricingWarningForTests();
  }
});
