# F075 — Priser på hele Claude 5-familien

**Bestilt af:** Christian 8/10 2026 («ja, læg priserne ind») · **Ejer:** ai-sdk

## Hvorfor

Den nye Anthropic-nøgle (vault «AI-SDK (generic)», 8/10) listede 14 modeller. 10 havde ingen pris i `src/cost/pricing.ts`, herunder hele Claude 5-familien. Et `override:{provider:"anthropic", model:"claude-opus-5-5"}` blev derfor bogført til $0 i upmetrics.

## Kilde (læst 8/10 2026 fra platform.claude.com/docs/en/about-claude/pricing)

| model | input | 5m cache write | cache read | output |
|---|---|---|---|---|
| Fable 5.1 | 10 | 12.50 | 0.25 (0.025×) | 50 |
| Fable 5 | 10 | 12.50 | 1 | 50 |
| Opus 5.5 | 4 | 5 | 0.20 (0.05×) | 20 |
| Opus 5 / 4.7 / 4.6 / 4.5 | 5 | 6.25 | 0.50 | 25 |
| Sonnet 5.5 | 2 | 2.50 | 0.10 (0.05×) | 10 |
| Sonnet 5 | 2 | 2.50 | 0.20 | 10 |
| Sonnet 4.5 | 3 | 3.75 | 0.30 | 15 |
| Haiku 5.5 ≤100k prompt | 0.10 | 0.125 | 0.01 | 0.50 |
| Haiku 5.5 >100k prompt | 0.50 | 0.625 | 0.05 | 2.50 |

Cache-read er IKKE 0,1× overalt: Opus/Sonnet 5.5 er 0,05×, Fable 5.1 0,025×.

## Haiku 5.5 — pris efter promptlængde

Tabellen kunne kun én pris pr. model. Haiku 5.5 koster 5× mere, når prompten er over 100.000 tokens. Én pris ville enten overrapportere alle normale kald 5× eller underrapportere de lange 5×. Løsning: et valgfrit `longPrompt`-felt på en prisrække (tærskel + andre takster), som `computeCost` bruger, når input + cache-read + cache-write overstiger tærsklen.

## Ikke med

- 1h cache write (2×) — SDK'en skriver kun 5-minutters cache i dag.
- Fast mode og `inference_geo:"us"` (1,1×) — SDK'en sender ingen af dem.
- Batch (50 %) — Anthropic-batch er ikke bygget.

## Reuse

Ingen ny pakke; udvider eksisterende `PRICING` og `computeCost`. ai-sdk ejer modelpriserne.

## Story

- F075.1 — rækker + `longPrompt` + tests + release.
