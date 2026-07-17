# F035 — fal image `extra`/params passthrough + bless fal-recraft price

> **Status: BACKLOG — deliberately not built (nothing-speculative).** No concrete
> consumer today. Build both parts the moment a fal-only consumer needs recraft or
> other fal knobs.

## Problem

Surfaced by a happy-little-place gap report (via components, intercom 17937/17939).
They needed Recraft SVG logos; that use-case was solved 100% via the **OpenRouter**
route (`ai.image({ override:{ provider:'openrouter', model:'recraft/recraft-v4.1-vector' }})`
→ real SVG + ground-truth cost), so the **fal** route was NOT built. But two genuine
fal-adapter gaps remain:

1. **No provider-knob passthrough.** The fal adapter's `image()` body only carries
   `{ prompt, image_size, loras }`. Everything else a fal model accepts —
   `negative_prompt`, `guidance_scale`, `style` (e.g. `style:"vector_illustration"`
   for real Recraft SVG), `num_images`, … — cannot be set. Releasing a named field
   per knob does not scale.
2. **Un-priced fal override models report $0.** A fal override model with no entry in
   `FAL_IMAGE_PRICE_ESTIMATE` yields `usage.costUsd = 0` — misleading cost telemetry
   (and directly against the fleet's "ALT skal trackes" invariant).

## Solution (when triggered)

1. Add a generic `extra?: Record<string, unknown>` to `ai.image` that **shallow-merges**
   into the provider body (provider-agnostic — future-proofs new knobs without a
   release-per-field). Consumer's own proposal.
2. If/when we bless `fal-ai/recraft/v4.1/text-to-image`, add its real price
   (~$0.04–0.08/img, **verify against fal** before committing the number) to
   `FAL_IMAGE_PRICE_ESTIMATE` so `costUsd` is non-zero.

## Non-goals

- Do NOT build speculatively — no consumer needs the fal route today (OpenRouter
  covers recraft-SVG). This card exists so the analysis is not lost, per the
  ALDRIG-fake-plan rule.
- No change to the OpenRouter image route (it already returns real SVG + real cost).

## Trigger

A fal-only consumer (has `FAL_KEY`, no OpenRouter) that needs recraft or other
fal-specific image knobs.

## Reuse

This IS the shared image primitive (`@broberg/ai-sdk` `ai.image`); the `extra` knob
is a generic provider-passthrough that benefits every future fal model. No external
package to reuse — extend this one.

_Origin: requested by the ai-sdk session via buddy (its cardmem MCP was down this
session); captured on its behalf._
