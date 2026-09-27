# F064 — Ren tekst-til-billede i EU via BFL FLUX 2

## Hvorfor
cms (#710, F201.7 «Flyt til EU», Christians ordre 27/9) skal flytte sit `generate_image`-værktøj fra Gemini API (USA) til EU. Vores eneste EU-billedrute er BFL (`api.eu.bfl.ai`, hårdt pinnet), men `src/providers/bfl.ts` kaster medmindre kaldet har `referenceImages` eller `finetune`. Et almindeligt prompt-billede har derfor ingen EU-vej.

FLUX 2 (`flux-2-pro`, `flux-2-max`) tager prompten alene på samme `/v1/<model>` + `get_result`-flow; referencebillederne er valgfrie.

## Rettelse
I adapteren: har kaldet hverken `referenceImages` eller `finetune`, OG er modellen en `flux-2*`, sendes den samme FLUX 2-krop som referencegrenen — `prompt`, `width`/`height`, `seed`, `output_format` (default jpeg), `safety_tolerance` (default 2) — bare uden `input_image*`. Enhver anden model uden finetune kaster stadig (den finetunede model kan ikke bruges uden et finetune-id).

Kaldet fra cms:
```ts
ai.image({ prompt, override: { provider: "bfl", model: "flux-2-pro" } })
```

## Ikke ændret
- EU-pinningen (`api.eu.bfl.ai`, poll på EU-værten, aldrig den returnerede `polling_url`).
- Standard-billedruten (fal) — at skifte alles default til BFL er ejerens beslutning, ikke denne.

## Kendt, uden for scope
Udebliver BFL's `cost`, falder prisen tilbage til `flux-pro-1.1-ultra-finetuned` ($0,06, `estimated`) uanset model — også for FLUX 2 i dag. BFL returnerer normalt `cost`, så det rammer kun undtagelsen.

## Reuse
Ingen ny kapabilitet — en manglende gren i en eksisterende adapter. ai-sdk er selv billed-gatewayen; intet `@broberg/*` at genbruge.
