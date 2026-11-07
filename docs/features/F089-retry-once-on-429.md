# F089 — Ét nyt forsøg ved «for mange kald» (429), på samme EU-rute

> Opdaget 7/11 2026 efter ejerens Upmetrics-skærmbillede. Status: forslag i backlog — afventer ejerens ja, da det er vores egen opdagelse (F180).

## Summary
Når en udbyder svarer HTTP 429 («for mange kald»), venter SDK'en det antal sekunder udbyderen angiver i `Retry-After` (med et loft) og prøver præcis én gang mere på SAMME rute. Først derefter går kaldet til en kalder-angivet fallback eller fejler.

## Motivation
Målt af upmetrics i agent_runs 5/11 kl. 23:55–00:12 dansk tid: trail lavede ~1.250 kald til mistral-large-2512, og 28 (2 %) fik 429 rate_limit. Hvert af dem blev til en fejl hos trail, fordi SDK'en ved 429 kun kender to veje: fallback (hvis kalderen har givet en) eller fejl. En kort burst mod en kvote er netop den situation hvor et enkelt nyt forsøg efter få sekunder lykkes. Uden fallback mister appen kaldet; med en US-fallback forlader data EU (CLAUDE.md: «A fallback chain kills the EU route — and it fails green»). Et nyt forsøg på samme rute løser begge.

## Reuse
- Dette ER `@broberg/ai-sdk`; logikken ligger i `runCapability` i `src/client.ts`, hvor 429/5xx allerede klassificeres (`isFallbackEligible`). Ingen ny pakke.
- Discovery: ingen `@broberg/*`-pakke ejer retry af LLM-kald.

## Design
None — no visual surface.

## Scope
### In scope
- Kun HTTP 429, kun ét ekstra forsøg, kun samme rute (provider+model+region uændret).
- Ventetid = `Retry-After` (sekunder eller HTTP-dato), loft 10 s; uden header 2 s.
- Ventetid > loft → intet nyt forsøg (fejl/fallback som i dag) — vi holder ikke en kalder fanget i et minut.
- Opt-out: `retryOn429: false` pr. kald og i `createAI`.
- Hvert forsøg rapporteres til cost-sinken som i dag (upmetrics ser begge rækker).
### Out of scope
- 5xx-retry (blips skal stadig være synlige; kan blive et senere kort).
- Streaming efter første token.
- Kvote-styring/kø på tværs af kald (appens ansvar; batch-API er vejen for natkørsler).

## Architecture
I `runCapability`: fang fejl med status 429 på den primære rute → læs `retryAfterMs` fra fejlen (adapterne lægger response-headeren på fejlobjektet) → `await sleep(min(ms, 10_000))` → kald samme spec én gang til → derefter eksisterende fallback-logik.

## Stories
- **F089.1** — Retry-once på 429 i runCapability + tests + docs + release.

## Acceptance criteria
1. Et kald der får 429 med `Retry-After: 1` og derefter 200 lykkes, og der er sendt præcis 2 forespørgsler til SAMME provider:model — unit-test.
2. To 429 i træk → fejl (eller fallback) efter præcis 2 forsøg på primær-ruten — unit-test.
3. `Retry-After: 60` (over loftet) → intet nyt forsøg — unit-test.
4. `retryOn429: false` → intet nyt forsøg — unit-test.
5. Release på npm + trail og components informeret.

## Dependencies
None.

## Rollout
Adfærdsændring uden API-brud: et kald kan tage op til 10 s længere ved 429. Minor-bump. Rollback: `retryOn429:false`.

## Open Questions
1. Ejerens ja (egen opdagelse).
2. Skal 503 med Retry-After også have ét forsøg? Målt 6/11: 7× 503 på ét minut hos Mistral (trail + cardmem).

## Effort estimate
**S** — ½ dag.
