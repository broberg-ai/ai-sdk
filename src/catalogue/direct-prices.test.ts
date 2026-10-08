// F076.2 — the providers' own price pages, read offline from fixtures shaped like the
// real pages (captured 2026-10-08).
import { expect, test } from "bun:test";
import { comparePrices, parseAnthropicPricing, parseMistralModelPage, renderPriceFindings, uncheckedRows, withAliases } from "./direct-prices.js";
import { diffCatalogue } from "./diff.js";

const ANTHROPIC_MD = `## Model pricing

| Model | Base input tokens | 5m cache writes | 1h cache writes | Cache hits and refreshes | Output tokens |
| :---- | :---- | :---- | :---- | :---- | :---- |
| Claude Opus 5.5 | $4 / MTok | $5 / MTok | $8 / MTok | $0.20 / MTok<sup>2</sup> | $20 / MTok |
| Claude Sonnet 5 | $2 / MTok<sup>3</sup> | $2.50 / MTok | $4 / MTok | $0.20 / MTok | $10 / MTok<sup>3</sup> |
| Claude Haiku 5.5 (for prompts up to 100,000 tokens) | $0.10 / MTok | $0.125 / MTok | $0.20 / MTok | $0.01 / MTok | $0.50 / MTok |
| Claude Haiku 5.5 (for prompts over 100,000 tokens) | $0.50 / MTok | $0.625 / MTok | $1 / MTok | $0.05 / MTok | $2.50 / MTok |

*<sup>1</sup> footnote*

## Batch processing

| Claude Opus 5.5 | $2 / MTok | $10 / MTok |
`;

test("Anthropic pricing.md: base rows, cache-read column, and Haiku 5.5's long-prompt tier", () => {
  const rows = parseAnthropicPricing(ANTHROPIC_MD);
  expect(rows.find((r) => r.model === "claude-opus-5-5")).toEqual({ provider: "anthropic", model: "claude-opus-5-5", inputPer1M: 4, outputPer1M: 20, cacheReadPer1M: 0.2 });
  expect(rows.find((r) => r.model === "claude-sonnet-5")?.inputPer1M).toBe(2); // footnote marker ignored
  expect(rows.find((r) => r.model === "claude-haiku-5-5")).toEqual({
    provider: "anthropic", model: "claude-haiku-5-5", inputPer1M: 0.1, outputPer1M: 0.5, cacheReadPer1M: 0.01,
    longPrompt: { aboveTokens: 100_000, inputPer1M: 0.5, outputPer1M: 2.5, cacheReadPer1M: 0.05 },
  });
  // The batch table further down must not overwrite the list price.
  expect(rows).toHaveLength(3);
});

const page = (body: string) => `<html><body><h1>x</h1><p>${body}</p><div>FEATURES</div></body></html>`;
const SALE = page(`52B active. <span>mistral-large-4</span> <span>+1</span> Speed Performance Modalities Context 1M Price USD EUR Sale price
  Original price: $1.36 Sale price: $0.68 Input /M Tokens Original price: $0.14 Sale price: $0.07 Cached input /M Tokens
  Original price: $4.18 Sale price: $2.09 Output /M Tokens Speed Performance Modalities Original price: $9 /M Tokens`);
const PLAIN = page(`6.5B active. mistral-small-2603 +1 Speed Performance Modalities Context 256k Price USD EUR $0.15 /M Tokens $0.6 /M Tokens Speed Performance $0.15 /M Tokens $0.6 /M Tokens`);
const NO_ALIAS = page(`mistral-large-2512 Speed Performance Price USD EUR $0.5 /M Tokens $1.5 /M Tokens`);
const PER_PAGE = page(`mistral-ocr-2512 Speed Performance Price USD EUR $2 /1000 Pages $3 /1000 Annotated Pages`);

test("Mistral page on SALE → the LIST price, never the sale price", () => {
  expect(parseMistralModelPage(SALE)).toEqual({ provider: "mistral", model: "mistral-large-4", inputPer1M: 1.36, cacheReadPer1M: 0.14, outputPer1M: 4.18 });
});

test("Mistral page without sale, with and without an alias count; per-page models are skipped", () => {
  expect(parseMistralModelPage(PLAIN)).toEqual({ provider: "mistral", model: "mistral-small-2603", inputPer1M: 0.15, outputPer1M: 0.6 });
  expect(parseMistralModelPage(NO_ALIAS)).toEqual({ provider: "mistral", model: "mistral-large-2512", inputPer1M: 0.5, outputPer1M: 1.5 });
  expect(parseMistralModelPage(PER_PAGE)).toBeUndefined();
});

test("a row at Small 3's $0.10 against the page's $0.15 is reported; a matching row is not", () => {
  const pricing = {
    "mistral:mistral-small-latest": { inputPer1M: 0.1, outputPer1M: 0.3, version: "t" },
    "mistral:mistral-large-4": { inputPer1M: 1.36, outputPer1M: 4.18, cacheReadPer1M: 0.136, version: "t" },
  };
  const direct = withAliases(
    [parseMistralModelPage(PLAIN)!, parseMistralModelPage(SALE)!],
    [{ provider: "mistral", model: "mistral-small-2603", aliases: ["mistral-small-latest"] }],
  );
  const findings = comparePrices(direct, new Set(), pricing);
  // Cache $0.14 on the page vs 0.136 in the table is the page's cent rounding, not drift.
  expect(findings).toEqual([{ kind: "changed", key: "mistral:mistral-small-latest", ours: "$0.1/$0.3", theirs: "$0.15/$0.6" }]);
  expect(renderPriceFindings(findings, {}).join("\n")).toContain("- mistral:mistral-small-latest: ours $0.1/$0.3 → provider $0.15/$0.6");
});

test("unpriced is reported only for ids the provider's API lists for us", () => {
  const direct = [parseMistralModelPage(PLAIN)!];
  expect(comparePrices(direct, new Set(["mistral:mistral-small-2603"]), {})).toEqual([{ kind: "unpriced", key: "mistral:mistral-small-2603", theirs: "$0.15/$0.6" }]);
  expect(comparePrices(direct, new Set(), {})).toEqual([]);
});

test("rows the check could not see are named, so silence is never read as 'checked'", () => {
  const pricing = { "mistral:mistral-embed": { inputPer1M: 0.1, outputPer1M: 0, version: "t" }, "mistral:mistral-small-2603": { inputPer1M: 0.15, outputPer1M: 0.6, version: "t" } };
  const unchecked = uncheckedRows([parseMistralModelPage(PLAIN)!], ["mistral"], pricing);
  expect(unchecked).toEqual(["mistral:mistral-embed"]);
  expect(renderPriceFindings([], {}, unchecked).join("\n")).toContain("Not checked against the provider's own page");
});

test("a DATED Anthropic id keeps its undated priced row from reading as GONE UPSTREAM", () => {
  // Measured 2026-10-08: /v1/models lists claude-haiku-4-5-20251001, we price claude-haiku-4-5.
  const diff = diffCatalogue([{ provider: "anthropic", model: "claude-haiku-4-5-20251001" }], { fetchedProviders: ["anthropic"] });
  expect(diff.removedUpstream).not.toContain("anthropic:claude-haiku-4-5");
});
