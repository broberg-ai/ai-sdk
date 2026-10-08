# F076 — Det faste job henter udbydernes egne priser

**Bestilt af:** Christian 8/10 2026: «Prisliste opdatering skal fixes der hvor de faste jobs kører så vi altid er up-to-date med seneste priser.» · **Ejer:** ai-sdk

## Hvorfor — målt 8/10

- Ingen i flåden henter priser direkte fra Anthropic eller Mistral (components' undersøgelse #2176). Det månedlige job (buddy 24cb5bbf på M1, `/model-research`) og upmetrics' natlige `checkPriceDrift()` sammenligner kun med OpenRouter, og kun rækker vi allerede har.
- Derfor stod 10 Claude-modeller uden pris (F075), og Mistral Large 4 manglede (F074).
- **Og Mistral Small 4 (`mistral-small-2603` = `mistral-small-latest` = tierne `fast`/`cheap`) står til $0.10/$0.30, mens Mistral selv og OpenRouter begge siger $0.15/$0.60.** Flådens største volumen-tier er bogført til cirka halvdelen.

## Kilder (maskinlæsbare, målt 8/10)

- **Anthropic:** `https://platform.claude.com/docs/en/about-claude/pricing.md` — ren markdown-tabel (model · input · 5m write · 1h write · cache hit · output). Haiku 5.5 har to rækker (≤/> 100k).
- **Mistral:** `https://docs.mistral.ai/models` lister sider pr. model (`/models/mistral-large-3-25-12` …). Hver side viser API-id'et (`mistral-large-2512 +1`) og pris pr. M tokens; ved udsalg står listeprisen som «Original price».
- OpenRouter bruges allerede og bliver ved.

## Løsning

- `src/catalogue/direct-prices.ts`: `fetchAnthropicPrices()` og `fetchMistralPrices()` → `{provider, model, inputPer1M, outputPer1M, cacheReadPer1M?}`. Listepris, aldrig udsalgspris.
- `/model-research` sammenligner med `PRICING` og melder øverst i rapporten: **pris ændret** (række findes, tal afviger) og **listet uden pris** (udbyderen har den, vi har ingen række).
- Jobbet retter IKKE `pricing.ts` selv (skill-reglen står): fundet bliver et kort, og en session retter + udgiver. Det gør rettelsen synlig og testet.

## Stories

- **F076.1** — Ret Mistral Small 4 til $0.15/$0.60 nu (+ cache 0.015) og udgiv.
- **F076.2** — Direkte prischeck for Anthropic + Mistral i `/model-research`.

## Reuse

Ingen ny pakke. Udvider `src/catalogue` og `scripts/research-models.ts`; jobbet er det eksisterende buddy-job 24cb5bbf. Discovery: intet prisjob findes (#2176).

## Åbent

- Takt: jobbet kører månedligt. Hyppigere (14 dage) er en ændring hos buddy på M1.
