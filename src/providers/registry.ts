// Default provider registry — the live adapters wired when AiConfig.providers is
// absent. A bare createAI() makes real calls (keys from env). fal stays a stub
// until F5.3 ships the real fal.ai image adapter.
import { anthropicAdapter } from "./anthropic.js";
import { openaiAdapter } from "./openai.js";
import { geminiAdapter } from "./gemini.js";
import { deepinfraAdapter } from "./deepinfra.js";
import { openrouterAdapter } from "./openrouter.js";
import { mistralAdapter } from "./mistral.js";
import { elevenlabsAdapter } from "./elevenlabs.js";
import { falAdapter } from "./fal.js";
import { bflAdapter } from "./bfl.js";
import type { ProviderAdapter } from "../types.js";

export const defaultProviders: Record<string, ProviderAdapter> = {
  anthropic: anthropicAdapter(),
  openai: openaiAdapter(),
  gemini: geminiAdapter(),
  deepinfra: deepinfraAdapter(),
  openrouter: openrouterAdapter(),
  mistral: mistralAdapter(),
  elevenlabs: elevenlabsAdapter(),
  fal: falAdapter(),
  bfl: bflAdapter(),
};
