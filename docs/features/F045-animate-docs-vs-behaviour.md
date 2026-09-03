# F045 — ai.animate: what the docs say and what the call does are not the same

**Status:** planned · **Priority:** high · **Reported by:** the `super` session, 2026-09-01

## Motivation

`super` put `ai.animate()` into production and hit three defects in one sitting. None is a
crash in our code; all three are the SDK **stating something that is no longer true**, and
the first one cost them a failed run and a wasted account signup.

Verified in our own source before writing anything — the report is accurate:

| # | Claim | Reality |
|---|---|---|
| 1 | `types.ts:469` — `ProviderAdapter.animate` doc says **"fal."** | `DEFAULT_ANIMATE_SPEC` is **gemini** (Veo 3.1). Also `types.ts:276` says the image is "uploaded to **fal** storage". |
| 2 | `ANIMATE_AUDIO_DIRECTIVE` appended to **every** animate prompt (`client.ts:560`) | Kling (fal) produces **no audio stream at all** — `ffprobe -select_streams a` found none. The directive is describing sound to a model that cannot make any. |
| 3 | `gemini.ts:124` — "API key not set (env **GOOGLE_API_KEY**)" | `gemini.ts:123` accepts `GOOGLE_API_KEY` **or** `GEMINI_API_KEY`. Our own `.env` uses the second one. |

**Defect 1 is the expensive one and shows why this class is worth a card.** The comment ships
in `index.d.ts`, so it appears in the editor tooltip at the exact moment a consumer decides
*which API key to go and buy*. `super` read "fal", obtained a fal key, called `ai.animate()`
with no override, and got `gemini adapter: API key not set`. The comment was almost certainly
true once — F024 originally routed animate through fal, and the default later moved to Veo
direct. Nothing tied the sentence to the decision, so only the sentence stayed behind.

## What we measured that was NOT reported

The recurring failure this repo had all week was fixing the reported instance and never
asking where else the same form lives. So we asked first:

- **`fal.ts` has defect 3 too, at three call sites.** It accepts `FAL_KEY ?? FAL_API_KEY`
  and every error says only `"fal adapter: FAL_KEY not set"`. Same shape, different file,
  not reported.
- **Defect 1 is the ONLY doc drift of its kind.** Seven `ProviderAdapter` members name a
  provider in their doc. Checked each against its `DEFAULT_*_SPEC`: `trainStyle`→fal,
  `dialogue`→elevenlabs, `tts`→elevenlabs, `batchSubmit`→mistral all still match; `chat`
  and `translate` name a provider only as an example, not as the route. **`animate` is the
  single drifter.** That is a useful result rather than a comforting one: it means the
  convention — *name the default provider in the member doc* — is followed everywhere and
  is right everywhere, and it drifted in exactly the one place where the default MOVED. So
  the guard writes itself.

## Scope

1. **Doc → truth, and a guard that keeps it true.** Correct `types.ts:276` and `:469`.
   Then a test that, for every capability with a `DEFAULT_*_SPEC`, asserts the provider
   named in that capability's `ProviderAdapter` member doc IS the default's provider.
   Red today on `animate`, green after — and red again the next time a default moves
   without its sentence.
2. **Bind the audio directive to a route that has audio.** Resolve it AFTER the override
   is applied, not before, or an overridden call keeps the wrong prompt.
3. **An error names every key it accepts.** `gemini` (1 site) and `fal` (3 sites).

### Non-goals

- **No new capability, no new provider.** This is three sentences and one conditional.
- **We do NOT drop the audio directive from fal entirely as a "cleanup".** fal routes other
  models than Kling; the rule is "the route this call resolved to", not "fal never".

## Open — defect 4, not yet ours to fix

`super` measured Veo rejecting `durationSec: 5` with *"provide a value between 4 and 8,
inclusive"* — while 5 is inside that range. Their read is that Google's message says
"interval" about what is really a discrete set (4, 6, 8). **Unconfirmed:** they are running 8
to separate "the value" from "the route", and the allowed set is a hypothesis until that
lands. fal/Kling accepted 5 (5.04s delivered), so **the same field takes different values on
different routes.**

We deliberately do NOT encode `[4,6,8]` yet. Probing it ourselves means paying for real Veo
generations for every value that is ACCEPTED, and an unmeasured allow-list that rejects a
legal value is worse than the 400 it replaces. Tracked as its own story, blocked on their
number.

## Verification

- The doc guard must be mutation-proved: restore "fal." on `animate` and the suite goes red
  **naming the member**, not merely changing a count.
- The audio directive gets a test per route: present for the Veo default, absent for a
  `fal` override — and the absent case must be asserted on the prompt the ADAPTER received,
  not on the input, since the whole defect was that the two differed.
- Each error-message change gets an assertion that the string contains BOTH env var names.

## Reuse

Discovery-tjek kørt 2026-09-03 pr. evne:

| evne | søgning | resultat | beslutning |
|---|---|---|---|
| sprogdetektion | `language detection` | `@broberg/chat`, `@broberg/webpush`, `@broberg/secret-scan`, `@broberg/gravatar` | **BYG** — ingen af de fire klassificerer sprog; det er navne-lighed i søgningen, ikke evne-lighed. |
| doc-drift / API-dokumentation | (ingen kandidat) | — | **BYG** — vagten læser DETTE repos egne typer mod DETTE repos egne default-specs. Der er intet delbart i den. |

`detectNordic` er bevidst holdt lille og lokal frem for at blive en pakke: den er
kalibreret på 30 målte svar fra ÉT modelvalg i ÉN branche, og en delt pakke ville
udgive den kalibrering som en generel evne den ikke er. Vurder den igen hvis et tredje
repo får samme behov — to er ikke nok til at kende formen.
