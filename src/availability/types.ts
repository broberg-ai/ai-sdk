// F022 — Model Availability Harness. Public types for the availability layer:
// the shared status read (ModelStatus), the resolve result, and the structured
// error a caller can flag on. The registry is the one source both the spawn /
// call path (resolveModel) and UI pickers (listModels) read.

export type AvailabilityStatus = "available" | "suspended" | "unknown";

/** Where a model's current availability came from: the curated default seed,
 *  or a live provider refresh (Anthropic GET /v1/models). */
export type AvailabilitySource = "default" | "refresh";

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
