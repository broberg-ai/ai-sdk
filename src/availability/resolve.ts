// F022 — the synchronous, zero-I/O resolve + status read. This is the spawn /
// call hot path (buddy's launcher calls resolveModel per spawn, cardmem #4842):
// it MUST never await and never touch the network. Freshness comes only from a
// prior async refreshAvailability(); resolve just reads the in-memory registry.
import { allEntries, canonicalId, getEntry } from "./registry.js";
import { ModelUnavailableError } from "./types.js";
import type { ModelStatus, ResolveResult } from "./types.js";

export interface ResolveOptions {
  /** One id/alias or an ordered chain to try when `requested` is unavailable. */
  fallback?: string | string[];
  /** Scope hint (passed through to the result); does not gate lookup. */
  provider?: string;
  /** Throw ModelUnavailableError instead of returning ok:false when there is no
   *  usable fallback. For callers that want to flag rather than degrade. */
  throwIfUnavailable?: boolean;
}

/** The shared status read — UI pickers grey out `available:false` rows. */
export function listModels(opts: { provider?: string } = {}): ModelStatus[] {
  return allEntries(opts.provider);
}

/** Is this id/alias currently usable? Untracked ids are fail-open (true). */
function isAvailable(requested: string): boolean {
  const e = getEntry(requested);
  return e ? e.available : true; // fail-open on unknown
}

/**
 * Resolve a requested model (id or alias) to one that is actually usable.
 * Synchronous + offline by contract (cardmem #4842) — reads the registry only.
 *
 * - Available → pass through ({ ok:true, fellBack:false }).
 * - Unavailable + a fallback that IS available → swap ({ ok:false, fellBack:true }).
 * - Unavailable + no usable fallback → throw (throwIfUnavailable) or return ok:false.
 * - Unknown id → treated available (never block a model we do not track).
 */
export function resolveModel(requested: string, opts: ResolveOptions = {}): ResolveResult {
  const id = canonicalId(requested) ?? requested;
  const entry = getEntry(requested);
  const provider = opts.provider ?? entry?.provider;

  if (isAvailable(requested)) {
    return {
      ok: true,
      model: id,
      requested: id,
      provider,
      fellBack: false,
      status: entry?.status ?? "unknown",
    };
  }

  // Requested is suspended — walk the fallback chain for the first available one.
  const chain = opts.fallback === undefined ? [] : Array.isArray(opts.fallback) ? opts.fallback : [opts.fallback];
  for (const fb of chain) {
    if (isAvailable(fb)) {
      const fbId = canonicalId(fb) ?? fb;
      return {
        ok: false,
        model: fbId,
        requested: id,
        provider,
        fellBack: true,
        status: entry?.status ?? "suspended",
        reason: entry?.note ?? `${id} is unavailable`,
      };
    }
  }

  // No usable fallback.
  if (opts.throwIfUnavailable) {
    throw new ModelUnavailableError(id, entry?.note, provider);
  }
  return {
    ok: false,
    model: id,
    requested: id,
    provider,
    fellBack: false,
    status: entry?.status ?? "suspended",
    reason: entry?.note ?? `${id} is unavailable`,
  };
}
