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

// F071.3 — "-latest" moves. Measured 2026-10-07: Mistral answers with the ALIAS in
// the response's model field, so served_model cannot show mistral-large-latest
// starting to mean a different model. Its /v1/models can: the -latest row lists the
// dated model it currently is. Storing that pair each run turns a silent overnight
// model swap — every `smart`/`powerful` call in the fleet — into a report line.

/** provider → alias → the dated model it pointed at on the last run. */
export type AliasTargets = Record<string, Record<string, string>>;

export interface AliasMove {
  provider: string;
  alias: string;
  from: string;
  to: string;
}

/** For every "-latest" id, the other names it currently shares, sorted and joined —
 *  the WHOLE set, not one pick: mistral-medium-latest also answers to a bare
 *  "mistral-medium" (measured 2026-10-08), and keeping only the first name would
 *  miss a move of the dated one behind it. A changed set reads as a move; an extra
 *  name showing up is a false alarm we can see, a missed move is not. An alias with
 *  no partner is left out rather than guessed. */
export function aliasTargets(models: CatalogueModel[]): AliasTargets {
  const out: AliasTargets = {};
  for (const m of models) {
    if (!m.model.endsWith("-latest") || !m.aliases?.length) continue;
    const target = [...new Set(m.aliases.filter((a) => !a.endsWith("-latest")))].sort().join(", ");
    if (!target) continue;
    (out[m.provider] ??= {})[m.model] = target;
  }
  return out;
}

/** Aliases whose target changed since the last run. A NEW alias is not a move:
 *  there was nothing for it to move from. */
export function aliasMoves(previous: AliasTargets, current: AliasTargets): AliasMove[] {
  const moves: AliasMove[] = [];
  for (const [provider, aliases] of Object.entries(current)) {
    for (const [alias, to] of Object.entries(aliases)) {
      const from = previous[provider]?.[alias];
      if (from !== undefined && from !== to) moves.push({ provider, alias, from, to });
    }
  }
  return moves;
}

/** What to store: this run's pairs for each cleanly-fetched provider; the previous
 *  pairs for a provider that was not fetched (a missing key must not erase them). */
export function nextAliasTargets(current: AliasTargets, fetchedProviders: string[], previous: AliasTargets): AliasTargets {
  const next: AliasTargets = { ...previous };
  for (const provider of fetchedProviders) {
    if (current[provider]) next[provider] = current[provider]!;
    else delete next[provider];
  }
  return next;
}

/** Report lines for the research report. Empty when nothing moved. */
export function renderAliasMoves(moves: AliasMove[]): string[] {
  if (moves.length === 0) return [];
  return [
    `## Alias moved (${moves.length})`,
    "",
    "_A model name the fleet routes by now means a different model. Every call through it changed model, and likely price and behaviour, without a release of ours._",
    "",
    ...moves.map((m) => `- alias flyttet: ${m.provider} \`${m.alias}\` ${m.from} → ${m.to}`),
    "",
  ];
}
