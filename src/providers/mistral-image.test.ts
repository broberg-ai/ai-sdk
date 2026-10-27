import { expect, test } from "bun:test";
import { mistralAdapter } from "./mistral.js";
import { createAI } from "../client.js";
import { byokAdapter } from "../byok.js";

const URL_ = "https://mistralaiblackforestprod.blob.core.windows.net/images/x/image.jpg?se=2026-10-27T01%3A06%3A04Z&sig=abc";
// Shape measured live 2026-10-27 (trimmed).
const LIVE = {
  outputs: [
    { type: "tool.execution", name: "image_generation", info: { result: JSON.stringify({ url: URL_ }) }, content: null },
    { type: "message.output", content: "done" },
  ],
  usage: { prompt_tokens: 173, completion_tokens: 3, connectors: { image_generation: 1 } },
};
const spec = { provider: "mistral", model: "mistral-small-2603", transport: "http" as const };

function convFetch(body: unknown = LIVE) {
  const seen: { url: string; auth: string | null; body: any }[] = [];
  const f = (async (url: string | URL, init?: RequestInit) => {
    seen.push({ url: String(url), auth: new Headers(init!.headers).get("authorization"), body: JSON.parse(String(init!.body)) });
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { f, seen };
}

test("posts one inline conversation with the image tool and store:false, and returns the tool's URL (F084)", async () => {
  const { f, seen } = convFetch();
  const r = await mistralAdapter({ apiKey: "k", fetch: f }).image!({ prompt: "a lighthouse", spec });
  expect(seen[0]!.url).toBe("https://api.mistral.ai/v1/conversations");
  expect(seen[0]!.body.model).toBe("mistral-small-2603");
  expect(seen[0]!.body.inputs).toBe("a lighthouse");
  expect(seen[0]!.body.tools).toEqual([{ type: "image_generation" }]);
  expect(seen[0]!.body.store).toBe(false);
  expect(r.url).toBe(URL_);
});

test("usage = exact token cost + an estimated per-image price, region eu (F084)", async () => {
  const { f } = convFetch();
  const r = await mistralAdapter({ apiKey: "k", fetch: f }).image!({ prompt: "x", spec });
  const tokens = (173 / 1e6) * 0.15 + (3 / 1e6) * 0.6;
  expect(r.usage.costUsd).toBeCloseTo(tokens + 0.1, 9);
  expect(r.usage.costBasis).toBe("estimated");
  expect(r.usage.region).toBe("eu");
  expect(r.usage.capability).toBe("image");
});

test("options Mistral's tool cannot honour throw with a bfl hint — never silently dropped (F084)", async () => {
  const { f, seen } = convFetch();
  const a = mistralAdapter({ apiKey: "k", fetch: f });
  await expect(a.image!({ prompt: "x", width: 512, spec })).rejects.toThrow(/width\/height.*bfl/);
  await expect(a.image!({ prompt: "x", referenceImages: ["https://a/b.png"], seed: 1, spec })).rejects.toThrow(/referenceImages, seed/);
  expect(seen.length).toBe(0);
});

test("a reply without an image throws and quotes what the model said (F084)", async () => {
  const { f } = convFetch({ outputs: [{ type: "message.output", content: "I cannot draw that." }], usage: {} });
  await expect(mistralAdapter({ apiKey: "k", fetch: f }).image!({ prompt: "x", spec })).rejects.toThrow(/no image \(I cannot draw that\.\)/);
});

test("works BYOK: createAI({ byok:true }) with byokAdapter(mistralAdapter) sends the customer's key (F084)", async () => {
  const { f, seen } = convFetch();
  const ai = createAI({ byok: true, costSink: null, providers: { mistral: byokAdapter(mistralAdapter, { apiKey: "customer-key", fetch: f }) } });
  const r = await ai.image({ prompt: "x", override: { provider: "mistral", model: "mistral-small-2603" } });
  expect(seen[0]!.auth).toBe("Bearer customer-key");
  expect(r.url).toBe(URL_);
});
