// F057.1 — these tests MUST run under Node, not Bun.
//
// The bug they seal is invisible from Bun by construction: under Bun, bun:sqlite
// imports fine and every sqliteSink test passes. The whole failure lives in the
// other runtime, so a Bun-only test proves nothing here. Reported by pitch
// (ref 28546) via components; verified on Node v25.6.1 against v0.47.1.
//
// Node is driven as a subprocess. It imports the TypeScript SOURCE directly
// (Node >=22.18 strips types natively, and these modules' only cross-file import
// is type-only, so nothing needs resolving) — deliberately not dist/, so the test
// can never pass against a stale build.
import { expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";

/** Absolute path to a Node binary, or null. CI provides one on PATH (setup-node);
 *  a dev machine often has it only under nvm, which is not on an agent's PATH. */
function findNode(): string | null {
  const onPath = Bun.which("node");
  if (onPath) return onPath;
  const nvm = `${process.env.HOME}/.nvm/versions/node`;
  if (!existsSync(nvm)) return null;
  const versions = readdirSync(nvm).sort().reverse();
  for (const v of versions) {
    const bin = `${nvm}/${v}/bin/node`;
    if (existsSync(bin)) return bin;
  }
  return null;
}

const NODE = findNode();

/** Run one ES-module snippet under Node and hand back what it printed. */
function underNode(script: string): { stdout: string; stderr: string; exitCode: number } {
  // A missing Node is reported as a FAILURE, never as a silent skip: the point of
  // this file is that the guard is Node-verified, and "we could not check" must
  // not read the same as "we checked and it was fine".
  if (!NODE) throw new Error("no Node binary found (PATH or ~/.nvm) — the F057.1 guard is UNVERIFIED");
  const r = Bun.spawnSync({
    cmd: [NODE, "--input-type=module", "-e", script],
    cwd: import.meta.dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  return { stdout: r.stdout.toString(), stderr: r.stderr.toString(), exitCode: r.exitCode ?? -1 };
}

test("Node really cannot import bun:sqlite — the premise this guard rests on", () => {
  const { stdout } = underNode(`
    try { await import("bun:sqlite"); console.log("IMPORTED"); }
    catch (e) { console.log("THREW:" + (e.code ?? e.constructor.name)); }
  `);
  expect(stdout.trim()).toBe("THREW:ERR_UNSUPPORTED_ESM_URL_SCHEME");
});

test("sqliteSink throws at SETUP on Node, before any record()", () => {
  const { stdout } = underNode(`
    const { sqliteSink } = await import("./sqlite.ts");
    let phase = "none", message = "";
    try {
      const sink = sqliteSink({ dbPath: "/tmp/f057-should-never-exist.db" });
      phase = "constructed";
      try { await sink.record({}); } catch (e) { phase = "threw-on-record"; message = e.message; }
    } catch (e) { phase = "threw-on-setup"; message = e.message; }
    console.log(JSON.stringify({ phase, message }));
  `);
  const out = JSON.parse(stdout.trim()) as { phase: string; message: string };

  // The whole fix in one assertion: setup, not the first record. If this ever
  // flips back to "threw-on-record", the error is swallowed by client.report()
  // again and cost tracking goes silently dead.
  expect(out.phase).toBe("threw-on-setup");

  // The message has to route the reader somewhere. A correct-but-mute error
  // ("Cannot find module") is what sent pitch looking for a noopSink fallback
  // that does not exist.
  expect(out.message).toContain("Bun");
  expect(out.message).toContain("upmetricsSink");
});

test("getCostSummary also refuses at setup on Node", () => {
  const { stdout } = underNode(`
    const { getCostSummary } = await import("./sqlite.ts");
    try { await getCostSummary("/tmp/f057-nope.db"); console.log("RESOLVED"); }
    catch (e) { console.log("THREW:" + e.message.slice(0, 40)); }
  `);
  expect(stdout.trim()).toStartWith("THREW:getCostSummary requires the Bun runtime");
});

// Same root cause, OPPOSITE direction — and that direction is load-bearing.
//
// sqliteBudgetStore has the identical lazy bun:sqlite import, but BudgetGuard has
// no catch and client.preflight() awaits it, so on Node the AI call THROWS. That
// is fail-closed: loud, immediate, harmless. Only the sink half failed green.
//
// This test exists so a later "make bun:sqlite Node-safe everywhere" change cannot
// quietly soften the budget half down to the sink half's old behaviour. A budget
// guard that degrades to silence would stop capping spend while still looking fine.
test("sqliteBudgetStore still fails LOUDLY on Node (direction lock)", () => {
  const { stdout } = underNode(`
    const { sqliteBudgetStore } = await import("../budget-store.ts");
    const store = sqliteBudgetStore({ dbPath: "/tmp/f057-budget.db" });
    let outcome = "resolved-silently";
    try { await store.getSpent(); } catch { outcome = "threw"; }
    console.log(outcome);
  `);
  expect(stdout.trim()).toBe("threw");
});
