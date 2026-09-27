# F063 — Recraft V4.1 Pro / Pro Vector

## Hvorfor
kai (#702, Christians ordre 27/9) skal lave logo-forslag med Recraft V4.1 Pro Vector. Ruten virker allerede: `override:{provider:"openrouter", model:"recraft/recraft-v4.1-pro-vector"}` sendes ordret til OpenRouter `/images`, og prisen læses fra svarets `usage.cost`. Men `MEDIA_PRICING` kender kun `recraft-v4.1` og `-vector`. Udebliver `usage.cost`, bliver et pro-kald i dag bogført til **$0** (`openrouter.ts:95`, `?? 0`).

## Priser — målt 27/9 fra `openrouter.ai/api/v1/models?output_modalities=image`
OpenRouter prissætter Recraft pr. image-token. De eksisterende rækker er omregnet med 4175 tokens/billede (0,035 / 8,383e-6 = 4175,0; 0,08 / 1,916e-5 = 4175,0). Samme faktor:

| slug | image_token | × 4175 |
|---|---|---|
| recraft/recraft-v4.1-pro-vector | 7,186e-5 | **$0,30** |
| recraft/recraft-v4.1-pro | 5,030e-5 | **$0,21** |

## Rettelse
- To rækker i `src/cost/media-pricing.ts` med kilden og faktoren skrevet ind.
- README-linjen om vector nævner pro-vector som «højere detalje til komplekse vektorer», med prisen.
- Minor-udgivelse ikke nødvendig: ren tilføjelse af pris-rækker → patch 0.49.1.

## Uden for scope (nævnt, ikke rettet)
`?? 0` i `openrouter.ts:95` fabrikerer et nul for enhver ukendt slug uden `usage.cost`, stik imod `getMediaPrice`'s egen kontrakt («never a fabricated 0»). Eget kort hvis ejeren vil.

## Reuse
Ingen ny kapabilitet — pris-rækker i den eksisterende tabel. Intet `@broberg/*` at genbruge; ai-sdk er selv LLM-gatewayen.
