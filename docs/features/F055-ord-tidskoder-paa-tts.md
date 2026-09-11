# F055 — ord-tidskoder på `ai.tts`: highlight hvert ord mens det læses op

**Bestilt af:** `cms` for broberg.ai (F019) · **GO:** Christian, 11. september 2026
**Målt før bygget**, og målingen væltede bestillingens centrale antagelse.

## Bestillingen

broberg.ai skal have en oplæser der markerer hvert ord mens det læses. Christians ord
til cms: *«det er bare om at highlighte hvert ord mens du læser op.»* Alt andet findes —
teksten, lyden (pre-genereret, cachet pr. indholds-hash), afspilleren. Kun tidskoderne
mangler, og uden dem findes featuren ikke.

## MÅLINGEN DER ÆNDREDE DESIGNET

cms skrev, helt korrekt, at det bærende felt ikke er lyd-offset men **tekst-offset** —
koblingen tilbage til manuskriptet — og bad os bekræfte at Azures `word.json` bærer den.
De kunne ikke selv verificere det fra dokumentationssiden.

**Den bærer den ikke.** Microsofts eget eksempel på filen, ordret:

```json
[
  { "Text": "The",     "AudioOffset": 50,   "Duration": 137 },
  { "Text": "rainbow", "AudioOffset": 200,  "Duration": 350 },
  { "Text": ".",       "AudioOffset": 1700, "Duration": 100 }
]
```

**Tre felter. Ingen tekst-offset.** Havde vi bygget `words[].textOffset` efter
bestillingen, ville feltet have stået `undefined` på hver eneste post — et felt der
findes i typen og aldrig i data. Præcis den fejlform vi fjernede fra `classify` to dage
før (F052), og den grund F045.2 stadig ligger blokeret: **vi koder ikke efter en
forventet form.**

### Men featuren er ikke død — koblingen skal UDLEDES, og det hører hjemme her

Ordlisten kommer i rækkefølge. Kildeteksten kender kalderen. Så koblingen er en
sekventiel gennemgang: gå teksten og ordlisten igennem side om side. Det er
deterministisk, det er testbart uden netværk, og det er **ikke** noget fem forbrugere
skal skrive hver sin udgave af.

## DEN FÆLDE KUN VI KAN SE, og cms rammer den med sikkerhed

Azure udtaler **SSML**, ikke råtekst. Vores `pronunciations` (F051) indsætter
`<sub alias='A I'>AI</sub>` — så Azure taler «A», «I» som **to** ord, hvor manuskriptet
har **ét**. Ordlisten er altså i SPROG-rummet, ikke i manuskript-rummet.

**cms bruger begge features på den samme tekst.** En naiv gennemgang mister
synkronisering ved den første substitution.

**HVOR GALT DET SÅ GÅR, ER MÅLT — ikke påstået.** Denne plan sagde først at «hvert
eneste ord derefter markeres forkert». Det er for stærkt, og prøven
*«WITHOUT the dictionary the run is not repaired — this is what it costs»* viser hvorfor:
gennemgangen **kommer sig**. De alias-ord der ikke findes i manuskriptet ender i
`unaligned`, og det næste ord der faktisk står i teksten fanger cursoren igen. Skaden er
altså **lokal omkring hver substitution**, ikke total resten af artiklen. Det er stadig
værd at rette — en artikel med 34 udtale-poster har 34 lokale huller — men en overdreven
skade-påstand i en plan-doc er den samme fejlform som et felt der ikke findes: en
beskrivelse ingen har målt.

Det er nøjagtig den slags vi ejer: vi bygger SSML'en, så vi ved hvor hver substitution
faldt og hvad den erstattede. En forbruger der får rå Azure-data kan ikke vide det.

**Og det første design var forkert — vores egen probe fandt det.** En flad
`spokenToSource`-tabel lod aliassets «i» sluge det NÆSTE ægte danske ord «i» i
«broberg.ai i dag». Danske alias-dele ER almindelige danske ord. Derfor forbruges en
substitution som et **RUN**, længste alias først, og kun når kilde-ordet genuint ligger
foran cursoren.

## Omfang

**F055.1 — `alignWordTimings(text, words)`** — ren funktion, ingen netværk. Går
kildeteksten og Azures ordliste igennem sammen og producerer
`{ text, startMs, endMs, sourceStart, sourceEnd }`. Den **navngiver hvad den ikke kunne
placere** frem for at gætte — samme disciplin som `rerank.unscored` (F052): et ord uden
plads i kilden hører i `unaligned`, ikke i listen med et opdigtet offset.

**F055.2 — batch-ruten hos Azure.** `submit → poll → hent ZIP → læs word.json`.
Realtids-endpointet vi bruger i dag returnerer KUN lyd; ordgrænser findes kun på
batch-API'et (`properties.wordBoundaryEnabled`). Det er en anden kaldsform, ikke et
ekstra felt.

### Ikke-mål

- **Intet `textOffset` fra Azure.** Det findes ikke; vi udleder det eller siger det ikke.
- **Ingen Speech-SDK-afhængighed.** Batch er REST.
- **Ingen ændring af den eksisterende `ai.tts`-rute.** Uden det nye felt går kaldet
  præcis som i dag, til realtids-endpointet.

## Verifikation — og hvad der IKKE kan verificeres her

**F055.1 kan bevises fuldt ud** og gør det: ren tekstbehandling, ingen nøgle nødvendig.
Fælderne har hver sin prøve — tegnsætning som egen post, gentagne ord, `<sub>`-desync,
et ord der slet ikke findes i kilden. To mutationer kørt: `unaligned` altid tom → 2 røde
prøver; gennemgangen søger fra 0 hver gang → 3 røde. Begge på præcis de navngivne prøver.

**F055.2 kan IKKE live-verificeres i dette repo.** Der er ingen Azure-nøgle i `.env`
og ingen i projektets vault (målt: Recraft, Mistral, OpenAI, Vertex, OpenRouter — ingen
Azure). Koden skrives mod Microsofts dokumenterede form og **mærkes eksplicit som
ikke-runtime-verificeret**, både i plan-doc'en, i kortet og til cms. cms har nøglen —
de kører `ai.tts` i drift i dag — så den første ægte kørsel er deres, og den er et
acceptkriterium frem for en antagelse. **F055.2's sidste AC står bevidst ukrydset** og
må ikke krydses på vores egen læsning af Microsofts dokumentation.

ZIP-læseren er derimod bevist offline: prøven bygger selv arkiverne med `zlib`, både
deflated (word.json) og stored (lyd), med præfiks-kollision og ukendt
komprimeringsmetode. Et manglende entry giver `undefined`; en krop der ikke er et ZIP
KASTER og navngiver hvad den er — en HTML-fejlside fra en udløbet SAS-URL må aldrig
læses som «ingen ordgrænser».

## Reuse

Discovery-søgt 11. september 2026 på `tts`, `word timing`, `speech`, `alignment`.
`@broberg/speech-dictionary` ejer en ordliste — et andet problem. Ingen `@broberg/*`
ejer tale-syntese eller tidskodning; det er denne pakkes eget domæne, og det er netop
grunden til at cms IKKE byggede Azure-kaldet direkte hos sig selv.
