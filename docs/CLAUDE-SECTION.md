<!-- CANONICAL — single source of truth for the "@broberg/ai-sdk — the AI/LLM gateway (MUST)" CLAUDE.md section scaffolded into every broberg.ai repo. Owned by broberg-ai/ai-sdk; cardmem's scaffolder (F149.3) pulls this file verbatim. Update model IDs / tiers HERE, then ping cardmem to re-scaffold. -->

## @broberg/ai-sdk — the AI/LLM gateway (MUST)

**ALL LLM/AI calls in this repo go through `@broberg/ai-sdk` — never a raw Anthropic/OpenAI/Gemini/Vercel SDK or a bare `fetch` to a provider.** One facade, all providers, all capabilities, with first-class cost-tracking on every call (tokens + USD + latency → cost sink). Swap models by changing a *tier*, not your call-sites.

```ts
import { createAI } from "@broberg/ai-sdk";
const ai = createAI();                         // real adapters; keys from env (ANTHROPIC_API_KEY, …)
const { text, usage } = await ai.chat({ prompt: "Hej", tier: "smart" });
// also: ai.vision · ai.video · ai.translate · ai.image · ai.embedding · ai.transcribe · ai.ocr · ai.moderate · ai.contracts.{extract,classify,…}
```

**Route by tier, not by model-string.** Tiers → current model (overridable per call):
`fast`=claude-haiku-4-5 · `smart`=claude-sonnet-4-6 · `powerful`=claude-opus-4-8 · `cheap`=claude-haiku-4-5 via `claude -p` ($0) · `vision`=claude-sonnet-4-6 · `video`=gemini-2.5-flash-lite · `embedding`=text-embedding-3-small.

**Model-availability gate (F022, v0.11+).** Before launching/spawning on a model, gate it — a suspended tier (e.g. Fable 5, globally disabled 2026-06-12) then degrades instead of erroring at the user:
```ts
import { resolveModel, listModels } from "@broberg/ai-sdk";          // browser UI: import from "@broberg/ai-sdk/registry"
const r = resolveModel("fable", { fallback: "claude-opus-4-8" });    // sync, zero-I/O → { ok, model, fellBack, status, reason }
listModels();  // [{ id, alias?, provider, available, status, note? }] — grey out dead tiers in a picker
```

**GDPR:** for any client/personal/health data, use the EU tier — `override:{ provider:"mistral", model:"mistral-large-latest" }` (Mistral, Paris-hosted, no Schrems II). Never route personal data through US/CN models.

**Do NOT:** import a provider SDK directly · `fetch` a provider API · hardcode a model-string in app code (route by tier; pin via `override` only) · skip the SDK "just this once" · spawn/launch a model without `resolveModel`. The SDK is the single chokepoint so cost-tracking, fallback, and availability work everywhere.
