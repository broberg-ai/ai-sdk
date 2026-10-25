# F081 — Microsoft-Decision-1 som EU-beslutningsmodel bag ai.judge

> Byggeordre 01a1693b-6901-75f8-9612-7aa8b798c801 fra Christian, 23/10 2026. Prioritet high. Effort M. Status: planlagt, F081.1 blokeret på Azure-adgang.

## Summary
ai.judge får en anden udbyder ved siden af Jev: Microsoft-Decision-1, deployet i Microsoft Foundry i Sweden Central som Data Zone Standard, så data behandles i EU. Apps skifter mellem Jev og Decision-1 med én indstilling uden kodeændringer, og svarene har samme form. En måling af de to mod hinanden lander som rapport i cardmem.

## Motivation
Jev (TypeSafe, F066) er US-hostet og gemmer input på vores nøgle, så den må ikke få persondata. cardmem (Scope, cardmem-F346.127) bad 23/10 om en EU-dommer bag ai.judge, og Christian svarede med denne ordre. Decision-1 er samme modelklasse (typede beslutninger, kalibrerede sandsynligheder, ingen fritekst) og samme listepris: $0,042 pr. million input-tokens, output gratis.

Målt 23/10 som alternativer: Gemini 2.5 Flash på Vertex europe-west1 giver token-logprobs, men er ikke kalibreret (99 % sikker på et uvist spørgsmål). Mistral har ingen logprobs ("Logprobs are not enabled for this model", large/medium/ministral). Opper er en gateway til samme US-Jev. Ingen af dem er en EU-dommer.

## Solution
Ny adapter `microsoft-decision` i `src/providers/` der kun implementerer `ProviderAdapter.judge`, mod Foundrys `/providers/microsoft/v1/systemone`. Kilderne (se nedenfor) beskriver samme protokol som TypeSafes `/v1/systemone` (state + typede spørgsmål, svar pr. spørgsmåls-id), så svar-mapningen fra `typesafe.ts` genbruges; forskellen er vært, auth (Azure `api-key`) og deployment-navn. Skiftet sker via `override` pr. kald (findes) og en ny klient-standard læst fra env.

## Reuse
- LLM-adgang: dette ER `@broberg/ai-sdk` — udvidelse af eget pakke, ingen ekstern afhængighed.
- Azure-auth: genbrug mønsteret fra `src/providers/azure.ts` (api-key-header, nøgle fra env/config). Ingen Azure-SDK (flåderegel: plain fetch).
- Svar-mapning: genbrug `mapAnswer`-logikken fra `src/providers/typesafe.ts` — løftes til en fælles hjælper i stedet for kopi.
- Cost/region: eksisterende `freshUsage`, `pricing.ts`, `region.ts`, cost-sinks.
- Discovery-tjek: ingen anden `@broberg/*`-pakke ejer beslutningsmodeller; ai-sdk er ejeren. Discovery skal have besked ved udgivelse (CLAUDE.md trin 5).

## Design
None — no visual surface (SDK-adapter, ingen UI).

## Scope

### In scope
- Foundry-ressource i Sweden Central + deployment `decision-1-eu` (model `Microsoft-Decision-1`, version 1, SKU `DataZoneStandard`), oprettet gentageligt via Azure CLI-script i `scripts/`.
- Endpoint + nøgle i ai-sdk-vault og `.env` (`AZURE_DECISION_ENDPOINT`, `AZURE_DECISION_API_KEY`, `AZURE_DECISION_DEPLOYMENT`).
- `src/providers/microsoft-decision.ts` + test; registreret i `src/providers/registry.ts`.
- BYOK: adapteren tager `{ endpoint, apiKey, deployment }` fra kalderen (kundens egne Azure-credentials), env er kun fallback.
- Skift via konfiguration: `AI_JUDGE_PROVIDER=typesafe|microsoft-decision` læst i `createAI()` som standardrute for `ai.judge`; `override` pr. kald vinder stadig.
- Pris i `src/cost/pricing.ts`, rækker i `src/availability/registry.ts` (pinnet version, udløbsdato i note), `kind: "judge"`.
- `usage.region`: `"eu"` kun når deployment er konfigureret som EU-datazone (se Architecture); ellers `"unknown"`.
- Sammenligningsrapport Jev vs Decision-1 i cardmem Assets/Reports.
- Docs: `README.md`, `docs/API.md`, CLAUDE.md-afsnittet om ai.judge, Discovery-besked.

### Out of scope
- Selv-hostede åbne modeller (Clef-flash, GLiNER2.5-Decide) — evt. senere ordre.
- Udrulning til andre apps i flåden (cardmem/Scope flytter selv når vi melder ruten).
- En Gemini-baseret EU-dommer (målt ikke kalibreret 23/10).
- OpenRouter- og Global Standard-ruten til Decision-1 (ingen EU-garanti) — bygges ikke, heller ikke som fallback.
- At ændre standarden for ai.judge fra Jev til Decision-1 for alle (ejerens valg, ikke vores).
- Entra ID-auth (kun api-key i denne omgang).

## Architecture

### Adapter `src/providers/microsoft-decision.ts`
```ts
export function microsoftDecisionAdapter(config: {
  endpoint?: string;     // https://<resource>.services.ai.azure.com — env AZURE_DECISION_ENDPOINT
  apiKey?: string;       // env AZURE_DECISION_API_KEY
  deployment?: string;   // env AZURE_DECISION_DEPLOYMENT, default "decision-1-eu"
  dataZone?: "eu";       // erklæret af den der oprettede deploymentet; styrer usage.region
  fetch?: typeof fetch;
} = {}): ProviderAdapter   // implementerer kun judge
```
- POST `${endpoint}/providers/microsoft/v1/systemone`, header `api-key`, body `{ model: deployment, state, questions }`. Præcis wire-form verificeres mod et rå svar i F081.2 før koden låses — kilderne er uenige om feltnavne ud over `choice`.
- Svar → `JudgeResult` med samme form som Jev (`noul` / `choice`+`probabilities`+`confidence` / `score`+`probabilities`+`legend`+`confidence`). Manglende svar kaster (samme regel som typesafe.ts).
- Ships dark: uden endpoint/nøgle sker intet før judge kaldes, og fejlen navngiver env-variablerne.

### Region
En Foundry-vært (`<resource>.services.ai.azure.com`) bærer ikke regionen i navnet, så `regionOfHost` kan ikke svare. `usage.region = "eu"` kun når adapteren er konfigureret med `dataZone: "eu"` (sat af vores standard-deployment og af BYOK-kalderen der ved det); ellers `"unknown"`. Det er en erklæring, ikke en måling — står sådan i docs. Data Zone EU omfatter også Norge og Schweiz.

### Skift via konfiguration
`createAI()` læser `AI_JUDGE_PROVIDER`; `microsoft-decision` → `DEFAULT_JUDGE_SPEC = { provider: "microsoft-decision", model: "microsoft-decision-1-v1", transport: "http" }`. Ukendt værdi kaster ved opstart (fail-closed, ligesom en ukendt tier). Uden variablen: uændret Jev.

### Pris + registry
- `"microsoft-decision:microsoft-decision-1-v1": { inputPer1M: 0.042, outputPer1M: 0 }` — kilde og læsedato i versionsfeltet.
- Registry-række med `note` om pinnet version 1, udløbsdato 2027-02-04 (verificeret i F081.1) og at modellen senere flyttes fra Qwen3.5-9B til MAI/OpenAI-modeller.

### Sammenligning `scripts/judge-compare.ts`
Fast testsæt (`scripts/judge-compare/cases.json`) af ikke-personlige cases: ticket-routing (helpdesk-agtige, anonymiserede/konstruerede), relevans (Scout/Field), urgency/sprog. Hver case har et facit. Måler nøjagtighed, p50/p95 latency, pris pr. 1.000 beslutninger ud fra faktisk `usage`, og kalibrering (Brier-score + reliability-tabel). Rapport → `cardmem_create_asset` i Reports.

## Stories
- **F081.1** — Foundry-deployment i Sweden Central (DataZoneStandard) + nøgler i vault + udløbsdato undersøgt.
- **F081.2** — `microsoft-decision`-adapter bag ai.judge, BYOK, samme svarform som Jev.
- **F081.3** — Skift via `AI_JUDGE_PROVIDER`, pris, registry, region.
- **F081.4** — Sammenligningsrapport Jev vs Decision-1 i cardmem.
- **F081.5** — Docs + udgivelse + Discovery + Christians verifikation på cb-2.

## Acceptance criteria
1. `az cognitiveservices account deployment show` mod ressourcen viser `sku.name = DataZoneStandard`, location `swedencentral`, model `Microsoft-Decision-1` version 1 — output gemt i F081.1-kortet.
2. `ai.judge({ override:{provider:"microsoft-decision", model:"microsoft-decision-1-v1"}, … })` svarer live med samme `JudgeResult`-form som Jev for noul, choice og score — målt med et live-kald mod deploymentet, ikke kun en mock.
3. Med `AI_JUDGE_PROVIDER=microsoft-decision` går et `ai.judge`-kald uden override til Decision-1 — målt på `usage.provider` i svaret.
4. BYOK: et kald med eksplicit `{ endpoint, apiKey }` bruger de credentials og ikke env — bevist i test med indsprøjtet fetch (header + URL aflæst).
5. Rapporten ligger i cardmem Reports med nøjagtighed, p50/p95, pris pr. 1.000 og kalibrering for begge, plus de kendte forbehold.
6. Udløbsdato 2027-02-04 undersøgt; hvad der sker derefter står i registry-note og docs.
7. Christian har verificeret på cb-2.

## Dependencies
- F066 (ai.judge + Jev) — Done.
- Azure-adgang til abonnement `aea479dd…` (Christian) — blokerer F081.1, og dermed live-delen af F081.2–F081.4.

## Rollout
Additivt: ny provider, standard uændret (Jev). Minor-bump (ny capability-rute + ny env). Ingen migration. Rollback: fjern `AI_JUDGE_PROVIDER` hos kalderen. Adapteren kan bygges og testes mod mock før deploymentet findes; live-AC venter på F081.1.

## Open Questions
1. **Azure-adgang:** Har ai-sdk (cc) adgang til at oprette Foundry-ressourcen i abonnement `aea479dd…`, eller opretter Christian den? Målt 23/10: `az` CLI er ikke installeret her, og vaulten har kun abonnements-id'et — ingen login eller service principal. Ordren siger: stop og spørg, gæt ikke konti.
2. **Beslutningsregistret:** registret siger (16/10) «ingen Jev-måling før en app har en opgave UDEN persondata». Denne ordre (23/10, Christians egen) bestiller målingen. Vi tolker ordren som nyere og bygger testsættet uden persondata. Bekræft.
3. Den præcise wire-form for svar (ud over `choice`) — afklares med første rå svar i F081.2.

## Effort estimate
**M** — 2–3 dage efter Azure-adgang findes.

Kilder (læst 23/10 2026): llmreference.com/provider/microsoft-foundry/microsoft-decision-1, hermes-agent.nousresearch.com/docs/plugins/ms-decision-provider, nuget ElBruno.AI.Decisions.Foundry. Microsofts egen API-reference er ikke læst endnu — gøres i F081.2.

## Målt 26/10 2026 (F081.1)

- **Login:** abonnement `aea479dd…` hører til Entra-tenant senti.info (`69977c23-…`). Login som cb@senti.info via device-code — Lens udfyldte microsoft.com/devicelogin, MFA (6-cifret kode) gik til ejeren via ARS. Ingen `az` CLI nødvendig; token fra Azure CLI's offentlige app-id.
- **Ressource:** `ai-sdk-decision-eu` (kind AIServices, S0, swedencentral) i resource group `ai-sdk-generic-group`. Endpoint `https://ai-sdk-decision-eu.cognitiveservices.azure.com` (også `…services.ai.azure.com`). Den eksisterende `ai-sdk-generic` er SpeechServices F0 og kan ikke rumme model-deployments.
- **Deployment:** `decision-1-eu`, Microsoft-Decision-1 v1, SKU DataZoneStandard, capacity 500 (standard), `versionUpgradeOption: NoAutoUpgrade`. Genskabes idempotent af `scripts/azure-decision-deploy.sh`.
- **Udløb:** Azures model-katalog for swedencentral angiver `deprecationDate 2027-02-04` på både SKU'en og `deprecation.inference` — efter den dato modtager deploymentet ikke kald. En efterfølger skal vælges og deployes før; cardmem (Scope) har bedt om det.
- **Wire-form:** POST `{endpoint}/providers/microsoft/v1/systemone`, header `api-key`, body `{ model: <deployment>, state, questions }` — samme spørgsmålsform som TypeSafe (score = array af 2–10 niveauer). Svar `{ model: "microsoft-decision-1", answers: { <id>: { type, noul | choice+probabilities+confidence | score+probabilities+legend+confidence } }, usage: { input_tokens, output_tokens } }` — samme felter som Jev. 0,7 s.
- **Region pr. kald:** svaret har `x-ms-region: Sweden Central` og `azureml-destination-region: swedencentral`. Det er en måling pr. kald, bedre end en erklæring — adapteren læser `x-ms-region` og sætter `usage.region` ud fra den (se F081.3).
