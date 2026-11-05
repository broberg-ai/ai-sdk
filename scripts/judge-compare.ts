#!/usr/bin/env bun
// F081.4 — Jev (TypeSafe, US) vs Microsoft-Decision-1 (Azure Sweden Central, EU) on the same
// questions with a KNOWN answer, plus Mistral Small (ai.contracts.classify, EU) as the
// "ordinary chat model" baseline. Cases: scripts/judge-compare/cases.json (synthetic, no
// personal data).
//
//   bun run scripts/judge-compare.ts [--out report.md]
//
// Per engine: correct answers, probability on the right answer, Brier score (yes/no),
// p50/p95 latency, input tokens, and cost per 1,000 decisions FROM usage (not list price).
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createAI } from "../src/index.js";

type Item =
  | { id: string; kind: "noul"; text: string; question: string; truth: boolean }
  | { id: string; kind: "choice"; text: string; question: string; options: string[]; truth: string }
  | { id: string; kind: "score"; text: string; question: string; levels: string[]; truth: number };

const ITEMS: Item[] = JSON.parse(readFileSync(join(import.meta.dir, "judge-compare", "cases.json"), "utf8"));

type Row = { engine: string; id: string; correct: boolean; pTruth?: number; ms: number; inTok: number; usd: number; region: string; error?: string };

const ai = createAI();
const ENGINES = {
  "Jev (TypeSafe)": { provider: "typesafe", model: "jev-1.13.0", transport: "http" as const },
  "Decision-1 (Azure)": { provider: "microsoft-decision", model: "microsoft-decision-1-v1", transport: "http" as const },
};
const BASELINE = "Mistral Small (classify)";

function question(it: Item) {
  if (it.kind === "noul") return { type: "noul" as const, instructions: it.question };
  if (it.kind === "choice") return { type: "choice" as const, instructions: it.question, criteria: Object.fromEntries(it.options.map((o) => [o, o])) };
  return { type: "score" as const, instructions: it.question, criteria: it.levels };
}

async function judge(engine: keyof typeof ENGINES, it: Item): Promise<Row> {
  const t0 = Date.now();
  try {
    const r = await ai.judge({ state: it.text, questions: { q: question(it) }, override: ENGINES[engine], purpose: "F081.4-compare" });
    const a = r.answers.q!;
    let correct: boolean, pTruth: number;
    if (a.type === "noul" && it.kind === "noul") {
      pTruth = it.truth ? a.noul : 1 - a.noul;
      correct = a.noul >= 0.5 === it.truth;
    } else if (a.type === "choice" && it.kind === "choice") {
      pTruth = a.probabilities[it.truth] ?? 0;
      correct = a.choice === it.truth;
    } else if (a.type === "score" && it.kind === "score") {
      pTruth = a.probabilities[String(it.truth)] ?? 0;
      correct = Math.round(a.score) === it.truth;
    } else throw new Error(`answer type ${a.type} does not match case ${it.kind}`);
    return { engine, id: it.id, correct, pTruth, ms: Date.now() - t0, inTok: r.usage.inputTokens, usd: r.usage.costUsd, region: r.usage.region ?? "?" };
  } catch (e) {
    return { engine, id: it.id, correct: false, ms: Date.now() - t0, inTok: 0, usd: 0, region: "?", error: String(e).slice(0, 200) };
  }
}

async function classify(it: Item): Promise<Row> {
  const t0 = Date.now();
  try {
    const labels = it.kind === "noul" ? ["ja", "nej"] : it.kind === "choice" ? it.options : it.levels;
    const truth = it.kind === "noul" ? (it.truth ? "ja" : "nej") : it.kind === "choice" ? it.truth : it.levels[it.truth]!;
    const r = await ai.contracts.classify({ text: `${it.text}\n\nSpørgsmål: ${it.question}`, labels, tier: "cheap", purpose: "F081.4-compare" });
    return { engine: BASELINE, id: it.id, correct: r.label === truth, ms: Date.now() - t0, inTok: r.usage.inputTokens, usd: r.usage.costUsd, region: r.usage.region ?? "?" };
  } catch (e) {
    return { engine: BASELINE, id: it.id, correct: false, ms: Date.now() - t0, inTok: 0, usd: 0, region: "?", error: String(e).slice(0, 200) };
  }
}

function pct(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!;
}

const rows: Row[] = [];
for (const it of ITEMS) {
  rows.push(...(await Promise.all([judge("Jev (TypeSafe)", it), judge("Decision-1 (Azure)", it), classify(it)])));
}

const kinds = (k: Item["kind"]) => ITEMS.filter((i) => i.kind === k).length;
const engines = [...Object.keys(ENGINES), BASELINE];
const L: string[] = [`# F081.4 — Jev vs Decision-1 (+ Mistral Small) — målt ${new Date().toISOString().slice(0, 10)}`, ""];
L.push(`${ITEMS.length} cases med kendt facit: ${kinds("noul")} ja/nej, ${kinds("choice")} valg, ${kinds("score")} skala. Syntetisk materiale, gennemlæst: ingen persondata (ingen navne, adresser, CPR, helbredsoplysninger). Cases: \`scripts/judge-compare/cases.json\`.`, "");
L.push("| Motor | Rigtige | Snit-sandsynlighed på facit | Brier ja/nej (lavere = bedre) | p50 | p95 | Input-tokens i alt | Pris pr. 1.000 beslutninger (fra usage) | Region | Fejl |", "|---|---|---|---|---|---|---|---|---|---|");
for (const e of engines) {
  const rs = rows.filter((r) => r.engine === e);
  const ok = rs.filter((r) => !r.error);
  const probs = ok.filter((r) => r.pTruth !== undefined);
  const noul = probs.filter((r) => r.id.startsWith("n"));
  const brier = noul.length ? (noul.reduce((n, r) => n + (1 - r.pTruth!) ** 2, 0) / noul.length).toFixed(3) : "—";
  const avgP = probs.length ? (probs.reduce((n, r) => n + r.pTruth!, 0) / probs.length).toFixed(2) : "— (giver ingen)";
  const ms = ok.map((r) => r.ms);
  const per1000 = ok.length ? (ok.reduce((n, r) => n + r.usd, 0) / ok.length) * 1000 : 0;
  L.push(`| ${e} | ${rs.filter((r) => r.correct).length}/${rs.length} | ${avgP} | ${brier} | ${pct(ms, 50)} ms | ${pct(ms, 95)} ms | ${ok.reduce((n, r) => n + r.inTok, 0)} | $${per1000.toFixed(4)} | ${[...new Set(ok.map((r) => r.region))].join(",")} | ${rs.filter((r) => r.error).length} |`);
}
L.push("", "## Forbehold", "",
  "- **Ingen uafhængige tal fra Microsoft.** Decision-1's nøjagtighed og kalibrering er kun målt her, på dette lille sæt. 33 cases afgør ikke små forskelle.",
  "- **EU-datazonen** (Data Zone Standard) dækker EU/EØS **inkl. Norge og Schweiz** — ikke kun EU-lande. Region målt pr. kald fra `x-ms-region`.",
  "- **Qwen3.5-9B-basis:** Decision-1 er ifølge Microsofts modelkort bygget på Qwen3.5-9B, og Microsoft har annonceret et planlagt modelskift. Tallene her gælder versionen `microsoft-decision-1-v1`.",
  "- **Udløbsdato:** Azure udfaser `microsoft-decision-1-v1` **2027-02-04**. Efter det skal ruten flyttes eller fjernes.",
  "- **Jev** er US-hostet og gemmer input (målt 2026-10-01) — aldrig til persondata.",
  "- **Mistral Small** er en almindelig chatmodel via `ai.contracts.classify`; den giver ingen sandsynlighed, så kun antal rigtige kan sammenlignes.",
  "- **Token-tal er udbydernes egne.** Jev og Decision-1 har samme listepris ($0,042/1M ind), men tæller input forskelligt; prisen pr. 1.000 er derfor beregnet fra `usage`, ikke fra listen.",
);
L.push("", "## Pr. case (✓/✗ og sandsynlighed på facit)", "", `| id | ${engines.join(" | ")} |`, `|---|${engines.map(() => "---").join("|")}|`);
for (const it of ITEMS) {
  L.push(`| ${it.id} | ${engines.map((e) => { const r = rows.find((x) => x.engine === e && x.id === it.id)!; return r.error ? "FEJL" : `${r.correct ? "✓" : "✗"}${r.pTruth !== undefined ? ` ${r.pTruth.toFixed(2)}` : ""}`; }).join(" | ")} |`);
}
const errs = rows.filter((r) => r.error);
if (errs.length) L.push("", "## Fejl", "", ...errs.map((r) => `- ${r.engine} ${r.id}: ${r.error}`));
const md = L.join("\n");
const outIdx = process.argv.indexOf("--out");
if (outIdx > 0) writeFileSync(process.argv[outIdx + 1]!, md);
console.log(md);
