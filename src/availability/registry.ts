// F022 — the model-availability registry: the ONE source both resolveModel()
// (spawn / call path) and listModels() (UI picker) read. A curated default seed
// (works offline — the durable floor) plus a mutable overlay that
// refreshAvailability() updates from the live provider list.
//
// Scope note: this is a LIVENESS view (is this id alive right now?), not the
// rich capability/price inventory (that is F017 src/catalogue). We only track
// ids we want to assert status on; anything not here is fail-open (treated
// available) so we never block a model we simply do not track.
import { DEFAULT_TIER_MAP } from "../routing/tier-map.js";
import type { AvailabilityStatus, AvailabilitySource, ModelGrade, ModelKind, ModelStatus } from "./types.js";

/** Internal registry row. `aliases[0]` surfaces as ModelStatus.alias. */
export interface RegistryEntry {
  id: string;
  aliases: string[];
  provider: string;
  available: boolean;
  status: AvailabilityStatus;
  note?: string;
  source: AvailabilitySource;
  /** F022.6. Omitted = "chat" (most rows); set explicitly for anything else. */
  kind?: ModelKind;
  default?: true;
  grade?: ModelGrade;
}

/** A `-latest` id is a moving alias — the provider can swap the model behind it.
 *  Derived, not hand-written, so a new -latest row cannot forget the flag. */
export const isFloatingId = (id: string): boolean => /-latest$/.test(id);

/** F079 — routes that float without saying so in the id: the provider serves only a
 *  moving `latest` and has no dated version to pin. Measured 20/10 2026 on BFL's
 *  openapi.json: FLUX 3 Video's `version` is the const "latest" ("dated pinnable
 *  release tags are added here as they are published"). Remove a row when it can pin. */
export const LATEST_ONLY_ROUTES: ReadonlySet<string> = new Set(["bfl:flux-3-video"]);

/** Does this route float — a `-latest` id, or a provider that only serves latest? */
export const isFloatingRoute = (provider: string, model: string): boolean =>
  isFloatingId(model) || LATEST_ONLY_ROUTES.has(`${provider}:${model}`);

const NO_OPENAI_SNAPSHOT = "no dated snapshot published (measured 2026-10-11) — the id may start pointing at a newer model";
const SUSPENDED_FABLE_MYTHOS = "suspended — US export-control directive (2026-06-12)";

/** Curated defaults. Aliases here are MODEL-IDENTITY names only (short names for
 *  the model itself). TIER aliases — fast/smart/powerful/cheap/vision/video/
 *  embedding — are NOT written here: they are derived from DEFAULT_TIER_MAP below,
 *  because hand-maintaining them in two places is exactly how they drifted.
 *
 *  They HAD drifted, and it crossed the EU border: this list said `smart` was
 *  claude-sonnet-4-6 (Anthropic, US) for the ~3 months after F030 pointed the
 *  default tiers at Mistral EU, so resolveModel('smart') named a US model while
 *  ai.chat({tier:'smart'}) called an EU one. Anyone using resolveModel to SHOW or
 *  DECIDE where data goes — the obvious use — got the wrong answer. Measured by
 *  fd-sundhed in 0.21.1, still true in 0.28.0, fixed here by deleting the second
 *  list rather than correcting it. */
const DEFAULTS: RegistryEntry[] = [
  // ── Anthropic ────────────────────────────────────────────────────────────
  { id: "claude-haiku-4-5", aliases: ["haiku"], provider: "anthropic", available: true, status: "available", source: "default" },
  { id: "claude-sonnet-4-6", aliases: ["sonnet"], provider: "anthropic", available: true, status: "available", source: "default" },
  { id: "claude-opus-4-8", aliases: ["opus"], provider: "anthropic", available: true, status: "available", source: "default" },
  { id: "claude-fable-5", aliases: ["fable"], provider: "anthropic", available: true, status: "available", source: "default" },
  { id: "claude-mythos-5", aliases: ["mythos"], provider: "anthropic", available: false, status: "suspended", note: SUSPENDED_FABLE_MYTHOS, source: "default" },
  // F022.6 — the live Claude 5 family, measured with GET /v1/models on 2026-10-11.
  // These ids have no dated snapshot: the id IS the pin. The older rows above stay,
  // because removing one would turn a passing requireKnown gate into a refusal.
  { id: "claude-haiku-5-5", aliases: [], provider: "anthropic", available: true, status: "available", source: "default", grade: "cheap" },
  { id: "claude-sonnet-5-5", aliases: [], provider: "anthropic", available: true, status: "available", source: "default", grade: "standard", default: true },
  { id: "claude-opus-5-5", aliases: [], provider: "anthropic", available: true, status: "available", source: "default", grade: "strong" },
  { id: "claude-fable-5-1", aliases: [], provider: "anthropic", available: true, status: "available", source: "default" },
  { id: "claude-opus-5", aliases: [], provider: "anthropic", available: true, status: "available", source: "default" },
  { id: "claude-sonnet-5", aliases: [], provider: "anthropic", available: true, status: "available", source: "default" },
  { id: "claude-opus-4-7", aliases: [], provider: "anthropic", available: true, status: "available", source: "default" },
  { id: "claude-opus-4-6", aliases: [], provider: "anthropic", available: true, status: "available", source: "default" },
  // ── Gemini ───────────────────────────────────────────────────────────────
  { id: "gemini-2.5-flash", aliases: ["gemini-flash"], provider: "gemini", available: true, status: "available", source: "default", grade: "standard", default: true },
  { id: "gemini-2.5-flash-lite", aliases: ["gemini-flash-lite"], provider: "gemini", available: true, status: "available", source: "default", grade: "cheap" },
  // ── OpenAI ───────────────────────────────────────────────────────────────
  { id: "text-embedding-3-small", aliases: [], provider: "openai", available: true, status: "available", source: "default", kind: "embedding" },
  // F022.6 — chat models, measured with GET /v1/models on 2026-10-11 and priced from
  // developers.openai.com/api/docs/pricing the same day. The cheap/standard/strong
  // picks are DATED snapshots, so a picker's default cannot move under anyone
  // (D-385d97).
  { id: "gpt-5.4-nano-2026-03-17", aliases: [], provider: "openai", available: true, status: "available", source: "default", grade: "cheap" },
  { id: "gpt-5.4-mini-2026-03-17", aliases: [], provider: "openai", available: true, status: "available", source: "default", grade: "standard", default: true },
  { id: "gpt-5.5-2026-04-23", aliases: [], provider: "openai", available: true, status: "available", source: "default", grade: "strong" },
  // OpenAI's newest families had NO dated snapshot in /v1/models on 2026-10-11. They
  // are offered, but not as a default: we cannot show that the id will keep meaning
  // the same model.
  ...["gpt-6-luna", "gpt-6-sol", "gpt-6.1-sol", "gpt-6-astra", "gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"].map(
    (id): RegistryEntry => ({ id, aliases: [], provider: "openai", available: true, status: "available", source: "default", note: NO_OPENAI_SNAPSHOT }),
  ),
  // ── DeepSeek (CN-hosted — NOT GDPR-safe; non-PII workloads only) ─────────
  //
  // F057.2. These were missing while pricing.ts carried OFFICIAL rates for them
  // and providers/deepseek.ts shipped an adapter (F030.2) — so our own CLAUDE.md
  // instruction ("if you are GATING, pass requireKnown:true") refused a route we
  // built, priced and wrote an F-number for. Two tables disagreed, and the gate
  // is the one that decides. Reported by pitch (ref 28546) via components.
  //
  // The note carries the sunset because the registry is what a picker renders, and
  // a row that says only "available" would hide it. Both ids were documented to
  // deprecate 2026-07-24 in favour of `deepseek-v4-flash` — we have NOT verified
  // against a live key (no DEEPSEEK_API_KEY here), so this is the curated seed's
  // usual standing: a default, not a measurement. A live refresh may overrule it.
  //
  // `deepseek-v4-flash` on the DIRECT api is deliberately NOT here: it has no
  // price in pricing.ts (measured — getPrice("deepseek","deepseek-v4-flash") is
  // undefined), so a row would pass the gate for a route that silently bills
  // nothing. That is the same green-direction failure this card exists to remove,
  // and it needs a rate from a real source, not a guess. See the plan-doc.
  { id: "deepseek-chat", aliases: [], provider: "deepseek", available: true, status: "available", note: "direct api.deepseek.com; documented to deprecate 2026-07-24 in favour of deepseek-v4-flash — not live-verified", source: "default" },
  { id: "deepseek-reasoner", aliases: [], provider: "deepseek", available: true, status: "available", note: "direct api.deepseek.com (thinking); documented to deprecate 2026-07-24 in favour of deepseek-v4-flash — not live-verified", source: "default" },
  // ── TypeSafe (US-hosted — NOT for personal data) ─────────────────────────
  //
  // F066. Two rows, not an alias. TypeSafe's "jev-latest" points at jev-1.13.0 TODAY and
  // moves on their next release; writing it here as an alias of 1.13.0 would make this
  // registry assert a mapping we would have to remember to undo. As separate rows, both
  // pass a requireKnown gate and neither claims to be the other.
  { id: "jev-1.13.0", aliases: ["jev"], provider: "typesafe", available: true, status: "available", note: "TypeSafe Jev, pinned version. US-hosted — not for personal data. Decision model: use ai.judge, not ai.chat", source: "default", kind: "judge" },
  { id: "jev-latest", aliases: [], provider: "typesafe", available: true, status: "available", note: "MOVING alias (jev-1.13.0 as of 2026-10-01). Pin jev-1.13.0 if you tuned thresholds on confidence. US-hosted — not for personal data", source: "default", kind: "judge" },
  // F081 — Microsoft-Decision-1, our deployment decision-1-eu (Sweden Central, Data Zone
  // Standard). Version 1 pinned (NoAutoUpgrade). Azure's catalogue: inference ends 2027-02-04.
  { id: "microsoft-decision-1-v1", aliases: ["decision-1"], provider: "microsoft-decision", available: true, status: "available", note: "Microsoft-Decision-1 v1 — EU decision model for ai.judge (Sweden Central, Data Zone Standard = EU+NO+CH). Same answer shape as Jev. Version 1 is RETIRED by Azure on 2027-02-04 (inference stops) — a successor must be deployed before then. Built on Qwen3.5-9B; Microsoft plans to move it to MAI/OpenAI models, so answers may change between versions", source: "default", kind: "judge" },
  // ── Mistral (EU / GDPR) ──────────────────────────────────────────────────
  // F083 — speech, measured live 2026-10-25. Not chat models: use ai.tts / ai.transcribe.
  { id: "voxtral-mini-tts-3-0", aliases: [], provider: "mistral", available: true, status: "available", note: "Voxtral TTS 3 — use ai.tts with override:{provider:\"mistral\"} and a voice slug (e.g. voice_3150 James, en_us). NOT FOR DANISH: no Danish-labelled voice, and the owner rejected Heidi on Danish 2026-10-26 (German accent) — use Azure da-DK. EU", source: "default", kind: "tts" },
  { id: "voxtral-small-transcribe-3-0", aliases: [], provider: "mistral", available: true, status: "available", note: "Voxtral Small Transcribe 3 — Danish (language:\"da\") measured word-for-word 2026-10-25; the older voxtral-mini rejects da. EU", source: "default", kind: "transcribe" },
  { id: "mistral-large-latest", aliases: ["mistral-large"], provider: "mistral", available: true, status: "available", source: "default" },
  { id: "mistral-medium-latest", aliases: ["mistral-medium"], provider: "mistral", available: true, status: "available", source: "default" },
  { id: "mistral-small-latest", aliases: ["mistral-small"], provider: "mistral", available: true, status: "available", source: "default" },
  // F077 — the dated ids the tiers are pinned to. The -latest rows above stay: callers
  // still pass them, and an unknown id would fail a requireKnown gate.
  // F022.6 — default = what the `smart` tier calls (a test holds them together).
  { id: "mistral-large-2512", aliases: [], provider: "mistral", available: true, status: "available", note: "Mistral Large 3 — RETIRES 2027-04-30 (Mistral deprecation mail 2026-10-30); Mistral recommends Mistral Large 4 (mistral-large-4-0). Backs the smart/powerful tiers until then (F085.3)", source: "default", grade: "standard", default: true },
  { id: "mistral-medium-2604", aliases: [], provider: "mistral", available: true, status: "available", note: "Mistral Medium 3.5 — RETIRES 2027-04-30 (Mistral deprecation mail 2026-10-30); Mistral recommends Mistral Large 4. Backs the vision tier until then (F085.3)", source: "default" },
  { id: "mistral-small-2603", aliases: [], provider: "mistral", available: true, status: "available", source: "default", grade: "cheap" },
];

/** Attach every tier name as an alias of the model that tier ACTUALLY calls.
 *  One source: DEFAULT_TIER_MAP decides, the registry follows. A tier whose model
 *  is not in the registry is left unaliased on purpose — resolveModel then reports
 *  status "unknown" (fail-open) instead of inventing a row, and the drift test
 *  catches it. */
export const TIER_ALIAS_CONFLICTS: string[] = [];

function applyTierAliases(entries: RegistryEntry[]): RegistryEntry[] {
  for (const [tier, spec] of Object.entries(DEFAULT_TIER_MAP)) {
    const owner = entries.find((e) => e.id === spec.model && e.provider === spec.provider);
    // A tier name hand-written on any OTHER row is the drift bug returning. It
    // would resolve correctly TODAY only because seed() lets the last write win
    // and the rows happen to be ordered favourably — reorder the array and the
    // tier silently points at the wrong provider again. Record it so a test can
    // fail on it, then strip it so runtime is right regardless.
    for (const e of entries) {
      if (e !== owner && e.aliases.includes(tier)) {
        TIER_ALIAS_CONFLICTS.push(`${tier} is hand-declared on ${e.id} (${e.provider}) but tier ${tier} calls ${spec.model} (${spec.provider})`);
        e.aliases = e.aliases.filter((a) => a !== tier);
      }
    }
    if (owner && !owner.aliases.includes(tier)) owner.aliases.push(tier);
  }
  return entries;
}
applyTierAliases(DEFAULTS);

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
      kind: e.kind ?? "chat",
      ...(e.default ? { default: true as const } : {}),
      ...(e.grade ? { grade: e.grade } : {}),
      ...(isFloatingId(e.id) ? { floating: true as const } : {}),
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
