#!/usr/bin/env bun
// F088 — five frontier models review a file; writes a markdown report.
//
//   bun run scripts/second-opinion.ts <file.md> [--focus "security and cost"] [--title T] [--out report.md] [--synth]
//
// Four of the five panel models are US/CN-hosted: run it ONLY on material without
// personal, customer or health data. Keys come from .env (ANTHROPIC, OPENAI, GEMINI,
// MISTRAL, OPENROUTER). Prints the report path and the total cost.
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { createAI } from "../src/index.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

const file = process.argv[2];
if (!file || file.startsWith("--")) {
  console.error('usage: bun run scripts/second-opinion.ts <file> [--focus "…"] [--title T] [--out report.md] [--synth]');
  process.exit(2);
}

const content = readFileSync(file, "utf8");
const title = arg("title") ?? basename(file);
const out = arg("out") ?? file.replace(/(\.[^./]+)?$/, ".second-opinion.md");

const started = Date.now();
const r = await createAI().secondOpinion({
  content,
  title,
  focus: arg("focus"),
  synthesize: process.argv.includes("--synth"),
  confirmNoPersonalData: true,
});

writeFileSync(out, r.markdown);
const failed = r.opinions.filter((o) => o.error);
console.log(`report: ${out}`);
console.log(`cost:   $${r.totalCostUsd.toFixed(4)}  time: ${Math.round((Date.now() - started) / 1000)}s`);
for (const o of r.opinions) console.log(`  ${o.error ? "FAIL" : "ok  "} ${o.label}${o.error ? ` — ${o.error.slice(0, 160)}` : ""}`);
if (r.synthesis?.error) console.log(`  FAIL synthesis — ${r.synthesis.error.slice(0, 160)}`);
process.exit(failed.length === r.opinions.length ? 1 : 0);
