# F085 — Mistral-ændringer oktober 2026

> Ejeren 30/10: «Der er mail fra Mistral ... check den». High. Effort S + en ejer-beslutning.

## Summary
Mistral har sænket prisen på Large 4, flytter aliaset `mistral-large-latest` til Large 4 den 12/11, og udfaser Large 3, Medium 3.5 og Voxtral 2 den 30/4-2027. ai-sdk's prisliste, model-register og standard-tiers skal følge med, så forbrugstal er sande og ingen app står uden model.

## Motivation
Kilder (ai-sdk-indbakken, Mistral News):
- **29/10 «Le Chonk»:** Large 4 open weights; pris fra i dag $0,70 / $0,07 cached / $2,10 pr. M tokens. Tre ræsonnementsniveauer, **High er standard**. «On November 12, mistral-large-latest will switch from Mistral Large 3 to Mistral Large 4» inkl. pris og ræsonnement.
- **30/10 «Action Required»:** udfases 31/10-2026 GLM 5.2; 30/11-2026 codestral-edit-2602; **30/4-2027** mistral-large-2512 (Large 3) → Large 4, mistral-medium-3-5 → Large 4, voxtral-mini-2602 → voxtral-mini-transcribe-3-0 ($0,0035/min), voxtral-mini-transcribe-realtime-2602 → -realtime-3-0 ($0,008/min), voxtral-mini-tts-2603 → voxtral-mini-tts-3-0 ($13/M tegn), voxtral-mini-2507 (ingen erstatning).

Målt i ai-sdk 30/10: `pricing.ts` har Large 4 til $1,36/$4,18 (fra 8/10) — omkostninger for Large 4-kald overrapporteres ~2×. Tiers `smart` og `powerful` er på `mistral-large-2512`, `vision` på `mistral-medium-2604` (= Medium 3.5) — begge udfases 30/4-2027. Pris bogføres på den model der blev bedt om (servedModel registreres kun), så et kald til `mistral-large-latest` efter 12/11 bliver prissat som Large 3 og får Large 4's standard-ræsonnement (`REASONS_BY_DEFAULT` dækker kun `mistral-large-4`/`-4-0`). Tiers er pinnet til daterede id'er (F077), så standardkald rammes ikke af aliaset.

## Solution
Tre trin: (1) ret priser og registry-noter nu; (2) på 12/11 måles aliasflytningen, og `mistral-large-latest` får Large 4-pris + kommer i `REASONS_BY_DEFAULT`; (3) inden 30/4-2027 flyttes `smart`/`powerful`/`vision` — kræver måling og ejerens beslutning (D-b890bf fastholder Large 3 for `powerful`; udfasningen er en ny kendsgerning).

## Reuse
None — data i ai-sdk's egne tabeller.

## Design
None — no visual surface.

## Scope

### In scope
- F085.1: `src/cost/pricing.ts` Large 4 → $0,70/$0,07/$2,10; `media-pricing.ts` voxtral-mini-transcribe-3-0 $0,0035/min, voxtral-mini-transcribe-realtime-3-0 $0,008/min; `availability/registry.ts` noter med udfasningsdato på mistral-large-2512, mistral-medium-2604, og på voxtral-mini-2602/2507-rutens rækker hvor de findes; docs.
- F085.2: på eller efter 12/11 — mål at `mistral-large-latest` svarer som Large 4, sæt pris og `REASONS_BY_DEFAULT`.
- F085.3: måling + ejerbeslutning for nye tier-modeller inden 30/4-2027.

### Out of scope
- GLM 5.2 og codestral-edit (ai-sdk ruter ikke dertil).
- At skifte tiers nu (Large 3 lever til 30/4-2027; det er ejerens valg).

## Stories
- **F085.1** — Priser og udfasningsnoter rettet nu.
- **F085.2** — `mistral-large-latest` → Large 4 den 12/11.
- **F085.3** — Tier-flytning før 30/4-2027 (ejerbeslutning).

## Acceptance criteria
Se stories.

## Dependencies
F074 (Large 4 + reasoningEffort), F077 (pinnede tiers).

## Rollout
F085.1 som patch nu. F085.2 som patch 12/11. F085.3 som minor med ejerens ord.

## Open Questions
1. Hvilke modeller skal `smart`, `powerful` og `vision` på før 30/4-2027? Mistral anbefaler Large 4 for begge; vores måling 8/10 viste Large 4 1,6× dyrere end Large 3 (nu ~1,4× med ny pris) og så Large-modeller *dårligere* til billedforståelse end Medium. Ejerens valg efter ny måling.

## Effort estimate
**S** for F085.1/.2; F085.3 **M** inkl. måling.
