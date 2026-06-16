import { expect, test } from "bun:test";
import { bflAdapter } from "./bfl.js";

const spec = { provider: "bfl", model: "flux-pro-1.1-ultra-finetuned", transport: "http" as const };

/** A scripted fetch: records every requested URL, returns submit then poll(Ready). */
function scriptedFetch(opts: { calls: string[]; sample?: string; status?: string; submit?: unknown }) {
  return (async (url: string, init?: RequestInit) => {
    opts.calls.push(url);
    const json = (payload: unknown, status = 200) =>
      new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
    if (typeof url === "string" && url.includes("/v1/flux-pro-1.1-ultra-finetuned")) {
      return json(opts.submit ?? { id: "task-1", polling_url: "https://api.eu.bfl.ai/v1/get_result?id=task-1" });
    }
    if (typeof url === "string" && url.includes("/v1/get_result")) {
      return json({ id: "task-1", status: opts.status ?? "Ready", result: { sample: opts.sample ?? "https://eu-cdn.bfl.ai/x.png" } });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as unknown as typeof fetch;
}

test("GDPR crux — every request is pinned to api.eu.bfl.ai (never global/US)", async () => {
  const calls: string[] = [];
  const adapter = bflAdapter({ apiKey: "k", fetch: scriptedFetch({ calls }) });
  await adapter.image!({ prompt: "portrait", spec, finetune: "ft-abc" });
  expect(calls.length).toBeGreaterThan(0);
  for (const u of calls) {
    expect(u.startsWith("https://api.eu.bfl.ai/")).toBe(true);
    expect(u).not.toContain("api.bfl.ai/"); // global (US-failover)
    expect(u).not.toContain("api.us.bfl.ai/");
  }
});

test("submits the finetune, polls to Ready, returns sample url + per-image cost", async () => {
  const calls: string[] = [];
  const adapter = bflAdapter({ apiKey: "k", fetch: scriptedFetch({ calls, sample: "https://eu-cdn.bfl.ai/me.png" }) });
  const { url, usage } = await adapter.image!({ prompt: "a portrait of me", spec, finetune: "ft-abc" });
  expect(url).toBe("https://eu-cdn.bfl.ai/me.png");
  expect(usage.capability).toBe("image");
  expect(usage.provider).toBe("bfl");
  expect(usage.costUsd).toBe(0.06);
  // submit hits the finetuned endpoint; poll hits get_result
  expect(calls.some((u) => u.includes("/v1/flux-pro-1.1-ultra-finetuned"))).toBe(true);
  expect(calls.some((u) => u.includes("/v1/get_result?id=task-1"))).toBe(true);
});

test("sends finetune_id, finetune_strength + derived aspect_ratio in the body", async () => {
  let body: Record<string, unknown> = {};
  const fetchMock = (async (url: string, init?: RequestInit) => {
    if (typeof url === "string" && url.includes("/v1/flux-pro-1.1-ultra-finetuned")) {
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ id: "task-1" }), { status: 200 });
    }
    return new Response(JSON.stringify({ status: "Ready", result: { sample: "https://eu-cdn.bfl.ai/x.png" } }), { status: 200 });
  }) as unknown as typeof fetch;
  const adapter = bflAdapter({ apiKey: "k", fetch: fetchMock });
  await adapter.image!({ prompt: "x", spec, finetune: "ft-9", finetuneStrength: 1.3, width: 1024, height: 1536 });
  expect(body.finetune_id).toBe("ft-9");
  expect(body.finetune_strength).toBe(1.3);
  expect(body.aspect_ratio).toBe("2:3"); // gcd-reduced 1024x1536
});

test("missing finetune id throws a clear, actionable error", async () => {
  const adapter = bflAdapter({ apiKey: "k", fetch: scriptedFetch({ calls: [] }) });
  await expect(adapter.image!({ prompt: "x", spec })).rejects.toThrow(/finetune id/);
});

test("missing BFL_API_KEY throws", async () => {
  const adapter = bflAdapter({ fetch: scriptedFetch({ calls: [] }) });
  const prev = process.env.BFL_API_KEY;
  delete process.env.BFL_API_KEY;
  try {
    await expect(adapter.image!({ prompt: "x", spec, finetune: "ft" })).rejects.toThrow(/BFL_API_KEY/);
  } finally {
    if (prev !== undefined) process.env.BFL_API_KEY = prev;
  }
});

test("a Moderated status throws (prompt/output flagged)", async () => {
  const adapter = bflAdapter({ apiKey: "k", pollIntervalMs: 1, fetch: scriptedFetch({ calls: [], status: "Content Moderated" }) });
  await expect(adapter.image!({ prompt: "x", spec, finetune: "ft" })).rejects.toThrow(/Moderated/);
});

test("ai.image({ finetune }) routes to the bfl provider", async () => {
  const { createAI } = await import("../client.js");
  const calls: string[] = [];
  const ai = createAI({ providers: { bfl: bflAdapter({ apiKey: "k", fetch: scriptedFetch({ calls, sample: "https://eu-cdn.bfl.ai/r.png" }) }) } });
  const { url, usage } = await ai.image({ prompt: "portrait of me", finetune: "ft-xyz" });
  expect(url).toBe("https://eu-cdn.bfl.ai/r.png");
  expect(usage.provider).toBe("bfl");
});

// ── F023.5 — FLUX 2 multi-reference (no training step) ───────────────────────

const flux2Spec = { provider: "bfl", model: "flux-2-max", transport: "http" as const };

/** Captures the submit body + URL; returns a Ready result with a `cost` in credits. */
function flux2Fetch(opts: { calls: string[]; body?: (b: Record<string, unknown>) => void; cost?: number }) {
  return (async (url: string, init?: RequestInit) => {
    opts.calls.push(url);
    const json = (p: unknown) => new Response(JSON.stringify(p), { status: 200, headers: { "content-type": "application/json" } });
    if (typeof url === "string" && url.includes("/get_result")) {
      return json({ status: "Ready", result: { sample: "https://delivery.eu2.bfl.ai/x.jpeg" } });
    }
    opts.body?.(JSON.parse(String(init?.body)));
    return json({ id: "task-2", polling_url: "https://api.eu2.bfl.ai/v1/get_result?id=task-2", cost: opts.cost ?? 25 });
  }) as unknown as typeof fetch;
}

test("referenceImages → input_image_N + output_format/safety + real credit cost, EU-pinned", async () => {
  const calls: string[] = [];
  let body: Record<string, unknown> = {};
  const adapter = bflAdapter({ apiKey: "k", fetch: flux2Fetch({ calls, body: (b) => (body = b), cost: 25 }) });
  const { url, usage } = await adapter.image!({
    prompt: "studio headshot",
    spec: flux2Spec,
    referenceImages: ["https://example.com/a.jpg", new Uint8Array([1, 2, 3])],
    seed: 42,
    outputFormat: "png",
    safetyTolerance: 2,
  });
  expect(url).toBe("https://delivery.eu2.bfl.ai/x.jpeg");
  expect(usage.costUsd).toBe(0.25); // 25 credits × $0.01 — the API's real billed cost
  expect(body.input_image).toBe("https://example.com/a.jpg"); // URL passes through
  expect(body.input_image_2).toBe(Buffer.from([1, 2, 3]).toString("base64")); // bytes → base64
  expect(body.output_format).toBe("png");
  expect(body.safety_tolerance).toBe(2);
  expect(body.seed).toBe(42);
  expect(body.finetune_id).toBeUndefined();
  for (const u of calls) expect(u.startsWith("https://api.eu.bfl.ai/")).toBe(true);
  expect(calls.some((u) => u.includes("/v1/flux-2-max"))).toBe(true);
});

test("a data: URI reference is stripped to plain base64", async () => {
  let body: Record<string, unknown> = {};
  const adapter = bflAdapter({ apiKey: "k", fetch: flux2Fetch({ calls: [], body: (b) => (body = b) }) });
  await adapter.image!({ prompt: "x", spec: flux2Spec, referenceImages: ["data:image/png;base64,QUJD"] });
  expect(body.input_image).toBe("QUJD"); // prefix stripped
});

test("bflCredits() reads GET /v1/credits (EU-pinned) → credits + USD", async () => {
  const { bflCredits } = await import("./bfl.js");
  const calls: string[] = [];
  const fetchMock = (async (url: string) => {
    calls.push(url);
    return new Response(JSON.stringify({ credits: 601.5 }), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  const bal = await bflCredits({ apiKey: "k", fetch: fetchMock });
  expect(bal.credits).toBe(601.5);
  expect(bal.usd).toBeCloseTo(6.015, 5); // 1 credit = $0.01
  expect(calls[0]).toBe("https://api.eu.bfl.ai/v1/credits"); // EU-pinned
});

test("bflCredits() throws without a key", async () => {
  const { bflCredits } = await import("./bfl.js");
  const prev = process.env.BFL_API_KEY;
  delete process.env.BFL_API_KEY;
  try {
    await expect(bflCredits({ fetch: (async () => new Response("{}")) as unknown as typeof fetch })).rejects.toThrow(/BFL_API_KEY/);
  } finally {
    if (prev !== undefined) process.env.BFL_API_KEY = prev;
  }
});

test("ai.image({ referenceImages }) routes to flux-2-max; override:{model} is the easy pro switch", async () => {
  const { createAI } = await import("../client.js");
  const calls: string[] = [];
  const ai = createAI({ providers: { bfl: bflAdapter({ apiKey: "k", fetch: flux2Fetch({ calls }) }) } });

  await ai.image({ prompt: "me", referenceImages: ["https://example.com/a.jpg"] });
  expect(calls.some((u) => u.includes("/v1/flux-2-max"))).toBe(true); // premium default

  const proCalls: string[] = [];
  const ai2 = createAI({ providers: { bfl: bflAdapter({ apiKey: "k", fetch: flux2Fetch({ calls: proCalls }) }) } });
  await ai2.image({ prompt: "me", referenceImages: ["https://example.com/a.jpg"], override: { model: "flux-2-pro" } });
  expect(proCalls.some((u) => u.includes("/v1/flux-2-pro"))).toBe(true); // one field switches to pro
  expect(proCalls.every((u) => u.startsWith("https://api.eu.bfl.ai/"))).toBe(true); // still EU, provider stays bfl
});
