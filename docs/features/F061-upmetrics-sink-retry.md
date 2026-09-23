# F061 — Den officielle omkostnings-sink smider et forbrug væk når afsendelsen fejler

**Fra upmetrics 8. september 2026, med Christians GO til retry.** Lå ulæst i agent-
indbakken i 15 dage, fordi ingen ai-sdk-session kørte da det blev skrevet. Fundet
ved orienteringen 22/9; Christian gentog GO 23/9.

## Fejlen

`src/cost/sinks/upmetrics.ts` — den KANONISKE sink, auto-wiret fra env i hver
forbruger (F034):

```ts
const res = await doFetch(url, { method: "POST", … });
if (!res.ok) { config.onError?.(new Error(`… returned ${res.status} …`)); }
} catch (err) { config.onError?.(err); }
```

Ét forsøg. Ingen genforsøg, ingen kø. Fejler POST'en, er stemplet væk, og det
eneste spor er et valgfrit `onError`-hook som trail havde koblet til en
`console.warn`. Trails formulering er hele begrundelsen: *et tal der mangler, ser
ud som et tal der ikke skulle være der.*

Samme fejlform som F057.1 (sqlite-sinken der døde lydløst) — bare i den sink hele
flåden faktisk bruger.

## Designets bærende begrænsning: genforsøg MÅ IKKE forsinke AI-kaldet

`src/client.ts:339` — `await report(res.usage)` ligger på kaldets sti. **Hvert
AI-kald venter på sinken før det returnerer.** Et genforsøg med backoff inde i
`record()` ville derfor lægge sekunder oven i brugerens AI-kald, præcis når
upmetrics har det dårligt. Uacceptabelt.

Derfor:
- `record()` gør **ét** øjeblikkeligt forsøg — samme ventetid som i dag når
  upmetrics er rask.
- Fejler det forbigående, lægges det i en **baggrundskø** og `record()` returnerer.
- Køen drænes af en timer der er `unref()`'et, så den ALDRIG holder en proces i live.

## Klassificeringen — lånt fra upmetrics, inklusive deres fejl

| svar | behandling | hvorfor |
|---|---|---|
| netværksfejl (fetch kaster) | genforsøg | forbigående |
| **408** | genforsøg | request timeout — forbigående |
| **429** | genforsøg | upmetrics' ingest svarer 429 ved sit rullende minut-loft. Forbigående per konstruktion, og udløses under en BYGE — altså præcis når stemplerne betyder mest |
| 5xx | genforsøg | serveren |
| øvrige 4xx | **IKKE** — tælles som afvist | modtageren har sagt nej; et nyt forsøg ændrer intet |

upmetrics' egen første udgave skrev `status >= 500` og ville have kasseret netop
den flod af 429 retry blev bygget til. **Fejlen blev fundet af et Discovery-tjek,
ikke af en prøve** — prøverne var grønne, fordi de afprøvede den regel de selv
havde skrevet. Derfor pinnes undtagelsen fra BEGGE sider (se AC).

## Sikkerhedsbetingelsen — og den er en egenskab ved KONFIGURATIONEN

Genforsøg er kun sikkert hvis **denne sinks modtager** deduplikerer. Ikke «hvis
upmetrics deduplikerer» — `baseUrl` kan peges andre steder hen (`UPMETRICS_BASE_URL`),
og dér er dedup ikke bevist. Et genforsøg bytter så et tab for en dobbelttælling.

- Hver nyttelast bærer `tags.idempotencyKey` — stabil på tværs af genforsøg af
  samme forbrug, unik per forbrug. Også på FØRSTE forsøg: et første forsøg kan nå
  serveren og miste svaret, og så skal genforsøget dedupliceres mod det.
- upmetrics deduplikerer på netop `tags.idempotencyKey` siden 8/9 (live, bevist af
  dem: to leveringer af samme nyttelast → én række).
- `retry: false` slår det fra for en modtager der ikke deduplikerer. Standarden er
  TIL, fordi den kanoniske modtager deduplikerer og det er hele pointen.
- Ingen navnebaseret vagt («retry kun hvis baseUrl er upmetrics.org») — en udbyder
  der tager en `baseUrl` kan ikke få sin opførsel afgjort af sit navn. Samme
  princip som `regionOfHost` mod `regionOfProvider`.

## Tæl det der opgives

`stats()` → `{ sent, retried, dropped, rejected, queued }`. Forskellen på «vi tabte
ingenting» og «vi ved ikke om vi tabte noget». Med trails forbehold: tælleren lever
i processen og nulstilles ved udrulning — et nul er et udsagn om oppetid, ikke om
historik.

## Loftet er ikke til forhandling

Køen har et loft (30, som upmetrics). En ubegrænset kø i en proces der ikke kan nå
sin server ER en hukommelseslækage der venter på et udfald. Ved overløb smides den
ÆLDSTE — talt som `dropped`.

## Korte processer

En `unref()`'et timer holder ikke processen i live, så i et script eller en
serverless-funktion kan køede stempler gå tabt ved exit. `flush()` forsøger alt i
køen én gang, nu. En kalder i en kortlivet proces skal kalde den før exit.

## Reuse (F217 — obligatorisk)

Discovery 23/9, `?q=retry backoff`: der findes **ingen** fælles retry/transport-
primitiv. Den ligger indlejret i `@broberg/sms`, `@broberg/chat` (og
`lens-client`, `cron`). **Beslutning: BYG lokalt**, fordi der intet er at forbruge.
Det bliver endnu en indlejret kopi — det meldes til components, som ejer beslutningen
om at samle dem. upmetrics har ikke målt hvor mange forbrugere en fælles primitiv
ville få, og det har vi heller ikke.

## AC

1. Et forbigående svar (netværksfejl, 408, 429, 5xx) lægges i køen og lykkes ved
   genforsøg — testet mod den RIGTIGE sende-sti med indsprøjtet fetch, ikke en
   separat sink med sin egen tæller (trails fælde).
2. Et permanent svar (400, 401, 403, 404, 422) genforsøges IKKE og tælles som `rejected`.
3. **Undtagelsen pinnes fra begge sider:** mutation «for snæver» (429/408 fjernet)
   → rød; mutation «for bred» (`>= 400` genforsøges) → rød.
4. `record()` venter ALDRIG på et genforsøg: et kald mod en nede-modtager returnerer
   efter ét forsøg — målt, ikke antaget.
5. Hver nyttelast bærer `tags.idempotencyKey`, identisk på tværs af genforsøg af samme
   forbrug og forskellig mellem forbrug; en forbruger-label kan ikke overskrive den.
6. Køen har loft 30; overløb smider den ældste og tæller den som `dropped`.
7. `stats()` tæller sent / retried / dropped / rejected / queued korrekt.
8. `retry: false` giver præcis dagens adfærd: ét forsøg, intet i kø.
9. Timeren holder ikke processen i live (`unref`), og `flush()` dræner køen.
10. F3.3 står: ingen sink-fejl vælter et AI-kald — den eksisterende test grøn.
