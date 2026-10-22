# F080 — Autoritativt svar på «billigste model fra udbyder X»

**Ordre:** Christian 22/10 2026: «Du skal kunne svare autoritativt på billigste model fra provider X».

## Hvorfor det ikke kan i dag (målt 22/10 2026)

`listModelPrices()` (512 rækker) sorteret på pris pr. leverandør:

| spørgsmål | svar i dag | hvorfor forkert |
|---|---|---|
| billigste fra mistral | `mistral-moderation-latest` | moderation, ikke chat — og udgået upstream (model-research 17/10) |
| billigste fra openai | `openai/gpt-oss-20b` | kun via OpenRouter; vi kalder OpenAI direkte |
| billigste fra anthropic | `anthropic/claude-haiku-5.5:batch` | batch-pris (forsinket kørsel) blandet med almindelig |
| billigste fra deepseek | `deepseek/deepseek-v4.1-flash` | korrekt *via OpenRouter*, men rækken siger ikke at den er CN |

Hullerne: ingen **type** pr. række (chat/embedding/moderation/ocr/…), ingen **adgangsvej** (direkte vs. OpenRouter), **batch** ikke adskilt, **udgåede** modeller ikke markeret, og ingen fast definition af «billigst».

## Hvad «autoritativt» betyder her

Et svar er autoritativt når det:
1. svarer på det præcise spørgsmål (udbyder + type + adgangsvej), ikke et bredere;
2. kun indeholder modeller vi faktisk **kan kalde** og som **findes** upstream ved seneste måling;
3. siger **hvorfra prisen kommer** (curated tabel / OpenRouter-katalog / udbyderens egen side) og **hvornår** den er målt;
4. bruger en **fast prismåling**: standard = blandet pris med 3:1 input:output (samme vægt som OpenRouter/Artificial Analysis bruger), plus input og output hver for sig, så kalderen kan vælge;
5. siger det højt når data er forældet (>35 dage, samme grænse som pricingFreshness).

## Scope

- **F080.1** — hver prisrække får `kind` (chat, embedding, moderation, ocr, transcribe, tts, image, video, judge), `route` (`direct` | `openrouter`), `batch: boolean`, og `upstream: 'listed' | 'gone' | 'unknown'` (fra catalogue-seen / model-research).
- **F080.2** — `cheapestModels({ vendor, kind = 'chat', route?, region?, includeBatch = false, limit = 3 })` → rangeret liste med pris (blended + in/out), kilde, måledato, region, og en `caveats[]` (fx «pris kun fra OpenRouter-katalog», «ikke live-verificeret»).
- **F080.3** — model-advisor-skillen svarer på «billigste fra X» via F080.2 (aldrig fra hukommelsen), i et fast format: model, pris, adgangsvej, region, kilde+dato, forbehold.

**Non-goals:** kvalitetsvurdering (billigst ≠ god nok — det er advisorens `prefer`); medie-priser pr. sekund/billede i første runde (kun hvis F080.1 alligevel giver dem `kind`).

## Reuse

Bygger på eksisterende `src/catalogue/pricing-api.ts`, `inventory.json`, `catalogue-seen.json` og `src/catalogue/advisor.ts` i `@broberg/ai-sdk` — ingen ny pakke. Discovery: ai-sdk er flådens model-valg-autoritet (F017).

## Rollout

Minor-release (ny eksport). Discovery får en dateret note. Model-advisor-skillen opdateres i samme release.

## Live-tjek mod udbydernes egne prissider (F080.3, 22/10 2026)

| udbyder | `cheapestModels` direkte | udbyderens egen side | dom |
|---|---|---|---|
| Mistral | `ministral-3b-2512` $0.10/$0.10 | Ministral 3 3B $0.1/$0.1 (docs.mistral.ai/inference/pricing) | ✓ |
| Anthropic | `claude-haiku-5-5` $0.10/$0.50 | Haiku 5.5 $0.10/$0.50 (≤100K-token prompts; $0.50/$2.50 over) | ✓ — >100K-satsen er ikke i tabellen |
| OpenAI | `gpt-6-luna` $0.10/$0.50 | gpt-5-nano $0.05/$0.40 og gpt-4.1-nano $0.10/$0.40 er billigere | **afvigelse**: de to står ikke i vores pristabel og kan ikke bogføres → udelukket med vilje. Svaret bærer nu forbeholdet «direct route covers only models in our curated price table …». gpt-5-nano vises under «billigst i alt» via OpenRouter. |

Øvrige fund:
- **Mistral Nemo** (billigst i alt, via OpenRouter) er udgået hos Mistral selv (retirement 31/7/2026, docs.mistral.ai models overview) — OpenRouter serverer den stadig fra andre værter. OpenRouter-rækker bærer nu forbeholdet om at regionen ikke er garanteret.
- Opfølgning (ikke i dette kort): prissætte `gpt-5-nano` og `gpt-4.1-nano` i pristabellen, hvis nogen vil kalde dem direkte.
