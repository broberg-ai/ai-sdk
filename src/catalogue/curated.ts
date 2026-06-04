// F017 — the curated overlay. Two things the OpenRouter API does NOT give us:
//  1. GDPR/region truth per vendor (the hard gate for client/personal data).
//  2. "good for what" capability tags (rankings are web-only).
// Hand-maintained; the monthly run flags new vendors/models for curation.
import type { InventoryModel } from "./inventory.js";

export interface RegionInfo {
  region: "eu" | "us" | "cn" | "other";
  gdprSafe: boolean;
}

// Keyed by OpenRouter vendor prefix. EU-hosted + DPA = gdprSafe. US/CN = not safe
// for client/personal data (Schrems II / non-EU). See [[mistral-is-gdpr-provider]].
export const PROVIDER_REGION: Record<string, RegionInfo> = {
  mistralai: { region: "eu", gdprSafe: true },
  anthropic: { region: "us", gdprSafe: false },
  openai: { region: "us", gdprSafe: false },
  google: { region: "us", gdprSafe: false },
  "x-ai": { region: "us", gdprSafe: false },
  "meta-llama": { region: "us", gdprSafe: false },
  nvidia: { region: "us", gdprSafe: false },
  microsoft: { region: "us", gdprSafe: false },
  cohere: { region: "us", gdprSafe: false },
  perplexity: { region: "us", gdprSafe: false },
  amazon: { region: "us", gdprSafe: false },
  deepseek: { region: "cn", gdprSafe: false },
  qwen: { region: "cn", gdprSafe: false },
  minimax: { region: "cn", gdprSafe: false },
  moonshotai: { region: "cn", gdprSafe: false },
  "z-ai": { region: "cn", gdprSafe: false },
  baidu: { region: "cn", gdprSafe: false },
  stepfun: { region: "cn", gdprSafe: false },
  "01-ai": { region: "cn", gdprSafe: false },
};

/** Capability tags derived from the model id + its live modalities/params.
 *  Heuristic + grounded — the advisor skill refines per-question. */
export function curateGoodFor(m: InventoryModel): string[] {
  const id = m.model.toLowerCase();
  const tags = new Set<string>();

  // From live API fields (grounded).
  if (m.inputModalities.includes("image")) tags.add("vision");
  if (m.inputModalities.includes("audio")) tags.add("audio");
  if (m.supportsTools) tags.add("agentic");

  // Family heuristics on the slug.
  const has = (...xs: string[]) => xs.some((x) => id.includes(x));
  if (has("codestral", "devstral", "coder", "-code")) tags.add("coding");
  if (has("magistral", "-r1", "reason", "think", "opus", "-o1", "-o3", "deepseek-r")) tags.add("reasoning");
  if (has("embed")) tags.add("embedding");
  if (has("ocr")) tags.add("ocr");
  if (has("tts", "-voice", "speech")) tags.add("tts");
  if (has("transcribe", "whisper", "voxtral", "parakeet")) tags.add("transcription");
  if (has("moderation", "guard", "safety", "content-safety")) tags.add("moderation");
  if (has("creative", "roleplay")) tags.add("creative");
  if (has("mini", "small", "nano", "haiku", "flash", "lite", "3b", "8b", "ministral")) {
    tags.add("fast");
    tags.add("edge");
  }
  if (has("large", "opus", "-pro", "sonnet", "gpt-5", "frontier", "-405b", "-max")) tags.add("frontier");

  return [...tags];
}

/** Apply the curated overlay over auto-enriched models: region/GDPR + goodFor.
 *  Curated fields win; live fields (price, modality, context) are never clobbered. */
export function applyCurated(models: InventoryModel[]): InventoryModel[] {
  return models.map((m) => {
    const reg = PROVIDER_REGION[m.provider] ?? { region: "other" as const, gdprSafe: false };
    return {
      ...m,
      region: reg.region,
      gdprSafe: reg.gdprSafe,
      goodFor: curateGoodFor(m),
    };
  });
}
