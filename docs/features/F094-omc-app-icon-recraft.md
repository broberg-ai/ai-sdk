# F094 — App-ikon til ODEUM Message Center (OMC) via Recraft

> Bestilling fra `messages` 21/11 2026 (#53298, deres kort F010.5), ejerens ord: «lave et ordentligt LOGO … sende det op til Recraft som vi bruger til logoer som inspiration til et Messages ikon for OMC». Kilde til det ægte logo: pitch `H_lljVeQju1vgVpLb9GbR`, side 1.

## Leverance

- Mindst 3 forskellige forslag, kvadratiske, SVG (Recraft vector) og PNG ≥ 1024 px, uden tekst, læsbare ved 32 px, på lys og mørk baggrund.
- Må ikke kunne forveksles med Apples Beskeder-ikon (grøn taleboble).
- Pr. forslag: prompt, model/stil, pris (usage.costUsd) og licens/ophav fra Recraft.
- Filer et sted messages kan hente dem (cardmem Assets), ikke indlejret i en besked.
- Farver: accent #1F6896 / #3B97D3, baggrund #050F17.

## Fremgangsmåde

1. Hent side 1 som billede via Pitch Vault API (`/pitches/<id>/thumbnail`), nøgle fra Global Vault via fil — aldrig i kontekst. Læs logoets form og farver derfra (ikke gættet).
2. Generer gennem `@broberg/ai-sdk` (`ai.image`, override `openrouter` / `recraft/recraft-v4.1-vector`) — den eneste Recraft-generationsrute SDK'en har; et scratch-script, ikke ny SDK-kode.
3. Gennemse resultaterne visuelt (inkl. 32 px-nedskalering og lys/mørk), kassér dårlige, generer igen.
4. Upload til cardmem Assets, svar messages med links + metadata.

## Non-goals

- Ingen ny Recraft-generations-adapter i SDK'en (OpenRouter-ruten dækker). Ingen indbygning i app-pakken — det gør messages efter ejerens valg.

## Reuse

Recraft nås via den eksisterende `ai.image` + OpenRouter-rute (F070-familien) — intet nyt. Pitch Vault læses via dens eksisterende API. Filer placeres i cardmem Assets (flådens hjem for artefakter).

## Licens

Recraft: billeder genereret på betalt plan/API ejes af brugeren med kommerciel ret; via OpenRouter gælder Recrafts vilkår for API-output. Angives pr. forslag som «Recraft API-output via OpenRouter, kommerciel brug» — verificéres mod Recrafts vilkår før det skrives som fakta.
