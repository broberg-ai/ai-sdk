// F014 — model-catalogue research. A normalized view of one model as a provider
// reports it today, so the diff engine can compare it against the SDK's hand-
// maintained pricing table (src/cost/pricing.ts) + tier map (src/routing).
export interface CatalogueModel {
  /** Matches usage.provider / override.provider: "openrouter" | "anthropic" | "openai" | "gemini" | ... */
  provider: string;
  /** Provider-native model id, e.g. "gemini-2.5-flash" or "google/gemini-2.5-flash". */
  model: string;
  /** USD per 1M input tokens. Undefined when the provider's list API exposes no price. */
  inputPer1M?: number;
  /** USD per 1M output tokens. */
  outputPer1M?: number;
  contextLength?: number;
  deprecated?: boolean;
}

/** `${provider}:${model}` — the same key shape PRICING uses. */
export function catalogueKey(m: Pick<CatalogueModel, "provider" | "model">): string {
  return `${m.provider}:${m.model}`;
}
