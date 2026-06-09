---
# Machine-readable header — the Research Adapter worker reads this to ROUTE + PRE-FILTER
# (same "YAML tokens + prose" spirit as buddy's). The prose below is what THIS repo's
# cc session reads when it receives a research task, so it can judge fit fast.
slug: ai-sdk
name: "@broberg/ai-sdk — unified AI/LLM SDK (one facade, all providers, cost on every call)"
stack: [typescript, esm, bun, zod, tsup, npm-oidc]
research_interests:
  - llm-models-and-pricing        # new models on OpenRouter, price cuts, frontier vs cheap
  - llm-provider-apis             # anthropic/openai/gemini/mistral/deepinfra/openrouter/fal/elevenlabs/deepseek
  - llm-cost-optimization         # cheap-model routing, batch (50%), prompt-caching, long-context economics
  - multimodal-capabilities       # vision, video, image-gen, LoRA, audio (transcribe/tts), OCR
  - tool-use-and-structured-output
  - gdpr-eu-model-hosting         # Schrems II, data residency, EU-hosted models
  - model-selection-and-routing   # tiers, advisor, inventory
  - streaming-chat                # SSE, agentic per-turn loops
not_interested:
  - frontend-marketing-design     # sanneandersen / cms territory
  - cms-content-modelling
  - agent-frameworks-and-ides     # Codex / Cursor product surfaces — we are a LIBRARY, not an agent host
  - hardware-quantum-infra
  - e-commerce-payments
landing_path: docs/research/
---

# @broberg/ai-sdk — Research Target

> You (ai-sdk's cc session) just received a **research task**: an article aimed at ai-sdk.
> Read this to orient WITHOUT spending startup tokens, then judge the article against the SDK
> and land your research per "How to land your research" below.

## What I am
A thin **TypeScript/ESM library** published to npm as `@broberg/ai-sdk`: ONE facade (`createAI()`) over every LLM provider and capability, with **first-class cost control on every call**. I am the fleet's *mandatory* AI layer — all of Christian's repos route AI through me, never raw provider SDKs. I am also the fleet's **model-selection authority** (`inventory.json` + the Model Advisor).

## What I do
- **One facade:** `ai.chat / chatStream / vision / video / translate / image / trainStyle / embedding / transcribe / ocr / moderate / podcast / tts` + `contracts.{mockup,design,extract,classify,rerank}`.
- **Routing:** a tier-map (`fast|smart|powerful|cheap|vision|embedding|video`) → `(provider, model, transport)`, plus per-call `override` + ordered `fallback` chains.
- **Cost:** every call returns `usage.costUsd`; pluggable cost sinks (upmetrics canonical) + `BudgetGuard` + per-call attribution `labels`.
- **Model inventory + Advisor:** monthly OpenRouter catalogue research → `inventory.json` → `recommendModel()` (GDPR-gated by default).

## Stack
TypeScript · ESM · **Bun** for dev/test but **Node-safe** for consumers · **Zod** at every public boundary · **tsup** build · npm publish via **OIDC trusted publishing**. Only one runtime dep (`zod`). Transports: global `fetch` (http) + `claude -p` subprocess (Max-plan $0).

## Key concepts (where an idea would plug in)
- **Capability pattern:** `runCapability({ primary, fallback, capability, estIn, estOut, invoke })`; a new capability = an optional `ProviderAdapter` method + a facade method.
- **ProviderAdapter registry:** each provider implements only what it supports (chat/vision/image/embedding/ocr/moderate/dialogue/tts/batch…).
- **Cost models:** per-token (pricing table), per-image, per-page (OCR), per-minute (transcribe), per-char (TTS), ×0.5 (batch).
- **Tier-map + Model Advisor** (`inventory.json`) + **GDPR routing** (Mistral / EU-hosted for personal data).

## Research interests — judge the article against THESE
New LLM models & pricing (esp. on **OpenRouter** — price cuts, new frontier/cheap models, EU-hosted) · provider API capabilities & quirks (Anthropic/OpenAI/Gemini/Mistral/fal/ElevenLabs/DeepSeek) · **LLM cost optimization** (cheap-model routing, batch, prompt-caching, long-context economics) · **multimodal** (vision/video/image-gen/LoRA/audio/OCR) · tool-use & structured output (function calling, JSON mode) · **GDPR/EU model hosting** (Schrems II, data residency) · model selection & routing.
**NOT relevant:** frontend/marketing design, CMS, e-commerce, agent-framework/IDE product surfaces (Codex/Cursor — we are a library, not an agent host), hardware/quantum — route those elsewhere.

## Current focus (timely research lands best here)
- **Post-15-June cost migration:** cheaper models replacing `claude -p` across the fleet (DeepSeek V4-Flash for review screens, Mistral-small for high-volume), proven head-to-head before adoption.
- **Keeping `inventory.json` + the Model Advisor fresh** as the model landscape churns monthly (new frontier/cheap models, price cuts).
- **Mistral as the GDPR/EU provider** for personal data; closing capability gaps (batch, OCR, Voxtral, moderation).
- **New multimodal capabilities** as providers ship them (latest: fal LoRA style-training F021).

## Hard constraints (any adopted idea MUST respect these)
- **All AI in the fleet goes through this SDK** — never raw provider SDKs; *extend* the SDK rather than bypass it.
- **Personal/client data → Mistral** (EU/Paris, no Schrems II); never a US/CN model for persondata.
- Every paid call must report a **non-zero `usage.costUsd`** (never silently $0).
- **Zero new heavy deps** (only `zod`); stay **Node-safe** (no static bun-only imports leaking to Node consumers).
- **Never claim something works without proof** — live-verify, or say "offline-verified only".
- **Releases via the OIDC publish workflow** (bump → tag → CI); never `npm publish` by hand.

## How to land your research
Write `docs/research/<slug>.md` in THIS repo via the cardmem landing tool. The doc must answer:
1. **TL;DR** — the article in 2–3 lines.
2. **Relevance to ai-sdk** — which capability / provider / concept above it touches + fit strength (high / med / low) and why.
3. **Adaptation** — concretely how it could land in the SDK (a new provider adapter? a new capability? a pricing/inventory update? a routing change?), respecting the Hard constraints.
4. **Next step** — a suggested F-number card / experiment (or "file-and-forget" if low fit). This is the SDLC hand-off into the board.
