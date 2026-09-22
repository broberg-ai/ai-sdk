// F058.2 — the browser subpath must stay bundleable for a browser target.
//
// We filed this rule as a fleet tip ourselves ([native-dep-isolation], by ai-sdk):
// "If a package's ROOT entry transitively imports a runtime builtin (bun:sqlite,
// node:zlib), a BROWSER build hard-fails. Ship a browser-clean subpath export and
// PROVE it with bun build --target=browser."
//
// We shipped the subpath (@broberg/ai-sdk/registry, see src/registry.ts) and never
// shipped the proof. That is the same shape as F058 itself: the fleet was told the
// rule, this repo did not follow it. Found by auditing our OWN Discovery tips
// against this repo, 22 September 2026.
//
// It is load-bearing (harness contract): a UI model-picker imports this entry, and
// a leaked `bun:sqlite` import breaks it at BUILD time in the consumer's app — not
// here, and not in any test we had. So it gets a red test that runs in `bun test`,
// which the publish workflow runs before it publishes.
import { expect, test } from "bun:test";

test("the browser subpath entry bundles for --target=browser", async () => {
  const result = await Bun.build({
    entrypoints: [`${import.meta.dir}/registry.ts`],
    target: "browser",
  });

  if (!result.success) {
    // Name WHAT broke. "build failed" sends the next reader to tsup or to their own
    // app; the actual cause is almost always a runtime builtin that crept into the
    // import chain of src/availability/*.
    const details = result.logs.map((l) => String(l)).join("\n");
    throw new Error(
      `The BROWSER entry (@broberg/ai-sdk/registry) no longer bundles for a browser ` +
        `target. Something in src/registry.ts's import chain now pulls a runtime ` +
        `builtin (bun:sqlite, node:zlib, …). Keep those on the root entry only.\n${details}`,
    );
  }

  expect(result.outputs.length).toBeGreaterThan(0);
});

test("the browser bundle contains no runtime-builtin import", async () => {
  // Belt and braces: Bun can resolve some builtins for a browser target instead of
  // failing, which would let the first test pass on a bundle a real bundler (Vite/
  // Rollup) still rejects — the exact failure the tip describes, and it is reported
  // by consumers, not by us.
  const result = await Bun.build({
    entrypoints: [`${import.meta.dir}/registry.ts`],
    target: "browser",
  });
  const code = await result.outputs[0]!.text();
  for (const builtin of ["bun:sqlite", "node:zlib", "node:fs", "node:child_process"]) {
    expect(code).not.toContain(builtin);
  }
});
