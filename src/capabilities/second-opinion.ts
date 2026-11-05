// F088 — second opinion: five frontier models from five providers review the same
// material with the same instruction, blind (no author, no sight of each other), and
// one cheap EU model condenses the five into agreement / disagreement / improvements.
// Runs on ai.chat, so cost, region and fallback behaviour are the SDK's own.
import type { ChatResult, TierSpec, Usage } from "../types.js";
import type { AiClient } from "../schema/inputs.js";

export interface PanelMember {
  label: string;
  provider: string;
  model: string;
}

/** Measured reachable with our keys 2026-11-05. Four of five are US/CN — hence the
 *  confirmNoPersonalData gate. DeepSeek goes via OpenRouter (no direct key here); so
 *  does GPT-6 Astra, because the direct OpenAI account answered 429 "no credits
 *  remaining" on 2026-11-05 — same model and list price on OpenRouter. */
export const SECOND_OPINION_PANEL: readonly PanelMember[] = [
  { label: "Anthropic Opus 5.5", provider: "anthropic", model: "claude-opus-5-5" },
  { label: "OpenAI GPT-6 Astra", provider: "openrouter", model: "openai/gpt-6-astra" },
  { label: "Google Gemini 4 Argon", provider: "gemini", model: "gemini-4-argon" },
  { label: "Mistral Large 4", provider: "mistral", model: "mistral-large-4-0" },
  { label: "DeepSeek V4.1 Flash 1017", provider: "openrouter", model: "deepseek/deepseek-v4.1-flash-1017" },
];

/** The synthesis step — EU. Large 4, not Large 3: the first live run (2026-11-05) had
 *  three of four reviewers call Large 3 too weak to condense five frontier answers,
 *  and it answered in English for a Danish plan. ~$0.01 a run. */
export const SECOND_OPINION_SYNTH: PanelMember = {
  label: "Opsummering (Mistral Large 4)",
  provider: "mistral",
  model: "mistral-large-4-0",
};

export const SECOND_OPINION_INSTRUCTION = [
  "You are an independent senior reviewer. You will receive a piece of material — a plan,",
  "an SDK or API design, a specification, or similar. You do not know who wrote it, and",
  "you have no stake in it.",
  "",
  "Give your impartial, qualitative and constructive assessment:",
  "1. Overall verdict in two or three sentences.",
  "2. Strengths — what is genuinely good and should be kept.",
  "3. Weaknesses and risks — gaps, wrong assumptions, missing pieces, things that will",
  "   break or cost more than expected. Be specific; quote or point to the part you mean.",
  "4. Concrete suggestions for improvement, ordered by impact.",
  "5. Open questions you would ask the author before approving it.",
  "",
  "Be direct. Do not flatter, and do not invent problems to look thorough. If something",
  "is fine, say so briefly.",
].join("\n");

export const SECOND_OPINION_SYNTH_INSTRUCTION = [
  "You receive several independent reviews of the same material, each labelled with the",
  "model that wrote it. Condense them for a busy decision-maker:",
  "1. Consensus — points most reviewers agree on.",
  "2. Disagreements — where reviewers contradict each other, and who said what.",
  "3. The most important improvements, ranked, merged where reviewers overlap.",
  "4. Unique catches — a valuable point only one reviewer raised (name the reviewer).",
  "Do not add opinions of your own.",
].join("\n");

export interface SecondOpinionInput {
  content: string;
  title?: string;
  /** Extra steering, e.g. "focus on security and cost". */
  focus?: string;
  panel?: readonly PanelMember[];
  /** Condense the reviews with SECOND_OPINION_SYNTH. Default FALSE — owner 2026-11-05
   *  answered "No" to a Mistral summary; the report carries the five reviews as-is. */
  synthesize?: boolean;
  maxTokens?: number;
  /** USD→DKK rate for the price line. Omitted: the ECB reference rate is fetched. */
  usdToDkk?: number;
  /** Language of every review and the summary. Default "Danish" — the owner reads them. */
  language?: string;
  /** REQUIRED true: four of five panel models are US/CN-hosted. */
  confirmNoPersonalData?: boolean;
}

export interface Opinion extends PanelMember {
  text?: string;
  error?: string;
  usage?: Usage;
}

export interface ReportCost {
  usd: number;
  dkk: number;
  usdToDkk: number;
  /** "ecb" = fetched ECB reference rate · "given" = caller's rate · "fallback" = fixed rate, fetch failed. */
  rateSource: "ecb" | "given" | "fallback";
  /** Date the rate applies to (YYYY-MM-DD). */
  rateDate: string;
}

export interface SecondOpinionResult {
  opinions: Opinion[];
  synthesis?: { text?: string; error?: string; usage?: Usage };
  totalCostUsd: number;
  /** What the report cost, in USD and DKK — always present (owner, 2026-11-05). */
  cost: ReportCost;
  markdown: string;
}

/** ECB reference rate via frankfurter.dev (free, no key). Measured 2026-11-04: 6.6334. */
export const USD_DKK_RATE_URL = "https://api.frankfurter.dev/v1/latest?from=USD&to=DKK";
/** Used ONLY when the fetch fails, and the report then says "fallback". */
export const FALLBACK_USD_DKK = { rate: 6.6334, date: "2026-11-04" } as const;

export async function getUsdToDkk(
  fetchImpl: typeof fetch = fetch,
): Promise<{ rate: number; date: string; source: "ecb" | "fallback" }> {
  try {
    const res = await fetchImpl(USD_DKK_RATE_URL, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) throw new Error(`rate ${res.status}`);
    const data = (await res.json()) as { date?: string; rates?: { DKK?: number } };
    const rate = data.rates?.DKK;
    if (typeof rate !== "number" || !(rate > 0)) throw new Error("rate missing in response");
    return { rate, date: data.date ?? "", source: "ecb" };
  } catch {
    // Not silent: source "fallback" is printed in the report next to the price.
    return { rate: FALLBACK_USD_DKK.rate, date: FALLBACK_USD_DKK.date, source: "fallback" };
  }
}

const DEFAULT_MAX_TOKENS = 12_000;

function override(m: PanelMember): TierSpec {
  return { provider: m.provider, model: m.model, transport: "http" };
}

/** Credentials that must never leave the machine in a review. Detects by shape only and
 *  names the KIND found, never the value. */
const SECRET_PATTERNS: readonly [string, RegExp][] = [
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["OpenAI/Anthropic-style key", /\bsk-[A-Za-z0-9_-]{20,}/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{30,}/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["Slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
];

export function findSecretKinds(text: string): string[] {
  return SECRET_PATTERNS.filter(([, re]) => re.test(text)).map(([kind]) => kind);
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function runSecondOpinion(ai: AiClient, input: SecondOpinionInput): Promise<SecondOpinionResult> {
  if (input.confirmNoPersonalData !== true) {
    throw new Error(
      "ai.secondOpinion: pass confirmNoPersonalData:true — four of the five panel models are US/CN-hosted, " +
        "so the material must contain no personal, customer or health data. Nothing was sent.",
    );
  }
  if (!input.content.trim()) throw new Error("ai.secondOpinion: content is empty");
  const secrets = findSecretKinds(input.content);
  if (secrets.length) {
    throw new Error(`ai.secondOpinion: the material looks like it contains a credential (${secrets.join(", ")}). Remove it first. Nothing was sent.`);
  }
  const lang = `\n\nWrite your entire answer in ${input.language ?? "Danish"}.`;
  const panel = input.panel ?? SECOND_OPINION_PANEL;
  if (panel.length === 0) throw new Error("ai.secondOpinion: panel is empty");
  const maxTokens = input.maxTokens ?? DEFAULT_MAX_TOKENS;

  const prompt = [
    input.title ? `Title: ${input.title}` : "",
    input.focus ? `Reviewer focus requested: ${input.focus}` : "",
    "Material to review:",
    "<material>",
    input.content,
    "</material>",
  ]
    .filter(Boolean)
    .join("\n");

  const opinions: Opinion[] = await Promise.all(
    panel.map(async (m): Promise<Opinion> => {
      try {
        const r: ChatResult = await ai.chat({
          system: SECOND_OPINION_INSTRUCTION + lang,
          prompt,
          maxTokens,
          override: override(m),
          purpose: "second-opinion",
        });
        return { ...m, text: r.text, usage: r.usage };
      } catch (e) {
        return { ...m, error: errText(e) };
      }
    }),
  );

  let synthesis: SecondOpinionResult["synthesis"];
  const answered = opinions.filter((o) => o.text);
  if (input.synthesize === true && answered.length > 0) {
    const reviews = answered.map((o) => `<review by="${o.label}">\n${o.text}\n</review>`).join("\n\n");
    try {
      const r = await ai.chat({
        system: SECOND_OPINION_SYNTH_INSTRUCTION + lang,
        prompt: reviews,
        maxTokens: 6_000,
        override: override(SECOND_OPINION_SYNTH),
        purpose: "second-opinion-synthesis",
      });
      synthesis = { text: r.text, usage: r.usage };
    } catch (e) {
      synthesis = { error: errText(e) };
    }
  }

  const totalCostUsd =
    opinions.reduce((n, o) => n + (o.usage?.costUsd ?? 0), 0) + (synthesis?.usage?.costUsd ?? 0);

  const fx = input.usdToDkk
    ? { rate: input.usdToDkk, date: new Date().toISOString().slice(0, 10), source: "given" as const }
    : await getUsdToDkk();
  const cost: ReportCost = {
    usd: totalCostUsd,
    dkk: totalCostUsd * fx.rate,
    usdToDkk: fx.rate,
    rateSource: fx.source,
    rateDate: fx.date,
  };
  return { opinions, synthesis, totalCostUsd, cost, markdown: toMarkdown(input, opinions, synthesis, cost) };
}

function usd(n: number | undefined): string {
  return n == null ? "—" : `$${n.toFixed(4)}`;
}

function toMarkdown(
  input: SecondOpinionInput,
  opinions: Opinion[],
  synthesis: SecondOpinionResult["synthesis"],
  cost: ReportCost,
): string {
  const lines: string[] = [];
  lines.push(`# Second opinion${input.title ? ` — ${input.title}` : ""}`, "");
  lines.push("| Model | Region | Pris | Status |", "|---|---|---|---|");
  for (const o of opinions) {
    lines.push(`| ${o.label} (\`${o.model}\`) | ${o.usage?.region ?? "—"} | ${usd(o.usage?.costUsd)} | ${o.error ? "fejl" : "ok"} |`);
  }
  if (synthesis) {
    lines.push(`| ${SECOND_OPINION_SYNTH.label} | ${synthesis.usage?.region ?? "—"} | ${usd(synthesis.usage?.costUsd)} | ${synthesis.error ? "fejl" : "ok"} |`);
  }
  const dkk = cost.dkk.toLocaleString("da-DK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const src = { ecb: "ECB-kurs", given: "angivet kurs", fallback: "FAST kurs — ECB-kursen kunne ikke hentes" }[cost.rateSource];
  lines.push("", `**Rapporten kostede:** ${usd(cost.usd)} ≈ ${dkk} kr. (1 USD = ${cost.usdToDkk} DKK, ${src} ${cost.rateDate})`, "");
  if (synthesis) {
    lines.push("## Opsummering", "", synthesis.text ?? `_Fejl: ${synthesis.error}_`, "");
  }
  for (const o of opinions) {
    lines.push(`## ${o.label}`, "", o.text ?? `_Fejl: ${o.error}_`, "");
  }
  return lines.join("\n");
}
