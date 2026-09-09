// F053 — residency must be findable in the README's FIRST SCREENFUL.
//
// helpdesk followed the reuse rule exactly: they looked for the capability, did not
// find it, and hand-rolled a (provider, model) allowlist — the very guard our own
// .d.ts warns against in capitals, with the gateway hole we ourselves closed in
// 0.36.0. They did nothing wrong. Measured 2026-09-09, BEFORE this test existed:
//
//   grep -c 'usage.region|regionOfHost' README.md  →  0   (of 142 lines)
//
// Not "further down" — absent. And the opening enumerated `Usage` as
// "(tokens, cost, latency, transport)", four fields, which reads as exhaustive: a
// reader looking for residency was told it does not exist, not that it is elsewhere.
//
// A test rather than a one-off grep, because documentation that was right when it was
// written is exactly the kind that rots — three notes bit the fleet that way in one week.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const README = readFileSync(join(import.meta.dir, "..", "README.md"), "utf8");
const FIRST_SCREENFUL = README.split("\n").slice(0, 40).join("\n");

test("residency is reachable in the README's first 40 lines", () => {
  const missing = ["usage.region", "regionOfHost"].filter((t) => !FIRST_SCREENFUL.includes(t));
  expect(missing).toEqual([]);
});

test("the Usage enumeration does not read as exhaustive while omitting region", () => {
  // The specific sentence that made the absence a CLAIM rather than a gap.
  const enumeration = README.match(/Every call returns a `Usage` \(([^)]*)\)/);
  expect(enumeration).not.toBeNull();
  expect(enumeration![1]).toContain("region");
});

test("the regionOfProvider trap is named, not just the right answer", () => {
  // Telling someone what to use without naming what NOT to use leaves the trap open —
  // and this trap is fail-closed-and-useless: it rejects the only EU route we have.
  expect(FIRST_SCREENFUL).toContain("regionOfProvider");
});

test('README says only "eu" is a positive claim', () => {
  // Without this, `region !== "us"` reads as an EU check. It passes every OpenRouter call.
  expect(FIRST_SCREENFUL).toMatch(/only .?"?eu"?.? is a positive claim/i);
});

test("CONTROL — the assertions actually read the README, not an empty string", () => {
  // Without this, a broken path would make every test above pass by having nothing to
  // check against. "0 violations" and "never looked" again.
  expect(README.length).toBeGreaterThan(3000);
  expect(FIRST_SCREENFUL.split("\n").length).toBe(40);
});
