# F2 — Core SDK: client, provider adapters, transport, Zod boundaries

## Role
Provide the facade and adapter foundation that all capabilities and providers build on.

## Task
Build `createAI()` client factory, `ProviderAdapter` interface, pluggable transports (http + `claude -p` subprocess), tier routing, and Zod validation on all public boundaries.

## Context
The public surface is a facade with its own contract. Vercel AI SDK may be one internal adapter only — it must never leak through to callers. The abstraction layer is what the earlier `@webhouse/ai` wrapper failed to enforce: repos kept calling the underlying SDK directly. This time the facade is the only public surface.

**Stack:** Bun + TypeScript, ESM only (`"type": "module"`), dotenv for secrets.

**Tier names** (from planning): `fast | smart | powerful | cheap | vision | embedding` — each resolves to a `(provider, model, transport)` tuple. Overridable per call.

**Transports:**
- `http` — fetch-based, provider API key from env
- `subprocess` — spawns `claude -p`, passes prompt via stdin, captures stdout (Max plan, `costUsd: 0` + subprocess flag)

## Non-goals
- No provider implementations in this epic (those are F4)
- No capability implementations (those are F5)
- No cost engine implementation (that is F3)
- The Anthropic, fal adapters mentioned in AC are stubs that satisfy the interface; full implementations land in F4/F5

## Stories

| Story | Title |
|---|---|
| F2.1 | Project scaffold |
| F2.2 | Core type definitions |
| F2.3 | Tier map + resolution |
| F2.4 | Transport implementations |
| F2.5 | createAI() factory + client interface |
| F2.6 | Zod validation on public boundaries |

## Acceptance criteria
1. `createAI({ defaults, providers, costSink, budget })` returns a typed client
2. `ProviderAdapter` interface implemented by `anthropic-api`, `anthropic-subprocess`, `fal` (stubs are fine; interface must be satisfied)
3. Transport selectable per call: `http` vs `claude -p` subprocess
4. Tier map resolves `(provider, model, transport)` from a tier name and is overridable per call
5. All public inputs and structured outputs validated with Zod
