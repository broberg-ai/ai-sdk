## Project layout

> **Fill this in for THIS repo.** Every cardmem-compatible repo MUST have a `## Project layout` section with the columns `Area | Path | Notes`. The cardmem Init flow (or the `feature` skill) populates it from the repo's actual structure — replace the example rows below.

| Area | Path | Notes |
|---|---|---|
| SDK source | `src/` | TypeScript ESM package — client, adapters, transports, capabilities, sinks |
| Client + types | `src/client.ts`, `src/types.ts` | `createAI()` factory, all public types and Zod schemas |
| Adapters | `src/adapters/` | One file per provider: `anthropic.ts`, `openai.ts`, `gemini.ts`, `deepinfra.ts`, `openrouter.ts`, `fal.ts` |
| Transports | `src/transports/` | `http.ts` (fetch) and `subprocess.ts` (`claude -p`) |
| Capabilities | `src/capabilities/` | `vision.ts`, `translate.ts`, `image.ts`, `embedding.ts`; `contracts/` for prompt-contract caps |
| Sinks | `src/sinks/` | `noop.ts`, `multi.ts`, `discord.ts`, `sqlite.ts` |
| Pricing | `src/pricing.ts` | Versioned per-`(provider, model)` pricing table |
| Budget | `src/budget.ts` | `BudgetGuard` + `BudgetExceededError` |
| Compat | `src/compat/` | `webhouse-ai.ts` shim for `@webhouse/ai` migration (F6.1) |
| Scan scripts | `scripts/` | `scan-ai-usage.ts` traversal script (F1) |
| Plan docs | `docs/features/` | `F<n>-<slug>.md` plan-docs for every epic |

## Working with cardmem

> **Canonical section per F057 multi-project convention.** Every cardmem-compatible repo gets this same block, copied verbatim (the URLs and F-number rules are universal). The `## Project layout` table above is what differs per repo.

- **MCP endpoint.** This repo declares the cardmem MCP server in `.mcp.json`. cc sessions in this repo get the full `cardmem_*` tool surface (search, list, create, write_plan, pickup, handoff, …).
- **F-numbers + plan-docs.** Every feature has a number (`F<n>`, with sub-stories `F<n>.<m>`, tasks `F<n>.<m>.<k>`). The plan-doc lives at `docs/features/F<n>-<slug>.md` and MUST be written in the same commit/turn as the card. Never "I'll write the plan next" — see the UFRAVIGELIG rule below.
- **Boards.** Each project has at least one board with the default columns: Backlog → Ready → In progress → Review → Done. The board renders from the `cards` table — there is no separate `FEATURES.md` mirror.
- **The `feature` skill** (`.claude/skills/feature.md`) is the canonical entry point for proposing new work. It checks for duplicates via `cardmem_search`, assigns the next F-number via `cardmem_suggest_next_f_number`, reads the `## Project layout` table above to scope the plan, writes the plan-doc via `cardmem_write_plan`, and creates the cards via `cardmem_create_card` / `cardmem_create_cards`.
- **Queue-drain.** When this session opts into queue-drain (`cardmem_session_start({ auto_pickup_mode: 'queue-drain' })`), Ready cards are picked up automatically without asking. See `.claude/skills/queue-drain.md`.
- **Handoff back to review** via `cardmem_handoff_card` once a card's AC is met. The PostToolUse hook injects the next Ready card as a binding pickup directive.


## Behavioral guidelines

> **Canonical section per F057 multi-project convention.** Same block ships into every cardmem-compatible repo. Reduces common LLM coding mistakes; merge with project-specific instructions as needed.
>
> Tradeoff: these guidelines bias toward caution over speed. For trivial tasks, use judgment.

### Rule 1 — Think before coding

Don't assume. Don't hide confusion. Surface tradeoffs.

Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### Rule 2 — Simplicity first

Minimum code that solves the problem. Nothing speculative.

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### Rule 3 — Surgical changes

Touch only what you must. Clean up only your own mess.

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

The test: every changed line should trace directly to the user's request.

### Rule 4 — Goal-driven execution

Define success criteria. Loop until verified.

Transform tasks into verifiable goals:

- "Add validation" → "Write tests for invalid inputs, then make them pass."
- "Fix the bug" → "Write a test that reproduces it, then make it pass."
- "Refactor X" → "Ensure tests pass before and after."

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

