# F096 — «LATEST»-ruter: ai-sdk ejer «hvad er nyest»

> Ejerens ordre 26/11 2026 (ordret, både direkte og via cardmem #55356): «Tænker du skal lave nogle ruter hvor man altid kan bede efter LATEST og derunder sørger du for den nyeste model så det er DIG der har researchet på hvad der er nyest og hvor vi er med model verdenen. Det skal aldrig være den enkelte fleet agents ansvar, de skal bare bruge dig og regne med at de får leveret det nyeste og bedste.»

## Problem

Flådens agenter vælger selv modelversion: hardkodede id'er, eller (cardmem) «nyeste fra listModels() pr. familie». Det er agent-logik ejeren ikke vil have, og den driver: registry-aliasserne `haiku/sonnet/opus` peger stadig på 4.x-modeller, selv om 5.5 findes.

## Løsning

En LATEST-tabel i ai-sdk (`src/routing/latest.ts`): familie-navn → én DATERET/versioneret model-id + provider + `checkedAt`. ai-sdk vedligeholder den; forbrugeren skriver kun familien.

| alias | provider | model (26/11 2026) |
|---|---|---|
| `claude-haiku-latest` | anthropic | `claude-haiku-5-5` |
| `claude-sonnet-latest` | anthropic | `claude-sonnet-5-5` |
| `claude-opus-latest` | anthropic | `claude-opus-5-5` |
| `mistral-large-latest` | mistral | `mistral-large-4-0` |
| `deepseek-flash-latest` | openrouter | `deepseek/deepseek-v4.1-flash-1017` |

Brug: `ai.chat({ prompt, override: { model: "claude-sonnet-latest" } })` — KUN model, ingen provider; ai-sdk sætter provider. Svaret viser den daterede model i `usage.model`.

- **D-385d97 holder:** aliaset er ikke en udbyders flydende `-latest`; det er ai-sdk's egen pinning til en dateret id, så et modelskift sker i en ai-sdk-release (synlig, med version), aldrig stille hos udbyderen.
- **Kollision med udbyder-id'er:** `mistral-large-latest` er OGSÅ Mistrals egen flydende id. Reglen: familie-aliaset gælder kun når override har model UDEN provider. `{provider:"mistral", model:"mistral-large-latest"}` opfører sig præcis som før (flydende, advarsel) — ingen eksisterende forbruger ændrer adfærd.
- Ukendt `*-latest` uden provider → fejl der lister de kendte familier (fail closed som en tier).
- `listLatest()` / `resolveLatest(alias)` eksporteres (også fra browser-entry `registry`) til modelvælgere.
- **Vedligehold:** model-research-skillen (hver 14. dag) får et fast trin: tjek hver familie for en nyere dateret model og opdatér tabellen + `checkedAt` i en release. Forbrugere skal ikke gøre noget.

## Non-goals

- Flytter ikke tier-defaults (`smart`/`powerful` m.fl. forbliver EU/Mistral, D-b890bf).
- Ændrer ikke de gamle registry-aliasser `haiku/sonnet/opus` (et skift ville flytte eksisterende forbrugere stille) — nævnt som fund.
- Ingen automatisk opdatering uden release.

## Reuse

Intet `@broberg/*` ejer modelvalg; ai-sdk er flådens model-autoritet (F017). Genbruger registry/pricing (hver alias-model skal have en prisrække) og model-research-skillen.

## Rollout

F096.1 kode + tests → release → cardmem får aliasnavne + version → components får Discovery-delta.
