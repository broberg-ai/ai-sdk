// Live smoke: DeepSeek V4-Pro via OpenRouter through the SDK facade.
// Proves provider+model are reachable and cost is non-zero. Needs OPENROUTER_API_KEY.
import { createAI } from "../src/index.js";

const ai = createAI();

for (const model of ["deepseek/deepseek-v4-pro", "deepseek/deepseek-v4-flash"]) {
  try {
    const { text, usage } = await ai.chat({
      prompt: "Svar kort på dansk: hvad er hovedstaden i Danmark? Ét ord.",
      override: { provider: "openrouter", model, transport: "http" },
      maxTokens: 50,
    });
    console.log(`\n=== ${model} ===`);
    console.log("TEXT:", text.trim());
    console.log(
      `USAGE: in=${usage.inputTokens} out=${usage.outputTokens} cost=$${usage.costUsd} (${usage.provider}:${usage.model})`,
    );
  } catch (e) {
    console.log(`\n=== ${model} === FEJL:`, (e as Error).message);
  }
}
