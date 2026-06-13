// F022 — async, off-the-hot-path availability refresh. The host runs this
// out-of-band (a timer / at idle); it mutates the registry overlay so the next
// synchronous resolveModel() sees overnight changes like the 2026-06-12 Fable /
// Mythos suspension. NEVER on the resolve hot path. Never hard-fails the SDK:
// a network/auth error keeps the curated defaults.
import { providerIds, setAvailability } from "./registry.js";

export interface RefreshOptions {
  /** Only "anthropic" is wired in v1 (where the incident hit). */
  provider?: "anthropic";
  /** Injectable for tests. Defaults to global fetch. */
  fetch?: typeof fetch;
  /** Defaults to process.env.ANTHROPIC_API_KEY. */
  apiKey?: string;
  /** Min ms between live fetches for a provider (default 1h). */
  ttlMs?: number;
  /** Injectable clock for deterministic TTL tests. Defaults to Date.now(). */
  now?: number;
}

export interface RefreshResult {
  refreshed: boolean;
  checked: number;
  markedUnavailable: string[];
}

const NOT_REFRESHED: RefreshResult = { refreshed: false, checked: 0, markedUnavailable: [] };
const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1h
const ANTHROPIC_MODELS_URL = "https://api.anthropic.com/v1/models";

/** Last successful live fetch per provider, for TTL short-circuiting. */
const lastRefreshAt = new Map<string, number>();

/** Reset the TTL bookkeeping. For tests. */
export function resetRefreshState(): void {
  lastRefreshAt.clear();
}

interface AnthropicModelsResponse {
  data?: { id?: string }[];
}

/**
 * Reconcile tracked models against the provider's live list. For Anthropic:
 * GET /v1/models — any tracked anthropic id NOT in the live set is marked
 * unavailable; ids present are (re)marked available. TTL-cached; a fetch within
 * the window is a no-op. Returns { refreshed:false } on any error or missing key.
 */
export async function refreshAvailability(opts: RefreshOptions = {}): Promise<RefreshResult> {
  const provider = opts.provider ?? "anthropic";
  if (provider !== "anthropic") return NOT_REFRESHED;

  const ttl = opts.ttlMs ?? DEFAULT_TTL_MS;
  const now = opts.now ?? Date.now();
  const last = lastRefreshAt.get(provider);
  if (last !== undefined && now - last < ttl) return NOT_REFRESHED; // within TTL → skip

  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NOT_REFRESHED;

  const f = opts.fetch ?? fetch;
  let liveIds: Set<string>;
  try {
    const res = await f(ANTHROPIC_MODELS_URL, {
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", accept: "application/json" },
    });
    if (!res.ok) return NOT_REFRESHED;
    const json = (await res.json()) as AnthropicModelsResponse;
    liveIds = new Set((json.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === "string"));
  } catch {
    return NOT_REFRESHED; // network error → keep defaults
  }

  // A models list that came back empty is almost certainly an API hiccup, not
  // "every model is dead" — don't suspend the whole provider on it.
  if (liveIds.size === 0) return NOT_REFRESHED;

  const tracked = providerIds(provider);
  const markedUnavailable: string[] = [];
  for (const id of tracked) {
    const live = liveIds.has(id);
    if (live) {
      setAvailability(id, true);
    } else {
      setAvailability(id, false, "not in provider model list (live refresh)");
      markedUnavailable.push(id);
    }
  }

  lastRefreshAt.set(provider, now);
  return { refreshed: true, checked: tracked.length, markedUnavailable };
}
