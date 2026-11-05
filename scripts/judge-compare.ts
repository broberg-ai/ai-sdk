#!/usr/bin/env bun
// F081.4 — Jev (TypeSafe, US) vs Microsoft-Decision-1 (Azure Sweden Central, EU) on the same
// questions with a KNOWN answer, plus Mistral Small (ai.contracts.classify, EU) as the
// "ordinary chat model" baseline. Synthetic material only — no personal data.
//
//   bun run scripts/judge-compare.ts [--out report.md]
//
// Measures per engine: correct answers, probability on the right answer, Brier score
// (yes/no), latency, input tokens and cost. Prints a markdown report.
import { writeFileSync } from "node:fs";
import { createAI } from "../src/index.js";

type Item =
  | { id: string; kind: "noul"; text: string; question: string; truth: boolean }
  | { id: string; kind: "choice"; text: string; question: string; options: string[]; truth: string };

const ITEMS: Item[] = [
  // yes/no — clear
  { id: "n1", kind: "noul", text: "Mødet er flyttet fra tirsdag til torsdag kl. 10.", question: "Er mødet flyttet til torsdag?", truth: true },
  { id: "n2", kind: "noul", text: "Fakturaen er betalt den 3. november via bankoverførsel.", question: "Mangler fakturaen at blive betalt?", truth: false },
  { id: "n3", kind: "noul", text: "The deploy failed: 3 tests red, rollback completed.", question: "Did the deploy succeed?", truth: false },
  { id: "n4", kind: "noul", text: "Vi har lukket klinikken mellem jul og nytår.", question: "Er klinikken lukket i juleugen?", truth: true },
  { id: "n5", kind: "noul", text: "The function returns null when the list is empty, otherwise the first element.", question: "Can the function return null?", truth: true },
  { id: "n6", kind: "noul", text: "Prisen er 499 kr. om måneden inkl. moms.", question: "Er prisen over 500 kr. om måneden?", truth: false },
  { id: "n7", kind: "noul", text: "Kunden skriver: 'Det virker nu, tak for hjælpen!'", question: "Er kundens problem løst?", truth: true },
  { id: "n8", kind: "noul", text: "PR #412 adds a migration that drops the column legacy_id.", question: "Is this migration purely additive?", truth: false },
  // yes/no — needs a step of reasoning
  { id: "n9", kind: "noul", text: "Leveringen tager 5 hverdage. Ordren blev lagt fredag.", question: "Kan pakken være fremme om mandagen 3 dage senere?", truth: false },
  { id: "n10", kind: "noul", text: "All endpoints require a bearer token except /health.", question: "Can /health be called without a token?", truth: true },
  { id: "n11", kind: "noul", text: "Vi tilbyder 14 dages fuld returret på alle varer, undtagen undertøj.", question: "Kan man returnere en jakke efter 10 dage?", truth: true },
  { id: "n12", kind: "noul", text: "The cache TTL is 300 seconds and the data changed 4 minutes ago.", question: "Could a reader still see the old data?", truth: true },
  // choice — category
  { id: "c1", kind: "choice", text: "Min app crasher hver gang jeg trykker på 'Gem'.", question: "Hvilken type henvendelse er det?", options: ["fejl", "faktura", "ønske", "ros"], truth: "fejl" },
  { id: "c2", kind: "choice", text: "Kan I lave så man kan eksportere til Excel?", question: "Hvilken type henvendelse er det?", options: ["fejl", "faktura", "ønske", "ros"], truth: "ønske" },
  { id: "c3", kind: "choice", text: "Jeg er blevet trukket to gange for samme måned.", question: "Hvilken type henvendelse er det?", options: ["fejl", "faktura", "ønske", "ros"], truth: "faktura" },
  { id: "c4", kind: "choice", text: "Tusind tak, det nye design er virkelig lækkert!", question: "Hvilken type henvendelse er det?", options: ["fejl", "faktura", "ønske", "ros"], truth: "ros" },
  { id: "c5", kind: "choice", text: "The service answers 503 for every request since 09:00.", question: "How urgent is this?", options: ["low", "medium", "critical"], truth: "critical" },
  { id: "c6", kind: "choice", text: "A typo in the footer: 'Copyrigth'.", question: "How urgent is this?", options: ["low", "medium", "critical"], truth: "low" },
  { id: "c7", kind: "choice", text: "Det var en fin dag, men regnen ødelagde turen lidt.", question: "Hvad er stemningen?", options: ["positiv", "neutral", "negativ", "blandet"], truth: "blandet" },
  { id: "c8", kind: "choice", text: "Ordren er afsendt med GLS og forventes leveret i morgen.", question: "Hvad er stemningen?", options: ["positiv", "neutral", "negativ", "blandet"], truth: "neutral" },
  { id: "c9", kind: "choice", text: "SELECT * FROM users WHERE id = '" + "' OR '1'='1", question: "What is this input?", options: ["normal search", "SQL injection attempt", "typo"], truth: "SQL injection attempt" },
  { id: "c10", kind: "choice", text: "Jeg vil gerne opsige mit abonnement pr. 1. december.", question: "Hvad ønsker kunden?", options: ["opsige", "opgradere", "nedgradere", "pause"], truth: "opsige" },
];

type Row = { engine: string; id: string; correct: boolean; pTruth: number; ms: number; inTok: number; usd: number; region: string; error?: string };

const ai = createAI();

async function judge(engine: "typesafe" | "microsoft-decision", it: Item): Promise<Row> {
  const override =
    engine === "typesafe"
      ? { provider: "typesafe", model: "jev-1.13.0", transport: "http" as const }
      : { provider: "microsoft-decision", model: "microsoft-decision-1-v1", transport: "http" as const };
  const t0 = Date.now();
  try {
    const q =
      it.kind === "noul"
        ? { type: "noul" as const, instructions: it.question }
        : { type: "choice" as const, instructions: it.question, criteria: Object.fromEntries(it.options.map((o) => [o, o])) };
    const r = await ai.judge({ state: it.text, questions: { q }, override, purpose: "F081.4-compare" });
    const a = r.answers.q!;
    let correct: boolean, pTruth: number;
    if (a.type === "noul") {
      pTruth = it.kind === "noul" && it.truth ? a.noul : 1 - a.noul;
      correct = (a.noul >= 0.5) === (it as { truth: boolean }).truth;
    } else if (a.type === "choice") {
      pTruth = a.probabilities[(it as { truth: string }).truth] ?? 0;
      correct = a.choice === (it as { truth: string }).truth;
    } else throw new Error("unexpected answer type");
    return { engine, id: it.id, correct, pTruth, ms: Date.now() - t0, inTok: r.usage.inputTokens, usd: r.usage.costUsd, region: r.usage.region ?? "?" };
  } catch (e) {
    return { engine, id: it.id, correct: false, pTruth: 0, ms: Date.now() - t0, inTok: 0, usd: 0, region: "?", error: String(e).slice(0, 200) };
  }
}

async function classify(it: Item): Promise<Row> {
  const t0 = Date.now();
  try {
    const labels = it.kind === "noul" ? ["ja", "nej"] : it.options;
    const r = await ai.contracts.classify({ text: `${it.text}\n\nSpørgsmål: ${it.question}`, labels, tier: "cheap", purpose: "F081.4-compare" });
    const truth = it.kind === "noul" ? (it.truth ? "ja" : "nej") : it.truth;
    const correct = r.label === truth;
    const u = r.usage;
    return { engine: "mistral-small (classify)", id: it.id, correct, pTruth: correct ? 1 : 0, ms: Date.now() - t0, inTok: u.inputTokens, usd: u.costUsd, region: u.region ?? "?" };
  } catch (e) {
    return { engine: "mistral-small (classify)", id: it.id, correct: false, pTruth: 0, ms: Date.now() - t0, inTok: 0, usd: 0, region: "?", error: String(e).slice(0, 200) };
  }
}

const rows: Row[] = [];
for (const it of ITEMS) {
  rows.push(...(await Promise.all([judge("typesafe", it), judge("microsoft-decision", it), classify(it)])));
}

const engines = [...new Set(rows.map((r) => r.engine))];
const lines: string[] = [`# F081.4 — Jev vs Decision-1 (+ Mistral Small) — ${new Date().toISOString().slice(0, 10)}`, ""];
lines.push(`${ITEMS.length} spørgsmål med kendt facit (${ITEMS.filter((i) => i.kind === "noul").length} ja/nej, ${ITEMS.filter((i) => i.kind === "choice").length} valg). Syntetisk materiale.`, "");
lines.push("| Motor | Rigtige | Snit-sandsynlighed på facit | Brier (ja/nej, lavere = bedre) | Snit-tid | Input-tokens i alt | Pris i alt | Region | Fejl |", "|---|---|---|---|---|---|---|---|---|");
for (const e of engines) {
  const rs = rows.filter((r) => r.engine === e);
  const ok = rs.filter((r) => !r.error);
  const noul = ok.filter((r) => r.id.startsWith("n"));
  const brier = e.startsWith("mistral") ? "—" : (noul.reduce((n, r) => n + (1 - r.pTruth) ** 2, 0) / Math.max(1, noul.length)).toFixed(3);
  const avgP = e.startsWith("mistral") ? "— (ingen sandsynlighed)" : (ok.reduce((n, r) => n + r.pTruth, 0) / Math.max(1, ok.length)).toFixed(2);
  lines.push(
    `| ${e} | ${rs.filter((r) => r.correct).length}/${rs.length} | ${avgP} | ${brier} | ${Math.round(ok.reduce((n, r) => n + r.ms, 0) / Math.max(1, ok.length))} ms | ${ok.reduce((n, r) => n + r.inTok, 0)} | $${ok.reduce((n, r) => n + r.usd, 0).toFixed(6)} | ${[...new Set(ok.map((r) => r.region))].join(",")} | ${rs.filter((r) => r.error).length} |`,
  );
}
lines.push("", "## Pr. spørgsmål", "", `| id | ${engines.join(" | ")} |`, `|---|${engines.map(() => "---").join("|")}|`);
for (const it of ITEMS) {
  lines.push(`| ${it.id} | ${engines.map((e) => { const r = rows.find((x) => x.engine === e && x.id === it.id)!; return r.error ? "FEJL" : `${r.correct ? "✓" : "✗"} ${e.startsWith("mistral") ? "" : r.pTruth.toFixed(2)}`; }).join(" | ")} |`);
}
const errs = rows.filter((r) => r.error);
if (errs.length) lines.push("", "## Fejl", "", ...errs.map((r) => `- ${r.engine} ${r.id}: ${r.error}`));
const md = lines.join("\n");
const outIdx = process.argv.indexOf("--out");
if (outIdx > 0) writeFileSync(process.argv[outIdx + 1]!, md);
console.log(md);
