# F5 — Capability layer: vision, translate, image, embedding + prompt-contract caps

## Role
Expose high-level, provider-agnostic capabilities that callers use directly — never a raw provider call.

## Task
Implement `vision`, `translate`, `image` (fal.ai primary), and `embedding` capabilities, then layer the prompt-contract capabilities (`mockup`, `design`, `extract`, `classify`, `rerank`) on top of `chat`/`vision` with Zod output schemas.

## Context
**Prompt contracts** (mockup, design, extract, classify, rerank) are CPM-style structured calls: a fixed prompt template + a Zod output schema. They go through `chat` or `vision`, so budgeting and cost tracking apply uniformly — they are not special-cased.

**fal.ai image generation** uses the async queue API (`queue.fal.run`): submit → poll for completion (or receive webhook) → return URL. This is different from the sync pattern other capabilities use.

**Default tiers:**
- `vision` → `vision` tier (Anthropic Claude with vision)
- `translate` → `fast` tier
- `image` → fal.ai (no tier map; fal uses its own routing)
- `embedding` → `embedding` tier (OpenAI text-embedding-3-small)

## Non-goals
- No streaming in v1
- No fine-tuned model calls
- Webhook handling for fal.ai is optional in v1 — polling is sufficient

## Stories

| Story | Title |
|---|---|
| F5.1 | vision capability |
| F5.2 | translate capability |
| F5.3 | image capability + fal.ai adapter |
| F5.4 | embedding capability |
| F5.5 | Prompt-contract capabilities (mockup, design, extract, classify, rerank) |

## Acceptance criteria
1. `vision`, `translate`, `image`, `embedding` capabilities callable with sensible default tiers
2. `image` capability handles fal.ai async queue (poll-based completion)
3. `mockup`, `design`, `extract`, `classify`, `rerank` ship as prompt contracts with Zod output schemas
4. Each capability picks an overridable default tier (except `image` which routes to fal.ai)
