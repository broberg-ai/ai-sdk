# F074 — Mistral Large 4: prissat, målt, bevidst valgt

**Ejer:** ai-sdk · **Bestilt af:** Christian, 8/10 2026 («ja, sæt i gang») · **Status:** i gang

## Hvorfor

Mistral udgav Large 4 den 6. oktober 2026 (Public Preview). Målt 8/10 mod `GET /v1/models`:

- `mistral-large-4` (alias `mistral-large-4-0`) findes på API'et: 1M kontekst, vision, function calling, reasoning.
- `mistral-large-latest` peger STADIG på `mistral-large-2512` (Large 3) — det er den `smart` og `powerful` bruger.
- Large 4 stod ikke i `src/cost/pricing.ts`, så et override-kald til den ville blive bogført til $0.

Når Mistral flytter `-latest`, skifter hele flåden model og pris samme nat uden at nogen vælger det. Det er F071.3's hul; dette epic gør skiftet til et valg i stedet.

## Pris (målt 8/10 fra docs.mistral.ai/models/mistral-large-4 og mistral.ai/news/mistral-large-4)

| | input /1M | cached input /1M | output /1M |
|---|---|---|---|
| Large 4 listepris | $1.36 | $0.14 | $4.18 |
| Large 4 preview-udsalg | $0.68 | $0.07 | $2.09 |
| Large 3 (`mistral-large-2512`) | $0.50 | $0.05 | $1.50 |

**Vi registrerer LISTEPRISEN.** Udsalget er tidsbegrænset og uden slutdato; bogfører vi udsalgsprisen, under-rapporterer upmetrics den dag det udløber, og ingen ser det. Over-rapportering i preview-perioden er den sikre fejlretning.

## Stories

- **F074.1** — Large 4 i pristabellen (`mistral-large-4`, `mistral-large-4-0`) + test.
- **F074.2** — Målt sammenligning Large 4 vs Large 3 på faste opgaver (dansk tekst, JSON-udtræk, klassifikation): korrekthed, gyldigt format, svartid, tokens, pris. Rapport i Assets/Reports.
- Beslutningen om at flytte `smart`/`powerful` er **Christians**, på baggrund af F074.2. Ikke en story — et skift sker kun på hans ord.
- Alarm ved fremtidige `-latest`-flytninger: **F071.3** (findes allerede).

## Reuse

Intet nyt modul. Bruger eksisterende `mistralAdapter`, `PRICING`-tabellen og `ai.chat` med `override`. Discovery-check: ingen `@broberg/*`-pakke ejer modelpriser — ai-sdk er selv ejeren.

## Ikke med

- Intet automatisk tier-skift.
- Ingen ændring af `vision`-tieren i dette epic.
