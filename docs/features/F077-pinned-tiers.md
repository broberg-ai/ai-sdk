# F077 — Ingen «-latest» som default

**Ordre:** Christian 8/10 2026 (videresendt af trail, #2192, hans ord): *«vi skal ingen steder i flåden tilbyde -latest som default, for så ender vi med at bruge v4 om nogle dage, og regningen følger pludselig efter med en stor overraskelse.»* Han vil kunne fastlåse en tidligere version, så længe den nyeste er for dyr til hverdagsbrug.

## Hvorfor — målt 8/10

- Alle Mistral-tiers peger på `-latest`: fast/cheap = `mistral-small-latest`, smart/powerful = `mistral-large-latest`, vision = `mistral-medium-latest`.
- Mistral flytter selv disse navne. I dag flyttede `magistral-*-latest` og `mistral-medium-3` til nye modeller (F076.2). Flytter `mistral-large-latest` til Large 4, koster hvert kald ca. 2,7× (40× med tænkning, F074), uden at nogen har valgt det.
- Mistral sender aliasset tilbage i svaret (F071.2), så et skift kan ikke ses i `usage.model`.

## Daterede mål i dag (Mistral /v1/models, 8/10)

| tier | i dag | låses til |
|---|---|---|
| fast, cheap | mistral-small-latest | **mistral-small-2603** (Small 4, $0.15/$0.60) |
| smart, powerful | mistral-large-latest | **mistral-large-2512** (Large 3, $0.50/$1.50) |
| vision | mistral-medium-latest | **mistral-medium-2604** (Medium 3.5, $1.50/$7.50) |

Samme model og pris som i dag. Det er kun navnet, der låses.

## Løsning

- **F077.1** — Tier-kortet bruger de daterede id'er. Et versionsskift sker kun ved en release med changelog-linje og prisforskel. Test: intet tier peger på et `-latest`-id.
- **F077.2** — `describeTier(tier)` svarer: hvilken konkret version og hvad den koster (pristabellen). Til flådens dashboards og til trails settings.
- **F077.3** — Et `-latest`-id i et override giver én advarsel pr. id (console + `usage.floating: true`), medmindre `allowFloating: true`. `createAI({ strictPinning: true })` gør det til en fejl. Ikke en fejl som standard: et hundrede kald i drift på tværs af flåden må ikke vælte på en minor-release.

## Reuse

Ingen ny pakke. Ændrer `src/routing/tier-map.ts`, registret og override-håndteringen i `client.ts`.

## Ikke med

- Embedding/video-tiers er ikke `-latest` i dag og røres ikke.
- At skifte TIL Large 4 er Christians beslutning (trails F317-måling).
