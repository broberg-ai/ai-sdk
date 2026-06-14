# @broberg/ai-sdk

One AI/LLM SDK — one facade, all providers, all capabilities, with **first-class
cost control on every call**.

A provider-agnostic facade: your code calls `ai.chat()`, `ai.vision()`,
`ai.image()` — never a provider SDK directly. Swap providers by changing a tier,
not your call-sites. Every call returns a `Usage` (tokens, cost, latency,
transport) and can fan that out to any cost sink.

```bash
bun add @broberg/ai-sdk   # or: npm i @broberg/ai-sdk
```

## Quick start

```ts
import { createAI } from "@broberg/ai-sdk";

const ai = createAI(); // real adapters, keys from env (ANTHROPIC_API_KEY, …)

const { text, usage } = await ai.chat({ prompt: "Say hi in Danish" });
console.log(text, usage.costUsd);

const v = await ai.vision({ image: "https://…/photo.png", prompt: "Describe" });
const img = await ai.image({ prompt: "a sunlit beach in Blokhus" });
const da = await ai.translate({ text: "hello", to: "Danish" });
const emb = await ai.embedding({ text: ["a", "b"] });
```

## Capabilities

`chat` · `vision` · `translate` · `image` (fal.ai) · `embedding` · `transcribe`
(Whisper), plus **prompt contracts** with structured output:

```ts
import { z } from "zod";
const { data } = await ai.contracts.extract({
  text: "Sanne is 40 and lives in Blokhus",
  schema: z.object({ name: z.string(), age: z.number(), city: z.string() }),
});
// also: ai.contracts.{ mockup, design, classify, rerank }
```

## Providers & tiers

Adapters: **Anthropic** (HTTP + `claude -p` subprocess), **OpenAI**, **Google
Gemini**, **DeepInfra**, **OpenRouter** (incl. MiniMax), **fal.ai** (images).

Calls route through named **tiers** — `fast · smart · powerful · cheap · vision ·
embedding` — each resolving to a `(provider, model, transport)` triple,
overridable per call:

```ts
await ai.chat({ prompt: "…", tier: "powerful" });
await ai.chat({ prompt: "…", override: { provider: "openrouter", model: "minimax/minimax-m2.7" } });
```

`cheap` defaults to the cheapest-that's-good-enough cloud model — **Mistral Small**
(EU/Paris-hosted, GDPR-safe, ~$0.10/$0.30) — so a cost-tier call is safe for
personal data by default; override per call for an even cheaper non-personal route.
(The `claude -p` subprocess transport is still available via explicit
`override: { transport: "subprocess" }`, but is no longer a default route.)

## Cost, budget & sinks

```ts
import { createAI, upmetricsSink, sqliteSink, multiSink } from "@broberg/ai-sdk";

const ai = createAI({
  budget: { perCallUsd: 0.05, rollingUsd: 5 }, // pre-flight guard (throws BudgetExceededError)
  costSink: multiSink([
    upmetricsSink({ baseUrl: "https://upmetrics.org", apiKey: process.env.UPMETRICS_API_KEY!, agentName: "my-app" }),
    sqliteSink({ dbPath: "./ai-cost.db" }),
  ]),
});
```

Sinks: `upmetricsSink` (canonical), `discordSink`, `sqliteSink`, `multiSink`,
`noopSink`. A failing sink never crashes a call.

## License

FSL-1.1-Apache-2.0
