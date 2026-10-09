# F078 — `search`: web search som fælles kapabilitet

**Ordre:** Christian 9/10 2026, byggeordre `01a12016-0d52-7857-8dc0-1645600c4c2a` (SEARCH-PLAN, via claude.ai). Planen er hans; denne fil omsætter den til ai-sdk-arbejde og noterer det, der er målt.

## Formål

Ingen app taler direkte med en søgeudbyder. CMS, Scout, Trail/Forager, techadvisor, Lead Scanner og Field kalder `search` fra `@broberg/ai-sdk`. Udbydere kan skiftes uden at røre apps. I dag har CMS'et sin egen Brave/Tavily-integration (`packages/cms-admin/src/lib/tools/web-search.ts`), som skal migreres.

## Låste beslutninger (fra planen)

1. ai-sdk er eneste søgegrænse.
2. Én resultatform: `{ title, url, description, provider, lang?, publishedAt? }` + `meta { provider, latencyMs, cached, costUsd, requestId }`.
3. Udbydere som adaptere: `brave` (direkte), `cloudflare:{ceramic,linkup,exa}` (Cloudflare Web Search via AI Gateway), `tavily` (kun CMS-legacy). Senere `field`.
4. BYOK pr. tenant; vores egne nøgler kun til interne værktøjer.
5. Routing efter sprog og formål, som data.
6. Ingen LLM i selve søgekaldet; valgfri omskrivning via billig model.
7. Exa er slået fra som standard for kundedata (ingen ZDR).

## Målt 9/10 (Cloudflare-docs)

- `POST https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/websearch/`, Bearer-token med *Workers AI Read* + *AI Gateway Read*.
- Body: `{ query (1–1024), provider: ceramic|exa|linkup (standard ceramic), limit 1–10, byokAlias?, options.gateway.id? }`.
- Svar: `{ items: [{ url, title, description }], metadata: { query, requestId, latencyMs } }` — ingen dato, intet sprog.
- Priser pr. 1.000: Ceramic $0,25 · Linkup $5 · Exa $7. ZDR: Ceramic ja, Linkup ja, Exa nej.
- Ingen sprog-, land- eller friskhedsfiltre; open beta.

## Stories

| | Fase | ai-sdk-del |
|---|---|---|
| F078.1 | S1 | `search()` + resultatform + Brave- og Cloudflare-adaptere + pris pr. kald |
| F078.2 | S2 | Router (sprog/formål/ZDR) som data, fallback-kæde, cache, omkostningslog til cost-sink |
| F078.3 | S3 | Tenant-BYOK og døgnloft pr. tenant |
| F078.4 | S4 | `webSearchTool` (definition Scout kan bruge) + overlevering til scout |
| F078.5 | S5 | `tavily`-adapter + migreringsnote til cms (cms gør selve migreringen) |
| F078.6 | S6 | `field`-adapter — venter på FIELD-PLAN F3 (backlog) |

## Reuse

Discovery-søgning på «web search» 9/10: ingen `@broberg/*`-pakke har søgning. CMS'ets integration er den eneste i flåden og er præcis det, planen vil erstatte. Genbruger ai-sdk's eksisterende cost-sinks, BYOK (F069), `fetch`-injektion (F073) og lazy `bun:sqlite` (som sqlite-sinken).

## Kræver Christian

- Nøgler i ai-sdk's vault: `BRAVE_API_KEY`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`. Uden dem kan adapterne kun bevises med testdata, ikke live.
- Åbne spørgsmål fra planens §11 (Ceramic direkte?, Linkup vs. Brave for dansk, kundens egen gateway, cache-levetid for grounding).

## Ikke med

- Selve Scout-værktøjet i scout-repoet og selve CMS-migreringen — de ejes af scout og cms; ai-sdk leverer byggestenene og fortæller dem det.
