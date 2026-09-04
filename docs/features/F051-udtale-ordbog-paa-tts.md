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

---

# F051.2 — sprogskift midt i et ord: engelsk stamme, dansk endelse

**Status:** BLOKERET på en lytning · **Meldt af:** `cms`, 4. september 2026

## ÅBENT SPØRGSMÅL — læs dette først

**Hvilken variant der bygges, afgøres af Christians ører, ikke af denne analyse.**
cms har renderet prøverne (6 ord × 3 varianter × 2 stemmer) og sendt dem som én
nummereret lydfil. Indtil dommen falder er der ingen kode at skrive, og enhver
påstand om hvad der lyder bedst er en formodning.

Det er ikke forsigtighed for forsigtighedens skyld. cms bad eksplicit om VORES dom
om hvordan da-DK-stemmernes `<lang>`-skift lyder — og hverken de eller jeg kan høre.
At svare alligevel ville have været et grønt svar fra det forkerte lag: et
kvalitetsspørgsmål besvaret af nogen der kun kan læse specifikationen.

## MÅLT LYTTEDATA — 4. september 2026

Christian har hørt `workflow` som `ˈwɜːkfloʊ` gennem da-DK-stemmerne jeppe og
christel. Hans dom, ordret: ***«ikke korrekt engelsk med et sjovt mix.»***

**En dansk neural stemme renderer engelske fonemer gennem dansk fonologi.** Symbolerne
bliver respekteret; accenten gør ikke. Resultatet er en hybrid.

To konsekvenser, og den første er allerede rettet:

1. **F051.1's egen dokumentation var misvisende og er rettet nu** (ikke når F051.2
   shipper). Typen sagde *«`ipa` says it precisely»* — sandt for et DANSK ord stemmen
   udtaler forkert, misvisende for et ENGELSK ord, hvor `ipa` netop er det felt der
   producerer hybriden. En konsument der læser «precise» ville have rakt efter `ipa`
   på præcis de ord hvor den fejler. Noten er dateret frem for formuleret som en
   tilstand: det er to bestemte stemmer på én dato, ikke en permanent egenskab ved IPA.

2. **Det svækker IPA-vejen for engelske ord og styrker sprogskiftet** — et ægte
   motorskift er den eneste mekanisme her der ikke fodrer en dansk motor med fremmede
   symboler.

**Men det AFGØR ikke varianten.** Datapunktet fjerner ét valg (IPA til engelske ord);
det siger intet om hvorvidt `<lang>` på en da-DK-stemme faktisk skifter motor rent,
eller også degraderer. Det er præcis hvad cms' 6-ords-eksperiment skal besvare, og
den dom er stadig undervejs.

## Foranledningen

F051.1 gav `ai.tts` en udtale-ordbog (alias + IPA). cms tog den i brug, og Christian
fandt straks dens grænse: *«stylet siger stylet i stedet for stajlet — alle engelske
ord skal formentligt igennem maskinen.»*

cms' egen diagnose er rigtig og former hele opgaven: **dansk tekst er fuld af
engelske låneord OG deres danske bøjninger.** En bruttoliste bliver aldrig færdig,
fordi bøjningerne eksploderer — `stylet`, `stylede`, `styling`, `loopet`,
`browseren`, `compacting`.

## Hvorfor cms' første forslag ikke er svaret — og det er ikke en kvalitets-tvivl

De foreslog en tredje post-type: `{ word, lang: "en-US" }` → adapteren pakker ordet
i `<lang xml:lang="en-US">` i SSML'en.

**Det beder den engelske motor læse *strengen*.** Kørt igennem deres egne seks ord:

| ord | hvad det er | engelsk motor læser | ønsket |
|---|---|---|---|
| `styling` | engelsk ord | «STAJ-ling» | ✅ rigtigt |
| `compacting` | engelsk ord | «kom-PAK-ting» | ✅ rigtigt |
| `stylet` | dansk bøjning | «STAJ-lit» | «stajlet» — tæt, men ikke ens |
| `stylede` | dansk bøjning | «STAJ-leed» | «STAJ-le-de» |
| `loopet` | dansk bøjning | «LOO-pet» | «LUUP-et» |
| `browseren` | dansk bøjning | «BROW-zer-en» | «BRAU-ser-en» |

**Fire af seks er ikke engelske ord.** De er en engelsk stamme med en dansk endelse,
og en engelsk motor har ingen måde at vide hvor stammen slutter. Hel-ord-`lang`
bytter altså en dansk fejllæsning for en engelsk fejllæsning af en streng der ikke
er engelsk. Nogle bliver tættere på; andre bliver værre.

cms er enige efter gennemgangen: **hel-ord-lang løser 2 af 6, ikke 4.**

## Det snit der dækker hele klassen

```xml
<lang xml:lang="en-US">style</lang>t
<lang xml:lang="en-US">browse</lang>ren
```

SSML kan skifte sprog midt i et ord. Det løser hele bøjningsklassen på én gang —
ÉN post pr. STAMME kan generere alle bøjninger hos konsumenten.

**Men hvor stammen slutter er en morfologi-beslutning, og den er cms', ikke vores.**
Det er nøjagtig den grænse de selv trak: SDK'en skal ikke mene noget om hvilke ord
der er engelske. Så formen er en, der lader dem UDTRYKKE det, ikke en hvor vi gætter:

```ts
{ word: "stylet", segments: [{ text: "style", lang: "en-US" }, { text: "t" }] }
```

## Omfang (hvis stamme/endelse vinder lytningen)

1. `Pronunciation.segments?: { text: string; lang?: string }[]` som fjerde form ved
   siden af `alias` og `ipa`.
2. `lang` valideres mod et BCP-47-mønster og escapes som attributværdi — **samme dør
   som F051.1 lukkede.** Den fælde cms overså sidst var at `alias`/`ipa` er
   attributværdier; uescapede ville ordbogen blive den injektionsvej feltet findes
   for at lukke. `lang` er den samme fælde igen.
3. **Den nuværende hverken-eller-spærre løsnes SAMTIDIG, ikke før.** I dag kaster en
   post med kun `lang` (feltet findes som `reserved`, men udsendes ikke). Løsnes
   spærren før feltet virker, bliver et `lang` tavst ignoreret — og tavst-ignoreret
   er den fejlform hele dette repo bruger mest tid på at fjerne.
4. **ElevenLabs kaster** på en `segments`-post, som den gør på `ipa` i dag. Den kan
   ikke sprogskifte midt i en ytring, og at springe posten over ville gøre en
   konsument sikker på en udtale de ikke får.

### Ikke-mål

- **Ingen indbygget engelsk-detektor, og ingen medfølgende ordliste.** Hvilke ord
  der er engelske, og hvor deres stammer slutter, er konsumentens domæne. En liste
  vi fandt på ville være en holdning forklædt som en funktion.
- **Ingen påstand om lydkvalitet uden en lytning.** Hverken i kort, commit eller
  intercom.

## Verifikation

- Markup plantet i `lang` skal komme ud **escapet**, ikke afvist stille — og en
  negativ kontrol: en gyldig BCP-47-kode må gå uændret igennem, ellers er spærren
  bare en afvisning af alt.
- En post med kun `lang` skal kaste, med ordet nævnt i beskeden.
- ElevenLabs + `segments` skal kaste, med ordet nævnt.
- Den valgte variant afprøves på **begge** stemmer (jeppe + christel) og høres af et
  menneske før udgivelse.
- **Lytningen skal også høre efter SØMMEN, ikke kun efter accenten.** Stamme/endelse
  beder motoren skifte MIDT i et ord (`<lang>style</lang>t`). Er skiftet hørbart — en
  pause, et stemmeskift, en søm — er kuren værre end sygdommen, og hel-ord-varianten
  vinder på trods af sin dårligere udtale. Et rent «lyder det engelsk?»-øre springer
  den fejl over, fordi den ikke handler om udtalen af nogen af delene.

## Reuse

Discovery-søgt 5. september 2026 på `tts`, `speech`, `pronunciation`, `ssml`.
`@broberg/speech-dictionary` (0.1.2) findes i rosteret og er navnemæssigt det
nærmeste — men den ejer en ORDLISTE, altså præcis den halvdel der er cms' domæne og
som vi udtrykkeligt ikke vil have i SDK'en. Denne opgave er SSML-renderingen og
escapingen i `ai.tts`, som kun `@broberg/ai-sdk` kan levere: den ligger i adapteren
der taler med Azure. Ingen overlapning at genbruge; ingen ny pakke at bygge.

Skulle cms senere ville dele deres stamme-ordliste med andre repoer, hører DEN hjemme
i `@broberg/speech-dictionary` — ikke her. Grænsen er den samme som i selve designet.
