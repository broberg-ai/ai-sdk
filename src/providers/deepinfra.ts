// DeepInfra adapter (F4.3). DeepInfra exposes an OpenAI-compatible endpoint, so
// this is the shared core pointed at DeepInfra's base URL + key. No extra deps.
import { DEFAULT_BASE_URLS } from "../cost/default-hosts.js";
import { makeOpenAICompatibleAdapter } from "./openai-compatible.js";
import type { ProviderAdapter } from "../types.js";

export function deepinfraAdapter(
  config: { apiKey?: string; baseUrl?: string; fetch?: typeof fetch } = {},
): ProviderAdapter {
  return makeOpenAICompatibleAdapter({
    name: "deepinfra",
    baseUrl: config.baseUrl ?? DEFAULT_BASE_URLS.deepinfra,
    apiKey: config.apiKey,
    fetch: config.fetch,
    // F091 — DeepInfra puts its own price in usage.estimated_cost (measured 2026-11-17).
    reportedCostField: "estimated_cost",
  });
}
