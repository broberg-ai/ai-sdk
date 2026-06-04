// Live Video Vision smoke (F019). Not part of the test suite — run manually with
// OPENROUTER_API_KEY (and a video path) set. Verified 2026-06-04 against gemma-4 +
// nvidia-nemotron on a 2MB clip. Gemini-direct works the same once that key has credit.
//   VIDEO=/tmp/img8419_small.mp4 node scripts/smoke-video.mjs
import { readFileSync } from "node:fs";
import { createAI } from "../dist/index.js";

const path = process.env.VIDEO ?? "/tmp/img8419_small.mp4";
const ai = createAI();
const bytes = new Uint8Array(readFileSync(path));
console.log(`clip: ${path} (${bytes.length} bytes)`);

const models = [
  { provider: "openrouter", model: "nvidia/nemotron-nano-12b-v2-vl:free", transport: "http" },
  { provider: "openrouter", model: "google/gemma-4-26b-a4b-it", transport: "http" },
  // { provider: "gemini", model: "gemini-2.5-flash-lite", transport: "http" }, // needs GEMINI credit
];

for (const override of models) {
  try {
    const { text, usage } = await ai.video({
      video: bytes,
      mimeType: "video/mp4",
      prompt: "Describe what happens in this video in 2 sentences.",
      override,
    });
    console.log(`\n=== ${override.model} ===\n${text}\n[cost $${usage.costUsd} | in ${usage.inputTokens} out ${usage.outputTokens}]`);
  } catch (e) {
    console.log(`\n=== ${override.model} === ERR: ${String(e.message).slice(0, 200)}`);
  }
}
