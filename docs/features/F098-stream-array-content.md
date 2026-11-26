# F098 — chatStream taber tekst når delta.content er en liste

> Meldt af cardmem 26/11 2026 (#55404): `chatStream` mod `mistral-large-latest` (mistral-large-4-0) giver « app in arn.» hvor `chat` giver «Fly hosts the app in arn.»; med maxTokens 30 ingen tekst. På prod mistede et svar sit første ord.

## Målt årsag (rå SSE fra api.mistral.ai, 26/11)

Mistral Large 4 ræsonnerer (ai-sdk sender `reasoning_effort: low`). I streamen kommer `delta.content` som en LISTE: først `[{type:"thinking", thinking:[…]}]`-bidder, så en overgangsbid `[{type:"text", text:"Fly hosts"}]`, og først derefter almindelige streng-deltas (« the app in arn», «.»). Stream-parseren i `openai-compatible.ts` læste kun `typeof delta.content === "string"` og smed liste-bidderne væk — også tekstdelen. Ikke-stream `chat` bruger allerede `contentToText()`, som henter `text`-dele og springer `thinking` over; derfor var `chat` korrekt.

## Rettelse

Stream-parseren bruger samme `contentToText()` på hver delta: tekst-dele yields, thinking-dele ignoreres (som i `chat`). Gælder alle OpenAI-kompatible adaptere (Mistral, OpenRouter, DeepSeek, DeepInfra …).

## Non-goals

Ingen eksponering af thinking-tekst i streamen (samme adfærd som `chat`).

## Reuse

Genbruger den eksisterende `contentToText()`; ingen ny afhængighed.

## Rollout

Test med optaget SSE-form → live-repro mod Mistral → patch-release → svar cardmem med version.
