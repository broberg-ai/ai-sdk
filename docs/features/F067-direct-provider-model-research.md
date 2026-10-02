# F067 — Model-research der ser alle leverandører direkte

**Bestilt af Christian 2. oktober 2026:** *«ja, sæt alle tre i gang og lav et fleet sweep efter nøgler til alle modeller for du burde jo have en nøgle til alle modeller DIREKTE så du ikke skal gå igennem OpenRouter hvilket ikke giver mening. Desuden skal jobbet køres som et buddy job så dukker det også op i cardmem under Fleet / Jobs hvilket gør at jeg kan se jobbet, pause det og stoppe og slette det og igangsætte det. … Rapporter kan du placere i Assets/Reports i det eget cardmem repo. Lav en liste over de nøgle du mangler og jeg opretter dem til dig.»*

## Hvorfor — målt 2. oktober 2026

ElevenLabs udsendte Eleven v4. Vores månedlige research (F014) kunne ikke have set det:

1. **Den spørger kun OpenRouter.** Oktober-kørslen: «462 models fetched across: openrouter. Providers skipped/failed: openai, anthropic, gemini.» Stemme, billede, video, OCR og oversættelse (ElevenLabs, fal, BFL, Azure, DeepL, Recraft) spørges aldrig — F050 melder kun prisernes alder.
2. **Fundene blev ikke læst.** Rapporterne lander som PR'er; #2 (3/9) og #3 (1/10) stod åbne og ulæste. #3 fandt tre prisfald.
3. **Den kører i GitHub Actions**, hvor Christian ikke kan se, pause eller starte den.

## Løsning

- **Direkte modellister** fra hver leverandør vi har en adapter til og en nøgle for: Anthropic, OpenAI, Gemini, Mistral, DeepSeek, ElevenLabs, fal, BFL, Azure Speech, DeepL, Recraft (hvor en liste-API findes). Nye modeller rapporteres; priser hvor API'et giver dem. Mangler nøglen, siges det i rapporten — ikke tavst sprunget over.
- **Rapport til cardmem** Assets/Reports i ai-sdk-projektet (ikke en PR), så den ses.
- **Buddy-job** (F062) i stedet for GitHub-cron: `targetSession:'ai-sdk'`, `lane:'support'`, `offSessionPolicy:'auto_launch'`, månedligt den 1. kl. 06.00 dansk tid. buddy bygger `monthlyOn` (svar 2026-10-02, #1473). Kommandoen er en skill i dette repo (`/model-research`).
- **Ingen nøgen overgang:** GitHub-cron'en bliver stående til buddy-jobbet har leveret én rapport.

## Reuse

- Planlægning: buddy `schedule_job` (F062) — genbrug, intet eget cron.
- Rapport-opbevaring: cardmem Assets/Reports — genbrug.
- Fetch: eksisterende `src/catalogue/fetchers.ts` + `scripts/research-models.ts` udvides; ingen ny pakke.
- Nøgler: cardmem Secrets Vault, én nøgle pr. leverandør i ai-sdk's eget projekt (samme princip som «One Mistral account per repo»: læsbart forbrug, lokal tilbagekaldelse).

## Nøgle-sweep — målt 2026-10-02 over 44 projekters vaults (kun metadata)

ai-sdk HAR: MISTRAL_API_KEY, OPENAI_API_KEY, OPENROUTER_API_KEY, GOOGLE_VERTEX_CREDENTIALS, RECRAFT_API_TOKEN, TYPESAFE_API_KEY (global), «Azure subscription 1» (uden env-navn — ikke en Speech-nøgle).

ai-sdk MANGLER: ANTHROPIC_API_KEY, GEMINI_API_KEY, DEEPSEEK_API_KEY, ELEVENLABS_API_KEY, FAL_KEY, BFL_API_KEY, AZURE_SPEECH_KEY (+ AZURE_SPEECH_REGION), DEEPL_API_KEY, UPMETRICS_API_KEY.

Findes i andre projekter (lånes IKKE — én nøgle pr. repo): Anthropic (buddy), ElevenLabs (cms), Gemini (trail).

## Stories

- F067.1 — Direkte modellister for alle leverandører, inkl. medie.
- F067.2 — Rapporten lander i cardmem Assets/Reports.
- F067.3 — `/model-research`-skill + buddy-job; GitHub-cron fjernes først efter første beviste kørsel.
- F067.4 — Egne direkte nøgler i ai-sdk's vault (venter på Christian).
- F067.5 — Oktober-prisfaldene ind i `pricing.ts` og udgivet; PR #2/#3 lukket.

## Ude af scope

- Automatisk ændring af tier-routing. Rapporten foreslår; et menneske/cc beslutter.
- Skrabning af prissider uden API. Mangler en pris, står det i rapporten som «kræver manuel pris».
