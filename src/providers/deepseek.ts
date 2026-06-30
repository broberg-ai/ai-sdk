// DeepSeek adapter (F030) — the opt-in NON-PII secondary route for the Anthropic
// phase-out. DeepSeek's direct API is OpenAI-compatible, so this reuses the shared
// core; only base URL + key differ. Reached via `override:{ provider:"deepseek",
// model:"…" }` — never a default tier. Key from DEEPSEEK_API_KEY.
//
// GDPR: DeepSeek is CN-hosted → NOT GDPR-safe. Use ONLY for non-PII workloads
// (e.g. public web/article scanning). Personal data stays on Mistral EU.
//
// Models (direct api.deepseek.com): `deepseek-chat` (non-thinking) and
// `deepseek-reasoner` (thinking) — both DEPRECATE 2026-07-24 and map to
// `deepseek-v4-flash`. Prefer `deepseek-v4-flash` going forward (same model, not
// sunset). The direct API does NOT return a cost field → cost comes from the
// pricing table (verify rates against a real key; see src/cost/pricing.ts).
import { makeOpenAICompatibleAdapter } from "./openai-compatible.js";
import type { ProviderAdapter } from "../types.js";

export function deepseekAdapter(
  config: { apiKey?: string; baseUrl?: string } = {},
): ProviderAdapter {
  return makeOpenAICompatibleAdapter({
    name: "deepseek", // → key DEEPSEEK_API_KEY
    baseUrl: config.baseUrl ?? "https://api.deepseek.com/v1",
    apiKey: config.apiKey,
    // Direct API returns no usage.cost → price from the table (not response).
    costFromResponseField: false,
  });
}
