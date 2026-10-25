// F022 — Model Availability Harness. Public types for the availability layer:
// the shared status read (ModelStatus), the resolve result, and the structured
// error a caller can flag on. The registry is the one source both the spawn /
// call path (resolveModel) and UI pickers (listModels) read.

export type AvailabilityStatus = "available" | "suspended" | "unknown";

/** Where a model's current availability came from: the curated default seed,
 *  or a live provider refresh (Anthropic GET /v1/models). */
export type AvailabilitySource = "default" | "refresh";

/** What a model IS, so a picker can offer only chat models in a chat dropdown (F022.6). */
export type ModelKind = "chat" | "embedding" | "judge" | "tts" | "transcribe";

/** The provider's price/quality step, as a picker labels it (F022.6). Not a tier:
 *  tiers route calls, grades only describe a row. */
export type ModelGrade = "cheap" | "standard" | "strong";

/** One row of the shared status read — what a UI model-picker renders. */
export interface ModelStatus {
  /** Canonical provider model id, e.g. "claude-fable-5". */
  id: string;
  /** Short/tier alias, e.g. "fable" (the first registered alias). */
  alias?: string;
  /** "anthropic" | "openai" | "gemini" | "mistral" | … */
  provider: string;
  available: boolean;
  status: AvailabilityStatus;
  /** Friendly reason, e.g. "suspended — US export-control directive (2026-06-12)". */
  note?: string;
  source: AvailabilitySource;
  /** F022.6 — chat / embedding / judge. */
  kind: ModelKind;
  /** F022.6 — exactly one row per provider carries this: the model a picker
   *  pre-selects. Always a pinned (non-floating), priced id. */
  default?: true;
  /** F022.6 — present on the cheap / standard / strong pick for a provider. */
  grade?: ModelGrade;
  /** F022.6 — the id is a moving alias (`-latest`): the provider can swap the
   *  model behind it without a deploy. Never the default (D-385d97). */
  floating?: true;
}

/** Result of resolveModel — the spawn / call path consumes this synchronously. */
export interface ResolveResult {
  /** True when the requested model itself is available. */
  ok: boolean;
  /** The id to actually use: `requested` when ok, else the first available fallback. */
  model: string;
  /** What the caller asked for (id or alias, normalized to the canonical id). */
  requested: string;
  provider?: string;
  /** True when `model` differs from `requested` because we fell back. */
  fellBack: boolean;
  status: AvailabilityStatus;
  /** Why it degraded / why it is unavailable. */
  reason?: string;
  /** The registry row's caveat, surfaced on the SUCCESS path too (F057.2).
   *
   *  `reason` only ever appears when a model is unavailable, so a caveat written
   *  on an AVAILABLE row — "documented to deprecate 2026-07-24", "preview", a
   *  known rate limit — was reachable through listModels() and invisible to the
   *  one caller who most needs it: the gate. A consumer passing requireKnown got
   *  a clean green with the warning sitting one call away, unread. Carrying it
   *  here costs an optional field and makes `ok:true` able to say "yes, but". */
  note?: string;
}

/** Thrown by resolveModel when the requested model is unavailable, no usable
 *  fallback exists, and the caller passed `throwIfUnavailable`. Callers flag on
 *  `.code === "model_unavailable"`. */
export class ModelUnavailableError extends Error {
  readonly code = "model_unavailable";
  readonly requested: string;
  readonly provider?: string;
  readonly note?: string;
  constructor(requested: string, note?: string, provider?: string) {
    super(`model "${requested}" is unavailable${note ? ` (${note})` : ""}`);
    this.name = "ModelUnavailableError";
    this.requested = requested;
    this.note = note;
    this.provider = provider;
  }
}
