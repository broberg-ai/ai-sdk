// F022 — the model-availability registry: the ONE source both resolveModel()
// (spawn / call path) and listModels() (UI picker) read. A curated default seed
// (works offline — the durable floor) plus a mutable overlay that
// refreshAvailability() updates from the live provider list.
//
// Scope note: this is a LIVENESS view (is this id alive right now?), not the
// rich capability/price inventory (that is F017 src/catalogue). We only track
// ids we want to assert status on; anything not here is fail-open (treated
// available) so we never block a model we simply do not track.
import type { AvailabilityStatus, AvailabilitySource, ModelStatus } from "./types.js";

/** Internal registry row. `aliases[0]` surfaces as ModelStatus.alias. */
export interface RegistryEntry {
  id: string;
  aliases: string[];
  provider: string;
  available: boolean;
  status: AvailabilityStatus;
  note?: string;
  source: AvailabilitySource;
}

const SUSPENDED_FABLE_MYTHOS = "suspended — US export-control directive (2026-06-12)";

/** Curated defaults. Mirrors DEFAULT_TIER_MAP model ids (src/routing/tier-map.ts)
 *  + the models documented in CLAUDE.md, plus the two ids Anthropic suspended
 *  globally on 2026-06-12. Aliases are the tier / short names a caller or picker
 *  may pass instead of the canonical id. */
const DEFAULTS: RegistryEntry[] = [
  // ── Anthropic ────────────────────────────────────────────────────────────
  { id: "claude-haiku-4-5", aliases: ["haiku", "fast"], provider: "anthropic", available: true, status: "available", source: "default" },
  { id: "claude-sonnet-4-6", aliases: ["sonnet", "smart"], provider: "anthropic", available: true, status: "available", source: "default" },
  { id: "claude-opus-4-8", aliases: ["opus", "powerful"], provider: "anthropic", available: true, status: "available", source: "default" },
  { id: "claude-fable-5", aliases: ["fable"], provider: "anthropic", available: true, status: "available", source: "default" },
  { id: "claude-mythos-5", aliases: ["mythos"], provider: "anthropic", available: false, status: "suspended", note: SUSPENDED_FABLE_MYTHOS, source: "default" },
  // ── Gemini ───────────────────────────────────────────────────────────────
  { id: "gemini-2.5-flash", aliases: ["gemini-flash"], provider: "gemini", available: true, status: "available", source: "default" },
  { id: "gemini-2.5-flash-lite", aliases: ["gemini-flash-lite", "video"], provider: "gemini", available: true, status: "available", source: "default" },
  // ── OpenAI ───────────────────────────────────────────────────────────────
  { id: "text-embedding-3-small", aliases: ["embedding"], provider: "openai", available: true, status: "available", source: "default" },
  // ── Mistral (EU / GDPR) ──────────────────────────────────────────────────
  { id: "mistral-large-latest", aliases: ["mistral-large"], provider: "mistral", available: true, status: "available", source: "default" },
  { id: "mistral-small-latest", aliases: ["mistral-small"], provider: "mistral", available: true, status: "available", source: "default" },
];

/** The live overlay, keyed by canonical id. Seeded from DEFAULTS (deep-copied so
 *  resetting is clean). refreshAvailability() mutates this; resolve/listModels
 *  read it synchronously. */
let OVERLAY = new Map<string, RegistryEntry>();
/** alias → canonical id, rebuilt whenever the overlay is seeded. */
let ALIAS_INDEX = new Map<string, string>();

function seed(): void {
  OVERLAY = new Map(DEFAULTS.map((e) => [e.id, { ...e, aliases: [...e.aliases] }]));
  ALIAS_INDEX = new Map();
  for (const e of DEFAULTS) for (const a of e.aliases) ALIAS_INDEX.set(a, e.id);
}
seed();

/** Reset the overlay back to the curated defaults. For tests. */
export function resetRegistry(): void {
  seed();
}

/** Canonical id for a model id OR alias; null when we track neither. */
export function canonicalId(requested: string): string | null {
  if (OVERLAY.has(requested)) return requested;
  return ALIAS_INDEX.get(requested) ?? null;
}

/** The current entry for an id/alias, or undefined when untracked (fail-open). */
export function getEntry(requested: string): RegistryEntry | undefined {
  const id = canonicalId(requested);
  return id ? OVERLAY.get(id) : undefined;
}

/** All tracked entries (optionally provider-scoped), as a public ModelStatus[]. */
export function allEntries(provider?: string): ModelStatus[] {
  const rows: ModelStatus[] = [];
  for (const e of OVERLAY.values()) {
    if (provider && e.provider !== provider) continue;
    rows.push({
      id: e.id,
      alias: e.aliases[0],
      provider: e.provider,
      available: e.available,
      status: e.status,
      note: e.note,
      source: e.source,
    });
  }
  return rows;
}

/** Provider-scoped canonical ids (for refresh reconciliation). */
export function providerIds(provider: string): string[] {
  return [...OVERLAY.values()].filter((e) => e.provider === provider).map((e) => e.id);
}

/** Mark a tracked id available/suspended from a live refresh. No-op if untracked. */
export function setAvailability(id: string, available: boolean, note?: string): void {
  const e = OVERLAY.get(id);
  if (!e) return;
  e.available = available;
  e.status = available ? "available" : "suspended";
  e.source = "refresh";
  if (note !== undefined) e.note = note;
  else if (available) e.note = undefined;
}
