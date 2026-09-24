# F062 — CI-jobs uden tidsgrænse

## Fundet
cms (#643, på Christians CI-ordre): et job uden `timeout-minutes` får GitHubs standard på 360 min. Hænger det, bliver det ikke rødt før efter 6 timer.

Målt hos os 24/9 (seneste 8 kørsler pr. workflow, længste job):

| workflow | længste job | timeout i dag |
|---|---|---|
| publish.yml | 26 s | ingen (360 min) |
| research-models.yml | 22 s | ingen |
| upmetrics-dedup-smoke.yml | 7 s | ingen |

Ingen af dem har `concurrency`, så en hængende kørsel spærrer ikke de næste — den værste konsekvens hos os er en udgivelse der ser ud til at køre i 6 timer i stedet for at fejle.

## Rettelse
`timeout-minutes: 10` på hvert job. Det er langt over cms' tommelfingerregel (~3× målt max ≈ 1-2 min), bevidst: publish.yml bygger + tester + udgiver, og npm-registret kan være langsomt; en grundænse der rammer en rask udgivelse er værre end en der fanger en hængende lidt senere. 10 min er stadig 36× hurtigere end i dag.

## Reuse
Ingen kapabilitet — CI-konfiguration. Intet `@broberg/*` at genbruge; `@broberg/deploy-core` er Fly-specifikt og ai-sdk har ingen Fly-app.
