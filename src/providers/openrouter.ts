// OpenRouter adapter (F4.4). Meta-router with an OpenAI-compatible API — reuses
// the shared core + OpenRouter's attribution headers. Any upstream model is
// reachable by its slug, e.g. "minimax/minimax-m2.7", "google/gemini-2.5-flash".
import { makeOpenAICompatibleAdapter } from "./openai-compatible.js";
import type { ProviderAdapter } from "../types.js";

export function openrouterAdapter(
  config: { apiKey?: string; baseUrl?: string; referer?: string; title?: string } = {},
): ProviderAdapter {
  return makeOpenAICompatibleAdapter({
    name: "openrouter",
    baseUrl: config.baseUrl ?? "https://openrouter.ai/api/v1",
    apiKey: config.apiKey,
    extraHeaders: {
      "HTTP-Referer": config.referer ?? "https://broberg.ai",
      "X-Title": config.title ?? "@broberg/ai-sdk",
    },
    // OpenRouter returns ground-truth usage.cost (USD) when usage:{include:true}
    // is set — use it over the local pricing-table estimate (F010).
    costFromResponseField: true,
  });
}
