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
import { fetchFullCatalogue } from "../src/catalogue/fetchers.js";
import { diffCatalogue, type CatalogueDiff } from "../src/catalogue/diff.js";

const json = process.argv.includes("--json");

const { models, errors, fetched } = await fetchFullCatalogue();
const diff = diffCatalogue(models, { fetchedProviders: fetched });

if (json) {
  console.log(JSON.stringify({ fetched, errors, modelCount: models.length, diff }, null, 2));
} else {
  // F014.5 — loud drift alert when a priced model has vanished upstream (we'd keep
  // pricing a model that no longer exists).
  if (diff.removedUpstream.length > 0) {
    console.log(`⚠️ DRIFT: ${diff.removedUpstream.length} priced model(s) GONE UPSTREAM — ${diff.removedUpstream.join(", ")}\n`);
  }
  console.log(renderReport(diff, { models: models.length, fetched, errors }));
}

const driftCount = diff.added.length + diff.missingPrice.length + diff.priceChanged.length + diff.removedUpstream.length;
process.exit(driftCount > 0 ? 1 : 0);

function num(n: number | undefined): string {
  // Round away float-division artifacts (0.27899999999999997 → 0.279).
  return n === undefined ? "—" : String(Number(n.toPrecision(6)));
}

function renderReport(
  d: CatalogueDiff,
  meta: { models: number; fetched: string[]; errors: Record<string, string> },
): string {
  const lines: string[] = [];
  lines.push(`# Model-catalogue research`);
  lines.push("");
  lines.push(`${meta.models} models fetched across: ${meta.fetched.join(", ") || "(none)"}.`);
  const errKeys = Object.keys(meta.errors);
  if (errKeys.length) lines.push(`Providers skipped/failed: ${errKeys.join(", ")}.`);
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

  lines.push(`## ✨ New models to consider (${d.added.length})`);
  lines.push(d.added.length === 0 ? "_None._" : d.added.map((m) => `- \`${m.provider}:${m.model}\``).join("\n"));
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
