// F067.6 — "new since last run", not "not in our price table".
//
// The research used to call every model the SDK does not price "new". Measured
// 2026-10-05: 106 OpenAI lines, most of them models that have existed for years
// (gpt-3.5-turbo, gpt-4) and that we simply never priced. A list that long is read
// once and then never again — the failure the report exists to prevent.
//
// So each run stores the model lists it saw (catalogue-seen.json, committed by the
// /model-research skill) and the next run reports only ids that were not there.
// A provider with NO stored list reports everything unknown, as before: a baseline
// written on a provider's first run must not silently swallow what that first run
// should have shown (eleven_v4 was unknown on the day ElevenLabs was first asked).
import type { CatalogueModel } from "./types.js";

/** provider → the model ids seen on the last run (sorted). */
export type SeenLists = Record<string, string[]>;

/** Of the models the diff calls unknown, keep those not seen on the last run. A
 *  provider without a stored list keeps all of them. */
export function newSinceLastRun(unknown: CatalogueModel[], seen: SeenLists): CatalogueModel[] {
  return unknown.filter((m) => {
    const before = seen[m.provider];
    return !before || !before.includes(m.model);
  });
}

/** The lists to store for next time: every id each cleanly-fetched provider listed
 *  this run. Providers that were not fetched keep their previous list, so a missing
 *  key one month does not reset the baseline the next. OpenRouter is left out — its
 *  catalogue is the price source, not a list we mine for new models. */
export function nextSeen(fetched: CatalogueModel[], fetchedProviders: string[], previous: SeenLists): SeenLists {
  const next: SeenLists = { ...previous };
  for (const provider of fetchedProviders) {
    if (provider === "openrouter") continue;
    next[provider] = [...new Set(fetched.filter((m) => m.provider === provider).map((m) => m.model))].sort();
  }
  return next;
}
