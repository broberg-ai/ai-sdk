# F053 — en forbruger ledte efter `usage.region`, fandt den ikke, og byggede den forkerte vagt

**Meldt af:** `helpdesk` via `components`, 9. september 2026 · **Målt:** i vores egen README

## Fundet, målt frem for gættet

```
grep -c 'usage.region|regionOfHost' README.md   →  0    (af 142 linjer)
```

components gættede at feltet stod «længere nede end en forbruger kigger». Det er værre:
**det står slet ikke.** `usage.region` har eksisteret siden 0.36.0, er ikke engang
valgfrit, og nævnes ikke ét sted i pakkens README.

**Og åbningen gør det aktivt vildledende**, ikke bare tavst:

> «Every call returns a `Usage` (tokens, cost, latency, transport)»

Fire felter, opremset. En opremsning læses som udtømmende — så en forbruger der leder
efter residens får ikke «det står et andet sted», de får **«det findes ikke»**. Det er
en påstand, ikke en udeladelse.

## Hvad det kostede, konkret

helpdesk fulgte reuse-reglen præcis som den er skrevet: de ville ikke hånd-rulle noget,
de ledte efter evnen i pakken, de fandt den ikke, og de byggede en lokal allowlist over
`(udbyder, model)`-par håndhævet på svarets `usage`.

**Det er præcis den navnebaserede vagt vores egen `.d.ts` advarer imod med versaler** —
og præcis den fejl vi selv fandt og lukkede i 0.36.0, da navnetabellen lavede en falsk
EU-påstand i det modul der var skrevet for at forhindre falske EU-påstande.

Deres vagt har derfor hullet: en gateway foran Mistral hedder stadig `mistral` /
`mistral-large-latest`, matcher begge felter, og passerer. Målt her:

```
regionOfHost("https://api.mistral.ai/v1")            → "eu"
regionOfHost("https://gateway.example.com/mistral")  → "unknown"    ← hullet
regionOfHost("https://api.openai.com/v1")            → "us"
```

**De gjorde intet forkert.** De ledte og fandt ikke. Fejlen er vores, og den er i
dokumentationen — ikke i koden, som har været rigtig i seks minor-versioner.

## Omfang

1. **Ret opremsningen i åbningen** så den ikke længere udelukker `region` ved at
   opregne fire felter som om de var alle.
2. **Et kort residens-afsnit HØJT OPPE** — ikke som en fodnote — med de tre ting en
   forbruger skal vide for ikke at bygge helpdesks vagt: læs `usage.region` bagefter,
   `regionOfHost` før, og **byg aldrig på `regionOfProvider`**.
3. **Kun `"eu"` er en positiv påstand.** `region !== "us"` er ikke et EU-tjek — det
   består hvert eneste OpenRouter-kald.

### Ikke-mål

- **Ingen kodeændring.** Koden er rigtig; det er vejen dertil der er lang. En rettelse i
  koden her ville være en ændring uden en defekt bag.
- **Ingen omskrivning af README'en i øvrigt.** Kun det der skjulte residens.

## Verifikation

- `grep` efter `usage.region` og `regionOfHost` i README'ens **første 40 linjer** skal
  give træffere — en prøve, ikke et engangs-grep, for det er nøjagtig den kontrol der
  ellers rådner.
- **Negativ kontrol:** prøven skal kunne fejle. Fjern afsnittet igen → rød.
- Advarslen mod `regionOfProvider` skal stå i README'en OG blive stående på funktionen.

## Reuse

Discovery-søgt 9. september 2026. Dette er dokumentation af vores egen pakkes eget API —
der findes intet `@broberg/*` at genbruge, og intet at bygge til andre.
