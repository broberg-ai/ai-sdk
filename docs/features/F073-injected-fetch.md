# F073 — Et injiceret `fetch` ignoreres i ikke-streamede kald

**Rapporteret** af scout via components 7. oktober 2026 (#2100, #2101): `mistralAdapter({ fetch })` bruger kun det injicerede `fetch` i `ocr()`; `chat()` går gennem `makeOpenAICompatibleAdapter`, som ikke får det med. Et falsk `fetch` i en test ignoreres stille, og kaldet rammer den rigtige api.mistral.ai — scout fik 401 «Invalid API Key».

## Målt af ai-sdk 7. oktober 2026

- `httpTransport` (src/transport/http.ts) kalder altid den **globale** `fetch`; den tager ingen injiceret.
- Derfor ignorerer den ikke-streamede sti `config.fetch` i: `openai-compatible` (og alt bygget på den: Mistral, DeepSeek, DeepInfra, Requesty, OpenRouter-chat), `openai`, `anthropic`, `gemini`. Vores egen kommentar i openai-compatible.ts sagde det: «config.fetch is the STREAMING path only».
- `mistralAdapter` sender ikke engang sit `fetch` videre til `makeOpenAICompatibleAdapter`.
- Selv set 2026-10-05 (BYOK-probe: `openaiAdapter({ fetch })` sendte et rigtigt kald) og 2026-10-07 (served-model-tests ramte rigtig Mistral) — vi stubbede global fetch i stedet for at rette det. Det var en omgåelse.

## Hvorfor det er alvorligt

En test, der *tror* den er isoleret, sender rigtige kald med rigtige nøgler, hvis miljøet har dem: penge, rate limits og — værst — testdata ud til en udbyder. Og den fejler grønt: kaldet lykkes jo.

## Løsning

- `httpTransport` tager et valgfrit `fetch` og bruger det.
- De fire adaptere sender `config.fetch` med på den ikke-streamede sti; `mistralAdapter` sender sit `fetch` videre til den OpenAI-formede base.
- Strukturel test: hver adapter, der tager `fetch`, kaldes med et spion-`fetch` og en global `fetch` der kaster — den globale må aldrig røres.

## Reuse

Ingen ny pakke. Ret i eksisterende transport og adaptere.

## Stories

- F073.1 — Injiceret fetch respekteres overalt + strukturel test.
