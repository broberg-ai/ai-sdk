# F093 — createAI() går ned i en browser/webview

> Rapporteret af `messages` 21/11 2026 (intercom #53216). Prioritet high: ejeren kan ikke bruge tone-funktionen i messages-appen (12 fejlede forsøg).

## Problem

`createAI()` kalder `judgeSpecFromEnv()` (src/client.ts) ubetinget, og den læser `process.env.AI_JUDGE_PROVIDER`. I et miljø uden global `process` (browser, Tauri/WebKit-webview) kaster det `ReferenceError: Can't find variable: process` — også med `byok:true` og `costSink:null`, hvor intet fra miljøet skal bruges.

Samme form findes ~45 steder: `config.apiKey ?? process.env.X` i alle adaptere, `defaultCostSink`, `requireAgentName`, `search/index.ts`, `catalogue/fetchers.ts`, `availability/refresh.ts`. De fleste rammes kun når nøglen IKKE er givet — men så bliver fejlen en kryptisk ReferenceError i stedet for adapterens egen «API key not set».

## Scope

- Én hjælper `env()` i `src/env.ts`: `typeof process !== "undefined" && process.env ? process.env : {}`.
- Erstat ALLE `process.env`-læsninger i `src/` (ikke-test) med `env()`. Opførsel i Node/Bun uændret.
- Test der fjerner `globalThis.process` midlertidigt og kører `createAI({ byok:true, costSink:null, providers })` + et judge-kald med eksplicit nøgle, samt en adapter uden nøgle der skal give sin egen «not set»-fejl, ikke ReferenceError.
- Statisk vagt-test: ingen `process.env` i `src/**/*.ts` (ikke-test) uden for `src/env.ts` — så formen ikke kommer tilbage.
- Patch-release (0.75.1) og svar til messages med versionen.

## Non-goals

- Ingen ændring af byok-semantik (env-routingvalget AI_JUDGE_PROVIDER læses stadig når det findes).
- Ingen browser-bundle-omlægning; `subprocess`-transport m.m. er fortsat Node-only.

## Arkitektur

`src/env.ts` eksporterer `env(): Record<string, string | undefined>`. Kaldes ved brug (ikke cachet), så tests og runtime der sætter env sent virker som før.

## Reuse

Intet `@broberg/*`-modul ejer env-læsning (`@broberg/config` er app-konfiguration, ikke en SDK-intern guard); en 3-linjers intern hjælper er det rigtige niveau. Ingen ny afhængighed.

## Rollout

bump 0.75.1 → tag → publish via workflow → verificér npm → svar messages (#53216) → messages fjerner deres midlertidige `define`.
