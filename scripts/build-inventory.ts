// F017 — generate inventory.json from the live OpenRouter catalogue + curated
// overlay. Run manually (`bun run scripts/build-inventory.ts`) or by the monthly
// workflow (F017.5). The Model Advisor reads the committed inventory.json.
import { writeFileSync } from "node:fs";
import { fetchOpenRouterInventory, buildInventory } from "../src/catalogue/inventory.js";

const models = await fetchOpenRouterInventory();
const inventory = buildInventory(models, new Date().toISOString());

writeFileSync("inventory.json", JSON.stringify(inventory, null, 2) + "\n");

const gdpr = inventory.models.filter((m) => m.gdprSafe).length;
const vision = inventory.models.filter((m) => m.goodFor.includes("vision")).length;
console.log(
  `inventory.json: ${inventory.modelCount} models (${gdpr} GDPR-safe, ${vision} vision) @ ${inventory.generatedAt}`,
);
