# F6 — Migration: absorb @webhouse/ai and onboard repos

## Role
Move every existing repo off direct provider SDK calls and onto the `@broberg/ai-sdk` facade.

## Task
Fold `@webhouse/ai` tier-wrapper into the SDK. Migrate `cms`, `trail`, `buddy`, `sanneandersen` (fal.ai image), and `xrt81` one at a time — sequence determined by the F1 inventory's migration-risk notes.

## Context
After migration, repos must only import from `@broberg/ai-sdk` — never from `@anthropic-ai/sdk`, `openai`, `@fal-ai/*`, `@ai-sdk/*`, or any other provider package directly.

**Why @webhouse/ai must be absorbed first:** several repos already depend on it. Absorbing its tier definitions into the SDK lets those repos upgrade in-place by swapping the import, not rewriting logic.

**Sequence principle:** lowest migration-risk repos first (informed by F1.4 risk notes). xrt81 and sanneandersen are likely simpler (newer, fewer call-sites). cms and trail carry more AI usage and should follow. buddy last (internal tooling, can tolerate disruption).

**Dependency:** F2 + F3 + F4 + F5 must all be at least partially complete before migration stories can land. F1 must be Done (risk notes available).

## Non-goals
- No new AI capabilities added during migration — feature parity only
- No breaking changes to the facade API during this epic
- No migration of repos outside the 5 listed

## Stories

| Story | Title |
|---|---|
| F6.1 | Absorb @webhouse/ai tier-wrapper |
| F6.2 | Migrate xrt81 |
| F6.3 | Migrate sanneandersen |
| F6.4 | Migrate cms |
| F6.5 | Migrate trail |
| F6.6 | Migrate buddy |

## Acceptance criteria
1. `@webhouse/ai` tiers reproduced in `@broberg/ai-sdk` and the old package deprecated
2. `cms`, `trail`, `buddy`, `sanneandersen`, `xrt81` each migrated — calling only the facade
3. No repo imports a provider SDK directly post-migration (grep verifiable)
4. Cost reporting verified live in at least one migrated repo via a configured sink
