# F091 — DeepInfra-kald bogføres med DeepInfras egen pris

> Ejerens ordre 17/11 2026 («ja byg F091»). Medium. Effort S.

## Summary
Når et kald går til DeepInfra, læser SDK'en den pris DeepInfra selv sender i svaret (`usage.estimated_cost`, USD) og bogfører den, med `costBasis: "reported"`. Ellers bogføres hvert DeepInfra-kald til $0, fordi vores prisliste ingen DeepInfra-modeller har (177 modeller ville skulle vedligeholdes i hånden).

## Motivation
Målt 17/11: nøglen `DEEPINFRA_API_KEY` virker og kontoen er fyldt op; `ai.chat({ override:{ provider:"deepinfra", model } })` svarer, men `usage.costUsd = 0`, `costBasis: "unpriced"`. Et råt kald viste `usage: { prompt_tokens, completion_tokens, estimated_cost: 3.4e-7 }`. Et kald der koster penge men bogføres som gratis er præcis den fejl omkostningssporingen findes for at fange.

Samtidig fundet: OpenRouter-stien (F010) bruger allerede udbyderens egen `usage.cost`, men lader `costBasis` stå som "unpriced" når modellen ikke er i tabellen — tallet er rigtigt, mærkatet forkert. Rettes i samme omgang, samme sted.

## Reuse
- Dette ER `@broberg/ai-sdk`; ændringen er i den fælles `openai-compatible`-kerne, som DeepInfra-adapteren allerede bruger. Ingen ny pakke.
- Discovery: ingen `@broberg/*`-pakke ejer udbyder-rapporteret pris.

## Design
None — no visual surface.

## Scope
### In scope
- Ny config i openai-compatible: `reportedCostField?: "estimated_cost"` → læses fra `usage` i både chat og stream og vinder over tabellen.
- DeepInfra-adapteren sætter den. Den sender IKKE OpenRouters `usage:{include:true}`.
- Hver gang en udbyder-rapporteret pris bruges (OpenRouter, Requesty, DeepInfra) sættes `costBasis: "reported"`.
- Live-kald via SDK'en: costUsd > 0 og = DeepInfras tal.
### Out of scope
- DeepInfra-rækker i pricing.ts (unødvendige når udbyderen rapporterer).
- DeepInfra-embeddings/billeder.
- Ændring af DeepInfras region (målt US).

## Architecture
`makeOpenAICompatibleAdapter({ name:"deepinfra", …, reportedCostField:"estimated_cost" })` → efter `freshUsage` i chat/stream: hvis `typeof data.usage?.[field] === "number"` → `usage.costUsd = v; usage.costBasis = "reported"`.

## Stories
- **F091.1** — implementering, tests, live-kald, release.

## Acceptance criteria
1. Et DeepInfra-svar med `usage.estimated_cost: 0.00012` giver `usage.costUsd === 0.00012` og `costBasis === "reported"` — både chat og stream, unit-test.
2. DeepInfra-requesten indeholder IKKE `usage:{include:true}` — unit-test.
3. OpenRouter med `usage.cost` får `costBasis === "reported"` — unit-test.
4. Live: et rigtigt DeepInfra-kald via SDK'en giver costUsd > 0 og `costBasis: "reported"`.
5. Release på npm; components informeret.

## Dependencies
None (nøgle + saldo på plads 17/11).

## Rollout
Additivt; patch/minor. Ingen ændring for andre udbydere ud over det rettede costBasis-mærkat.

## Effort estimate
**S** — ca. 1 time.
