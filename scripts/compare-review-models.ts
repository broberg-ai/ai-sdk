// Head-to-head: buddy's REVIEW prompt (Haiku-screen/Sonnet-confirm today) run
// 1:1 against Sonnet vs DeepSeek V4-Pro vs V4-Flash, all via OpenRouter through
// the SDK. Measures cost + output so we can compare quality (esp. false-positive
// rate on a JSON-flag task) head-to-head. Needs OPENROUTER_API_KEY.
import { readFileSync } from "node:fs";
import { createAI, parseJsonLoose } from "../src/index.js";

// 1) Reconstruct buddy's exact buildPrompt() output from source + the real sample,
//    so the prompt is byte-identical to what buddy actually feeds the model.
const cli = readFileSync(
  "/Users/cb/Apps/webhouse/buddy/packages/transport/src/cli.ts",
  "utf8",
);
const header = cli
  .slice(
    cli.indexOf("You are buddy, an adversarial code reviewer"),
    cli.indexOf("RULES:\n${rulesBlock}"),
  )
  // profile/contract/errorPatterns slots are empty for this turn (sample has none)
  .replace("${profileSection}${contractSection}${errorPatternsSection}", "");

const sample = readFileSync("/tmp/buddy-brain-sample.txt", "utf8");
const prompt = header + sample.slice(sample.indexOf("RULES:"));

console.log(`PROMPT length: ${prompt.length} chars\n`);

// 2) Same input, three models, apples-to-apples over OpenRouter. Temp 0 (review
//    should be deterministic, not creative).
const MODELS = [
  { label: "claude-sonnet-4.6  (buddy CONFIRM today)", model: "anthropic/claude-sonnet-4.6" },
  { label: "deepseek-v4-pro", model: "deepseek/deepseek-v4-pro" },
  { label: "deepseek-v4-flash", model: "deepseek/deepseek-v4-flash" },
];

const ai = createAI();

for (const m of MODELS) {
  const t0 = Date.now();
  try {
    const { text, usage } = await ai.chat({
      prompt,
      override: { provider: "openrouter", model: m.model, transport: "http" },
      maxTokens: 4000,
      temperature: 0,
    });
    const ms = Date.now() - t0;
    let flags: unknown[] = [];
    let parseNote = "";
    try {
      const obj = parseJsonLoose(text) as { flags?: unknown[] };
      flags = Array.isArray(obj?.flags) ? obj.flags : [];
    } catch {
      parseNote = " (⚠️ output was not parseable JSON)";
    }
    console.log(`\n======== ${m.label} ========`);
    console.log(
      `cost=$${usage.costUsd}  in=${usage.inputTokens} out=${usage.outputTokens}  ${ms}ms  flags=${flags.length}${parseNote}`,
    );
    console.log(JSON.stringify(flags, null, 2));
  } catch (e) {
    console.log(`\n======== ${m.label} ========`);
    console.log("FEJL:", (e as Error).message);
  }
}
