# F072 — Model Watch fase 2: natlig prisvagt

**Bestilt:** Christian 7. oktober 2026, «go» til fase 2 i Model Watch-planen (ai-sdk Assets/Plans/model-watch-plan.md). upmetrics bygger alarmen, når ai-sdk's halvdel er klar (#2065, #2067).

## Hvorfor

I dag fanges en prisændring tidligst den 1. i måneden (`/model-research`). Planen kræver det hver nat, for modeller der faktisk bruges, og som script uden AI-model (D-13a919).

## Løsning

- ai-sdk eksporterer `checkPriceDrift()`: henter OpenRouters offentlige katalog (ingen nøgle) og sammenligner med ai-sdk's egen pristabel. Returnerer én række pr. model hvor prisen afviger mere end 1 %: `{ key, provider, model, ours: {inputPer1M, outputPer1M}, upstream: {inputPer1M, outputPer1M}, changePct, measuredAt }`.
- **upmetrics' natlige worker kalder funktionen** (script, ingen LLM, ingen session), filtrerer til modeller der er kaldt de sidste 30 dage, og slår alarm. Én kilde til prislogikken: ai-sdk; én til forbrug og alarm: upmetrics.
- Funktionen kaster ikke ved netværksfejl — den returnerer `{ ok: false, error }`, så et nedbrud hos OpenRouter ikke ligner «ingen prisændringer».

## Hvad den IKKE dækker (sagt højt)

- Priser uden API (stemme, billede, video, OCR, Mistral direkte): kun det håndtjekkede media-prisbord (F050). Rapporteres som dækningshul, ikke som «intet nyt».
- Direkte udbydere (OpenAI, Anthropic, Gemini) har ingen pris-API; kun deres OpenRouter-pris kan sammenlignes.

## Reuse

Genbruger `fetchOpenRouterCatalogue` + `diffCatalogue` fra F014/F067. Ingen ny pakke. upmetrics' worker og alarmmaskineri (F028) genbruges på deres side.

## Stories

- F072.1 — `checkPriceDrift()` eksporteret, testet, udgivet og meldt til upmetrics.
