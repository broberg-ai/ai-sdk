# Seedance 2.5 (ByteDance) — undersøgelse

**Dato:** 2026-08-11 · **Anledning:** sideprojekt, bestilt af Christian
**Kort svar:** teknisk imponerende, men **må aldrig røre persondata** — og den er 3–7×
dyrere end den rute vi allerede har velsignet. Værd at have som *override*, ikke som
default.

---

## Hvad den kan (verificeret på fal's egne modelsider, 2026-08-11)

| | Seedance 2.5 | Vores nuværende (Kling 2.5 Turbo Pro) |
|---|---|---|
| Klip-længde i ét træk | **30 sek.** | ~5–10 sek. |
| Lyd | **Genereres i samme gennemløb, koster ikke ekstra** | Ingen |
| Referencer | **Op til 50** (billeder, video, lyd) | 1 startbillede |
| Styring | Første + sidste billede, kamerabevægelse | Startbillede + prompt |
| Opløsning | 480p / 720p (4K nævnt i markedsføring) | op til 1080p |

Endpoints på fal (hvor vi allerede har nøgle og adapter):
`bytedance/seedance-2.5/image-to-video` · `…/text-to-video` · `…/reference-to-video`

Den reelle nyhed er **30 sekunder uden sammenklipning**. Alt vi har i dag laver korte
klip der skal sys sammen; her kommer det ud i ét stykke med lyd der passer til billedet.

## Hvad den koster (fal's officielle takst)

Prisen er token-baseret: **$0,0214 pr. 1.000 tokens**, hvor
`tokens = højde × bredde × sekunder × 24 / 1024`.

| Klip | Seedance 720p | Seedance 480p | Kling (vores) |
|---|---|---|---|
| 8 sek. | **~$3,78** | ~$1,76 | **~$0,56** |
| 30 sek. | **~$14,19** | ~$6,62 | ikke muligt i ét træk |

Altså **~6,8× dyrere end Kling** ved 720p, ~3,1× ved 480p.

> **Uafklaret tal:** OpenRouter annoncerer "fra $0,1028/sek" for samme model — under en
> fjerdedel af fal's takst. Jeg kan ikke forklare forskellen ud fra offentlige tal
> (sandsynligvis en anden opløsning eller anden opgørelse). **Brug ikke OpenRouter-tallet
> til budgettering før nogen har målt en rigtig faktura.**

## Den vigtigste del: den må ikke få persondata

Tre uafhængige forhold, og de peger samme vej:

1. **ByteDance suspenderede selv en Seedance-funktion af privatlivshensyn.** I februar
   2026 lukkede de funktionen der lavede ansigtsfotos om til personlige stemmer.
   Producenten trak altså selv i nødbremsen på præcis den slags data.
2. **Kinesisk lovgivning gælder uanset hosting.** National Intelligence Law art. 7 og
   Cybersecurity Law art. 28 forpligter kinesiske selskaber til at bistå myndighederne
   på anmodning. Det er en strukturel betingelse, ikke et spørgsmål om
   privatlivspolitik. Modellen ligger primært på Volcano Engine (ByteDances egen sky,
   Kina); via fal er værten amerikansk — **ingen af delene er EU**.
3. **Uafklaret ophavsret.** Der er verserende konflikt mellem Hollywood og ByteDance om
   træningsdata. For materiale vi selv skal kunne stå på mod en kunde er det en åben
   risiko, ikke en løst sag.

**Konsekvens for flåden:** samme kategori som DeepSeek i vores CLAUDE.md — *kun
ikke-personhenførbart materiale.* Konkret: aldrig klubfotos, ansigter, medlemsdata
eller kundemateriale. Markedsføringsklip på eget, rettighedsklaret materiale er fint.

## Hvor den ville passe hos os

- **Passer:** contentpushs promo-klip. De vil have 30-sekunders klip med
  omgivelseslyd og *uden* tale (deres F024-direktiv siger netop "ingen dialog, kun
  ambient"). Det er præcis hvad Seedance leverer i ét gennemløb — i dag skal de sy
  flere klip sammen og lægge lyd på bagefter.
- **Passer ikke:** alt hos xrt81 (ansigter, geo, økonomi), alt klientarbejde,
  alt hvor persondata kan smutte med i et referencebillede.

**Teknisk indsats hvis vi vil have den:** lille. Den ligger på fal, som vi allerede
taler med, og `ai.animate` tager allerede `image`, `prompt`, `durationSec` og
`resolution`. Det kræver en velsignet model + rigtig pris i `FAL_VIDEO_PRICE_PER_SEC`
— samme indgreb som Kling fik i 0.23.0. Men prisen er token-baseret, ikke per sekund,
så vores nuværende pris-model (`pris/sek × varighed`) ville **regne forkert** ved andre
opløsninger. Det skal løses først, ellers logger vi misvisende omkostninger — præcis
den fejl vi brugte sidste uge på at rydde op i.

## Anbefaling

**Ikke nu, men hold den varm.** Begrundelse:

1. Ingen konkret forbruger har bedt om 30-sekunders klip endnu. At bygge det på
   forventning er præcis det spekulative arbejde vi har afvist tre gange i denne uge.
2. Prisen er reel: 8 sekunder koster $3,78 mod $0,56 i dag. Det er ikke en detalje ved
   volumen.
3. Pris-modellen (tokens frem for sekunder) kræver et lille stykke arbejde i
   cost-sporingen, ellers rapporterer vi forkerte tal.

**Udløser der ville ændre svaret:** contentpush (eller en anden) siger at de har brug
for et sammenhængende 30-sekunders klip med lyd. Så er indsatsen lille og gevinsten
konkret — og så bygger jeg det med token-korrekt prisberegning fra start.

---

### Kilder

- [Seedance 2.5 image-to-video på fal](https://fal.ai/models/bytedance/seedance-2.5/image-to-video) — endpoint, takst, parametre
- [Seedance 2.5 text-to-video på fal](https://fal.ai/models/bytedance/seedance-2.5/text-to-video) — token-formel, opløsninger
- [Seedance 2.5 på OpenRouter](https://openrouter.ai/bytedance/seedance-2.5) — det afvigende pris-tal
- [ByteDance suspenderer ansigt→stemme-funktion (TechNode, feb. 2026)](https://technode.com/2026/02/10/bytedance-suspends-seedance-2-0-feature-that-turns-facial-photos-into-personal-voices-over-potential-risks/)
- [Seedance 2.5 API live — uafklaret ophavsretsrisiko (TechTimes)](https://www.techtimes.com/articles/320683/20260716/seedance-25-api-live-bytedances-30-second-ai-video-carries-unresolved-copyright-risk.htm)
- [Native 30-sekunders video uden sammenklipning (TechTimes)](https://www.techtimes.com/articles/318975/20260624/bytedance-seedance-25-native-30-second-ai-video-no-stitching-required.htm)
