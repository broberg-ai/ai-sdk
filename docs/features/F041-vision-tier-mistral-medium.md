# F041 — Vision tier moves to mistral-medium

> **Status: shipped in v0.34.0 (commit `72cc20c`).**
>
> **This plan-doc is LATE and that is the first thing worth recording.** The code,
> the tests and the npm release all landed before this file or its card existed. The
> house rule is that the commit introducing an F-number is the commit introducing its
> plan-doc; I broke it. Written retroactively 2026-08-28 from the commit message and
> the measurements, with nothing invented to fill gaps — where the original reasoning
> is not recoverable, this doc says so instead of reconstructing a plausible version.

## Trigger

Christian, 2026-08-27: *"Forresten måtte du gerne bumpe vision op til en bedre model
i Mistral :)"* — an explicit owner instruction, not a discovery of ours.

A second, independent push came from cms, who noticed that our `vision` tier resolved
to the same model as `cheap`. A tier named `vision` that is byte-identical to `cheap`
gives a caller no way to ask for something better — the tier is then decoration.

## The decision

`vision` moves from `mistral-small-latest` to **`mistral-medium-latest`**.

| model | fine-discrimination score | input/output per 1M |
|---|---|---|
| `mistral-medium-latest` | **4 / 9** | $1.5 / $7.5 |
| `mistral-small-latest` | 1 / 9 | $0.1 / $0.3 |
| `mistral-large-latest` | **0 / 9** | $2.0 / $6.0 |

**"Bigger is better at vision" does not hold inside Mistral's own lineup.** `large`
scored *worse than small* while costing 5× small's input rate, and `mistral-medium-3.1`
returned empty responses on all six of its cases. If the tier had been picked off the
price list — the obvious heuristic, and the one a reasonable person would use — we
would have shipped the single worst option.

**Nobody is good at this.** The best score is 4/9. The honest claim is not "medium is
good at vision"; it is *"medium is the only one of the three that sees anything at all"*.
A consumer doing safety-critical visual discrimination should not lean on this tier.

### How it was measured

An 8×10 grid of colour cells where exactly ONE cell differs, and differs only in its
blue channel (190 → 150) — a difference small enough that a model must actually look
rather than pattern-match. Ground truth is **generated pixel-by-pixel inside the test**,
so the correct answer is constructed and cannot be misremembered.

The easy control matters as much as the hard case: on solid-colour blocks all three
models score 4/4. **An easy test would have justified any of the three**, including the
one that is measurably worst. That is the trap this measurement was designed to avoid.

### The invalid first attempt, kept on the record

The first vision test was **wrong, and all three models "failed" it**. I hand-wrote a
3×3 PNG's base64 from memory; the image itself was corrupt. Three models agreeing that
they cannot see something is very convincing evidence — right up until the thing they
were shown was not an image.

The fix is a rule, not a one-off correction: **every test image is generated
pixel-by-pixel in the test**, never transcribed. A remembered constant is an untested
input wearing the costume of a fixture.

## Cost consequence

$0.1/$0.3 → **$1.5/$7.5** per 1M. A real jump — 15× input, 25× output — and deliberate
for a tier whose job is to be *right* rather than cheap. `cheap` and `fast` are
untouched and remain `mistral-small-latest` for volume work.

## Scope

- `DEFAULT_TIER_MAP.vision` → `mistral-medium-latest` (`src/routing/tier-map.ts`).
- Register `mistral-medium-latest` in the availability registry.
- A test asserting the `vision` tier is **never** the same model as `cheap`.

### Non-goals

- No change to `fast` / `cheap` / `smart` / `powerful`.
- No cross-provider vision comparison. This measured Mistral's lineup only, because
  the EU-residency constraint is what makes the tier Mistral in the first place —
  a cheaper non-EU winner would not be selectable for personal data anyway.
- No claim that the tier is *good*. See the 4/9 above.

## Reuse

Checked before the change: no `@broberg/*` package owns model routing — this repo IS
the fleet's AI primitive and the Model Advisor authority (F017). Nothing external to
reuse.

## What the drift guard did

Adding the model surfaced its own bug immediately: before registration,
`resolveModel('vision')` **fell open and returned the literal string `'vision'`** as a
model id. That is the 0.29.0 guard doing exactly the job it was built for — and it is
the concrete case behind the `requireKnown: true` advice in CLAUDE.md, where a
success-shaped non-answer is worse than an error because an error gets handled and a
shape does not.

## Verification

- 445 tests pass; `tsc` clean.
- **Mutation check:** reverting `vision` to `mistral-small-latest` turns 2 tests red, so
  the guard is load-bearing rather than decorative.
- Shipped as v0.34.0 and confirmed against npm (`npm view @broberg/ai-sdk version`),
  not against a green workflow.
