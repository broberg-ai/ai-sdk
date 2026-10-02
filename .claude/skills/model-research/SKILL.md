---
name: model-research
description: Monthly model research (F067) — ask every provider we have a key for which models exist, diff against what ai-sdk prices and routes, refresh inventory.json, and file the report in cardmem Assets/Reports. Fired by the buddy job db90bb3f on the 1st at 06:00 Danish time; can be run by hand any time.
---

# /model-research

Runs in a fresh support-lane session in this repo. It reports — it never changes a
price or a route on its own. A finding becomes work only when someone reads the
report and makes a card.

## 1. Load the keys from the vault (never print a value)

`cardmem_list_secrets({ project: "ai-sdk" })`. For every secret with an
`env_var_name` that is NOT already a line in `.env`, fetch it with
`cardmem_get_secret` and append it:

```bash
printf '%s=%s\n' "$ENV_NAME" "$VALUE" >> .env   # .env is gitignored — check: git check-ignore .env
```

Never echo a value, never put one in a commit, a report or a message. A key that is
not in the vault is not an error here: the report names it under «Not checked — no key».

## 2. Run the research

```bash
set -a; . ./.env; set +a
D=$(TZ=Europe/Copenhagen date +%Y-%m-%d)
OUT="$TMPDIR/model-research-$D.md"
bun run scripts/research-models.ts > "$OUT" 2>&1; echo "research exit=$?"   # 1 = findings, that is fine
bun run scripts/media-price-age.ts >> "$OUT" 2>&1
```

Exit 1 means drift or new models — a result, not a failure. Anything else (a stack
trace, an empty file) IS a failure: stop and say so in one line.

## 3. Refresh inventory.json

```bash
bun run scripts/build-inventory.ts
git diff -I '"generatedAt"' -I '"checkedAt"' --quiet inventory.json && echo unchanged || echo changed
```

- `unchanged` → commit only the `checkedAt` stamp: `chore(inventory): verified, no changes`.
- `changed` → commit it: `chore(inventory): monthly model-research refresh (<date>)`,
  and add one line to the report saying the inventory moved.

Push to main. This is the advisor's data, not a price: `src/cost/pricing.ts` is NEVER
edited by this skill.

## 4. File the report in cardmem Assets/Reports

```
cardmem_create_asset({
  project_id: "019e850f-f390-771f-828f-4e0acc512b4e",   // ai-sdk
  session_id: <this session>,
  folder_name: "Reports",
  name: "model-research-<date>.md",
  mime: "text/markdown",
  base64: <base64 of $OUT>
})
```

## 5. Read it back — the run is not done until this passes

`cardmem_get_asset` (or `cardmem_list_assets`) on the id you got back, and compare
`byte_size` with `wc -c < "$OUT"`. Equal → done. Different or missing → the report
did not land; say so plainly. A filed-but-unverified report is the exact failure this
replaced: three monthly PRs nobody opened.

## 6. Say one line

`model-research <date>: <n> new · <n> price drift · <n> gone · <n> providers without key → @asset:<id>`

Nothing else. No price edits, no tier changes, no cards — the report is the deliverable.
