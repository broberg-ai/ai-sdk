// Live OpenRouter smoke for F10.1 (ground-truth cost) + F9.1 (json mode).
// Manual — run with OPENROUTER_API_KEY set.
import { createAI } from "../dist/index.js";

const ai = createAI();

// F10.1 — the exact model trail flagged as cost=0 (no pricing-table entry).
console.log("── F10.1: ground-truth cost (anthropic/claude-haiku-4.5 via openrouter) ──");
const r1 = await ai.chat({
  prompt: "Reply with one word: ok",
  override: { provider: "openrouter", model: "anthropic/claude-haiku-4.5", transport: "http" },
});
console.log(`text=${JSON.stringify(r1.text.trim())} costUsd=${r1.usage.costUsd} in=${r1.usage.inputTokens} out=${r1.usage.outputTokens}`);
console.log(`COST_OK=${r1.usage.costUsd > 0}`);

// F9.1 — JSON mode returns parseable JSON.
console.log("\n── F9.1: json mode ──");
const r2 = await ai.chat({
  prompt: 'Return a JSON object with keys "city" and "country" for Aalborg.',
  responseFormat: "json",
  override: { provider: "openrouter", model: "google/gemini-2.5-flash", transport: "http" },
});
let parsed = null;
try { parsed = JSON.parse(r2.text); } catch {}
console.log(`raw=${r2.text}`);
console.log(`JSON_OK=${parsed !== null && typeof parsed === "object"} costUsd=${r2.usage.costUsd}`);
