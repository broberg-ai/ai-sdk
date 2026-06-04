// F017 — the Model Advisor. Given a task + hard constraints, filter the inventory
// and rank by fit, returning a cited recommendation. Deterministic (pure function
// of the inventory + constraints) so the answer is auditable — the "rely on it"
// requirement. The model-advisor skill wraps this for conversational use.
import type { Inventory, InventoryModel } from "./inventory.js";

export interface AdvisorConstraints {
  /** Only EU-hosted/GDPR-safe models — the hard gate for client/personal data. */
  gdprRequired?: boolean;
  /** Required input modality, e.g. "image" | "audio". */
  modality?: string;
  /** Required capability tag, e.g. "ocr" | "reasoning" | "coding" | "vision". */
  capability?: string;
  maxInputPer1M?: number;
  maxOutputPer1M?: number;
  /** Bias toward frontier-quality over cheapest. Default: cheapest-that-qualifies. */
  prefer?: "cheapest" | "frontier";
}

export interface Recommendation {
  primary?: InventoryModel;
  fallback?: InventoryModel;
  alternatives: InventoryModel[];
  rationale: string;
  /** "fresh (3d)" | "STALE (42d) — run the monthly enrichment". */
  inventoryAge: string;
  /** How many models passed the hard filters. */
  matched: number;
}

function priceOut(m: InventoryModel): number {
  return m.pricing.output ?? Number.POSITIVE_INFINITY;
}

function fmtPrice(m: InventoryModel): string {
  const i = m.pricing.input ?? "?";
  const o = m.pricing.output ?? "?";
  return `$${i}/$${o} per 1M`;
}

function ageLabel(generatedAt: string, nowMs: number): string {
  const days = Math.floor((nowMs - Date.parse(generatedAt)) / 86_400_000);
  if (!Number.isFinite(days)) return "unknown age";
  return days <= 35 ? `fresh (${days}d)` : `STALE (${days}d) — run the monthly enrichment`;
}

/**
 * Recommend a model for `task` under `constraints`. `nowMs` is injected for
 * deterministic age reporting (defaults to Date.now() outside tests).
 */
export function recommendModel(
  inventory: Inventory,
  task: string,
  constraints: AdvisorConstraints = {},
  nowMs: number = Date.now(),
): Recommendation {
  const c = constraints;
  let pool = inventory.models;
  const filters: string[] = [];

  if (c.gdprRequired) {
    pool = pool.filter((m) => m.gdprSafe);
    filters.push("GDPR-safe (EU-hosted)");
  }
  if (c.modality) {
    pool = pool.filter((m) => m.inputModalities.includes(c.modality!));
    filters.push(`input modality "${c.modality}"`);
  }
  if (c.capability) {
    pool = pool.filter((m) => m.goodFor.includes(c.capability!));
    filters.push(`capability "${c.capability}"`);
  }
  if (c.maxInputPer1M !== undefined) {
    pool = pool.filter((m) => (m.pricing.input ?? Infinity) <= c.maxInputPer1M!);
    filters.push(`input ≤ $${c.maxInputPer1M}/1M`);
  }
  if (c.maxOutputPer1M !== undefined) {
    pool = pool.filter((m) => (m.pricing.output ?? Infinity) <= c.maxOutputPer1M!);
    filters.push(`output ≤ $${c.maxOutputPer1M}/1M`);
  }

  // Rank. "frontier" prefers tagged-frontier first, then price; default = cheapest output.
  const ranked = [...pool].sort((a, b) => {
    if (c.prefer === "frontier") {
      const fa = a.goodFor.includes("frontier") ? 0 : 1;
      const fb = b.goodFor.includes("frontier") ? 0 : 1;
      if (fa !== fb) return fa - fb;
    }
    return priceOut(a) - priceOut(b);
  });

  const primary = ranked[0];
  const fallback = ranked[1];
  const inventoryAge = ageLabel(inventory.generatedAt, nowMs);

  if (!primary) {
    return {
      alternatives: [],
      matched: 0,
      inventoryAge,
      rationale: `No model in the inventory matches: ${filters.join(", ") || "(no constraints)"}. Loosen a constraint — e.g. drop GDPR-required, or raise the price ceiling.`,
    };
  }

  const why = [
    `Picked **${primary.model}** (${fmtPrice(primary)}${primary.region ? `, ${primary.region}` : ""}${primary.gdprSafe ? ", GDPR-safe" : ""}) for: ${task}.`,
    filters.length ? `Hard filters: ${filters.join(", ")} → ${pool.length} candidates.` : `No hard filters → ranked all ${pool.length} models.`,
    primary.goodFor.length ? `Strengths: ${primary.goodFor.join(", ")}.` : "",
    fallback ? `Fallback: ${fallback.model} (${fmtPrice(fallback)}).` : "",
    `Inventory: ${inventoryAge}.`,
  ].filter(Boolean);

  return {
    primary,
    ...(fallback ? { fallback } : {}),
    alternatives: ranked.slice(2, 6),
    matched: pool.length,
    inventoryAge,
    rationale: why.join(" "),
  };
}
