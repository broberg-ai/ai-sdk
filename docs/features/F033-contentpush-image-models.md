# F033 — Contentpush image models: Recraft V4.1, Gemini 2.5 Flash Image, gpt-image-1

> Status: planned · Epic · Priority: high

## Why

Contentpush (Stack B, internal social-post tool) needs on-brand image generation as an alternative to a stock library: logos + brand illustrations (vector/SVG), series-consistent editing, and text-in-image for social headlines. Christian's order (relayed via intercom, confirmed directly 2026-07-03): land these as **permanent** `ai.image()` capabilities, not a one-off test. Contentpush's F003.3 and F009.3 are blocked on this landing.

Priority order: **Recraft V4.1 first** (logo generation is the concrete driving use-case), then Gemini 2.5 Flash Image, then gpt-image-1.

## Research already done (this session, web-verified 2026-07-03)

- **Recraft is at V4.1** (not V3 — V4 shipped Feb 2026, ground-up rebuild with production-grade vector/SVG generation; V4.1 followed). Variants: V4.1 / V4.1 Pro / V4.1 Vector / V4.1 Pro Vector / V4.1 Utility / V4.1 Utility Pro.
- **Route via OpenRouter, not fal.ai and not a direct Recraft key**:
  - OpenRouter Recraft V4.1 raster: **$0.035/img** (cheaper than fal's $0.04)
  - OpenRouter Recraft V4.1 Vector (SVG): **$0.08/img** (same as fal)
  - OpenRouter Recraft V4.1 Pro: $0.21/img
  - OpenRouter's unified Image API **does support SVG output** (`recraft/recraft-v4.1-vector` — confirmed via model page: "produces SVG image output"), and supports brand color palette control via `image_config.rgb_colors` / `background_rgb_color`.
  - `OPENROUTER_API_KEY` already exists in this repo's routing — zero new secret required. A direct Recraft API key (credit-based billing, no clear price advantage) is NOT needed.
- **Gemini 2.5 Flash Image ("Nano Banana") is already shipped** — F013 (done, v0.5.0+). `src/providers/gemini.ts` has a full `image()` implementation, pricing already in the table ($0.039/img). Contentpush can use this today via `ai.image({ override: { provider: "gemini", model: "gemini-2.5-flash-image" } })`. This epic just needs to confirm/document it for contentpush — no new adapter code expected.
- **gpt-image-1 is net-new work** — `src/providers/openai.ts` is text/chat-only today, zero image-generation code. Needs a new `image()` method comparable in scope to F013's gemini work (request/response shape, pricing entry, registry wiring).

## GDPR / provider policy

All three models are US-hosted (OpenRouter routes to Recraft's US infra; Gemini and OpenAI are US). Per repo convention: **brand-visuals only** — no personal data, no faces/likeness in training or prompts through these paths. Personal/health data stays on Mistral EU (text) or the BFL EU-portrait path (F023, for face/likeness image work). Flag this explicitly in docs and in contentpush's own AC (their F003.3 already locked this as a hard constraint per intercom #83).

## Cost tracking

No new mechanism needed — `client.ts`'s `report()` already funnels every capability's `usage` through `cfg.costSink.record(usage)` uniformly (verified against the existing fal.ts image path). New provider work (gpt-image-1) just needs to populate `usage.costUsd` the same way `fal.ts`/`gemini.ts` do.

## Stories

See child stories F033.1 (Recraft V4.1 via OpenRouter), F033.2 (Gemini 2.5 Flash Image — verify/document), F033.3 (gpt-image-1 — new OpenAI adapter).
