// DeepL translation adapter (F032) — a dedicated MT engine, not a chat model.
// Implements ProviderAdapter.translate directly (no chat prompt-contract).
// EU-hosted (Falun, Sweden per deepl.com). Opt-in via override:{provider:"deepl"};
// the LLM-prompt-based ai.translate stays the default for every other provider.
//
// CONTRACT NOTE: DeepL requires real language codes ("DA", "EN-US", "DE", …) in
// `to`/`from` — NOT the free-form names the chat-based route accepts ("Danish").
// This adapter does not translate names to codes; pass DeepL's own codes.
import { freshUsage } from "../cost/usage.js";
import { regionOfHost } from "../cost/region.js";
import type { ProviderAdapter, TranslateRequest, TranslateResult } from "../types.js";
import { getMediaPrice } from "../cost/media-pricing.js";

export function deeplAdapter(
  config: { apiKey?: string; baseUrl?: string; fetch?: typeof fetch; pricePer1kChars?: number } = {},
): ProviderAdapter {
  const fetchImpl = config.fetch ?? fetch;

  function key(): string {
    const k = config.apiKey ?? process.env.DEEPL_API_KEY;
    if (!k) throw new Error("deepl adapter: API key not set (env DEEPL_API_KEY)");
    return k;
  }

  // DeepL Free API keys always end in ":fx" — a documented DeepL convention —
  // and must hit the free-tier host, not the Pro one.
  function baseUrl(apiKey: string): string {
    return config.baseUrl ?? (apiKey.endsWith(":fx") ? "https://api-free.deepl.com" : "https://api.deepl.com");
  }

  async function translate(req: TranslateRequest): Promise<TranslateResult> {
    const apiKey = key();
    const body: Record<string, unknown> = { text: [req.text], target_lang: req.to.toUpperCase() };
    if (req.from) body.source_lang = req.from.toUpperCase();

    const res = await fetchImpl(`${baseUrl(apiKey)}/v2/translate`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `DeepL-Auth-Key ${apiKey}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(`deepl translate ${res.status}: ${errBody.slice(0, 300)}`);
    }
    const data = (await res.json()) as { translations?: { text?: string; detected_source_language?: string }[] };
    const text = data.translations?.[0]?.text;
    if (text === undefined) throw new Error("deepl translate: response contained no translation");

    const usage = freshUsage({
      provider: "deepl",
      region: regionOfHost(baseUrl(apiKey)),
      model: req.spec.model,
      transport: "http",
      capability: "translate",
      inputTokens: 0,
      outputTokens: 0,
    });
    usage.costUsd = (req.text.length / 1000) * (config.pricePer1kChars ?? getMediaPrice("deepl", "translate")?.usd ?? 0);
    usage.costBasis = config.pricePer1kChars !== undefined ? "computed" : "estimated";
    return { text, usage };
  }

  return { name: "deepl", translate };
}
