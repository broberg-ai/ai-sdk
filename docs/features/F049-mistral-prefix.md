# F049 — Mistral `prefix`: lag to på sproglåsen

**Status:** planlagt · **Prioritet:** medium · **Anmodet af:** `vn-leker`, 3. september 2026

## Baggrund

vn-leker skal bygge en kundeassistent der skriver til danske, norske og svenske kunder.
Vi målte for dem at et eksplicit sprogkrav i systemprompten holder — **5/15 forkerte uden
lås, 0/15 med** — og de byggede deres plan på det. Så fandt de et lag mere, og de fandt
det ved at læse vores UDGIVNE `.d.ts` frem for vores beskrivelse af den.

**Verificeret i begge ender før noget blev besluttet:**

| påstand | målt hvor | resultat |
|---|---|---|
| vores pakke har intet `prefix` | `src/types.ts`, `src/schema/inputs.ts`, `openai-compatible.ts` | bekræftet — alle otte træffere på ordet handler om **prompt-cache-prefikset**, et andet begreb med samme navn |
| Mistral har `prefix: true` på en afsluttende assistant-besked | docs.mistral.ai/guides/prefix | bekræftet: `{"role":"assistant", "content":prefix, "prefix":True}` |
| «Language Adherence» er en erklæret use case | samme | bekræftet — sidens titel navngiver den først |
| prefikset returneres og skal klippes af | samme | bekræftet: deres eget eksempel er `content[len(prefix):]` |
| system + prefix anbefales SAMMEN | samme | bekræftet: «the best solution is to use both» |

## Hvorfor det er værd at have i pakken

Det er **ikke** et alternativ til den lås vi målte — Mistral siger selv at prefix alene
giver «noisy and unpredictable answers». Det er lag to: systemprompten beder om et sprog,
prefikset **starter svaret i det**. Det er den eneste mekanisme der kan tvinge det første
ord, og sproglækagen vi målte begyndte hver gang i første ord («Tak for din
henvendelse»).

Og der findes **ingen `language`- eller `locale`-parameter** på Mistrals chat-endpoint.
Sproget kan kun styres gennem indhold. Det gør prefix til det sidste værktøj der findes,
ikke til et bekvemt et.

## De to fælder vn-leker navngav, og som er hele designet

### 1. Prefikset kommer MED i svaret

Gør pakken ikke noget, får hver eneste kunde en indledning som «Her er svaret på norsk
bokmål:» øverst i sin mail. Deres formulering er den rigtige: **det er en fejl der ser ud
som en formatering og ikke som en bug** — ingen fejler, ingen logger noget, og teksten
ligner noget nogen har skrevet med vilje.

### 2. Feltet sidder på en BESKED, ikke på kaldet

Det kan ikke være en top-level option. `messages[]` skal bære flaget, og valideringen skal
kun tillade det på den SIDSTE besked når den er `assistant`. På en tidligere besked er
adfærden udefineret hos Mistral — altså skal vi afvise det, ikke sende det videre.

### 3. Den fælde de ikke nævnte: alle ANDRE udbydere

`prefix` er Mistral-specifikt. Vores `openai-compatible`-adapter betjener også openai,
deepseek, openrouter og requesty. Sendes feltet dertil, bliver det enten afvist eller
**stille ignoreret** — og den anden mulighed er den farlige: kaldet lykkes, sproget er
ikke tvunget, og forbrugeren tror det er. Vi skal **afvise** frem for at droppe.

## Omfang

1. `Message` får `prefix?: boolean`, og skemaet tillader det.
2. Validering: kun på den sidste besked, kun når `role === "assistant"`. Alt andet kaster
   med en besked der navngiver reglen.
3. Kun mod en udbyder der forstår det. En anden udbyder + `prefix` = en fejl, aldrig et
   stille frafald.
4. Svaret får prefikset **klippet af** før det når forbrugeren — både i `chat` og i
   `chatStream`. Streaming er den svære: prefikset ankommer som de første deltaer.

### Ikke-mål

- **Vi bygger ikke en sprog-abstraktion.** `prefix` er et råt felt med et dokumenteret
  formål; en `language: "no"`-option ville skjule at det er en prompt-teknik og ikke en
  garanti.
- **Vi sætter ikke et prefiks automatisk.** Hvad der skal stå i det er forbrugerens — og
  Mistrals eget råd er at det skal parres med en systemprompt de også selv skriver.

## Verifikation

- Et **ægte kald** til mistral-large med prefix, og svaret læst: sproget skal være tvunget
  OG prefikset skal være væk af det vi returnerer.
- Streaming måles separat. En prefiks-strip der kun virker på `chat` er halvdelen, og
  chat-UI'er streamer — det er samme halvdel vi missede på prompt-cachen indtil 0.35.
- Negativ kontrol: uden prefix skal svaret være uændret (ingen utilsigtet afklipning).
- En anden udbyder + prefix skal KASTE, bevist med en test der ville være grøn hvis vi
  bare droppede feltet.
