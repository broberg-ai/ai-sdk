# F056 — hvor VILLE en tier lande? En prognose, ikke en spærre

**Foreslået af:** `helpdesk` 11. september 2026 · **GO:** Christian, 12. september 2026
**Skarpere indvending fra:** `components`, og den former returtypen mere end forslaget gør.

## Hvad det IKKE er

**Det er ikke `euOnly`.** Christian afviste 11. september en EU-spærre i pakken, med den
begrundelse at residens hører hos den enkelte forbruger i dialog med ham. Den afvisning
står. Dette kort bygger det modsatte af en spærre: **en oplysning der gør forbrugerens
egen beslutning mulig.** helpdesk sagde det selv, uopfordret: en spærre i pakken ville
blokere legitimt US/CN-arbejde og give falsk tryghed, fordi pakken ikke kan vide hvad der
er persondata i et fremmed repo.

## Målingen der motiverer det (helpdesk, mod 0.44.0)

```
listModels() felter:  id alias provider available status note source
poster med et region-felt:  0 af 11

tier        provider   regionOfProvider
smart       mistral    unknown
vision      mistral    unknown
video       gemini     us
embedding   openai     us
```

**Man kan bevise at en rute er US. Man kan ikke bevise at den er EU — før kaldet.**
`unknown` for mistral er rigtigt og bevidst: adapteren tager en `baseUrl`, så navnet
«mistral» kan være en gateway hvor som helst. Udledningen virker derfor kun i den retning
der ikke betyder noget.

`usage.region` (F042) løser det EFTER kaldet og bruges allerede. Den kan bare ikke svare
på «må jeg sende det her» — kun på «hvor endte det».

**Prisen, målt og ikke påstået:** hver forbruger med et EU-løfte vedligeholder sin egen
håndholdte kopi af vores tier-tabel. helpdesk' hedder `NON_EU_CAPABILITIES`, er rigtig i
dag, og har ingen mekanisme der siger til når den holder op med at passe.

**Og præcedensen er vores egen:** F030 flyttede `smart`/`powerful`/`vision` til Mistral, og
både dokumentationen og `resolveModel('smart')` sagde Claude i ~3 måneder bagefter. Kunne
kopien INDE i pakken drive så længe, driver en kopi i et fremmed repo også.

## DEN MÅLING DER AFGØR DESIGNET — og den lå hvor helpdesk ikke kunne se den

De standard-værter en prognose skal læse, ligger **hardkodet inde i hver adapter-fabrik**:

```
src/providers/mistral.ts:30   config.baseUrl ?? "https://api.mistral.ai/v1"
src/providers/openai.ts:19    config.baseUrl ?? "https://api.openai.com/v1"
src/providers/gemini.ts:98    config.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta"
```

Der er **ingen fælles tabel**. Så den nemme udgave af forslaget — en liste over tier → vært
inde i prognosen — ville være en **anden kopi** af de samme URL'er, flyttet fra helpdesk'
repo ind i vores, hvor de havde endnu mindre grund til at kigge efter den. helpdesk'
egen reaktion på målingen: *«havde I bygget den nemme udgave, ville jeg have slettet min
liste og troet at kopien var væk — mens den bare var flyttet. Det havde været værre end i
dag, fordi jeg ville have stolet på den.»*

**Derfor er én kilde til standard-værten en forudsætning, ikke en oprydning.**

## OG EN ANDEN MÅLING, som ingen af os havde: ikke alle værter ER faste

```
fast standard-vært    anthropic deepinfra deepseek elevenlabs gemini mistral openai openrouter bfl
VÆRT UDLEDT AF CONFIG azure (region/resource) · vertex (region) · deepl (free/paid) · requesty (eu/non-eu) · fal (flere værter)
```

En flad «standard-vært pr. provider»-tabel ville altså være **forkert** for fem providere —
og forkert i den grønne retning, fordi den ville svare noget frem for at sige at den ikke
kan. For netop `requesty` findes både en EU- og en ikke-EU-vært, så et gæt dér ville være
en residens-påstand truffet af en tabel.

De tre tier-providere (mistral, gemini, openai) er alle faste, så **det spørgsmål helpdesk
faktisk stillede, kan besvares ordentligt.** De config-afhængige skal navngives som sådan.

## Omfang

**F056.1 — én kilde til standard-værten.** `DEFAULT_BASE_URLS` læses af både adapteren og
prognosen. En prøve forbyder FORMEN `baseUrl ?? "https://…"` i en adapter, så en ny
provider ikke kan indføre en niende kopi uden at porten går rød.

**F056.2 — prognosen.** Svarer for en tier, udledt af den vært SDK'en selv ville bruge.

### Formen, og den er components' fortjeneste

> *«En svar-FØR-kaldet og et faktum-EFTER-kaldet er to forskellige påstande, og faren er at
> de LIGNER ét felt.»* — *«en prognose der kan tage fejl, må ikke have form som et faktum
> der ikke kan.»*

Derfor:

- **Navnet siger at det er betinget.** `wouldRouteTo`, ikke `region`. Et felt der hedder
  `region` ved siden af `usage.region` er to ting med samme navn og forskellig
  sandhedsværdi — præcis den fejlform F055 har handlet om.
- **Forudsætningerne returneres SAMMEN med svaret**, ikke i dokumentationen. Svaret gælder
  kun hvis du ikke overstyrer `baseUrl` og ikke giver en fallback. **En fallback ER en
  rute**, og ruten afgør residens.
- **`unknown` skal kunne komme ud og må aldrig kunne læses som sikkert.** Kun `"eu"` er en
  positiv påstand — pakkens egen invariant siden F042.

### Ikke-mål

- **Ingen spærre, intet `euOnly`, ingen kast.** Funktionen returnerer; den nægter intet.
- **Ingen påstand om en `baseUrl` kalderen selv har sat.** Vi kan ikke vide hvor deres
  gateway sender videre hen, og et svar der lod som om ville være en påstand i en kontrols
  kostüme.
- **Ingen ændring af `usage.region`.** Den er faktummet og røres ikke.

## Verifikation

Alt kan bevises offline — ingen netværkskald, ingen nøgler. Den bærende prøve er
**drift-porten**: en scanner der forbyder formen, ikke navnene. Præcedens i dette repo
(F046.4): en scanner efter en defekts FORM fandt 10 flere tilfælde end et grep efter de 4
kendte navne.

Mutationerne skal vise begge retninger: at prognosen følger adapteren når den ændres, og
at den ikke bare gentager en tabel der tilfældigvis er enig med den i dag.

## Reuse

Discovery-søgt 12. september 2026 på `region`, `residency`, `gdpr`, `baseUrl`. Ingen
`@broberg/*` ejer residens-udledning; `regionOfHost`/`classifyRegionName` er denne pakkes
egne og allerede eksporterede (F043.8). Dette kort tilføjer ingen ny residens-logik — det
åbner en dør til den der findes, og fjerner grunden til at et fremmed repo skriver sin
egen.
