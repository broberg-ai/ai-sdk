# F051 — Udtale-ordbog på `ai.tts`

**Status:** planlagt · **Prioritet:** høj · **Ejerens GO:** Christian, 5. september 2026 (filet af `cms`)

## Hvorfor

En dansk stemme udtaler engelske fagord forkert. Målt af cms i aften på da-DK
(jeppe/christel):

| ord | hvad stemmen siger | hvad den skal sige |
|---|---|---|
| `AI` | ordet «aj» | «A I» |
| `broberg.ai` | mangles | — |
| `webhook` | kan ikke siges | — |
| `native` | «nativ» | «nejtiv» |

De kører i dag **lydord** som bro: teksten forvanskes FØR tts (`native` → «nejtiv»).
Det virker, og det ødelægger teksten alle andre steder den genbruges — samme streng
renderes også på skærmen. Christians formål, ordret: *«en ordbog der gør at vores stemme
bare bliver bedre og bedre jo flere faldgruber jeg fanger den i».

## Formen

```ts
ai.tts({
  text, voice,
  pronunciations: [
    { word: "AI",         alias: "A I" },
    { word: "native",     ipa: "ˈneɪtɪv" },
    { word: "broberg.ai", alias: "broberg dot A I" },
  ],
})
```

- **Azure** → SSML: `<sub alias="…">ord</sub>` (alias) eller
  `<phoneme alphabet="ipa" ph="…">ord</phoneme>` (ipa).
- **ElevenLabs** → ren tekst-substitution af `alias`; den har ingen SSML. En regel med
  KUN `ipa` kan den ikke udføre — se nedenfor.

## Den bærende sikkerhedsbeslutning, og den er cms'

**Substitutionen sker ADAPTER-SIDE, EFTER `xmlEscape`.** Vores escaping er værnet mod
SSML-injektion: en `<` i `text` bliver til `&lt;` og kan ikke bryde konvolutten. Skete
udskiftningen før escaping, ville de indsatte tags blive escapet væk; skete den på
tekstfeltet, ville tekstfeltet blive en vej ind i SSML. **`pronunciations` er den
kontrollerede dør** — og døren skal selv være lukket:

> **`alias` og `ipa` skal også XML-escapes.** cms nævnte det ikke, og det er den
> åbenlyse måde at bygge dette forkert på: de er ATTRIBUT-værdier, så en uescapet
> `alias: '" onload="'` ville gøre ordbogen til præcis den injektionsvej feltet findes
> for at undgå. Et værn der kun dækker den ene af to indgange er ikke et værn.

## Fire fælder i selve udskiftningen

1. **LÆNGSTE ORD FØRST, ÉN gennemgang.** `AI` og `broberg.ai` overlapper. Sekventielle
   `replace`-kald ville lade den første regel æde den anden — og værre: en senere regel
   kunne matche inde i markup den første lige har indsat (`alias`, `sub`, `ph` er
   almindelige ord). Én alternation-regex, sorteret længste først.
2. **Helords-match uden `\b`.** `\b` opfører sig forkert omkring punktummer.
   `(?<![\w-])…(?![\w-])` i stedet, så `broberg.ai` matcher som helhed og `AI` ikke
   rammer inde i `SAID`.
3. **Søgeordet skal escapes som teksten.** Teksten er allerede escapet når vi søger i
   den, så et ord med `&` skal søges som `&amp;` — ellers matcher det aldrig.
4. **Både `alias` OG `ipa` på samme regel afvises.** At vælge én i stilhed er den
   succes-formede ikke-besked dette repo har brugt to døgn på at fjerne.

## Ikke-mål

- **Ingen hosted lexicon (`<lexicon uri=…>`).** cms tilbød det som alternativ og
  foretrækker selv per-kald-feltet. Et hosted leksikon kræver en URL vi skal hoste og
  versionere; det løser et problem ingen har endnu.
- **Ingen indbygget standard-ordbog.** Hvilke ord der udtales forkert afhænger af stemme,
  sprog og branche. En ordbog vi finder på, ville være en mening forklædt som en
  funktion.

## Verifikation

- Escaping bevist i BEGGE døre: en `<` i `text` OG en `"` i `alias` må ikke nå ud som
  markup. Mutations-bevist ved at fjerne escapingen af `alias`.
- Overlap bevist på cms' egne cases: `broberg.ai` og `AI` i samme streng, hvor det
  LÆNGSTE skal vinde.
- ElevenLabs: alias substitueres, og en regel med kun `ipa` må IKKE tie — den kan ikke
  udføres der, og et stille frafald er den fejlform vi lige har fjernet i F049.
- Negativ kontrol: uden `pronunciations` er den udsendte SSML byte-identisk med i dag.
