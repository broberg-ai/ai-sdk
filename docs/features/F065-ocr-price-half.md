# F065 — OCR bogføres til halv pris

## Fundet (30/9)
Mistrals mail «Action Required: Update Your Mistral AI Models» (30/9, i ai-sdk's Inbox via mailbox-watcheren på mistral.ai) siger om OCR 4.1: *«Priced at $4 per 1,000 pages, with a 50% Batch-API discount, reducing the cost to $2 per 1,000 pages.»*

Vores `src/cost/media-pricing.ts` har `mistral:ocr` = **$0,002/side = $2 pr. 1.000** — batch-prisen. Men `ai.ocr` kalder den direkte `/v1/ocr`, ikke batch. Hvert OCR-kald bogføres derfor til **halvdelen** af den faktiske pris, og forbrugernes omkostningsrapporter underrapporterer OCR med 50 %.

Målt samme dag: `mistral-ocr-latest` (vores default, `client.ts:144`) er et alias for `mistral-ocr-4-1` ifølge `GET /v1/models`, så mailens pris gælder den model vi faktisk kalder. `mistral-ocr-4-0`, som udfases 30/9, bruger vi ikke.

## Rettelse
`mistral:ocr` → $0,004/side, kilde = mailen med dato. Testen der låser 3 sider × prisen opdateres. Patch-udgivelse (0.49.3) — caret når den, og det er en ret, ikke en adfærdsændring.

## Konsekvens for forbrugere
OCR-omkostningen i deres rapporter fordobles fra 0.49.3. Det er ikke at OCR er blevet dyrere — det har altid kostet det; vi har rapporteret halvdelen.

## Reuse
Ingen ny kapabilitet — én række i pris-tabellen.
