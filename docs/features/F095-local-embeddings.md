# F095 — Lokale embeddings: provider `local`

> Bestilling fra cardmem 24/11 2026 (#54513, deres F437.4), ejerens GO: «Der er GO til at sætte ai-sdk i gang med LocalSearchKeys til Embeddings». Ejeren: «så skal vi ikke bruge AI tokens på det».

## Problem

`ai.embedding` går i dag til en betalt API (standard `openai:text-embedding-3-small`, US; EU-alternativ Mistral). buddys daglige job embedder samtale-stumper fra cardmem og skal kunne gøre det på en af vores egne maskiner (m1, cb-2, cb-ubuntu) til $0.

I dag kan `openaiAdapter({ baseUrl })` pege på en lokal Ollama, men: den kræver `OPENAI_API_KEY`, bogfører med OpenAI-priser, mærker kaldet `openai`, og en forbruger der gør det selv har i praksis lavet en rå integration uden om SDK'ens kontrakt.

## Krav (fra bestillingen)

1. Samme `embedding`-API som i dag, valgt via override (`provider:'local'`) — aldrig et rå Ollama-kald hos forbrugeren.
2. Modelnavn + dimension returneres med hvert svar, så forbrugeren kan gemme `model` ved vektoren og genindeksere ved modelskift.
3. Ship dark: ingen lokal server → klar fejl, aldrig tavs fallback til en betalt provider.
4. Discovery får besked (components ejer rosteren).

## Arkitektur

- Ny adapter `src/providers/local.ts` — `localAdapter({ baseUrl?, fetch? })`, kun `embedding`.
  - Adresse: `config.baseUrl ?? env().LOCAL_EMBEDDING_URL ?? "http://127.0.0.1:11434/v1"` (Ollamas OpenAI-kompatible `/v1/embeddings`; llama.cpp-server og LM Studio taler samme form).
  - Ingen nøgle, ingen `Authorization`-header.
  - Kan ikke nås → fejl der navngiver adressen og hvordan serveren startes, og siger at intet er sendt andetsteds hen. 404 → «modellen er ikke hentet: `ollama pull <model>`».
  - `usage.provider = "local"`, `costUsd = 0`, `costBasis = "computed"` (en kendt, ægte $0 — ikke «unpriced»).
- Registreres i `defaultProviders`, så `override:{ provider:"local", model }` virker uden ekstra konfiguration.
- `EmbeddingResult` får `model` og `dimensions` (additivt, sættes centralt i `client.embedding` for ALLE ruter, så kravet ikke kun gælder den lokale).
- Ingen automatisk fallback: SDK'en har aldrig haft en; testen beviser at en utilgængelig lokal server ikke rører en anden provider.
- Standard-tieren `embedding` ændres IKKE (lokal er et bevidst tilvalg pr. kald).

## Modelforslag

**`bge-m3`** (BAAI, 1024 dimensioner, flersproget inkl. dansk, 8192 tokens kontekst, ~1,2 GB, MIT-licens, findes i Ollamas bibliotek). Alternativ: `nomic-embed-text-v2-moe` (768 dim, flersproget, mindre). Valget binder: vektorer fra to modeller kan ikke sammenlignes, så et modelskift betyder genindeksering — derfor krav 2.

Maskine: cb-ubuntu kører allerede Ollama (målt 24/11: x86_64, 14 GB RAM, ingen modeller hentet). bge-m3 kan køre på CPU til et dagligt batchjob; m1 (Apple silicon) er hurtigere. cardmem måler kapaciteten.

## Åbne spørgsmål

- `usage.region` for en lokal adresse: `regionOfHost` svarer `unknown` for loopback/LAN. Data forlader ikke maskinen, men SDK'en kan ikke vide hvor maskinen står (D-1bd1c1: ingen residens-spærre i SDK'en). Bevares som `unknown` i F095.1; en ændring af Region-typen er et brud for forbrugere der matcher udtømmende og kræver ejerens ord.

## Non-goals

- Ingen in-process model (transformers/onnx) — pakken forbliver let; serveren kører ved siden af.
- Ingen lokal chat/vision i denne omgang.
- Ingen installation af Ollama-tjenester på maskinerne ud over at hente modellen til live-testen.

## Reuse

Discovery: ingen `@broberg/*`-pakke ejer embeddings eller lokale modeller — `@broberg/ai-sdk` er sel dette lag (D-844223). Adapteren genbruger SDK'ens `httpTransport`, `freshUsage` og `env()`. Ny afhængighed: ingen.

## Rollout

F095.1 kode + tests + live-måling mod cb-ubuntu → release 0.76.0 → svar cardmem med version + eksempel-kald → components får delta til Discovery.
