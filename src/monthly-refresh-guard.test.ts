// F046 — the monthly price refresh must not be able to succeed without delivering.
//
// Measured 2026-09-03 in this repo's own run history: the job ran on 1 Jul, 1 Aug and
// 1 Sep, reported SUCCESS all three times, pushed a branch all three times, and opened
// ZERO pull requests — `gh pr create` is blocked by org policy and the failure was
// swallowed by a `|| { echo "::notice::..."; }` that exited 0. Three months of green,
// nothing delivered, nobody told. Meanwhile a single week of drift produced 34 price
// changes, 23 new models and 15 removals.
//
// This test reads the workflow as TEXT because that is the artifact GitHub runs. There
// is no unit to call; the only way to stop the pattern coming back is to forbid it.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const wf = readFileSync(new URL("../.github/workflows/research-models.yml", import.meta.url), "utf8");

/** The workflow with its `#` comment lines removed.
 *
 *  Assertions run against THIS. The comments explaining why `::notice::` is banned
 *  contain the word `::notice::`, so a naive text search makes the prose that justifies
 *  the rule the thing that violates it — the guard would be red for writing down its own
 *  reason. Same lesson this repo learned on the mailto guard: strip the commentary
 *  first, or the documentation becomes the defect. */
const code = wf
  .split("\n")
  .filter((l) => !/^\s*#/.test(l))
  .join("\n");

test("the workflow exists and still opens a PR on a substantive change", () => {
  // Guard the guard: if the file were renamed away, every assertion below would vanish
  // rather than fail.
  expect(wf).toContain("gh pr create");
  expect(wf).toContain("scripts/build-inventory.ts");
});

test("a blocked PR creation FAILS the run — it may not be a notice", () => {
  const fallback = code.slice(code.indexOf("gh pr create"));
  expect(fallback).toContain("exit 1");
  // ::notice:: is invisible in a green run. That is precisely how this went unseen for
  // three months, so the string itself is banned from the failure path.
  expect(fallback).not.toContain("::notice::");
  expect(fallback).toContain("::error::");
});

test("no step silences its own failure with `|| true` after the report step", () => {
  // The drift REPORT is allowed to fail (it is informational and its output is captured
  // either way). Nothing after it may be.
  const afterReport = code.slice(code.indexOf("Rebuild inventory"));
  expect(afterReport).not.toContain("|| true");
});

test("the no-change path still records that the check HAPPENED", () => {
  // The old version ran `git checkout inventory.json`, throwing the whole rebuild away
  // including the timestamp — so "verified, unchanged" became indistinguishable from
  // "abandoned". A run that verifies and finds nothing must still leave a trace.
  expect(code).not.toContain("git checkout inventory.json");
  expect(wf).toContain("checkedAt");
});
