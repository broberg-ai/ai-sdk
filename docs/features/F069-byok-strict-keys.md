# F069 — BYOK-sikker klient

**Anledning:** components-F096. Christian vil have BYOK (Bring Your Own Key) i CMS, HelpDesk, Trail og Mailworker: kunden indsætter sin egen nøgle og vælger dermed selv udbyder og EU/US. components spørger 2026-10-05 (#1780), og BYOK skal bygges OVEN PÅ ai-sdk.

## Målt 2026-10-05 mod 0.50.1 (probe-script, global fetch stubbet)

| Spørgsmål | I dag |
|---|---|
| Injicerede adaptere + egen tier-map | **Findes.** `createAI({ providers, defaults })`; `ai.chat({tier})` uændret. `providers` ERSTATTER flådens adaptere. |
| Ingen fallback til flådens udbydere | **Findes for ruter:** ingen implicit fallback; umappet tier og ikke-tier-kapabiliteter fejler lukket («no provider adapter registered for "mistral"»). |
| Ingen fallback til flådens NØGLER | **Mangler.** Hver adapter læser `config.apiKey ?? process.env.<X>_API_KEY`. Målt: `openaiAdapter({apiKey: undefined})` med `OPENAI_API_KEY` i env sendte flådens nøgle. |
| byok/tenant-mærkning i cost-sink | **Findes per kald** (`labels`, målt på usage). **Mangler** på klient-niveau. |

## Hvorfor hullet er alvorligt

Mangler kundens nøgle i appens lager (ikke oprettet endnu, slettet, fejlindlæst), kører kaldet stille på FLÅDENS konto. Kunden tror, de betaler og ejer data-aftalen; det gør vi. Og intet fejler, så ingen opdager det.

## Løsning

- Adapter-option der slår env-fallback fra (fx `envFallback: false`) og kaster en tydelig fejl når `apiKey` mangler eller er tom.
- Klient-option (fx `createAI({ byok: true })`) der håndhæver det for alle injicerede adaptere og afviser at bruge `defaultProviders`.
- Klient-niveau `labels` der fletter ind i hvert kalds labels (kaldets egne vinder).
- Dokumentation i API.md + besked til components.

## Reuse

Ingen ny pakke. Udvider eksisterende `createAI`-config og adapter-configs. Discovery: BYOK ejes af components (F096); ai-sdk leverer kun garantien om at nøglen ikke lækker.

## Stories

- F069.1 — Streng nøgle-tilstand: ingen env-fallback.
- F069.2 — Klient-niveau labels.
