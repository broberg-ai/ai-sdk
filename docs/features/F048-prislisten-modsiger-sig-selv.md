# F048 — Prislisten modsiger sig selv

**Status:** planlagt · **Prioritet:** kritisk · **Meldt af:** `upmetrics`, 3. september 2026

## Hvad upmetrics meldte, og hvad målingen fandt i stedet

De rapporterede at 12 af 29 (provider, model)-par er ukendte, med `claude-haiku-4-5-20251001`
øverst: **19.456 kald, 68 mio. tokens.** Det er sandt at opslaget fejler. Grunden er ikke
at modellen mangler.

```
getModelPrice("claude-haiku-4-5-20251001")   → undefined
getModelPrice("claude-haiku-4-5")            → $0,80 / $4,00   (curated)
getModelPrice("anthropic/claude-haiku-4.5")  → $1,00 / $5,00   (curated)
```

**To ting, og den anden er værre end den første.**

### 1. Det daterede id resolver ikke — i det ENE af to opslag

`getPrice(provider, model)` — den INTERNE omkostningssti, som `usage.costUsd` bruger —
stripper allerede en efterstillet `-YYYYMMDD` og slår basen op. Den rettelse hedder F012,
og kommentaren ved siden af siger hvorfor: *«et rigtigt betalt kald må aldrig logges som
$0»*.

`getModelPrice(modelId)` — det EKSPORTEREDE katalog, som upmetrics og ethvert andet repo
slår op i — gør det ikke.

Samme repo, samme problem, to opslag, og kun det ene fik rettelsen. Ugens gennemgående
form, denne gang med to års mellemrum mellem instans og klasse.

### 2. Samme model står til to forskellige priser, og den lætteste at ramme er forkert

Anthropics offentliggjorte takst for Haiku 4.5 er **$1,00 / $5,00** (bekræftet mod
`claude-api`-skillets modeltabel, ikke husket). Vores to rækker:

| id | pris | rigtig? |
|---|---|---|
| `anthropic:claude-haiku-4-5` | $0,80 / $4,00 | **NEJ** |
| `openrouter:anthropic/claude-haiku-4.5` | $1,00 / $5,00 | ja |

En forbruger får altså et svar der afhænger af hvilken stavemåde de tilfældigvis bruger,
og den korteste, mest oplagte form er **20 % for lav**. På upmetrics' 68 mio. tokens er
det ikke en afrunding.

Det er husets egen «én kilde pr. værdi»-regel brudt inde i selve prislisten.

## Omfang

1. **Ret haiku-prisen** til $1,00 / $5,00, og få de to rækker til at kunne sammenlignes
   frem for at leve hver for sig.
2. **`getModelPrice` skal kende daterede id'er**, som `getPrice` allerede gør — og reglen
   skal ligge ÉT sted, ikke kopieres til det andet opslag.
3. **Tilføj `pixtral-large-latest`** (mistral, 6 kald) — ægte token-model, genuint fravende.
4. **En vagt der finder NÆSTE selvmodsigelse**: to rækker for samme model til forskellige
   priser skal gøre suiten rød, ikke opdages af en forbruger om et halvt år.

### Ikke-mål (upmetrics' spørgsmål 2, besvaret her)

**Billede, video og tale hører i prislisten — de er bare ikke der endnu.** Det er en
mangel, ikke en grænse, og beviset ligger i vores egen kode: `falAdapter` bærer
`pricePerImage` og `pricePerSecond`, `bflAdapter` bærer `pricePerImage`, og begge skriver
et rigtigt `usage.costUsd`. SDK'en **kender** de priser på kaldstidspunktet; katalogets
`unit`-felt findes for netop den skelnen og har kun nogensinde indeholdt
`per_1m_tokens`.

Så svaret til upmetrics er: mærk dem `unpriced`, ikke `outside scope`. Selve udvidelsen
(`per_image`, `per_second`, `per_character`) får sit eget F-nummer — den ændrer
`ModelPrice`-formen og berører enhver forbruger, og den skal ikke smugles ind i en
prisrettelse.

## Verifikation

- Haiku-prisen bekræftes mod en autoritativ kilde og ikke mod hukommelsen; den kilde
  navngives i rækken.
- Det daterede opslag prøves på det RIGTIGE id fra upmetrics' måling
  (`claude-haiku-4-5-20251001`), ikke på et konstrueret eksempel.
- Selvmodsigelses-vagten skal være RØD på træet FØR rettelsen — ellers beviser den kun
  at den kan være grøn.
- Negativ kontrol: en model der findes ÉN gang må ikke flages.
