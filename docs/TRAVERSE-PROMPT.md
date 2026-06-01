# cc Traversal Prompt — AI/LLM Usage Inventory

**Run from the parent dir that contains all repos (e.g. `~/code` or `~/dev`).**

```
Role: You are auditing every repo under the current directory to inventory ALL
AI/LLM/GenAI usage so we can design a unified SDK (@broberg/ai-sdk).

Task: Traverse every git repo (skip node_modules, .git, dist, build, .next, .turbo).
For EACH repo produce a row of findings.

Detect usage by scanning for these signals (ripgrep, case-insensitive):
  - SDK imports:  ai-sdk, @ai-sdk/*, openai, @anthropic, anthropic, @google/genai,
                  groq-sdk, @fal-ai, fal, replicate, cohere, mistral, together,
                  deepinfra, openrouter, ollama, @webhouse/ai
  - Raw HTTP:     api.anthropic.com, api.openai.com, generativelanguage.googleapis.com,
                  api.deepinfra.com, openrouter.ai, fal.run, queue.fal.run, api.together.xyz
  - Subprocess:   "claude -p", spawn(*claude*), execa(*claude*)
  - Env keys:     *_API_KEY references in code AND .env/.env.example
  - Model strings: claude-*, gpt-*, gemini-*, llama-*, *maverick*, minimax-*, flux*, sdxl*

For each HIT, capture:
  - file path + line
  - which capability it maps to (chat | vision | translate | image | mockup |
    design | embedding | transcribe | extract | classify | rerank | OTHER)
  - provider + model string (if literal)
  - transport (subprocess `claude -p` vs HTTP API vs 3rd-party SDK)
  - whether cost/token usage is currently tracked (grep: usage, tokens, cost, input_tokens)

Output: write `AI-INVENTORY.md` in the CURRENT dir with:
  1. Summary table: repo | #call-sites | providers | capabilities | tracks-cost? | transports
  2. Per-repo detail: every call-site grouped by capability
  3. "Unmapped" section: any usage that didn't fit a known capability (candidates for NEW abstraction layers)
  4. "Migration risk" notes: places that are deeply provider-coupled (hard to swap)

Stop conditions: every repo visited; AI-INVENTORY.md written; no code changed.
Constraints: READ ONLY. Do not modify any repo. Do not run installs.
```

After cc writes `AI-INVENTORY.md`, paste it back to me and we lock the v1 capability
set + provider matrix against real data.
