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

`chat` · `vision` · `translate` · `image` (fal.ai default / OpenRouter) · `embedding` · `transcribe`
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

> **Images — raster vs. vector.** `ai.image()` defaults to fal.ai (raster PNG). For
> **vector/SVG** output (logos), override to OpenRouter Recraft — the slug is an
> **OpenRouter** model, not a fal app-id:
> ```ts
> await ai.image({ prompt: "…", override: { provider: "openrouter", model: "recraft/recraft-v4.1-vector" } });
> // → data:image/svg+xml;base64,… with ground-truth cost
> ```

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

### Cost-tracking is on by default (v0.24+)

You don't have to wire a sink. If `UPMETRICS_API_KEY` is in the env, a bare
`createAI()` auto-attaches the upmetrics sink — this exists because most
call-sites passed no sink, leaving ~91% of Mistral spend invisible. No key in
the env → no sink, no crash (ship-dark).

```ts
createAI();                      // key in env → tracked; no key → nothing happens
createAI({ costSink: mySink });  // explicit sink wins
createAI({ costSink: null });    // explicit OPT-OUT — see below
```

| Env var | Effect |
|---|---|
| `UPMETRICS_API_KEY` | **The only switch.** Present → tracking on. |
| `UPMETRICS_AGENT_NAME` | Row label. Set it — the fallback is `npm_package_name`, which is empty for a process not started via an npm/bun script (a `node dist/…` or Docker service logs as `unknown`). |
| `UPMETRICS_BASE_URL` | Ingest host. Defaults to `https://upmetrics.org`. |
| `UPMETRICS_COMPLIANCE` | `1` sets compliance mode. `Usage` carries no prompt/response text either way. |

**Adopting it in a repo — two things to do first, or the adoption corrupts the
numbers it was meant to reveal:**

1. **Opt out wherever you already report your own costs.** Pass
   `costSink: null`. Otherwise the SDK adds a *second* reporting path on top of
   yours and every call is counted **twice**, in production, with no error
   anywhere. (Found by `buddy`, who aggregates to `cli_usage` and pushes hourly.)

2. **Keep the key out of your test run.** Test runners auto-load `.env` (Bun
   does; Vitest with a dotenv setup does), so any suite that reaches a
   `createAI()` will POST **fabricated usage into production telemetry**. Note
   the trigger is *importing* a module that builds the client — a module-level
   `createAI()` arms it without anything calling it. Strip the whole prefix:

   ```ts
   // test-setup.ts  — bunfig.toml: [test] preload = ["./test-setup.ts"]
   for (const k of Object.keys(process.env)) {
     if (k.startsWith("UPMETRICS_")) delete process.env[k];
   }
   ```

   Strip the **prefix**, not a list of names — a guard you must remember to
   update is one that silently rots. And assert the *effect* (no `UPMETRICS_*`
   visible to a test) with a control proving the probe can go red; a test that
   checks "the key is undefined" passes while protecting nothing on a machine
   that never had the key.

Adoption is **per repo, opt-in** — there is no fleet-wide push. Turn it on when
a repo has spend worth watching, with both guards in place.

## License

FSL-1.1-Apache-2.0
