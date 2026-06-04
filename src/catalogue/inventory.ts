// F017 — the LLM inventory: a rich, queryable view of every model the fleet can
// reach (auto-enriched from OpenRouter's API ⊕ a curated overlay). The Model
// Advisor (advisor.ts + the model-advisor skill) reasons over this; the monthly
// run keeps inventory.json fresh.
import { applyCurated } from "./curated.js";

export type PricingUnit =
  | "per_1m_tokens"
  | "per_1k_chars"
  | "per_minute"
  | "per_hour"
  | "per_image"
  | "per_page";

export interface InventoryModel {
  /** OpenRouter vendor prefix: "mistralai" | "anthropic" | "openai" | "google" | "deepseek" | … */
  provider: string;
  /** Full routable slug, e.g. "mistralai/mistral-large-2512". */
  model: string;
  name?: string;
  pricing: {
    input?: number;
    output?: number;
    unit: PricingUnit;
    cacheReadPer1M?: number;
  };
  inputModalities: string[]; // text | image | audio | video | file
  outputModalities: string[]; // text | image | audio
  contextLength?: number;
  supportsTools?: boolean;
  supportsStructuredOutput?: boolean;
  /** Curated/ranked strength categories (OpenRouter rankings are web-only → mostly curated). */
  categories: { name: string; rank?: number }[];
  /** Capability tags: reasoning|coding|vision|ocr|tts|transcription|moderation|embedding|agentic|multilingual|creative|edge|frontier|fast. */
  goodFor: string[];
  description?: string;
  region?: "eu" | "us" | "cn" | "other";
  /** EU-hosted + DPA, no Schrems II — the hard gate for client/personal data. */
  gdprSafe?: boolean;
  isModerated?: boolean;
  source: "openrouter" | "curated";
}

export interface Inventory {
  generatedAt: string; // ISO; the advisor flags staleness from this
  modelCount: number;
  models: InventoryModel[];
}

interface ORModel {
  id: string;
  name?: string;
  description?: string;
  context_length?: number;
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
  pricing?: { prompt?: string; completion?: string; input_cache_read?: string };
  top_provider?: { is_moderated?: boolean };
  supported_parameters?: string[];
}

/** Per-token USD string → USD per 1M tokens. undefined for missing/NaN/negative. */
function per1M(v: string | undefined): number | undefined {
  if (v == null) return undefined;
  const n = Number(v) * 1_000_000;
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** Fetch the OpenRouter catalogue and map it to the rich (un-curated) inventory shape. */
export async function fetchOpenRouterInventory(
  opts: { fetch?: typeof fetch; baseUrl?: string } = {},
): Promise<InventoryModel[]> {
  const f = opts.fetch ?? fetch;
  const base = opts.baseUrl ?? "https://openrouter.ai/api/v1";
  const res = await f(`${base}/models`, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`openrouter models ${res.status}`);
  const json = (await res.json()) as { data?: ORModel[] };
  return (json.data ?? []).map((m): InventoryModel => {
    const params = m.supported_parameters ?? [];
    const input = per1M(m.pricing?.prompt);
    const output = per1M(m.pricing?.completion);
    const cacheReadPer1M = per1M(m.pricing?.input_cache_read);
    return {
      provider: m.id.split("/")[0] ?? m.id,
      model: m.id,
      ...(m.name ? { name: m.name } : {}),
      pricing: {
        unit: "per_1m_tokens",
        ...(input !== undefined ? { input } : {}),
        ...(output !== undefined ? { output } : {}),
        ...(cacheReadPer1M !== undefined ? { cacheReadPer1M } : {}),
      },
      inputModalities: m.architecture?.input_modalities ?? ["text"],
      outputModalities: m.architecture?.output_modalities ?? ["text"],
      ...(m.context_length ? { contextLength: m.context_length } : {}),
      supportsTools: params.includes("tools"),
      supportsStructuredOutput:
        params.includes("structured_outputs") || params.includes("response_format"),
      categories: [],
      goodFor: [],
      ...(m.description ? { description: m.description } : {}),
      ...(m.top_provider?.is_moderated !== undefined ? { isModerated: m.top_provider.is_moderated } : {}),
      source: "openrouter",
    };
  });
}

/** Build the full inventory: auto-enriched OpenRouter data with the curated overlay applied. */
export function buildInventory(models: InventoryModel[], generatedAt: string): Inventory {
  const curated = applyCurated(models);
  return { generatedAt, modelCount: curated.length, models: curated };
}
