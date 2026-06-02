// OpenAI adapter (F4.1). Chat + vision via the shared OpenAI-compatible core.
// Embedding is added with the embedding capability (F5.4). No openai npm package
// — plain fetch through httpTransport.
import { makeOpenAICompatibleAdapter } from "./openai-compatible.js";
import type { ProviderAdapter } from "../types.js";

export function openaiAdapter(
  config: { apiKey?: string; baseUrl?: string } = {},
): ProviderAdapter {
  return makeOpenAICompatibleAdapter({
    name: "openai",
    baseUrl: config.baseUrl ?? "https://api.openai.com/v1",
    apiKey: config.apiKey,
  });
}
