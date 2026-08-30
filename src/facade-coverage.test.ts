// F043.5 — the four capabilities no test drove through the PUBLIC path.
//
// components' synthesis of three separate faults found across the fleet today: the
// common shape is not too few tests, it is that THE CHECK RUNS DOWN A DIFFERENT PATH
// THAN PRODUCTION. A test that never touches the layer that can fail is green for the
// wrong reason — an active misdirection, not merely missing coverage.
//
// Measured on this suite before writing these: 36 test files call an adapter directly,
// 27 go through createAI, and trainStyle / ocr / moderate / batch were driven through
// the facade by NOTHING — each with a Zod schema that runs on every real call and that
// no test had ever seen say yes. That is exactly where the args/arguments fault hid.
//
// These assert the call ARRIVES AT THE ADAPTER with the spec we expect. "It did not
// throw" is deliberately not the assertion: a silently stripped field looks identical.
import { expect, test } from "bun:test";
import { createAI } from "./client.js";
import { freshUsage } from "./cost/usage.js";
import type { Capability, ProviderAdapter, TierSpec } from "./types.js";

type Seen = { spec?: TierSpec; payload?: unknown };

function spyProviders(seen: Seen): Record<string, ProviderAdapter> {
  const capture = (payload: unknown, spec: TierSpec, capability: Capability) => {
    seen.payload = payload;
    seen.spec = spec;
    // A real adapter always returns a Usage; the client stamps it. Handing back
    // undefined would be testing our own stub, not the facade.
    return freshUsage({
      provider: spec.provider,
      model: spec.model,
      transport: "http",
      capability,
      inputTokens: 1,
      outputTokens: 1,
    });
  };
  const spy: ProviderAdapter = {
    async trainStyle(req: never) {
      const usage = capture(req, (req as { spec: TierSpec }).spec, "trainStyle" as Capability);
      return { loraId: "lora-1", usage };
    },
    async ocr(req: never) {
      const usage = capture(req, (req as { spec: TierSpec }).spec, "ocr" as Capability);
      return { text: "ok", pages: [], usage };
    },
    async moderate(req: never) {
      const usage = capture(req, (req as { spec: TierSpec }).spec, "moderate" as Capability);
      return { flagged: false, categories: {}, usage };
    },
    async batchSubmit(req: { items: unknown[]; spec: TierSpec }) {
      capture(req, req.spec, "chat");
      return { id: "job-1", status: "queued" } as never;
    },
    async batchStatus(req: { jobId: string; spec: TierSpec }) {
      capture(req, req.spec, "chat");
      return { id: req.jobId, status: "queued" } as never;
    },
    async batchResults(req: { jobId: string; spec: TierSpec }) {
      capture(req, req.spec, "chat");
      return [] as never;
    },
  } as unknown as ProviderAdapter;
  return { mistral: spy, fal: spy, bfl: spy };
}

test("ocr reaches the adapter through the public facade, with its schema run", async () => {
  const seen: Seen = {};
  const ai = createAI({ providers: spyProviders(seen), costSink: null });
  await ai.ocr({ document: "https://example.test/a.pdf" });
  expect(seen.spec?.provider).toBe("mistral");
  // The input survived validation rather than being stripped to nothing.
  expect((seen.payload as { document: string }).document).toBe("https://example.test/a.pdf");
});

test("trainStyle reaches the adapter through the public facade", async () => {
  const seen: Seen = {};
  const ai = createAI({ providers: spyProviders(seen), costSink: null });
  await ai.trainStyle({ images: ["https://example.test/a.png", "https://example.test/b.png"] });
  expect(seen.spec?.provider).toBe("fal");
  // Both images survived validation — an array field that silently became one item,
  // or none, is the shape a "did not throw" assertion cannot tell apart from success.
  expect((seen.payload as { images: string[] }).images).toEqual([
    "https://example.test/a.png",
    "https://example.test/b.png",
  ]);
});

test("moderate reaches the adapter through the public facade", async () => {
  const seen: Seen = {};
  const ai = createAI({ providers: spyProviders(seen), costSink: null });
  await ai.moderate({ input: "hej med dig" });
  expect(seen.spec?.provider).toBe("mistral");
  // The facade NORMALISES a single string into an array before the adapter sees it —
  // which this test found, and which is the reason to drive the real path: an
  // adapter-level test would have asserted the shape the adapter is handed by hand
  // and never learned that the facade reshapes it.
  expect((seen.payload as { input: string[] }).input).toEqual(["hej med dig"]);
});

test("batch.submit reaches the adapter through the public facade", async () => {
  const seen: Seen = {};
  const ai = createAI({ providers: spyProviders(seen), costSink: null });
  await ai.batch.submit({ requests: [{ customId: "1", messages: [{ role: "user", content: "hej" }] }] as never });
  expect(seen.spec?.provider).toBe("mistral");
  expect((seen.payload as { items: unknown[] }).items).toHaveLength(1);
});

test("batch.status and batch.results guard the override like batch.submit does", () => {
  // 2 of 3 methods in this namespace still merged the override raw after F043.2 —
  // the same "guard at some of the call sites" fault, one namespace deeper.
  const ai = createAI({ providers: spyProviders({}), costSink: null });
  const foreign = { provider: "fal" } as TierSpec;
  expect(ai.batch.status("job-1", foreign)).rejects.toThrow(/belongs to "mistral"/);
  expect(ai.batch.results("job-1", foreign)).rejects.toThrow(/belongs to "mistral"/);
});
