// Requesty adapter (F028). An OpenAI-compatible AI gateway (400+ models, 30+
// providers) — a drop-in alternative to the `openrouter` upstream. Reuses the
// shared OpenAI-compatible core; only the base URL + key differ. Requesty returns
// ground-truth `usage.cost`, so cost is exact (not a table estimate). Key from
// REQUESTY_API_KEY. EU data-residency endpoint via `eu:true`.
//
// GDPR note: the EU endpoint keeps only Requesty's GATEWAY in the EU (Frankfurt).
// End-to-end EU residency still requires an EU-region MODEL slug (Bedrock
// `@eu-central-1`, Vertex `@eu`, Azure `@swedencentral`, Mistral EU-default) — a
// global slug routes inference outside the EU despite the EU endpoint.
import { makeOpenAICompatibleAdapter } from "./openai-compatible.js";
import type { ProviderAdapter } from "../types.js";

const US_BASE = "https://router.requesty.ai/v1";
const EU_BASE = "https://router.eu.requesty.ai/v1";

export function requestyAdapter(
  config: { apiKey?: string; baseUrl?: string; eu?: boolean; referer?: string; title?: string } = {},
): ProviderAdapter {
  return makeOpenAICompatibleAdapter({
    name: "requesty",
    baseUrl: config.baseUrl ?? (config.eu ? EU_BASE : US_BASE),
    apiKey: config.apiKey,
    extraHeaders: {
      "HTTP-Referer": config.referer ?? "https://broberg.ai",
      "X-Title": config.title ?? "@broberg/ai-sdk",
    },
    // Requesty returns ground-truth usage.cost (USD) by default — use it over the
    // local pricing-table estimate (same as OpenRouter, F010).
    costFromResponseField: true,
  });
}
