# F097 — Alle OpenRouter-kald via EU

> Ejeren 26/11 2026: «Så er der upgraded til EU så brug https://eu.openrouter.ai/api/v1 fra nu af på alle OpenRouter kald». Efter målingen af hvad der ikke findes i EU: «Bevidst undtagelse for Recraft».

## Målt 26/11 (OpenRouter-kontoen opgraderet til Business samme dag)

- `eu.openrouter.ai` svarer; 73 modeller. DeepSeek-kald gik igennem (udbyder Inceptron, EU).
- I EU: Claude Haiku/Sonnet/Opus 5.5, Fable 5, GPT 5.x/6.x (inkl. `openai/gpt-6.1-sol`), Gemini 4, Mistral, DeepSeek `deepseek-v4-flash-0731`, Kimi K2.6/K2.7-code, GLM 5.2/5.3.
- IKKE i EU («No endpoints found supporting your data region»): Recraft-billeder, embeddings, `deepseek-v4.1-flash-1017`, `deepseek-v4-pro`, `minimax-m2.7`, `gpt-6-astra`, `gemini-2.5-flash`.

## Ændring

- `DEFAULT_BASE_URLS.openrouter` = `https://eu.openrouter.ai/api/v1` — al chat/vision/stream/billeder går dertil, medmindre forbrugeren selv sætter `baseUrl`.
- **Bevidst undtagelse:** `recraft/*`-billeder sendes til den globale `https://openrouter.ai/api/v1` (Recraft findes ikke i EU). Kun Recraft — en anden model der mangler i EU fejler synligt, ingen stille omvej til USA.
- `regionOfHost("eu.openrouter.ai")` = `"eu"` (OpenRouters løfte: EU-endpoints, ingen fallback udenfor). Den globale vært forbliver `"unknown"`.
- `deepseek-flash-latest` → `deepseek/deepseek-v4-flash-0731` (EU); `secondOpinion`s DeepSeek-plads → samme. Prisrække fra OpenRouter-kataloget (0.0434/0.3, inventory 2026-11-14) — kaldet bogfører alligevel OpenRouters rapporterede pris.

## Forbehold

OpenRouter er et amerikansk firma og aftalepart; EU-behandlingen er deres løfte (DPA med SCC), ikke noget vi selv kan efterprøve. `usage.region` siger `eu` ud fra værten, som for Vertex/Azure/BFL.

## Non-goals

OpenCode/oc's egne OpenRouter-kald (minimax) går ikke gennem ai-sdk — meldes til cardmem/buddy. Ingen ændring af tier-defaults.

## Reuse

Genbruger OpenRouter-adapterens `baseUrl` og `regionOfHost`; ingen ny afhængighed.

## Rollout

F097.1 kode + tests + live-kald → release → cardmem/components får delta.
