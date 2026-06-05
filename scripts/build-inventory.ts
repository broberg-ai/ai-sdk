// F017 — generate inventory.json from the live OpenRouter catalogue + curated
// overlay. Run manually (`bun run scripts/build-inventory.ts`) or by the monthly
// workflow (F017.5). The Model Advisor reads the committed inventory.json.
//   --enrich [N]   F017.6: use a cheap model (mistral-small) THROUGH the SDK to
//                  write real goodFor tags + a one-line summary for up to N models
//                  that the curated overlay left untagged. Needs MISTRAL_API_KEY.
import { writeFileSync } from "node:fs";
import { fetchOpenRouterInventory, buildInventory } from "../src/catalogue/inventory.js";
import { createAI } from "../src/client.js";

const models = await fetchOpenRouterInventory();
const inventory = buildInventory(models, new Date().toISOString());

// F017.6 — cheap-model enrichment pass (cost-bounded; only untagged models).
const enrichArg = process.argv.indexOf("--enrich");
if (enrichArg !== -1) {
  const limit = Number(process.argv[enrichArg + 1]) || 15;
  const ai = createAI();
  const targets = inventory.models.filter((m) => m.goodFor.length === 0).slice(0, limit);
  console.log(`enriching ${targets.length} untagged models via mistral-small…`);
  for (const m of targets) {
    try {
      const { text } = await ai.chat({
        prompt: `Model "${m.model}". Description: ${(m.description ?? "").slice(0, 400)}. Reply ONLY JSON {"goodFor":["tag",...],"summary":"one short line"} where tags ⊆ [reasoning,coding,vision,audio,ocr,tts,transcription,moderation,embedding,agentic,multilingual,creative,edge,fast,frontier].`,
        override: { provider: "mistral", model: "mistral-small-latest", transport: "http" },
        responseFormat: "json",
        maxTokens: 200,
      });
      const parsed = JSON.parse(text) as { goodFor?: string[]; summary?: string };
      if (Array.isArray(parsed.goodFor)) m.goodFor = parsed.goodFor;
      if (parsed.summary) (m as { summary?: string }).summary = parsed.summary;
    } catch {
      /* skip a model the cheap pass can't enrich; never fail the build */
    }
  }
}

writeFileSync("inventory.json", JSON.stringify(inventory, null, 2) + "\n");

const gdpr = inventory.models.filter((m) => m.gdprSafe).length;
const vision = inventory.models.filter((m) => m.goodFor.includes("vision")).length;
console.log(
  `inventory.json: ${inventory.modelCount} models (${gdpr} GDPR-safe, ${vision} vision) @ ${inventory.generatedAt}`,
);
