# F071 — Model Watch fase 1: ai-sdk's signaler

**Anledning:** Christian 7. oktober 2026: *«If a model provider changes access, retention, price, or model behavior overnight, what happens to your operations?»* Planen (ai-sdk Assets/Plans/model-watch-plan.md) lægger overvågningen hos upmetrics (deres F048) og signalerne hos ai-sdk. Christian bad upmetrics starte samme dag (#2042).

## Målt 7. oktober 2026

- **Fejlede kald sendes aldrig.** `runCapability` kalder kun cost-sinken efter et vellykket kald, og upmetrics-sinken hårdkoder `status: "success"`. Lukker en udbyder for os, ser upmetrics intet.
- **Den model der svarede registreres ikke** (undtagen Jev). `usage.model` er den model vi bad om. Flytter et `-latest`-navn, kan det ikke ses.
- **upmetrics' modtager (målt af dem, #2042):** `/api/agent` tager `status` som fri streng og `tags` som fri JSON — ingen skemaændring. Fælde: udelades `status`, lagres `success`.

## Kontrakt med upmetrics (foreslået 2026-10-07)

En række pr. forsøg, også fejlede:

| felt | værdi |
|---|---|
| `status` | `"success"` eller `"error"` |
| `model` | den model vi BAD om (stabil gruppering, prisnøgle) |
| `tags.served_model` | den model der SVAREDE, når udbyderen oplyser den |
| `tags.error_code` | HTTP-status som streng (`"401"`, `"429"`, `"503"`) eller `"timeout"` / `"network"` / `"unknown"` |
| `tags.error_kind` | `auth` (401/403) · `not_found` (404) · `rate_limit` (429) · `server` (5xx) · `timeout` · `network` · `other` |
| `cost_usd` | 0 for et fejlet forsøg |

## Løsning

- Ny valgfri metode på cost-sinken, `recordFailure`, så eksisterende sinks (sqlite, discord, budget) ikke pludselig får fejl-rækker i deres summer. upmetrics-sinken implementerer den.
- `runCapability` kalder den for hvert fejlet forsøg, også når en reserve-rute derefter lykkes. Fejl i rapporteringen må aldrig vælte kaldet.
- `usage.servedModel` sættes af adapterne fra svarets eget `model`-felt; sinken sender det som `tags.served_model`.

## Reuse

Ingen ny pakke. Udvider den eksisterende upmetrics-sink og `runCapability`. upmetrics ejer lagring, alarmer og visninger (F048).

## Stories

- F071.1 — Fejlede kald til upmetrics med status + fejlkode.
- F071.2 — Den model der svarede (`served_model`).
