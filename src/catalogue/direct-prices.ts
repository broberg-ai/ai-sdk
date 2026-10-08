// F076.2 — read prices from the providers' OWN pages, not only from OpenRouter.
//
// Measured 2026-10-08: nothing in the fleet did. The monthly research and upmetrics'
// nightly drift check both compare against OpenRouter, and only for rows we already
// have — so ten Claude models sat unpriced (booked at $0) and Mistral Small 4, the
// fast/cheap tiers, sat at Small 3's price (about half the real cost). Neither API
// lists prices, so the pages are the source:
//   • Anthropic: platform.claude.com/docs/en/about-claude/pricing.md — a markdown table.
//   • Mistral:   docs.mistral.ai/models/<slug> — one page per model, API id + price.
// LIST price only: a Mistral page on sale shows "Original price: $x" beside the sale
// price, and booking the sale would under-report the day it ends (same rule as F074.1).
import { PRICING } from "../cost/pricing.js";
import type { CatalogueModel } from "./types.js";

type FetchImpl = typeof fetch;

export interface DirectPrice {
  provider: "anthropic" | "mistral";
  model: string;
  inputPer1M: number;
  outputPer1M: number;
  cacheReadPer1M?: number;
  /** A second price set above a prompt length (Claude Haiku 5.5). */
  longPrompt?: { aboveTokens: number; inputPer1M: number; outputPer1M: number; cacheReadPer1M?: number };
}

const ANTHROPIC_URL = "https://platform.claude.com/docs/en/about-claude/pricing.md";
const MISTRAL_BASE = "https://docs.mistral.ai";

const usd = (cell: string): number | undefined => {
  const m = cell.match(/\$([0-9]+(?:\.[0-9]+)?)/);
  return m ? Number(m[1]) : undefined;
};

/** "Claude Opus 5.5" → "claude-opus-5-5". Exported for tests. */
export function anthropicId(name: string): string {
  return name.trim().toLowerCase().replace(/\./g, "-").replace(/\s+/g, "-");
}

/** Parse the first model table of Anthropic's pricing.md. Exported for tests. */
export function parseAnthropicPricing(md: string): DirectPrice[] {
  const section = md.slice(md.indexOf("## Model pricing"));
  const out = new Map<string, DirectPrice>();
  for (const line of section.split("\n")) {
    if (!line.startsWith("| Claude")) {
      if (out.size > 0 && !line.startsWith("|")) break; // end of the first table
      continue;
    }
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 6) continue;
    const nameCell = cells[0]!;
    const name = nameCell.replace(/\s*\(.*$/, "");
    const id = anthropicId(name);
    const [input, , , cacheRead, output] = cells.slice(1).map(usd);
    if (input === undefined || output === undefined) continue;
    const over = nameCell.match(/over ([0-9,]+) tokens/);
    if (over) {
      const base = out.get(id);
      if (base) base.longPrompt = { aboveTokens: Number(over[1]!.replace(/,/g, "")), inputPer1M: input, outputPer1M: output, cacheReadPer1M: cacheRead };
      continue;
    }
    out.set(id, { provider: "anthropic", model: id, inputPer1M: input, outputPer1M: output, cacheReadPer1M: cacheRead });
  }
  return [...out.values()];
}

export async function fetchAnthropicPrices(opts: { fetch?: FetchImpl } = {}): Promise<DirectPrice[]> {
  const res = await (opts.fetch ?? fetch)(ANTHROPIC_URL);
  if (!res.ok) throw new Error(`anthropic pricing.md: HTTP ${res.status}`);
  const rows = parseAnthropicPricing(await res.text());
  if (rows.length === 0) throw new Error("anthropic pricing.md: no model rows parsed — the page layout changed");
  return rows;
}

const textOf = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

/** One Mistral model page → its API id and per-token list price. Exported for tests. */
export function parseMistralModelPage(html: string): DirectPrice | undefined {
  const t = textOf(html);
  const idm = t.match(/([a-z][a-z0-9.-]*)(?: \+\d+)? Speed Performance/);
  if (!idm) return undefined;
  const after = t.slice(idm.index! + idm[0].length);
  // The price block is rendered twice; read only the first.
  const end = after.search(/Speed Performance|FEATURES/);
  const seg = end === -1 ? after : after.slice(0, end);
  const sale = /Original price/.test(seg);
  const vals = sale
    ? [...seg.matchAll(/Original price: \$([0-9.]+)/g)].map((m) => Number(m[1]))
    : [...seg.matchAll(/\$([0-9.]+) \/M Tokens/g)].map((m) => Number(m[1]));
  if (vals.length === 2) return { provider: "mistral", model: idm[1]!, inputPer1M: vals[0]!, outputPer1M: vals[1]! };
  if (vals.length === 3) return { provider: "mistral", model: idm[1]!, inputPer1M: vals[0]!, cacheReadPer1M: vals[1]!, outputPer1M: vals[2]! };
  return undefined; // per-page / per-minute models, or a layout we do not read
}

export async function fetchMistralPrices(opts: { fetch?: FetchImpl } = {}): Promise<DirectPrice[]> {
  const f = opts.fetch ?? fetch;
  const index = await f(`${MISTRAL_BASE}/models`);
  if (!index.ok) throw new Error(`mistral models index: HTTP ${index.status}`);
  const slugs = [...new Set([...(await index.text()).matchAll(/href="\/models\/([a-z0-9-]+)"/g)].map((m) => m[1]!))];
  const pages = await Promise.allSettled(
    slugs.map(async (s) => {
      const r = await f(`${MISTRAL_BASE}/models/${s}`);
      return r.ok ? parseMistralModelPage(await r.text()) : undefined;
    }),
  );
  const rows = pages.flatMap((p) => (p.status === "fulfilled" && p.value ? [p.value] : []));
  if (rows.length === 0) throw new Error("mistral model pages: no prices parsed — the page layout changed");
  return rows;
}

/** A price on a dated id holds for every alias the provider's model API names for it
 *  (mistral-small-latest IS mistral-small-2603). Without this, only the dated rows
 *  were checked and the -latest rows the tiers actually use were not. */
export function withAliases(direct: DirectPrice[], catalogue: CatalogueModel[]): DirectPrice[] {
  const aliases = new Map<string, string[]>();
  for (const m of catalogue) if (m.aliases?.length) aliases.set(`${m.provider}:${m.model}`, m.aliases);
  const out = new Map<string, DirectPrice>();
  for (const d of direct) {
    out.set(`${d.provider}:${d.model}`, d);
    for (const a of aliases.get(`${d.provider}:${d.model}`) ?? []) {
      if (!out.has(`${d.provider}:${a}`)) out.set(`${d.provider}:${a}`, { ...d, model: a });
    }
  }
  return [...out.values()];
}

/** Rows we price for a provider that the direct check could not see — shown in the
 *  report so "no finding" is never mistaken for "checked". */
export function uncheckedRows(direct: DirectPrice[], providers: string[], pricing = PRICING): string[] {
  const seen = new Set(direct.map((d) => `${d.provider}:${d.model}`));
  return Object.keys(pricing).filter((k) => providers.some((p) => k.startsWith(`${p}:`)) && !seen.has(k)).sort();
}

export interface PriceFinding {
  kind: "changed" | "unpriced";
  key: string;
  ours?: string;
  theirs: string;
}

const fmt = (i: number, o: number, c?: number) => `$${i}/$${o}${c !== undefined ? ` (cache $${c})` : ""}`;
// Mistral shows cache to the cent ($0.14 for 0.136); a cent of slack on cache only.
const sameCache = (a: number | undefined, b: number | undefined) => a === undefined || b === undefined || Math.abs(a - b) <= 0.005;

/** Compare the providers' own prices with PRICING. `listed` = ids the provider's
 *  model API returns for our key: an unpriced row is reported only for those, so
 *  retired or invite-only models on a price page do not drown the report. */
export function comparePrices(direct: DirectPrice[], listed: Set<string>, pricing = PRICING): PriceFinding[] {
  const out: PriceFinding[] = [];
  for (const d of direct) {
    const key = `${d.provider}:${d.model}`;
    const ours = pricing[key];
    const theirs = fmt(d.inputPer1M, d.outputPer1M, d.cacheReadPer1M);
    if (!ours) {
      if (listed.has(key)) out.push({ kind: "unpriced", key, theirs });
      continue;
    }
    const drift =
      ours.inputPer1M !== d.inputPer1M ||
      ours.outputPer1M !== d.outputPer1M ||
      !sameCache(ours.cacheReadPer1M, d.cacheReadPer1M) ||
      (d.longPrompt !== undefined &&
        (ours.longPrompt?.aboveTokens !== d.longPrompt.aboveTokens ||
          ours.longPrompt.inputPer1M !== d.longPrompt.inputPer1M ||
          ours.longPrompt.outputPer1M !== d.longPrompt.outputPer1M));
    if (drift) out.push({ kind: "changed", key, ours: fmt(ours.inputPer1M, ours.outputPer1M, ours.cacheReadPer1M), theirs });
  }
  return out;
}

/** Report lines; empty when the table matches the providers. */
export function renderPriceFindings(findings: PriceFinding[], failed: Record<string, string>, unchecked: string[] = []): string[] {
  const lines: string[] = [];
  const changed = findings.filter((f) => f.kind === "changed");
  const unpriced = findings.filter((f) => f.kind === "unpriced");
  if (changed.length) {
    lines.push(`## Price changed at the provider (${changed.length})`, "", "_Our table disagrees with the provider's own price page. Every call on these is booked wrong until pricing.ts is fixed and released._", "");
    for (const f of changed) lines.push(`- ${f.key}: ours ${f.ours} → provider ${f.theirs}`);
    lines.push("");
  }
  if (unpriced.length) {
    lines.push(`## Listed by the provider, no price in our table (${unpriced.length})`, "", "_A call to any of these is booked at $0._", "");
    for (const f of unpriced) lines.push(`- ${f.key}: provider ${f.theirs}`);
    lines.push("");
  }
  for (const [p, e] of Object.entries(failed)) lines.push(`_Direct price check failed for ${p}: ${e}_`, "");
  if (unchecked.length) lines.push(`_Not checked against the provider's own page (no page with a per-token price, or retired): ${unchecked.join(", ")}_`, "");
  return lines;
}
