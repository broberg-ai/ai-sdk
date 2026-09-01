// F045 — an error that names a key must name EVERY key it accepts.
//
// super read "gemini adapter: API key not set (env GOOGLE_API_KEY)" and went to get a
// GOOGLE_API_KEY — while the adapter also accepts GEMINI_API_KEY, which is the name this
// very repo's own .env uses. A message that names one of two valid answers sends a
// reader to solve a problem they do not have.
//
// fal had the same shape at three sites and was NOT in the report — found by asking where
// else the form lived rather than fixing only what was pointed at.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/** Every adapter source, read as text: we are asserting about the MESSAGE, and the
 *  message is a literal. Reading the source is the honest way to check all sites at once
 *  rather than the one or two a hand-written call can reach. */
function src(file: string): string {
  return readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
}

/** `config.apiKey ?? process.env.A ?? process.env.B` → ["A", "B"] per occurrence. */
function multiKeySites(text: string): [string, string][] {
  return [...text.matchAll(/process\.env\.([A-Z_]+)\s*\?\?\s*process\.env\.([A-Z_]+)/g)]
    .map((m): [string, string] => [m[1]!, m[2]!]);
}

for (const file of ["gemini.ts", "fal.ts"]) {
  test(`${file}: every accepted env var is named in the not-set error`, () => {
    const text = src(file);
    const sites = multiKeySites(text);
    // Guard the guard: if the fallback chain is refactored away, this test must fail
    // rather than silently assert nothing.
    expect(sites.length).toBeGreaterThan(0);

    const errors = [...text.matchAll(/throw new Error\((["'`])((?:(?!\1).)*)\1\)/g)]
      .map((m) => m[2]!)
      .filter((msg) => /key not set|KEY not set/i.test(msg));
    expect(errors.length).toBeGreaterThan(0);

    const missing: string[] = [];
    for (const msg of errors) {
      for (const [a, b] of sites) {
        if (!msg.includes(a) || !msg.includes(b)) {
          missing.push(`"${msg}" omits ${msg.includes(a) ? b : a}`);
        }
      }
    }
    // Name the offending message. A count would not tell the next reader which of the
    // three fal sites is the stale one.
    expect(missing).toEqual([]);
  });
}

test("an adapter with ONE accepted key is not dragged into this rule", () => {
  // mistral reads only MISTRAL_API_KEY, so its single-name message is correct. Without
  // this, someone could "fix" the rule by demanding two names everywhere.
  const text = src("mistral.ts");
  expect(multiKeySites(text)).toEqual([]);
  expect(text).toContain("env MISTRAL_API_KEY");
});
