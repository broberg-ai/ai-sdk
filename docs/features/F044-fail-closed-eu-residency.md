# F044 — Fail-closed EU residency: refuse before the bytes leave

**Status:** planned · **Priority:** high · **Requested by:** the `super` session, 2026-08-30

## Motivation

F042 gave every response a `usage.region`. That is an *audit* field: it is readable
only once the call has happened, so it can tell you personal data left the EU — it
cannot stop it. F043.8 exported `regionOfHost` so a consumer can ask beforehand. Both
are necessary and neither is sufficient, because a consumer building the pre-check has
to know **which host each adapter will use, for each capability**, and that is our
knowledge, not theirs.

Two consumers wrote that guard within a day of each other and both got it wrong in the
same direction:

- `super` wrote `regionOfProvider(p) === "eu"`, which rejects **Mistral** — the only EU
  route we have. Fail-closed and useless: it filters out the thing it exists to allow.
- `components` called `regionOfHost("api.mistral.ai")` with a bare hostname, got
  `"unknown"` (our bug, fixed in 0.36.6), and their guard rejected everything.

The pattern is the point. When two careful readers independently build the same wrong
guard from a correct primitive, the primitive is not the deliverable — **the guard is.**

## Scope

One client-wide setting:

```ts
const ai = createAI({ residency: "eu" });
```

With it set, **every** capability refuses before the request is issued when the endpoint
it would call is not EU-resident. The error names the capability, the provider, the host
and the region it resolved to, so the consumer can see WHICH call would have left.

```
createAI: residency "eu" refuses ai.embedding — provider "openai" would call
api.openai.com (region "us"). Set override:{provider:"mistral", model:"mistral-embed"}
for an EU route, or drop residency:"eu" on this client.
```

### Non-goals

- **No per-call `euOnly` flag.** `super` asked for the client-wide form specifically, and
  it is the right shape: a per-call flag is one a caller forgets on exactly the call that
  matters. If a repo needs both, it constructs two clients.
- **No automatic re-routing.** A guard that silently swapped `openai:text-embedding-3-small`
  for `mistral-embed` would change the vector length under a live index and change the
  bill 5x, both invisibly. We refuse and name the fix; picking is the consumer's.
- **No new residency claims.** `"unknown"` stays a refusal, not a pass. Only `"eu"` is a
  positive claim (F042), and this feature must not soften that to be more useful.

## Architecture

The crux is that `ProviderAdapter` today exposes `name` and its capability methods — it
does **not** expose the host it will call. The client therefore cannot ask the question
on the consumer's behalf. So:

1. **Adapters declare their effective endpoint.** Add an optional readonly member to
   `ProviderAdapter` — the base URL the adapter was actually constructed with, after the
   config override is applied. It must be the EFFECTIVE value, not the default, or the
   guard reproduces the exact bug F042 was written to remove.
2. **The client checks it at the one chokepoint.** `pickProvider` already resolves
   (capability, spec) → adapter for every capability. The guard goes there, so a new
   capability is covered on the day it is added rather than the day someone remembers.
3. **An adapter that declares no endpoint is a refusal**, not a pass. Absence is exactly
   the "we did not look" case, and a missing value must not read as an answer.

### The Azure/Vertex wrinkle

`azureAdapter` derives more than one host from one config: its chat host and its
speech-to-text host are built separately, which already produced a wrong `"eu"` on a US
STT resource during F042. So the declaration must be **per capability**, not one base URL
per adapter — otherwise this feature ships the same bug in a new place.

## Verification

Structural, not by counting call sites — counting failed three times during F043:

- A test that walks EVERY capability on the facade with `residency: "eu"` and a
  non-EU-configured client, and asserts each one THROWS. A capability added later with
  no guard fails this test without anyone remembering to extend it.
- A negative control per capability: the same call with an EU-configured client must
  SUCCEED. A guard that refuses everything passes the first test and is worthless.
- Mutation proof: remove the guard, the suite goes red naming the capability.

## Rollout

Minor bump. Default is unchanged (`residency` unset = today's behaviour), so no existing
consumer is affected. Tell `super`, `components` and `sanne` when it lands — all three
are running hand-rolled versions of this guard right now, and two of them are wrong.

## Open questions

- Does `residency: "eu"` also refuse a `fallback` spec that would leave the EU? It must,
  or the guard has a hole exactly where a call is already degrading — but that means the
  fallback becomes unreachable rather than silently non-EU, which is a behaviour change
  worth stating rather than discovering.
