# F088 — ai.secondOpinion: fem frontier-modeller vurderer en plan

> Ejerens ordre 5/11 2026 («ja» til forslaget samme dag). High. Effort M. Status: i gang.

## Summary
Én funktion, `ai.secondOpinion()`, sender en plan, en SDK-beskrivelse eller andet materiale til fem frontier-modeller fra fem udbydere på én gang med samme instruktion: en uvildig, kvalitativ og konstruktiv vurdering med forslag til forbedringer. En sjette, billig EU-model samler de fem svar til én opsummering (enighed, uenighed, vigtigste forbedringer). Et script (`scripts/second-opinion.ts`) gør det kørbart for ai-sdk-sessionen i dag; cardmem pakker det senere ind som et asynkront MCP-job, så alle agenter kan bruge det.

## Motivation
Christian brugte ChatGPT's standardmodel på chatgpt.com til at vurdere en plan og fik et meget godt svar. Han vil have det systematisk og med flere udbydere: forskellige modeller ser forskellige svagheder. Krav: ingen faste omkostninger — ingen live service hos ai-sdk. Kun betaling pr. kald.

## Panelet (målt 5/11 2026 mod vores egne nøgler)
| Udbyder | Model | Rute | Pris ind/ud pr. 1M | Region |
|---|---|---|---|---|
| Anthropic | `claude-opus-5-5` | anthropic direkte | $4 / $20 | US |
| OpenAI | `gpt-6-astra` | openai direkte | $10 / $50 | US |
| Google | `gemini-4-argon` | gemini direkte | $2 / $10 | US |
| Mistral | `mistral-large-4-0` | mistral direkte | $0.7 / $2.1 | EU |
| DeepSeek | `deepseek/deepseek-v4.1-flash-1017` | openrouter (ingen DeepSeek-nøgle i repoet) | $0.15 / $0.6 | unknown (CN-model) |
| Opsummering | `mistral-large-2512` | mistral direkte | $0.5 / $1.5 | EU |

OpenAI-valget: chatgpt.com's standardmodel er ikke offentliggjort; `gpt-6-astra` er den dyreste/topmodellen vi kan nå (`gpt-6.1-sol`, `gpt-5.5-pro` findes også). Panelet kan overskrives pr. kald.

## Reuse
- LLM-adgang: dette ER `@broberg/ai-sdk`; panelet kører gennem den eksisterende `ai.chat` med `override`, så cost-tracking, region (`usage.region`) og pris kommer gratis. Ingen ny pakke.
- Discovery: ingen `@broberg/*`-pakke ejer «flere modeller vurderer et dokument». cardmem-værktøjet (F088.4) skal bruge denne funktion, ikke sin egen kode.

## Design
None — no visual surface (rapporten er markdown).

## Scope
### In scope
- `src/capabilities/second-opinion.ts`: `SECOND_OPINION_PANEL`, `SECOND_OPINION_SYNTH_SPEC`, instruktionen, markdown-rapport.
- `ai.secondOpinion({ content, title?, focus?, panel?, synthesize?, maxTokens?, confirmNoPersonalData })` → `{ opinions[], synthesis?, totalCostUsd, markdown }`.
- **GDPR-port:** `confirmNoPersonalData: true` er PÅKRÆVET; uden den kaster kaldet, før noget forlader maskinen. Fire af fem modeller er US/CN. Vi kan ikke detektere persondata pålideligt, så kalderen skal sige det eksplicit.
- **Blindt panel:** ingen model får at vide hvem der skrev materialet eller ser de andres svar.
- Parallelle kald; én fejlende model stopper ikke de andre (fejlen står i rapporten).
- Prisrækker for `gemini:gemini-4-argon` og `openrouter:deepseek/deepseek-v4.1-flash-1017`.
- `scripts/second-opinion.ts <fil> [--focus …] [--out …]` → rapport i markdown.
- Docs (`docs/API.md`), release, Discovery.
### Out of scope
- Automatisk detektion af persondata.
- Selve cardmem-MCP-værktøjet (bygges af cardmem; F088.4 er overdragelsen).
- Iterativ debat mellem modellerne.

## Architecture
```ts
const r = await ai.secondOpinion({ content: planMd, title: "F088", confirmNoPersonalData: true });
r.opinions // [{ label, provider, model, region, text?, error?, usage? }]
r.synthesis // { text, usage } | undefined
r.markdown  // samlet rapport
```

## Stories
- **F088.1** — `ai.secondOpinion` + GDPR-port + mock-tests.
- **F088.2** — script + priser + live-kørsel på en rigtig plan.
- **F088.3** — docs, release, Discovery.
- **F088.4** — overdragelse til cardmem: asynkront MCP-job der bruger `ai.secondOpinion`.

## Acceptance criteria
1. Uden `confirmNoPersonalData:true` kaster kaldet, og intet netværkskald sker — unit-test.
2. Alle fem kaldes parallelt med samme system-instruktion; én fejlende model giver `error` i dens række mens de andre svarer — unit-test.
3. Live-kørsel på en rigtig plan giver fem vurderinger + opsummering med pris pr. model.
4. Release på npm og components informeret; cardmem har fået kontrakten.

## Dependencies
None.

## Rollout
Additivt (ny funktion). Minor-bump. Ingen ændrede standarder.

## Open Questions
1. Hvilken OpenAI-model svarer til chatgpt.com's standard? Antaget `gpt-6-astra`; ejeren kan rette.

## Effort estimate
**M** — ½–1 dag.
