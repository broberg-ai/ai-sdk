// F043.6 — a structural guard, because counting call sites is what kept failing.
//
// components asked the question this answers (#24226): "is there a place where
// withOverride CAN be skipped, rather than counting the call sites again next time?"
// Three times in one week, in three repos, the same fault: a guard applied at SOME of
// the sites, with nothing to say whether a bare merge was deliberate or forgotten.
//
// So this test reads the source and forbids the raw spread outright. A capability that
// genuinely must skip the guard calls mergeUnguarded(..., why) and says why; anything
// else is a bug this test names by line.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const SRC = new URL("./client.ts", import.meta.url).pathname;

/** Strip comments first — a doc-comment describing the pattern is not the pattern.
 *  (This test's own explanation would otherwise fail it.) */
function stripComments(code: string): string[] {
  const out: string[] = [];
  let inBlock = false;
  for (const raw of code.split("\n")) {
    const line = raw.trim();
    if (inBlock) {
      if (line.includes("*/")) inBlock = false;
      out.push("");
      continue;
    }
    if (line.startsWith("/*")) {
      if (!line.includes("*/")) inBlock = true;
      out.push("");
      continue;
    }
    if (line.startsWith("//") || line.startsWith("*")) {
      out.push("");
      continue;
    }
    out.push(raw.replace(/\/\/.*$/, ""));
  }
  return out;
}

test("no capability merges an override without going through a named merge helper", () => {
  const lines = stripComments(readFileSync(SRC, "utf8"));
  const offenders: string[] = [];

  lines.forEach((line, i) => {
    if (!/\.\.\.(input\.)?override\b/.test(line)) return;
    // The two helpers ARE the merge; they are allowed to spread.
    if (/return \{ \.\.\.base, \.\.\.override \};/.test(line)) return;
    offenders.push(`client.ts:${i + 1}  ${line.trim()}`);
  });

  // Print the offending lines when it fails — a count tells the next reader nothing.
  expect(offenders).toEqual([]);
});

test("the unguarded merges are the speech ones, and each states a reason", () => {
  const code = readFileSync(SRC, "utf8");
  const calls = [...code.matchAll(/mergeUnguarded\(\s*DEFAULT_(\w+)_SPEC[^)]*?,\s*"([^"]+)"/g)];
  const named = calls.map((m) => m[1]!.toLowerCase()).sort();

  // Exactly the three capabilities measured to not send spec.model to the provider.
  expect(named).toEqual(["podcast", "transcribe", "tts"]);
  // Every one carries a real reason, not an empty string kept to satisfy the signature.
  for (const m of calls) expect(m[2]!.length).toBeGreaterThan(20);
});
