// F093 — createAI() must survive an environment with no global `process`
// (a browser, a Tauri/WebKit webview). Reported by messages on 0.75.0:
// «ReferenceError: Can't find variable: process» at createAI({ byok:true, costSink:null }).
import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createAI } from "./client.js";
import { byokAdapter } from "./byok.js";
import { microsoftDecisionAdapter } from "./providers/microsoft-decision.js";
import { mistralAdapter } from "./providers/mistral.js";

/** Run `fn` with globalThis.process gone, the way a webview has it. */
async function withoutProcess<T>(fn: () => Promise<T> | T): Promise<T> {
  const g = globalThis as { process?: unknown };
  const saved = g.process;
  const desc = Object.getOwnPropertyDescriptor(globalThis, "process");
  Object.defineProperty(globalThis, "process", { value: undefined, configurable: true, writable: true });
  try {
    expect(typeof (globalThis as { process?: unknown }).process).toBe("undefined"); // the control: it really is gone
    return await fn();
  } finally {
    if (desc) Object.defineProperty(globalThis, "process", desc);
    else g.process = saved;
  }
}

const LIVE = { model: "microsoft-decision-1", answers: { ok: { noul: 0.97, type: "noul" } }, usage: { input_tokens: 10, output_tokens: 1 } };
const fakeAzure = (async () =>
  new Response(JSON.stringify(LIVE), { status: 200, headers: { "content-type": "application/json", "x-ms-region": "Sweden Central" } })) as unknown as typeof fetch;

test("F093 createAI({ byok:true, costSink:null }) and a judge call work with no global process", async () => {
  const r = await withoutProcess(async () => {
    const ai = createAI({
      byok: true,
      costSink: null,
      providers: {
        "microsoft-decision": byokAdapter(microsoftDecisionAdapter, { endpoint: "https://e.example", apiKey: "k", deployment: "d", fetch: fakeAzure }),
      },
    });
    return ai.judge({ state: "The Godfater", questions: { ok: { type: "noul", instructions: "Is it The Godfather?" } } });
  });
  expect(r.answers.ok).toEqual({ type: "noul", noul: 0.97 } as never);
  expect(r.usage.provider).toBe("microsoft-decision");
  expect(r.usage.region).toBe("eu");
});

test("F093 an adapter with no key says its own 'not set', not ReferenceError, with no global process", async () => {
  const msg = await withoutProcess(async () => {
    const noFetch = (async () => { throw new Error("must not be called"); }) as unknown as typeof fetch;
    const ai = createAI({ costSink: null, agentName: "env-guard-test", providers: { mistral: mistralAdapter({ fetch: noFetch }) } });
    return ai.chat({ prompt: "hej", tier: "cheap" }).then(() => "resolved", (e: Error) => `${e.name}: ${e.message}`);
  });
  expect(msg).not.toContain("ReferenceError");
  expect(msg).toContain("API key not set");
});

test("F093 no bare process.env in src/ outside src/env.ts — the form must not come back", () => {
  const root = join(import.meta.dir);
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (!p.endsWith(".ts") || p.endsWith(".test.ts") || p === join(root, "env.ts")) continue;
      readFileSync(p, "utf8").split("\n").forEach((line, i) => {
        const t = line.trimStart();
        if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
        if (/\bprocess\.env\b/.test(line)) offenders.push(`${p.slice(root.length + 1)}:${i + 1}`);
      });
    }
  };
  walk(root);
  expect(offenders).toEqual([]);
});
