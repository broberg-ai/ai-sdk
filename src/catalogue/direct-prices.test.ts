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

// Fixtures shaped like the real pages after docs.mistral.ai moved to Next.js flight data
// (read live 2026-11-28): the price lives in a backslash-escaped JSON record, no price text.
const tok = (direction: string, label: string, priceUsd: number) => ({ direction, label, priceUsd, unit: "/M Tokens" });
const page = (modelIds: string[], pricing: object[], extra = "") =>
  `<html><script>self.__next_f.push([1,"${JSON.stringify({ modelIds, pricing, replacedBy: { modelIds: ["other-model"], pricing: [tok("input", "Input", 99), tok("output", "Output", 99)] } })
    .replace(/"/g, '\\"')}${extra}"])</script></html>`;
const CACHED = page(["mistral-large-4", "mistral-large-4-0", "mistral-large-latest"], [tok("input", "Input", 0.7), tok("input", "Cached input", 0.07), tok("output", "Output", 2.1)]);
const PLAIN = page(["mistral-small-2603"], [tok("input", "Input", 0.15), tok("output", "Output", 0.6)]);
const PER_PAGE = page(["mistral-ocr-2512"], [{ direction: "input", label: "Pages", priceUsd: 2, unit: "/1000 Pages" }]);

test("Mistral page → one list-price row per API id it names, cache-read from the 'Cached input' line", () => {
  expect(parseMistralModelPage(CACHED)).toEqual(
    ["mistral-large-4", "mistral-large-4-0", "mistral-large-latest"].map((model) => ({ provider: "mistral", model, inputPer1M: 0.7, cacheReadPer1M: 0.07, outputPer1M: 2.1 })),
  );
});

test("Mistral page reads the page's OWN record, never the replacement model nested after it", () => {
  expect(parseMistralModelPage(PLAIN)).toEqual([{ provider: "mistral", model: "mistral-small-2603", inputPer1M: 0.15, outputPer1M: 0.6 }]);
});

test("per-page models and a layout we cannot read give no rows (so the caller can fail loudly, not silently)", () => {
  expect(parseMistralModelPage(PER_PAGE)).toEqual([]);
  expect(parseMistralModelPage("<html>Speed Performance $0.15 /M Tokens</html>")).toEqual([]);
});

test("a row at Small 3's $0.10 against the page's $0.15 is reported; a matching row is not", () => {
  const pricing = {
    "mistral:mistral-small-latest": { inputPer1M: 0.1, outputPer1M: 0.3, version: "t" },
    "mistral:mistral-large-4": { inputPer1M: 0.7, outputPer1M: 2.1, cacheReadPer1M: 0.07, version: "t" },
  };
  const direct = withAliases(
    [...parseMistralModelPage(PLAIN), ...parseMistralModelPage(CACHED)],
    [{ provider: "mistral", model: "mistral-small-2603", aliases: ["mistral-small-latest"] }],
  );
  const findings = comparePrices(direct, new Set(), pricing);
  expect(findings).toEqual([{ kind: "changed", key: "mistral:mistral-small-latest", ours: "$0.1/$0.3", theirs: "$0.15/$0.6" }]);
  expect(renderPriceFindings(findings, {}).join("\n")).toContain("- mistral:mistral-small-latest: ours $0.1/$0.3 → provider $0.15/$0.6");
});

test("unpriced is reported only for ids the provider's API lists for us", () => {
  const direct = parseMistralModelPage(PLAIN);
  expect(comparePrices(direct, new Set(["mistral:mistral-small-2603"]), {})).toEqual([{ kind: "unpriced", key: "mistral:mistral-small-2603", theirs: "$0.15/$0.6" }]);
  expect(comparePrices(direct, new Set(), {})).toEqual([]);
});

test("rows the check could not see are named, so silence is never read as 'checked'", () => {
  const pricing = { "mistral:mistral-embed": { inputPer1M: 0.1, outputPer1M: 0, version: "t" }, "mistral:mistral-small-2603": { inputPer1M: 0.15, outputPer1M: 0.6, version: "t" } };
  const unchecked = uncheckedRows(parseMistralModelPage(PLAIN), ["mistral"], pricing);
  expect(unchecked).toEqual(["mistral:mistral-embed"]);
  expect(renderPriceFindings([], {}, unchecked).join("\n")).toContain("Not checked against the provider's own page");
});

test("a DATED Anthropic id keeps its undated priced row from reading as GONE UPSTREAM", () => {
  // Measured 2026-10-08: /v1/models lists claude-haiku-4-5-20251001, we price claude-haiku-4-5.
  const diff = diffCatalogue([{ provider: "anthropic", model: "claude-haiku-4-5-20251001" }], { fetchedProviders: ["anthropic"] });
  expect(diff.removedUpstream).not.toContain("anthropic:claude-haiku-4-5");
});
