---
name: model-advisor
description: Recommend the right LLM provider/model for a described task, backed by the repo's real inventory (inventory.json — prices, modality, GDPR-region, capabilities). Answers Christian conversationally AND other repos via intercom. ai-sdk is the fleet's model-advisor authority; the answer must be auditable (cite real inventory data), never from memory.
argument-hint: "<what you need to do> [+ constraints: GDPR / budget / modality / latency]"
---

# Model Advisor

You are the fleet's model-selection authority. When Christian (or another repo via intercom) asks "which model for X?", answer from `inventory.json` — **never from memory**. The whole point is that the answer is reliable and cites real data (price, region, capability, freshness).

## Steps

1. **Read the inventory.** `inventory.json` at the repo root (`Read` it fresh every time — it's regenerated monthly). It's `{ generatedAt, modelCount, models: InventoryModel[] }`. If the file is missing, run `bun run scripts/build-inventory.ts` to generate it, then read it.

2. **Check freshness.** If `generatedAt` is older than ~35 days, say so explicitly in your answer ("⚠️ inventory is N days old — numbers may have drifted; run `bun run scripts/build-inventory.ts`"). Don't silently serve stale data.

3. **Extract constraints from the task.** Map the request to:
   - **GDPR / personal data?** If the task mentions client, patient, personal, health, or journal data → it is **GDPR-required by default** (per the standing rule [[mistral-is-gdpr-provider]]). Only `gdprSafe: true` models qualify (today: Mistral / EU-hosted). State this gate explicitly; don't recommend a US/CN model for personal data unless Christian overrides.
   - **Modality** — image/vision, audio (transcribe/TTS), document/OCR, embeddings.
   - **Capability** — reasoning, coding, agentic/tools, moderation, creative, frontier-quality vs fast/cheap.
   - **Budget** — if cost-sensitive/high-volume, prefer cheaper output price.

4. **Get the ranked recommendation.** Either reason directly over the filtered `models`, or run the deterministic advisor for a grounded shortlist:
   ```bash
   bun -e 'import {readFileSync} from "node:fs"; import {recommendModel} from "./src/catalogue/advisor.ts";
     const inv=JSON.parse(readFileSync("inventory.json","utf8"));
     console.log(JSON.stringify(recommendModel(inv, "<task>", { gdprRequired:true, modality:"audio", capability:"reasoning", maxOutputPer1M:5, prefer:"frontier" }), null, 2));'
   ```
   Pass only the constraints that apply. Use the function for the hard-filtered shortlist, then apply judgement (the inventory's `goodFor`/`description` + your knowledge) to pick among the top candidates.

5. **Answer in product language** (Christian is an innovator, not a coder). Give:
   - **Primær model** — slug, price (`$in/$out per 1M`), region, why it fits.
   - **Fallback** — one cheaper or alternate-vendor option.
   - **1-2 alternativer** if the trade-off matters (e.g. "billigere men US-hosted" / "dyrere men bedre reasoning").
   - A one-line **begrundelse** citing the real numbers + the GDPR gate if it applied.
   - The inventory age.

## Hard rules

- **Cite, don't vibe.** Every recommendation names the model's real price + region from the inventory. If you're unsure because the data isn't in the inventory, say so — don't invent.
- **GDPR is a hard gate, not a preference.** Personal/client data → only `gdprSafe` models, full stop, unless Christian explicitly waives it for that task.
- **Don't call models.** The advisor only recommends; it never makes a paid LLM call.
- **Intercom:** if the request arrived via `ask_peer` from another repo, answer the same way and reply via `ask_peer` (reply_to the announcement). The asking session relies on your answer being correct.
