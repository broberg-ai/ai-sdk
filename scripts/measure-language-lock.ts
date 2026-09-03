#!/usr/bin/env bun
// F046.3 — does an explicit language instruction actually hold?
//
// Built for vn-leker, who needed to know whether a customer assistant writing to Danish,
// Norwegian and Swedish customers could be steered by one line in the system prompt, or
// whether the answer's language had to be verified programmatically before it reached a
// customer. Those are two very different pieces of work, and it is not guessable.
//
// MEASURED 2026-09-03 on mistral-large-latest, 5 questions × 3 runs per cell:
//   without the lock  5/15 wrong   ← the positive control
//   with the lock     0/15 wrong
// So: one line. But see the warning below about what it does NOT fix.
//
// USAGE
//   bun run scripts/measure-language-lock.ts <cases.json> [runs]
//
// cases.json:
//   { "model": "mistral-large-latest",
//     "system": "…your real system prompt…",
//     "lockTemplate": "Svar UDELUKKENDE på {lang}. HELE svaret skal være på {lang}. Brug aldrig dansk.",
//     "langNames": { "no": "norsk bokmål", "sv": "svenska" },
//     "cases": [{ "lang": "no", "topic": "levering", "prompt": "Kor lang leveringstid…" }] }
//
// WHY IT RUNS THE UNLOCKED CONDITION TOO, and refuses to report without it:
// a run that only tests the lock and sees 0 failures has proved nothing — it cannot
// tell "the lock works" from "this setup could never have found a failure". vn-leker
// insisted on this control before accepting the result, and they were right: it is what
// turns 0/15 from a number into evidence.
import { readFileSync } from "node:fs";
import { createAI } from "../src/index.js";
import { detectNordic } from "../src/lang-detect.js";

interface Case { lang: string; topic: string; prompt: string }
interface Spec {
  model: string;
  system: string;
  lockTemplate: string;
  langNames: Record<string, string>;
  cases: Case[];
}

const file = process.argv[2];
const RUNS = Number(process.argv[3] ?? 3);
if (!file) {
  console.error("usage: bun run scripts/measure-language-lock.ts <cases.json> [runs]");
  process.exit(2);
}
const spec = JSON.parse(readFileSync(file, "utf8")) as Spec;
const ai = createAI();

async function run(locked: boolean): Promise<{ failures: number; total: number }> {
  console.log(`\n${"=".repeat(76)}`);
  console.log(locked ? "MED sproglås" : "UDEN sproglås  (den positive kontrol)");
  console.log("=".repeat(76));
  let failures = 0;
  let total = 0;
  for (const c of spec.cases) {
    const name = spec.langNames[c.lang] ?? c.lang;
    const system = locked ? spec.lockTemplate.replaceAll("{lang}", name) : spec.system;
    const got: string[] = [];
    let shown = "";
    for (let r = 0; r < RUNS; r++) {
      const { text } = await ai.chat({
        system, prompt: c.prompt,
        override: { provider: "mistral", model: spec.model },
        maxTokens: 200,
      });
      const d = detectNordic(text);
      got.push(d);
      // Prefer showing a FAILING answer — that is the one a reader needs to check.
      if (d !== c.lang && !shown) shown = text.trim().replace(/\s+/g, " ");
      if (!shown && r === RUNS - 1) shown = text.trim().replace(/\s+/g, " ");
    }
    const bad = got.filter((g) => g !== c.lang).length;
    failures += bad;
    total += RUNS;
    console.log(`\n[${c.lang}/${c.topic}] ${bad}/${RUNS} forkert → ${got.join(", ")}`);
    console.log(`   ${shown.slice(0, 200)}`);
  }
  return { failures, total };
}

const before = await run(false);
const after = await run(true);

console.log(`\n${"─".repeat(76)}`);
console.log(`uden lås: ${before.failures}/${before.total} forkert · med lås: ${after.failures}/${after.total} forkert`);
console.log(
  "\nKLASSIFIKATIONEN ER EN HEURISTIK, ikke en dom — dansk og norsk bokmål deler for\n" +
  "meget til at markørord kan skille dem sikkert på 40 ord. Svarene står ovenfor\n" +
  "ordret; læs dem, og overrul hvor detektoren tager fejl.",
);
console.log(
  "\nDER MÅLES SPROG, IKKE FAKTUEL KORREKTHED. Målt 2026-09-03: et korrekt LÅST norsk\n" +
  "svar opfandt stadig «2-3 virkedager». Låsen løser sproget og intet andet — opdigtede\n" +
  "tal forsvinder kun ved at hente dem fra et rigtigt system.",
);

if (before.failures === 0) {
  // The whole report is void without this. Refusing loudly beats printing a 0 that a
  // reader will take as proof.
  console.error(
    `\n::error:: MÅLINGEN ER UGYLDIG: kørslen UDEN lås fandt 0 fejl, så opstillingen har\n` +
    `ikke vist at den KAN finde en. Et resultat på ${after.failures}/${after.total} med lås\n` +
    `beviser derfor ingenting. Vælg spørgsmål der fejler uden lås, eller hæv runs.`,
  );
  process.exit(1);
}
console.log(
  `\nPositiv kontrol OK: ${before.failures} fejl uden lås, så opstillingen kan finde dem.`,
);
if (after.failures === 0) {
  console.log(
    `Låsen holdt på ${after.total} svar. Stærkt nok til at bygge på — for tyndt til at\n` +
    "skrive under på i en kontrakt. Mål igen mod dine EGNE spørgsmål før du lover det.",
  );
}
