// F014.3 — model-catalogue research runner.
//
// Fetches the live model catalogue from every provider (OpenRouter is public;
// openai/anthropic/gemini run when their key is in env), diffs it against the
// SDK's PRICING table + tier map, and renders a markdown report. The monthly
// GitHub Actions workflow (F014.4) runs this, and opens a PR from the report.
//
//   bun run scripts/research-models.ts            # human-readable report
//   bun run scripts/research-models.ts --json     # raw CatalogueDiff as JSON
//
// Exit code: 0 = catalogue clean, 1 = drift found (so CI can branch on it).
import { fetchFullCatalogue, NO_LIST_API } from "../src/catalogue/fetchers.js";
import { diffCatalogue, type CatalogueDiff } from "../src/catalogue/diff.js";
import { aliasMoves, aliasTargets, newSinceLastRun, nextAliasTargets, nextSeen, renderAliasMoves, type AliasTargets, type SeenLists } from "../src/catalogue/seen.js";
import { comparePrices, fetchAnthropicPrices, fetchMistralPrices, renderPriceFindings, uncheckedRows, withAliases, type DirectPrice } from "../src/catalogue/direct-prices.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const json = process.argv.includes("--json");

const { models, errors, fetched, missingKeys } = await fetchFullCatalogue();
const diff = diffCatalogue(models, { fetchedProviders: fetched });

// F067.6 — compare against the lists seen last run (committed by /model-research).
// --dry leaves the file untouched, for a look without moving the baseline.
const SEEN_FILE = "catalogue-seen.json";
const seen: SeenLists = existsSync(SEEN_FILE) ? (JSON.parse(readFileSync(SEEN_FILE, "utf8")) as SeenLists) : {};
const unknownTotal = diff.added.length;
diff.added = newSinceLastRun(diff.added, seen);
// F076.2 — the providers' OWN price pages (Anthropic, Mistral). Their APIs list no
// prices, and OpenRouter only covers rows we already have, so this is the check that
// finds an unpriced model or a price that moved.
const directFailed: Record<string, string> = {};
const directRows: DirectPrice[] = [];
const direct = await Promise.allSettled([fetchAnthropicPrices(), fetchMistralPrices()]);
direct.forEach((r, i) => {
  const p = ["anthropic", "mistral"][i]!;
  if (r.status === "fulfilled") directRows.push(...r.value);
  else directFailed[p] = r.reason instanceof Error ? r.reason.message : String(r.reason);
});
const directPrices = withAliases(directRows, models);
const listed = new Set(models.flatMap((m) => [m.model, ...(m.aliases ?? [])].map((id) => `${m.provider}:${id}`)));
const priceFindings = comparePrices(directPrices, listed);
const priceLines = renderPriceFindings(
  priceFindings,
  directFailed,
  uncheckedRows(directPrices, ["anthropic", "mistral"].filter((p) => !directFailed[p])),
);

// F071.3 — which dated model each "-latest" alias meant last run, so a move shows.
const ALIAS_FILE = "catalogue-aliases.json";
const prevAliases: AliasTargets = existsSync(ALIAS_FILE) ? (JSON.parse(readFileSync(ALIAS_FILE, "utf8")) as AliasTargets) : {};
const nowAliases = aliasTargets(models);
const moves = aliasMoves(prevAliases, nowAliases);
if (!process.argv.includes("--dry")) {
  writeFileSync(SEEN_FILE, JSON.stringify(nextSeen(models, fetched, seen), null, 2) + "\n");
  writeFileSync(ALIAS_FILE, JSON.stringify(nextAliasTargets(nowAliases, fetched, prevAliases), null, 2) + "\n");
}

if (json) {
  console.log(JSON.stringify({ fetched, errors, missingKeys, modelCount: models.length, diff, aliasMoves: moves, priceFindings, directFailed }, null, 2));
} else {
  // F014.5 — loud drift alert when a priced model has vanished upstream (we'd keep
  // pricing a model that no longer exists).
  if (diff.removedUpstream.length > 0) {
    console.log(`⚠️ DRIFT: ${diff.removedUpstream.length} priced model(s) GONE UPSTREAM — ${diff.removedUpstream.join(", ")}\n`);
  }
  // F071.3 — first in the report: a moved alias changes live traffic, everything else is a list.
  const moved = renderAliasMoves(moves);
  if (moved.length) console.log(moved.join("\n"));
  if (priceLines.length) console.log(priceLines.join("\n"));
  console.log(renderReport(diff, { models: models.length, fetched, errors, missingKeys, unknownTotal }));
}

const driftCount = diff.added.length + diff.missingPrice.length + diff.priceChanged.length + diff.removedUpstream.length + moves.length + priceFindings.length + Object.keys(directFailed).length;
process.exit(driftCount > 0 ? 1 : 0);

function num(n: number | undefined): string {
  // Round away float-division artifacts (0.27899999999999997 → 0.279).
  return n === undefined ? "—" : String(Number(n.toPrecision(6)));
}

function renderReport(
  d: CatalogueDiff,
  meta: { models: number; fetched: string[]; errors: Record<string, string>; missingKeys: Record<string, string>; unknownTotal: number },
): string {
  const lines: string[] = [];
  lines.push(`# Model-catalogue research`);
  lines.push("");
  lines.push(`${meta.models} models fetched across: ${meta.fetched.join(", ") || "(none)"}.`);
  lines.push("");

  // F067.1 — three kinds of "not looked at", named apart. They used to share one
  // line ("skipped/failed: openai, anthropic, gemini") and read as an outage.
  const missing = Object.entries(meta.missingKeys);
  lines.push(`## 🔐 Not checked — no key (${missing.length})`);
  lines.push(missing.length === 0 ? "_None._" : missing.map(([p, env]) => `- **${p}** — set \`${env}\``).join("\n"));
  lines.push("");
  const failed = Object.entries(meta.errors);
  lines.push(`## ❌ Fetch failed (${failed.length})`);
  lines.push(failed.length === 0 ? "_None._" : failed.map(([p, e]) => `- **${p}** — ${e}`).join("\n"));
  lines.push("");
  lines.push(`No model-list API we call: ${NO_LIST_API.join(", ")} — their prices are the hand-checked table below.`);
  lines.push("");

  lines.push(`## 💰 Price drift (${d.priceChanged.length})`);
  if (d.priceChanged.length === 0) lines.push("_None._");
  for (const p of d.priceChanged) {
    lines.push(
      `- \`${p.key}\` — input ${p.ourInputPer1M} → **${num(p.upstreamInputPer1M)}**, output ${p.ourOutputPer1M} → **${num(p.upstreamOutputPer1M)}** (per 1M)`,
    );
  }
  lines.push("");

  lines.push(`## 🔑 Missing price — a routed model would log $0 (${d.missingPrice.length})`);
  lines.push(d.missingPrice.length === 0 ? "_None — every shipped route is priced._" : d.missingPrice.map((k) => `- \`${k}\``).join("\n"));
  lines.push("");

  lines.push(`## ✨ New since last run (${d.added.length})`);
  lines.push(
    `_${meta.unknownTotal} listed model(s) are not in our price table; only those not seen on the last run are shown. Dated snapshots of a listed model are folded in._`,
  );
  lines.push(
    d.added.length === 0
      ? "_None._"
      : d.added
          .map((m) => `- \`${m.provider}:${m.model}\`${m.aliases?.length ? ` (also: ${m.aliases.join(", ")})` : ""}`)
          .join("\n"),
  );
  lines.push("");

  lines.push(`## 🗑️ In our table but gone upstream (${d.removedUpstream.length})`);
  lines.push(
    d.removedUpstream.length === 0
      ? "_None._"
      : d.removedUpstream.map((k) => `- \`${k}\` — renamed (check slug formatting) or retired?`).join("\n"),
  );
  lines.push("");

  return lines.join("\n");
}
