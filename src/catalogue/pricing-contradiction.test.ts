// F048 — the price table must not answer the same question two ways.
//
// upmetrics reported 12 "unknown models". Measuring that report found something worse
// than a gap: `claude-haiku-4-5` said $0.80/$4.00 and `anthropic/claude-haiku-4.5` said
// $1.00/$5.00 — the SAME model, two rows, two prices, and the shorter and likelier id
// carried the wrong one. A consumer's answer depended on which spelling they happened
// to type. On their real volume (68M haiku tokens) that is 20% understated, not a
// rounding difference.
//
// A gap announces itself: `undefined` is visibly nothing. A contradiction does not —
// both answers look like answers. So this is the check that has to be automatic.
import { expect, test } from "bun:test";
import { listModelPrices, getModelPrice } from "./pricing-api.js";

/** Same model, written differently. Lowercase, dots→dashes, drop a `vendor/` prefix.
 *  A `:suffix` is KEPT: `…:batch` is a genuinely different product at a genuinely
 *  different price (50% off), and folding it in would manufacture false contradictions. */
function modelKey(model: string): string {
  const m = model.toLowerCase().replaceAll(".", "-");
  const slash = m.lastIndexOf("/");
  return slash === -1 ? m : m.slice(slash + 1);
}

test("no two rows price the same model differently", () => {
  const byKey = new Map<string, { model: string; inp: number; out: number }[]>();
  for (const e of listModelPrices()) {
    const k = modelKey(e.model);
    const list = byKey.get(k) ?? [];
    list.push({ model: e.model, inp: e.inputPer1M, out: e.outputPer1M });
    byKey.set(k, list);
  }

  const contradictions: string[] = [];
  for (const [k, rows] of byKey) {
    const distinct = new Set(rows.map((r) => `${r.inp}/${r.out}`));
    if (distinct.size > 1) {
      // Name the model AND every price. A count cannot tell the next reader which row
      // to trust, and "which one is right" is the only question worth asking here.
      contradictions.push(`${k}: ${rows.map((r) => `${r.model}=$${r.inp}/$${r.out}`).join("  vs  ")}`);
    }
  }
  expect(contradictions).toEqual([]);
});

test("the guard can SEE a contradiction — it is not green by construction", () => {
  // Without this, a modelKey() that accidentally made every key unique would pass the
  // test above forever while checking nothing.
  const rows = [
    { model: "anthropic/claude-x.5", inp: 1, out: 5 },
    { model: "claude-x-5", inp: 0.8, out: 4 },
  ];
  const keys = new Set(rows.map((r) => modelKey(r.model)));
  expect(keys.size).toBe(1);
  expect(new Set(rows.map((r) => `${r.inp}/${r.out}`)).size).toBe(2);
});

test("a batch variant is NOT a contradiction — it is a different product", () => {
  // ":batch" is legitimately ~50% off. Folding it into the base key would make the
  // guard cry wolf on every model that has one, and a guard that cries wolf gets
  // switched off.
  expect(modelKey("anthropic/claude-haiku-4.5:batch")).not.toBe(modelKey("claude-haiku-4-5"));
});

test("the dated snapshot resolves — the id upmetrics actually sent us", () => {
  // Not a constructed example: this exact string appeared on 19,456 real calls, and
  // getModelPrice returned undefined while the INTERNAL getPrice had handled dated
  // suffixes since F012. Same repo, two lookups, one fix.
  const dated = getModelPrice("claude-haiku-4-5-20251001");
  const base = getModelPrice("claude-haiku-4-5");
  // F050.2 — narrowing is now required, and that is the feature: reading inputPer1M
  // off an un-narrowed row is a compile error rather than a 0 that reads as free.
  expect(dated?.unit).toBe("per_1m_tokens");
  expect(base?.unit).toBe("per_1m_tokens");
  if (dated?.unit !== "per_1m_tokens" || base?.unit !== "per_1m_tokens") throw new Error("not token-priced");
  expect(dated.inputPer1M).toBe(base.inputPer1M);
  expect(dated.outputPer1M).toBe(base.outputPer1M);
  // And the value itself is Anthropic's published rate, not the one we used to carry.
  expect(base.inputPer1M).toBe(1.0);
  expect(base.outputPer1M).toBe(5.0);
});

test("an id with no dated suffix is unaffected", () => {
  // Negative control on the strip: it must not mangle a model whose name ends in digits.
  expect(getModelPrice("mistral-large-latest")).toBeDefined();
  expect(getModelPrice("definitely-not-a-model-20990101")).toBeUndefined();
});
