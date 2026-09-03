# F046 — Prislisten: tre grønne kørsler, nul leverancer

**Status:** planlagt · **Prioritet:** høj · **Ejerens ordre:** Christian, 3. september 2026

## Hvad der faktisk skete

Christian sagde «du skulle gerne køre et fast job der gør dette ikke sandt ;)». Jobbet
findes, og det har kørt hver eneste måned. **Målt i kørselshistorikken:**

| dato | resultat | leverede |
|---|---|---|
| 1. juli | success | intet |
| 1. august | success | intet |
| 1. september | success | intet |

Tre grønne kørsler. Nul opdateringer. **Og jobbet gjorde intet forkert** — det byggede
inventaret, så at der var ændringer, og pushede en gren hver gang:

```
refs/heads/model-research/2026-07-01
refs/heads/model-research/2026-08-01
refs/heads/model-research/2026-09-01
```

De ligger der stadig. Ingen af dem blev til en PR, fordi `gh pr create` afvises af
organisationens politik (Actions må ikke oprette pull requests). Workflowet fanger den
fejl og skriver en `::notice::` med et link — **og exit'er 0.**

```yaml
gh pr create ... || {
  echo "::notice::PR auto-create blocked by org policy. Branch pushed — open a PR:"
  ...
}
```

En `::notice::` i en **grøn** kørsel er usynlig. Ingen fik besked, tre måneder i træk.
Det er ugens gennemgående fejlform, denne gang i vores egen automatisering: **en
fejl der rapporterer succes.**

## Hvorfor det koster noget

Priserne driver hurtigt. Målt på en genopbygning 3. september mod inventaret fra 27.
august — **én uge:**

- **34 prisændringer** ud af 402 fælles modeller
- **23 nye modeller**, **15 forsvundne**
- `google/gemini-3.7-flash` **fordoblede** sin pris (0,375 → 0,75 ind)
- `meta-llama/llama-3.3-70b-instruct` faldt fra 0,71 til 0,10 ind

En liste der er en uge gammel er altså ikke «næsten rigtig». Og fordi `@broberg/ai-sdk`
er flotillens eneste prisautoritet, er det de tal ethvert budget, ethvert modelvalg og
enhver omkostningsrapport i flotillen hviler på.

## Den anden halvdel: tidsstemplet svarer på et andet spørgsmål end nogen tror

`pricingGeneratedAt()` er i dag inventarets `generatedAt`. Workflowet kaster bevidst en
ren tidsstempel-opdatering væk (`git checkout inventory.json`) når intet substantielt
ændrede sig. Konsekvensen:

> **`generatedAt` betyder «hvornår ændrede tallene sig sidst» — ikke «hvornår
> kontrollerede vi dem sidst».** Enhver læser tager det som det andet.

En liste der er efterset i går og ikke havde ændringer ser derfor **identisk ud** med en
ingen har kigget på siden juni. En «forstår-35-dage»-advarsel bygget på `generatedAt`
ville altså fyre på en fuldstændig aktuel liste — en falsk alarm der lærer folk at
ignorere advarslen.

Mønsteret findes allerede i dette repo og løser netop dette: stemme-registret (F037)
udstiller `checkedAt` pr. udbyder ved siden af dataene, og dets egen ADR siger hvorfor
— *«at opfinde en friskere dato er den løgn checkedAt findes for at forhindre»*.

## Omfang

1. **Opdatér priserne nu** (ejerens direkte ordre) — genopbygget inventar committes.
2. **Gør jobbets fejl SYNLIG.** Kan den ikke aflevere, skal kørslen være **rød**. En
   grøn kørsel skal betyde «der ligger en PR», ikke «jeg forsøgte».
3. **To datoer, ikke én.** `checkedAt` opdateres ved HVER kørsel, også uden ændringer;
   `generatedAt` bliver ved med at betyde «hvornår ændrede data sig».
4. **Advarslen ejeren bad om**, målt på `checkedAt` — aldrig på `generatedAt`.

### Ikke-mål

- **Vi auto-merger ikke priser.** Workflowets egen kommentar siger «we PROPOSE, never
  auto-merge pricing», og det er stadig rigtigt: en pris der ændrer sig af sig selv i
  produktionen er ikke en forbedring.
- **Ingen ny cron.** Den månedlige kadence er ejerens beslutning og står fast.

## Åbent — og det er ejerens valg, ikke vores

Organisationens politik blokerer Actions for at oprette PR'er. To veje:

- **A:** Slå «Allow GitHub Actions to create and approve pull requests» til. Kræver
  Christian i GitHub-indstillingerne; vi kan ikke gøre det.
- **B:** Lad jobbet committe direkte til `main`. Kræver ingen indstilling, men opgiver
  «vi foreslår, vi flytter ikke selv» — og det var en bevidst beslutning.

Indtil han vælger, gør vi det tredje: **fejl højlydt**, så en manglende PR ikke kan
gå ubemærket hen tre måneder i træk igen.

## Verifikation

- Advarslen skal kunne fyre OG tie: en test med en frisk `checkedAt` må ikke advare, og
  en gammel skal. En advarsel der altid fyrer er lige så ubrugelig som en der aldrig gør.
- Mutations-bevis: byt `checkedAt` ud med `generatedAt` i friskhedsudregningen, og en
  test skal gå rød og NAVNGIVE forskellen — det er hele pointen med de to felter.
- Advarslen skal skrives **én gang pr. proces**, ikke pr. opslag. Et bibliotek der
  støjer i hver løkke bliver slukket, og så er vi tilbage ved tavshed.
