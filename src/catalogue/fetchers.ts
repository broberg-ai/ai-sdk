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

/** F067.1 — a fetcher that did not run because its key is absent. Kept apart from a
 *  real failure so the report can say "not checked — set X", instead of folding a
 *  missing key into the same line as an outage. Measured 2026-10-02: every monthly
 *  run had said "skipped/failed: openai, anthropic, gemini" and nobody could tell
 *  which of the two it was. */
export class MissingKeyError extends Error {
  constructor(
    readonly provider: string,
    readonly envVar: string,
  ) {
    super(`${provider} catalogue: ${envVar} not set`);
    this.name = "MissingKeyError";
  }
}

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
  if (!key) throw new MissingKeyError("openai", "OPENAI_API_KEY");
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
  if (!key) throw new MissingKeyError("anthropic", "ANTHROPIC_API_KEY");
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
  if (!key) throw new MissingKeyError("gemini", "GEMINI_API_KEY");
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

// ── Mistral (key, list-only, with alias groups) ─────────────────────────
// GET /v1/models returns one row per id, and each row names the OTHER ids of the same
// model in `aliases` (measured 2026-10-02: mistral-large-2512 ⇄ mistral-large-latest).
export async function fetchMistralCatalogue(
  opts: { fetch?: FetchImpl; apiKey?: string; baseUrl?: string } = {},
): Promise<CatalogueModel[]> {
  const f = opts.fetch ?? fetch;
  const key = opts.apiKey ?? process.env.MISTRAL_API_KEY;
  if (!key) throw new MissingKeyError("mistral", "MISTRAL_API_KEY");
  const base = opts.baseUrl ?? "https://api.mistral.ai/v1";
  const json = (await getJson(f, `${base}/models`, { authorization: `Bearer ${key}` })) as {
    data?: { id: string; aliases?: string[]; deprecation?: string | null }[];
  };
  return (json.data ?? []).map((m): CatalogueModel => ({
    provider: "mistral",
    model: m.id,
    ...(m.aliases?.length ? { aliases: m.aliases } : {}),
    ...(m.deprecation ? { deprecated: true } : {}),
  }));
}

// ── DeepSeek (key, list-only, OpenAI-shaped) ────────────────────────────
export async function fetchDeepSeekCatalogue(
  opts: { fetch?: FetchImpl; apiKey?: string; baseUrl?: string } = {},
): Promise<CatalogueModel[]> {
  const f = opts.fetch ?? fetch;
  const key = opts.apiKey ?? process.env.DEEPSEEK_API_KEY;
  if (!key) throw new MissingKeyError("deepseek", "DEEPSEEK_API_KEY");
  const base = opts.baseUrl ?? "https://api.deepseek.com";
  const json = (await getJson(f, `${base}/models`, { authorization: `Bearer ${key}` })) as {
    data?: { id: string }[];
  };
  return (json.data ?? []).map((m): CatalogueModel => ({ provider: "deepseek", model: m.id }));
}

// ── ElevenLabs (key, list-only) ─────────────────────────────────────────
// GET /v1/models returns a bare array of { model_id, ... }. This is the fetcher that
// would have caught Eleven v4 (`eleven_v4`, in their docs 2026-10-02) the month it
// shipped — the token catalogue above cannot see a speech model at all.
export async function fetchElevenLabsCatalogue(
  opts: { fetch?: FetchImpl; apiKey?: string; baseUrl?: string } = {},
): Promise<CatalogueModel[]> {
  const f = opts.fetch ?? fetch;
  const key = opts.apiKey ?? process.env.ELEVENLABS_API_KEY;
  if (!key) throw new MissingKeyError("elevenlabs", "ELEVENLABS_API_KEY");
  const base = opts.baseUrl ?? "https://api.elevenlabs.io/v1";
  const json = (await getJson(f, `${base}/models`, { "xi-api-key": key })) as { model_id: string }[];
  return (Array.isArray(json) ? json : []).map((m): CatalogueModel => ({ provider: "elevenlabs", model: m.model_id }));
}

/** Providers we route to that publish NO model-list API we call. The report names
 *  them every month so their absence is a stated limit, not a silent one; their
 *  prices are covered by the hand-checked media table (F050). */
export const NO_LIST_API = ["fal", "bfl", "azure", "deepl", "recraft", "typesafe", "vertex"] as const;

// ── Aggregate ───────────────────────────────────────────────────────────
export interface CatalogueFetchResult {
  models: CatalogueModel[];
  /** Provider → error message, for any fetcher that failed (missing key, network, etc.). */
  errors: Record<string, string>;
  /** Providers whose direct list was fetched cleanly — the diff only trusts
   *  "removed upstream" for these (a failed fetch must not look like a removal). */
  fetched: string[];
  /** F067.1 — provider → env var, for every fetcher that did not run for lack of a
   *  key. Not an error: nothing was attempted. */
  missingKeys: Record<string, string>;
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
    { provider: "mistral", run: () => fetchMistralCatalogue(opts) },
    { provider: "deepseek", run: () => fetchDeepSeekCatalogue(opts) },
    { provider: "elevenlabs", run: () => fetchElevenLabsCatalogue(opts) },
  ];

  const settled = await Promise.allSettled(fetchers.map((x) => x.run()));
  const result: CatalogueFetchResult = { models: [], errors: {}, fetched: [], missingKeys: {} };
  settled.forEach((s, i) => {
    const { provider } = fetchers[i]!;
    if (s.status === "fulfilled") {
      result.models.push(...s.value);
      result.fetched.push(provider);
    } else if (s.reason instanceof MissingKeyError) {
      result.missingKeys[provider] = s.reason.envVar;
    } else {
      result.errors[provider] = s.reason instanceof Error ? s.reason.message : String(s.reason);
    }
  });
  return result;
}
