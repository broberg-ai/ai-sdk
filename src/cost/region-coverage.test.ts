// F043.7 — "the adapter forgot" must not look identical to "genuinely unknowable".
//
// components' point (#24232), from their own `scanned` field: "we looked and found
// nothing" has to be separable from "we never looked". `usage.region` had exactly that
// collapse. An adapter that omits `region` falls back to the provider-NAME table, and
// for a provider deliberately absent from that table (because its baseUrl is
// configurable) the answer is "unknown" — byte-identical to an aggregator's honest
// "we cannot know".
//
// It cost a live regression: removing mistral from the name table in 0.36.0 was
// correct, but mistralAdapter's OWN capabilities (ocr/moderate/embedding/transcribe)
// pass no region, so they silently started reporting "unknown" on the designated
// personal-data provider. It failed CLOSED — a consumer enforcing region === "eu"
// refuses a legitimately EU call — which is the safe direction and still wrong.
//
// So this is structural: an adapter may omit `region` ONLY if its provider's endpoint
// is fixed in code, i.e. it appears in the name table. Anything else must pass one.
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { mistralAdapter } from "../providers/mistral.js";

const DIR = new URL("../providers/", import.meta.url).pathname;
const REGION_SRC = readFileSync(new URL("./region.ts", import.meta.url).pathname, "utf8");

/** Providers whose endpoint is fixed in code, read from the table itself rather than
 *  duplicated here — a second copy is the drift this whole feature exists to stop. */
function fixedProviders(): string[] {
  const block = REGION_SRC.split("const FIXED_PROVIDER_REGION")[1]!.split("};")[0]!;
  return [...block.matchAll(/^\s{2}([a-z]+):/gm)].map((m) => m[1]!);
}

test("an adapter omits `region` only when its provider's endpoint is fixed in code", () => {
  const fixed = fixedProviders();
  expect(fixed.length).toBeGreaterThan(5); // the parse worked at all
  const offenders: string[] = [];

  for (const file of readdirSync(DIR).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))) {
    const code = readFileSync(DIR + file, "utf8");
    // Each freshUsage({...}) literal, with the provider it names.
    for (const m of code.matchAll(/freshUsage\(\{([\s\S]{0,600}?)\}\)/g)) {
      const body = m[1]!;
      const provider = body.match(/provider:\s*"([a-z-]+)"/)?.[1] ?? body.match(/provider:\s*config\.name/)?.[0];
      if (!provider) continue;
      if (/\bregion:/.test(body)) continue; // passes one explicitly — fine
      if (provider === "config.name" || fixed.includes(provider)) continue;
      offenders.push(`${file}  provider "${provider}" omits region and is NOT in the fixed table`);
    }
  }

  expect(offenders).toEqual([]);
});

// ── the regression itself, asserted at the adapter ───────────────────────────

const spec = { provider: "mistral", model: "mistral-small-latest", transport: "http" as const };
const fakeFetch = (async () =>
  new Response(
    JSON.stringify({
      pages: [{ markdown: "x" }],
      usage_info: { pages_processed: 1 },
      results: [{ categories: {}, category_scores: {} }],
      data: [{ embedding: [0.1] }],
      usage: { prompt_tokens: 1, total_tokens: 1 },
      text: "hej",
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  )) as unknown as typeof fetch;

test("Mistral's own capabilities report eu — they reported unknown in 0.36.0", async () => {
  const a = mistralAdapter({ apiKey: "k", fetch: fakeFetch });
  expect((await a.ocr!({ document: "https://x.test/a.pdf", spec } as never)).usage.region).toBe("eu");
  expect((await a.moderate!({ input: ["hej"], spec } as never)).usage.region).toBe("eu");
  expect((await a.embedding!({ input: ["hej"], spec } as never)).usage.region).toBe("eu");
});

test("…and a custom Mistral gateway is NOT eu — the fix reads the host, not the name", async () => {
  // Without this the fix would just be the old lie re-hardcoded one level down.
  const a = mistralAdapter({ apiKey: "k", fetch: fakeFetch, baseUrl: "https://my-gateway.example/v1" });
  expect((await a.ocr!({ document: "https://x.test/a.pdf", spec } as never)).usage.region).not.toBe("eu");
  expect((await a.embedding!({ input: ["hej"], spec } as never)).usage.region).not.toBe("eu");
});
