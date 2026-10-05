// F046 — the monthly price refresh must not be able to succeed without delivering.
//
// Measured 2026-09-03 in this repo's own run history: the job ran on 1 Jul, 1 Aug and
// 1 Sep, reported SUCCESS all three times, pushed a branch all three times, and opened
// ZERO pull requests — `gh pr create` is blocked by org policy and the failure was
// swallowed by a `|| { echo "::notice::..."; }` that exited 0. Three months of green,
// nothing delivered, nobody told. Meanwhile a single week of drift produced 34 price
// changes, 23 new models and 15 removals.
//
// F067.3 (2026-10-02): the GitHub workflow is gone. The monthly run is now the
// /model-research skill, fired by buddy job 24cb5bbf in the primary session, and the
// report lands in cardmem Assets/Reports instead of a PR. The PROPERTIES this file
// guarded did not go away with the workflow — "a run may not succeed without
// delivering" is exactly why the skill reads its report back — so they are asserted
// against the skill now. The skill is prose an agent follows; reading it as TEXT is
// the same move as reading the YAML was, and for the same reason: it is the artifact
// that runs.
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

const skill = readFileSync(new URL("../.claude/skills/model-research/SKILL.md", import.meta.url), "utf8");
const pub = readFileSync(new URL("../.github/workflows/publish.yml", import.meta.url), "utf8");

test("the old workflow stays retired — one monthly job, not two", () => {
  expect(existsSync(new URL("../.github/workflows/research-models.yml", import.meta.url))).toBe(false);
});

test("the skill runs research, the media-price report AND the inventory rebuild", () => {
  // Guard the guard: if the skill were renamed away, readFileSync above throws.
  expect(skill).toContain("scripts/research-models.ts");
  expect(skill).toContain("scripts/build-inventory.ts");
  // F050 — the prices no catalogue API serves are reported every month, into the
  // report itself (a report only in a log is a report nobody reads).
  expect(skill).toMatch(/media-price-age\.ts >> "\$OUT"/);
});

test("a run is not done until the filed report has been READ BACK", () => {
  // The workflow's failure was three green months with zero PRs opened. The skill's
  // equivalent is filing a report and never checking it landed.
  expect(skill).toContain("Read it back");
  expect(skill).toContain("byte_size");
});

test("the no-change path still records that the check HAPPENED", () => {
  expect(skill).not.toContain("git checkout inventory.json");
  expect(skill).toContain("checkedAt");
  expect(skill).toContain("verified, no changes");
});

test("the monthly run never edits a price on its own", () => {
  expect(skill).toMatch(/src\/cost\/pricing\.ts` is NEVER\s+edited/);
});

// ── F046.2: a release may not carry a stale price table ──────────────────────

const pubCode = pub
  .split("\n")
  .filter((l) => !/^\s*#/.test(l))
  .join("\n");

test("publish refuses to ship a stale price table", () => {
  expect(pubCode).toContain("checkedAt");
  expect(pubCode).toContain("PRICING_STALE_AFTER_DAYS");
  // The threshold is READ from the constant, never retyped in YAML. Two copies of a
  // threshold drift until the code and the release disagree about what "stale" means.
  expect(pubCode).not.toMatch(/limit\s*[:=]\s*35/);
});

test("the release guard cannot be neutralised", () => {
  const guard = pubCode.slice(pubCode.indexOf("price table is fresh"));
  const upToNextStep = guard.slice(0, guard.indexOf("      - name:", 10));
  expect(upToNextStep).not.toContain("|| true");
  expect(upToNextStep).not.toContain("continue-on-error");
  expect(upToNextStep).toContain("process.exit(1)");
});

test("publish does NOT fetch prices at tag time — a gate, not a fetch", () => {
  // Deliberate non-goal, asserted so it is not "improved" into existence later.
  // A live fetch at publish makes two builds of the same tag produce different
  // packages, which breaks what `npm publish --provenance` attests; and
  // build-inventory swallows per-model failures on purpose, so a degraded fetch
  // would ship a thinner table in silence.
  // Assert on lines that would EXECUTE it, not on every occurrence of the name. The
  // guard's own error message tells a human to run `bun run scripts/build-inventory.ts`
  // — so a naive text search makes the helpful instruction the thing that trips the
  // rule. Third time this session that a rule's own prose failed its own check; the
  // discriminating version is the one that separates a command from a message about it.
  const executable = pubCode
    .split("\n")
    .filter((l) => !/console\.(error|log)|echo /.test(l))
    .join("\n");
  expect(executable).not.toContain("build-inventory");
  // …and prove the filter did not simply delete everything it was meant to inspect.
  expect(executable).toContain("npm publish");
});
