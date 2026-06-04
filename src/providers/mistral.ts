// Mistral adapter. Mistral's La Plateforme exposes an OpenAI-compatible chat
// endpoint, so this is the shared core pointed at Mistral's base URL + key.
// Key resolved from MISTRAL_API_KEY when not passed. No extra deps.
import { makeOpenAICompatibleAdapter } from "./openai-compatible.js";
import type { ProviderAdapter } from "../types.js";

export function mistralAdapter(
  config: { apiKey?: string; baseUrl?: string } = {},
): ProviderAdapter {
  return makeOpenAICompatibleAdapter({
    name: "mistral",
    baseUrl: config.baseUrl ?? "https://api.mistral.ai/v1",
    apiKey: config.apiKey,
  });
}
