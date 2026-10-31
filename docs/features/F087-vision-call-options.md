# F087 — ai.vision tager samme kaldeindstillinger som ai.chat

> Fundet 31/10 2026 under jams SVG-måling. High. Effort S.

## Summary
`ai.vision` kan ikke sætte svarlængde (`maxTokens`) eller `temperature`, som `ai.chat` kan. Derfor bliver lange svar — fx en SVG-tegning — afskåret ved udbyderens standard, hos Claude 1.024 tokens. Rettelsen sender indstillingerne videre til adapteren.

## Motivation
Målt 31/10: `ai.vision` med `override:{provider:'anthropic', model:'claude-sonnet-5-5'}` og `claude-opus-5-5` på jams 4-billeders strip returnerede præcis 1024 output-tokens og ingen afsluttet `</svg>`. `visionInputSchema` har ingen `maxTokens`, og `client.vision` sender kun `messages`, `spec` og (siden F085.5) `reasoningEffort` videre. Anthropic-adapteren bruger `max_tokens: req.maxTokens ?? 1024`. Jamai (jam) tegner SVG via `ai.vision` — på Claude ville hver tegning blive afskåret.

## Solution
Tilføj `maxTokens` og `temperature` til `visionInputSchema` (samme validering som chat) og send dem i `adapter.vision({...})`.

## Reuse
None — intern paritet mellem to kapabiliteter i ai-sdk.

## Design
None — no visual surface.

## Scope
### In scope
- `src/schema/inputs.ts` (visionInputSchema), `src/client.ts` (vision invoke), unit-test med indsprøjtet fetch, docs-linje.
### Out of scope
- `ai.video` (egen kontrakt; berøres hvis samme hul findes — tjekkes, men rettes kun hvis målt).
- Ændring af adapternes standarder.

## Stories
- **F087.1** — maxTokens + temperature gennem ai.vision.

## Acceptance criteria
Se F087.1.

## Dependencies
None.

## Rollout
Patch.

## Open Questions
None — all decisions made.

## Effort estimate
**S** — en time.
