# F079 — Video i EU: FLUX 3 Video og FLUX 3 Image via BFL's EU-endpoint

**Ordre:** Christian 20/10 2026: «Ja, spørg BFL om FLUX 3 findes i EU og vi skal HELT KLART kunne lave videoer vi får brug for det».
**Udløst af:** OpenRouter-mail 16/10 om FLUX 3 Image Klein / FLUX 3 Video / Video Upscale.

## Open questions (afgøres i F079.1, før kode)

1. **Pris pr. sekund på BFL direkte er ukendt.** OpenRouter oplyser 4K text/image→video $0.41/s; BFL's egen prisside er ikke målt. Måles med `/v1/credits` før/efter ét 5-sekunders `hd`-klip (credits à $0.01). Indtil da: ingen pris i tabellen = ingen route (budget-gaten må ikke se $0).
2. **Version-pin.** BFL's `version` defaulter til `latest` (flydende). Flådereglen (D-385d97, 0.56.0) er daterede id'er. Findes der en dateret tag? Hvis ikke: send intet `version`, markér ruten `floating` og kræv `allowFloating` — samme kontrakt som `-latest`.
3. **API-form for tekst→video.** `ai.animate` tager i dag et påkrævet `image`. Forslag: gør `image` valgfri; uden billede → `mode:'t2v'`, med → `mode:'i2v'` (keyframes). Adaptere der kræver billede (fal, gemini, vertex) kaster en klar fejl. Alternativ: ny `ai.generateVideo`. Valg: den mindste ændring (valgfri `image`), medmindre testen viser at fejlbeskeden ikke kan gøres klar.

## Målt 20/10 2026 (api.eu.bfl.ai, tomme POST-kroppe → $0)

| endpoint | svar |
|---|---|
| `/v1/flux-3-video` | 422 — `mode` påkrævet: `t2v`, `i2v`, `v2v`, `draft_enhance` |
| `/v1/flux-3-image` | 422 — `prompt` påkrævet |
| `/v1/flux-3-image-klein` | 422 — `prompt` påkrævet |
| `/v1/flux-3`, `/v1/flux-3-image-pro`, `/v1/flux-video-upscale` | 404 |

`openapi.json` (offentlig) lister desuden `/v1/flux-tools/video-upscale-v1` og `/v1/flux-tools/video-edit-v1`.

FLUX 3 Video-felter (t2v/i2v): `prompt`, `mode`, `aspect_ratio` (auto), `duration` 5–20 s eller `auto`, `resolution` hd|fhd|qhd|uhd, `generate_audio` (default **true**), `safety_tolerance` 0–7, `draft`, `version` (default `latest`), i2v: `keyframes` 1–10 billeder (URL eller base64).

## Hvorfor

- Ejeren vil kunne lave video. I dag kan SDK'en kun billede→video (`ai.animate`: gemini/Veo US som default, vertex/Veo EU, fal US) — **ingen tekst→video**, og ingen video med lyd i EU.
- BFL's EU-endpoint er allerede vores EU-billedrute (F023, hard-pinned `api.eu.bfl.ai`, samme `BFL_API_KEY`). Samme dør giver nu video — ingen ny leverandør, ingen ny DPA.

## Scope

- **F079.1** — `bflAdapter.animate()`: FLUX 3 Video `i2v` + `t2v` mod `api.eu.bfl.ai`, polling via `get_result`, bytes downloadet (som Veo), `usage.region = 'eu'`, pris fra credits. Live-smoke: ét 5 s `hd`-klip, pris målt.
- **F079.2** — `ai.animate` uden `image` → tekst→video (kun på ruter der kan); klar fejl ellers.
- **F079.3** — FLUX 3 Image + Klein på `ai.image({override:{provider:'bfl', model:'flux-3-image'|'flux-3-image-klein'}})`, priser målt.
- **F079.4** — README/API.md + Discovery-note (dateret måling).

**Non-goals:** default-ruten for `animate`/`image` ændres IKKE (EU er opt-in via override — ejeren har afvist stille default-skift); ingen OpenRouter-video (`/api/v1/videos`) — US/ukendt region; ingen v2v, draft_enhance, upscale eller video-edit i denne runde (næste F-nummer hvis efterspurgt).

## Arkitektur-skitse

```ts
await ai.animate({ prompt: "...", durationSec: 5, resolution: "hd",
  override: { provider: "bfl", model: "flux-3-video" } });          // t2v
await ai.animate({ image, prompt, override: { provider: "bfl", model: "flux-3-video" } }); // i2v
```

Adapteren: POST `/v1/flux-3-video` → `{id, polling_url}` → poll indtil `Ready` → download `result.sample` (kort-levet signeret URL → vi returnerer `bytes`). Polling-URL'en skal også være EU-vært; en ikke-EU polling-URL afvises (samme vagt som billedruten).

`generate_audio`: SDK'ens animate-default er «ingen lyd» (F024, Christian). Vi sender `generate_audio:false` medmindre kalderen beder om lyd — én regel for alle animate-ruter.

## Reuse

Discovery: ingen anden `@broberg/*`-pakke laver video; `@broberg/ai-sdk` ER flådens AI-dør, og BFL-adapteren findes allerede her (F023). Udvid den — ingen ny pakke, ingen rå BFL-kald i apps.

## Afhængigheder

- `BFL_API_KEY` (findes i ai-sdk-vault) og credits på kontoen (`/v1/credits`).
- F024 (animate-kontrakt), F023 (BFL EU-pin), F045 (animate-docs = adfærd).

## Rollout

Minor-release (ny valgfri adfærd + type-ændring `image?`). Default-ruter uændret. Discovery får en dateret note: «målt 20/10 2026: EU tekst→video og billede→video findes via bfl/flux-3-video».
