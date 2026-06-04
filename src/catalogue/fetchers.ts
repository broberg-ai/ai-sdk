// F014 — per-provider model-list fetchers, normalized to CatalogueModel.
//
// Two roles:
//  • OpenRouter /api/v1/models is the pricing-bearing source — public (no key),
//    one call covers every model OpenRouter routes to, with live prices.
//  • Direct-provider list endpoints (openai/anthropic/gemini) return a focused
//    list of THAT provider's current models (no price) — used for new-model
//    detection + "removed upstream" against the direct-provider PRICING keys.
//
// Each fetcher is independently failable: fetchFullCatalogue collects results
// and errors side by side so one provider being down never fails the whole run.
import type { CatalogueModel } from "./types.js";

type FetchImpl = typeof fetch;

async function getJson(f: FetchImpl, url: string, headers: Record<string, string>): Promise<unknown> {
  const res = await f(url, { headers: { accept: "application/json", ...headers } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${body.slice(0, 200)}`);
  }
  return res.json();
}

// ── OpenRouter (public, pricing-bearing) ────────────────────────────────
interface OpenRouterModel {
  id: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
}

/** Per-token USD string → USD per 1M tokens. Returns undefined for missing/NaN/negative. */
function per1M(v: string | undefined): number | undefined {
  if (v == null) return undefined;
  const n = Number(v) * 1_000_000;
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

export async function fetchOpenRouterCatalogue(
  opts: { fetch?: FetchImpl; baseUrl?: string } = {},
): Promise<CatalogueModel[]> {
  const f = opts.fetch ?? fetch;
  const base = opts.baseUrl ?? "https://openrouter.ai/api/v1";
  const json = (await getJson(f, `${base}/models`, {})) as { data?: OpenRouterModel[] };
  return (json.data ?? []).map((m): CatalogueModel => {
    const inputPer1M = per1M(m.pricing?.prompt);
    const outputPer1M = per1M(m.pricing?.completion);
    return {
      provider: "openrouter",
      model: m.id,
      ...(inputPer1M !== undefined ? { inputPer1M } : {}),
      ...(outputPer1M !== undefined ? { outputPer1M } : {}),
      ...(m.context_length ? { contextLength: m.context_length } : {}),
    };
  });
}

// ── OpenAI (key, list-only) ─────────────────────────────────────────────
export async function fetchOpenAICatalogue(
  opts: { fetch?: FetchImpl; apiKey?: string; baseUrl?: string } = {},
): Promise<CatalogueModel[]> {
  const f = opts.fetch ?? fetch;
  const key = opts.apiKey ?? process.env.OPENAI_API_KEY;
  if (!key) throw new Error("openai catalogue: OPENAI_API_KEY not set");
  const base = opts.baseUrl ?? "https://api.openai.com/v1";
  const json = (await getJson(f, `${base}/models`, { authorization: `Bearer ${key}` })) as {
    data?: { id: string }[];
  };
  return (json.data ?? []).map((m): CatalogueModel => ({ provider: "openai", model: m.id }));
}

// ── Anthropic (key, list-only) ──────────────────────────────────────────
export async function fetchAnthropicCatalogue(
  opts: { fetch?: FetchImpl; apiKey?: string; baseUrl?: string } = {},
): Promise<CatalogueModel[]> {
  const f = opts.fetch ?? fetch;
  const key = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("anthropic catalogue: ANTHROPIC_API_KEY not set");
  const base = opts.baseUrl ?? "https://api.anthropic.com/v1";
  const json = (await getJson(f, `${base}/models`, {
    "x-api-key": key,
    "anthropic-version": "2023-06-01",
  })) as { data?: { id: string }[] };
  return (json.data ?? []).map((m): CatalogueModel => ({ provider: "anthropic", model: m.id }));
}

// ── Gemini (key, list-only) ─────────────────────────────────────────────
export async function fetchGeminiCatalogue(
  opts: { fetch?: FetchImpl; apiKey?: string; baseUrl?: string } = {},
): Promise<CatalogueModel[]> {
  const f = opts.fetch ?? fetch;
  const key = opts.apiKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!key) throw new Error("gemini catalogue: GEMINI_API_KEY not set");
  const base = opts.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta";
  const json = (await getJson(f, `${base}/models?key=${encodeURIComponent(key)}`, {})) as {
    models?: { name: string }[];
  };
  // Gemini ids come as "models/gemini-2.5-flash" — strip the prefix to match the
  // adapter's usage.model + the PRICING key.
  return (json.models ?? []).map((m): CatalogueModel => ({
    provider: "gemini",
    model: m.name.replace(/^models\//, ""),
  }));
}

// ── Aggregate ───────────────────────────────────────────────────────────
export interface CatalogueFetchResult {
  models: CatalogueModel[];
  /** Provider → error message, for any fetcher that failed (missing key, network, etc.). */
  errors: Record<string, string>;
  /** Providers whose direct list was fetched cleanly — the diff only trusts
   *  "removed upstream" for these (a failed fetch must not look like a removal). */
  fetched: string[];
}

type NamedFetcher = { provider: string; run: () => Promise<CatalogueModel[]> };

/**
 * Run every available fetcher. OpenRouter always runs (no key). Direct-provider
 * fetchers run only when their key is present (a missing key is recorded as a
 * skip, not a hard failure). Each fetcher is isolated — one throwing never
 * sinks the others.
 */
export async function fetchFullCatalogue(
  opts: { fetch?: FetchImpl } = {},
): Promise<CatalogueFetchResult> {
  const fetchers: NamedFetcher[] = [
    { provider: "openrouter", run: () => fetchOpenRouterCatalogue(opts) },
    { provider: "openai", run: () => fetchOpenAICatalogue(opts) },
    { provider: "anthropic", run: () => fetchAnthropicCatalogue(opts) },
    { provider: "gemini", run: () => fetchGeminiCatalogue(opts) },
  ];

  const settled = await Promise.allSettled(fetchers.map((x) => x.run()));
  const result: CatalogueFetchResult = { models: [], errors: {}, fetched: [] };
  settled.forEach((s, i) => {
    const { provider } = fetchers[i]!;
    if (s.status === "fulfilled") {
      result.models.push(...s.value);
      result.fetched.push(provider);
    } else {
      result.errors[provider] = s.reason instanceof Error ? s.reason.message : String(s.reason);
    }
  });
  return result;
}
