// F069.1 — Bring Your Own Key: a client that can never run on the fleet's keys.
//
// Every adapter resolves its key as `config.apiKey ?? process.env.<X>_API_KEY`. That
// fallback is right for the fleet (keys from env) and wrong for a customer key:
// measured 2026-10-05, `openaiAdapter({ apiKey: undefined })` with OPENAI_API_KEY in
// env sent the FLEET's key. A customer whose key is missing from the app's store —
// not yet saved, deleted, mis-read — would run silently on our account, and nothing
// would fail, so nobody would notice.
//
// The guard is central on purpose. Fifteen adapters each read env their own way; a
// flag threaded through all of them is fifteen places to forget one. Instead:
//   • byokAdapter(factory, config) refuses to build without a real key, and marks
//     what it built;
//   • createAI({ byok: true }) refuses to start unless EVERY provider carries that
//     mark — so an adapter built the ordinary way (which may read env) cannot slip in.
// An adapter given a non-empty key never reaches its env fallback, because `??` only
// falls through on null/undefined.
import type { ProviderAdapter } from "./types.js";

const BYOK_KEYED = Symbol.for("@broberg/ai-sdk/byok-keyed");

/** The key-carrying fields an adapter config may hold. `credentials` is Vertex's
 *  service-account JSON; every other adapter takes `apiKey`. */
interface KeyedConfig {
  apiKey?: string;
  credentials?: string;
}

/** Build an adapter that is guaranteed to use the key you pass and never the fleet's
 *  env key. Throws at construction when the key is missing or blank — a blank string
 *  is not a key, and treating it as one would only move the failure to a 401 later. */
export function byokAdapter<C extends KeyedConfig>(
  factory: (config: C) => ProviderAdapter,
  config: C,
): ProviderAdapter {
  const key = config.apiKey ?? config.credentials;
  if (typeof key !== "string" || key.trim() === "") {
    throw new Error(
      "byokAdapter: no customer key (apiKey/credentials is missing or blank). " +
        "Refusing to build an adapter that would fall back to the fleet's env key.",
    );
  }
  const adapter = factory(config);
  Object.defineProperty(adapter, BYOK_KEYED, { value: true, enumerable: false });
  return adapter;
}

/** True when the adapter was built by byokAdapter with a real key. */
export function isByokKeyed(adapter: ProviderAdapter): boolean {
  return (adapter as unknown as Record<symbol, unknown>)[BYOK_KEYED] === true;
}

/** createAI({ byok: true }) calls this at setup. Throws, naming every offender, when
 *  there are no providers (the fleet's defaults would be used) or when any provider
 *  was not built by byokAdapter. Nothing has been sent when it throws. */
export function assertByokProviders(providers: Record<string, ProviderAdapter> | undefined): void {
  if (!providers || Object.keys(providers).length === 0) {
    throw new Error(
      "createAI({ byok: true }) needs `providers` built with byokAdapter — without them the " +
        "fleet's default adapters (and the fleet's keys) would be used.",
    );
  }
  const unkeyed = Object.entries(providers)
    .filter(([, a]) => !isByokKeyed(a))
    .map(([name]) => name);
  if (unkeyed.length > 0) {
    throw new Error(
      `createAI({ byok: true }): provider(s) ${unkeyed.join(", ")} were not built with byokAdapter, ` +
        "so they may read the fleet's env key. Build each one as byokAdapter(openaiAdapter, { apiKey }).",
    );
  }
}
