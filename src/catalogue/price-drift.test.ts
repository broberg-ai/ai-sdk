// F072.1 — the nightly price check upmetrics calls.
import { expect, test } from "bun:test";
import { checkPriceDrift } from "./price-drift.js";
import { getPrice } from "../cost/pricing.js";

const perTok = (per1M: number) => String(per1M / 1_000_000);
function catalogue(data: unknown[], status = 200): typeof fetch {
  return (async () => new Response(JSON.stringify({ data }), { status, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
}

test("one priced model 20 % dearer upstream → exactly one row with both prices and the change", async () => {
  const ours = getPrice("openrouter", "minimax/minimax-m2.7")!;
  const r = await checkPriceDrift({
    fetch: catalogue([
      { id: "minimax/minimax-m2.7", pricing: { prompt: perTok(ours.inputPer1M * 1.2), completion: perTok(ours.outputPer1M) } },
      { id: "deepseek/deepseek-v4-pro", pricing: { prompt: perTok(getPrice("openrouter", "deepseek/deepseek-v4-pro")!.inputPer1M), completion: perTok(getPrice("openrouter", "deepseek/deepseek-v4-pro")!.outputPer1M) } },
    ]),
  });
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.drift).toHaveLength(1);
  const row = r.drift[0]!;
  expect(row.key).toBe("openrouter:minimax/minimax-m2.7");
  expect(row.provider).toBe("openrouter");
  expect(row.model).toBe("minimax/minimax-m2.7");
  expect(row.ours).toEqual({ inputPer1M: ours.inputPer1M, outputPer1M: ours.outputPer1M });
  expect(row.upstream.inputPer1M).toBeCloseTo(ours.inputPer1M * 1.2, 9);
  expect(row.inputChangePct).toBe(20);
  expect(row.outputChangePct).toBe(0);
  expect(r.checked).toBe(2);
  expect(r.coverage).toContain("Not covered");
});

test("unchanged prices → ok with an EMPTY drift list", async () => {
  const p = getPrice("openrouter", "minimax/minimax-m2.7")!;
  const r = await checkPriceDrift({ fetch: catalogue([{ id: "minimax/minimax-m2.7", pricing: { prompt: perTok(p.inputPer1M), completion: perTok(p.outputPer1M) } }]) });
  expect(r).toMatchObject({ ok: true, drift: [] });
});

test("an outage is { ok: false }, never an empty list that reads as 'no changes'", async () => {
  const r500 = await checkPriceDrift({ fetch: catalogue([], 500) });
  expect(r500.ok).toBe(false);
  const rNet = await checkPriceDrift({ fetch: (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch });
  expect(rNet.ok).toBe(false);
  if (!rNet.ok) expect(rNet.error).toContain("fetch failed");
  const rEmpty = await checkPriceDrift({ fetch: catalogue([]) });
  expect(rEmpty.ok).toBe(false);
});
