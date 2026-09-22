# F060 — Vores classify-prompt laver afvisninger om til selvsikre forkerte svar

**Målt af trail, 22. september 2026**, på min forespørgsel. 444 golden-eksempler,
mistral-small-latest, temperatur 0, nul kaldfejl. Trail commit `52aa8f3`, deres
plan-doc F286 afsnit 14.

## Fundet

Vores prompt i `src/capabilities/contracts/index.ts:143`:

> *«You are a zero-shot classifier. **Choose exactly one label** from the provided
> list. Return ONLY JSON: {"label": "<one of the labels>", "confidence": <0..1>}.»*

Den giver ikke modellen lov til at sige «ingen af dem». Trail tog de **38 eksempler**
hvor deres egen prompt — som inviterer `{"label": null}` — fik modellen til at afvise,
og kørte dem gennem vores:

```
                               rigtige   FORKERTE i menuen   afvist
vores prompt (0.48.0 ordret)       4             34              0
deres prompt uden afvisnings-
  sætningen                        3             35              0
```

**34 af 38 afvisninger blev til et selvsikkert forkert svar inde i menuen.** Ikke én
afvisning overlevede.

Pr. opgave (afvist → rigtig / afvist → forkert), vores prompt:

```
routing     0 / 22
edge-type   1 / 10
admit       3 /  2    ← den eneste hvor presset hjalp
```

## Hvorfor det er værre end «et tomt felt»

**1. Det er præcis den fejlform F052 skulle lukke, genindført af prompten.** F052
(v0.42.0) fjernede faldet til `labels[0]`, så «modellen valgte den første» og
«modellen kunne ikke svare» ikke længere var samme værdi. Men prompten presser
modellen til at vælge SELV — så i praksis kommer `null` sjældent, og et
uklassificerbart input ender stadig som en rigtig-udseende etiket. Rettelsen i koden
blev delvist ophævet af teksten i prompten.

**2. Det aggregerede tal skjuler det.** Samlet træfsikkerhed gik fra 43,0 til 44,6 %
under vores prompt — det ligner en forbedring. Det er en omrokering: 10 forkerte blev
rigtige, 7 rigtige blev forkerte, på andre eksempler. **De 34 nye fejl inde i menuen
er usynlige i ethvert aggregat.** Kun et join pr. eksempel mod facit ser dem.

**3. Det gør F059's `outcome: "out-of-set"` korrekt men tomt.** Feltet kan kun fyre
når modellen tør svare uden for menuen, og vores prompt forbyder det.

**4. Confidence-feltet er irrelevant her.** Trail isolerede de to akser: fjerner man
KUN afvisnings-sætningen fra deres prompt, kommer der næsten samme tal (35 mod 34).
Det er invitationen til at afvise der gør forskellen.

## Hvem det rammer — og hvad jeg IKKE har kunnet se

**helpdesk.** Vores egne noter (F052, F052.2 i `types.ts` og `index.ts`) siger at
helpdesk kører `classify` på rigtige kundesager og **styrer et autonomi-niveau ud fra
`label`**. En sag modellen reelt ikke kunne placere, får i dag et selvsikkert
intent — og dermed et autonomi-niveau — uden at noget siger fra.

**Ikke verificeret herfra:** helpdesk er ikke tjekket ud på denne maskine, så jeg har
ikke set deres kald eller hvordan de håndterer `null`. Lokal søgning over de 14
tjekkede repoer fandt nul kald til `classify` — det er et udsagn om denne maskine,
ikke om flåden.

**Og tallene gælder mistral-small-latest på trails seks opgaver.** Andre modeller
eller etiketsæt kan opføre sig anderledes. Andelen af afvisninger hos helpdesk
kendes ikke.

## Mulighederne

| | hvad | konsekvens |
|---|---|---|
| **A** | Invitér afvisning i standard-prompten: *«If none of the labels fit, return {"label": null}»* | Ærlig standard. `null` går fra sjælden til almindelig — trails data: ~8,5 %. Kaldere der behandlede `null` som en kant-sag, ser den nu ofte |
| **B** | Opt-in-flag der slår afvisning til | Ingen brudflade — men så får enhver der ikke kender flaget den UÆRLIGE prompt. Ærlighed som opt-in er bagvendt |
| **C** | Lad være | 34 af 38 afvisninger bliver fortsat til selvsikre forkerte svar, uden spor |

## Anbefaling: A — men IKKE uden ejerens ord, og IKKE før helpdesk ved det

A er rigtig: en klassificering der ikke må sige «ved ikke», fabrikerer svar. Men det
ændrer hvad en produktionsforbruger får på rigtige kundesager, og det er en
produktbeslutning, ikke en fejlretning jeg tager alene:

1. Christian beslutter.
2. helpdesk får besked FØR udgivelsen, med tallene — de skal kunne se hvor mange af
   deres sager der går fra et selvsikkert intent til «uklassificeret».
3. Udgives som minor (under 1.0.0 er caret patch-only, så ingen får det automatisk).

## Reuse (F217 — obligatorisk)

Ingen ny kapabilitet — en ændring af tekst i en eksisterende. Discovery-tjekket for
F059 (22/9, `zero-shot classification`) gælder: intet `@broberg/*` klassificerer
tekst. **BYG / RET i eget repo.**

## AC (hvis A vælges)

1. Standard-prompten inviterer eksplicit `{"label": null}` når ingen etiket passer.
2. En test låser prompt-teksten, så en «forenkling» der fjerner afvisnings-sætningen
   går rød.
3. `outcome: "out-of-set"` fyrer når modellen svarer `{"label": null}` — testet.
4. helpdesk har fået besked MED tallene før udgivelsen, og har svaret.
5. Udgivelsesnoten siger: `label: null` bliver markant hyppigere, og hvorfor det er
   rigtigt.
6. Genmåling på trails 444 med den nye prompt, så vi ser tallet i stedet for at antage det.
