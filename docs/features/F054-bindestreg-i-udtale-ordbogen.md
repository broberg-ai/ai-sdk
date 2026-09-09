# F054 — udtale-ordbogen sprang over hvert dansk sammensat ord

**Meldt af:** `cms` via `components`, 9. september 2026 · **Målt af begge, og efterprøvet her**

## Fundet

```ts
new RegExp(`(?<![\\w-])(${alternation})(?![\\w-])`, "gi")
```

Bindestregen i lookaround'en gør at en regel for `AI` **ikke** rammer `AI-agenter`. På
dansk står forkortelser oftest netop dér. cms målte i deres egne artikler: **«AI-agenter»
13 gange, «AI-native» 12, 60+ forekomster i alt** — alle læst højt som ét forvansket ord.
Christian hørte det som «HTLM» og spurgte hvorfor AI ikke også blev stavet. Den BLEV det —
bare aldrig i sammensætninger.

## cms' spørgsmål var det rigtige, og svaret er målt frem for husket

> «Er `-` i lookahead'en et VALG eller et sammenfald?»

**Et sammenfald.** Kommentaren over linjen begrunder hvorfor det ikke er `\b`:

> *«\b is defined on word characters, so it behaves wrongly around the dot in
> "broberg.ai".»*

Hele begrundelsen handler om **punktummet**. Bindestregen kom med i tegnklassen uden en
eneste linje der forsvarer den. Det er værd at sige rent ud, for det ændrer beslutningen:
vi lemper ikke noget nogen havde tænkt over, vi retter noget ingen havde.

## Prisen er målt, ikke hypotetisk — og den er derfor ikke et forbehold

components kunne måle den fordi flåden allerede kører BEGGE former:
`@broberg/speech-dictionary` bruger `(?<![\p{L}\p{N}_])…(?![\p{L}\p{N}_])`, hvor en
bindestreg ER en ordgrænse. Kørt side om side på cms' egne tilfælde:

| term | tilfælde | ai-sdk i dag | speech-dictionary |
|---|---|---|---|
| `AI` | Vi bruger AI | ✓ | ✓ |
| `AI` | 15+ **AI-agenter** | ✗ | ✓ |
| `AI` | en **AI-native** platform | ✗ | ✓ |
| `HTML` | ret **HTML-filen** | ✗ | ✓ |
| `mail` | **e-mail** | ✗ | ✓ ← prisen |
| `mail` | min **e-mail** virker | ✗ | ✓ ← prisen |

cms' egen indvending — «`e-mail` skal ikke ramme en regel for `mail`» — er altså ikke en
bekymring. Det er en korrekt forudsigelse, verificeret på en implementering der allerede
betaler prisen.

## Beslutningen: pr. række, ikke generelt

**Valget er ikke symmetrisk.** «Skal en term ramme inde i et sammensat ord?» har ikke ét
rigtigt svar — det afhænger af ordet. `AI` ja. `mail` nej. En generel lempelse tvinger ét
svar på et spørgsmål hvis rigtige svar varierer, og `@broberg/speech-dictionary` betaler
netop den pris i dag.

```ts
{ word: "AI", alias: "A I", matchInCompounds: true }
```

**Standard er `false`, altså uændret adfærd.** To grunde:

1. **En ændret standard ændrer lyden hos enhver eksisterende forbruger — i lyd, hvor
   ingen opdager det.** Der er ingen oversættelsesfejl, ingen rød prøve, ingen log. Bare
   en oplæsning der bliver forkert et sted ingen lytter efter.
2. **Den der skrev rækken ved hvad ordet er.** Ordbogen er håndskrevet pr. forbruger; den
   der taster `AI` ved at det står i sammensætninger, og den der taster `mail` ved at det
   ikke skal ramme `e-mail`.

### Ikke-mål

- **Ingen generel lempelse.** Se ovenfor — den flytter fejlen frem for at fjerne den.
- **Ingen ændring af `@broberg/speech-dictionary`.** Det er components' pakke og deres
  kald; de har selv filet et kort på deres 19 korte rettelser.

## Verifikation

- Alle seks af components' målte tilfælde som prøvedata, **begge veje**: med flaget
  rammer `AI` i `AI-agenter`; uden flaget gør den det ikke.
- **Prisen som prøve, ikke som note:** `mail` UDEN flaget må ikke ramme `e-mail`, og
  `mail` MED flaget skal — så vi kan se at flaget faktisk er det der styrer det, og at
  standarden beskytter.
- En blandet ordbog: én række med flaget og én uden i samme kald skal opføre sig
  forskelligt i samme tekst. Ellers er flaget globalt forklædt som pr. række.
- Mutation: gør flaget virkningsløst (altid `false`, altid `true`) → navngiven prøve rød
  i hver retning.

## Reuse

Discovery-søgt 9. september 2026. `@broberg/speech-dictionary` (0.1.2) ejer en ORDLISTE —
den halvdel der er forbrugerens domæne og som vi udtrykkeligt ikke vil have i SDK'en.
Denne opgave er SSML-substitutionen i `ai.tts`, som kun denne pakke kan levere: den ligger
i adapteren der taler med Azure. Ingen overlapning; ingen ny pakke.
