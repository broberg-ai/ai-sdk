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

// ── F064 — plain text-to-image on FLUX 2 (the EU route for an ordinary prompt) ──

test("ai.image({ prompt, override:{bfl, flux-2-pro} }) generates from the prompt alone, EU-pinned, region eu", async () => {
  const { createAI } = await import("../client.js");
  const calls: string[] = [];
  let body: Record<string, unknown> = {};
  const ai = createAI({
    providers: { bfl: bflAdapter({ apiKey: "k", fetch: flux2Fetch({ calls, body: (b) => (body = b), cost: 12 }) }) },
  });
  const { url, usage } = await ai.image({
    prompt: "a lighthouse at dusk",
    width: 1024,
    height: 768,
    override: { provider: "bfl", model: "flux-2-pro" },
  });
  expect(url).toBe("https://delivery.eu2.bfl.ai/x.jpeg");
  expect(body.prompt).toBe("a lighthouse at dusk");
  expect(Object.keys(body).filter((k) => k.startsWith("input_image"))).toEqual([]);
  expect(body.width).toBe(1024);
  expect(body.height).toBe(768);
  expect(body.output_format).toBe("jpeg");
  expect(calls.some((u) => u.includes("/v1/flux-2-pro"))).toBe(true);
  expect(calls.length).toBeGreaterThan(0);
  for (const u of calls) expect(u.startsWith("https://api.eu.bfl.ai/")).toBe(true);
  expect(usage.provider).toBe("bfl");
  expect(usage.region).toBe("eu");
  expect(usage.costUsd).toBe(0.12);
});

test("the finetuned model without a finetune id still refuses, and names the flux-2 route", async () => {
  const adapter = bflAdapter({ apiKey: "k", fetch: scriptedFetch({ calls: [] }) });
  await expect(adapter.image!({ prompt: "x", spec })).rejects.toThrow(/flux-2-pro/);
});

// ── F079.1 — FLUX 3 Video, image→video on the EU endpoint ──────────────────────

const videoSpec = { provider: "bfl", model: "flux-3-video", transport: "http" as const };

/** Submit (cost null, as measured), poll Pending→Reasoning→Generating→Ready with the
 *  settled cost, then the mp4 download. Shapes measured live 20/10 2026. */
function videoFetch(opts: { calls: string[]; body?: (b: Record<string, unknown>) => void; sample?: string; cost?: number | null }) {
  const statuses = ["Pending", "Reasoning", "Generating", "Ready"];
  let polls = 0;
  return (async (url: string, init?: RequestInit) => {
    opts.calls.push(url);
    const json = (p: unknown) => new Response(JSON.stringify(p), { status: 200, headers: { "content-type": "application/json" } });
    if (url.includes("/v1/flux-3-video")) {
      opts.body?.(JSON.parse(String(init?.body)));
      return json({ id: "vid-1", polling_url: "https://api.eu2.bfl.ai/v1/get_result?id=vid-1", cost: null });
    }
    if (url.includes("/v1/get_result")) {
      const status = statuses[Math.min(polls++, statuses.length - 1)];
      return json(
        status === "Ready"
          ? { status, cost: opts.cost === undefined ? 75 : opts.cost, result: { sample: opts.sample ?? "https://delivery.eu2.bfl.ai/durable/x/video.mp4?se=1" } }
          : { status, cost: null, result: null },
      );
    }
    if (url.includes("video.mp4")) return new Response(new Uint8Array([0, 0, 0, 24, 102, 116]), { status: 200, headers: { "content-type": "video/mp4" } });
    throw new Error(`unexpected fetch ${url}`);
  }) as unknown as typeof fetch;
}

test("ai.animate({ image, override:{bfl, flux-3-video} }) → i2v on api.eu.bfl.ai, bytes back, region eu, reported cost", async () => {
  const { createAI } = await import("../client.js");
  const calls: string[] = [];
  let body: Record<string, unknown> = {};
  const ai = createAI({
    costSink: null,
    providers: { bfl: bflAdapter({ apiKey: "k", pollIntervalMs: 1, fetch: videoFetch({ calls, body: (b) => (body = b) }) }) },
  });
  const r = await ai.animate({
    image: new Uint8Array([1, 2, 3]),
    prompt: "they laugh",
    durationSec: 5,
    resolution: "720p",
    override: { provider: "bfl", model: "flux-3-video" },
  });
  expect(body.mode).toBe("i2v");
  expect(body.keyframes).toEqual([Buffer.from([1, 2, 3]).toString("base64")]);
  expect(body.duration).toBe(5);
  expect(body.resolution).toBe("hd");
  expect(body.generate_audio).toBeUndefined(); // BFL default (true); the prompt directive says "no speech"
  expect(String(body.prompt).startsWith("they laugh")).toBe(true);
  expect(Array.from(r.bytes!)).toEqual([0, 0, 0, 24, 102, 116]);
  expect(r.mimeType).toBe("video/mp4");
  expect(r.usage).toMatchObject({ provider: "bfl", model: "flux-3-video", region: "eu", capability: "animate", costUsd: 0.75, costBasis: "reported" });
  // every API call stayed on the EU API host; only the download went to the EU delivery host
  expect(calls.filter((u) => !u.includes("video.mp4")).every((u) => u.startsWith("https://api.eu.bfl.ai/"))).toBe(true);
});

test("a result URL on a non-EU host is refused, never fetched", async () => {
  const calls: string[] = [];
  const adapter = bflAdapter({ apiKey: "k", pollIntervalMs: 1, fetch: videoFetch({ calls, sample: "https://delivery.bfl.ai/x/video.mp4" }) });
  await expect(adapter.animate!({ image: "https://example.com/a.jpg", prompt: "x", spec: videoSpec })).rejects.toThrow(
    "bfl animate: result URL is not on an EU host (delivery.bfl.ai) — refusing to fetch it",
  );
  expect(calls.some((u) => u.includes("video.mp4"))).toBe(false);
});

test("no settled cost → the measured hd per-second fallback, marked estimated", async () => {
  const adapter = bflAdapter({ apiKey: "k", pollIntervalMs: 1, fetch: videoFetch({ calls: [], cost: null }) });
  const r = await adapter.animate!({ image: "https://example.com/a.jpg", prompt: "x", durationSec: 6, spec: videoSpec });
  expect(r.usage.costUsd).toBeCloseTo(0.9, 9); // 6 s × $0.15
  expect(r.usage.costBasis).toBe("estimated");
});

test("FLUX 3 Video input guards: prompt required, 5–20 s, known resolution", async () => {
  const adapter = bflAdapter({ apiKey: "k", fetch: videoFetch({ calls: [] }) });
  await expect(adapter.animate!({ image: "u", spec: videoSpec })).rejects.toThrow("requires a prompt");
  await expect(adapter.animate!({ image: "u", prompt: "x", durationSec: 3, spec: videoSpec })).rejects.toThrow("durationSec must be 5–20");
  await expect(adapter.animate!({ image: "u", prompt: "x", resolution: "8k", spec: videoSpec })).rejects.toThrow('unknown resolution "8k"');
});

test("flux-3-video floats (BFL serves only `latest`): usage.floating, and strictPinning refuses it", async () => {
  const { createAI } = await import("../client.js");
  const mk = (strictPinning?: boolean) =>
    createAI({ costSink: null, strictPinning, providers: { bfl: bflAdapter({ apiKey: "k", pollIntervalMs: 1, fetch: videoFetch({ calls: [] }) }) } });
  const r = await mk().animate({ image: "u", prompt: "x", override: { provider: "bfl", model: "flux-3-video" } });
  expect(r.usage.floating).toBe(true);
  await expect(mk(true).animate({ image: "u", prompt: "x", override: { provider: "bfl", model: "flux-3-video" } })).rejects.toThrow("floats");
  const ok = await mk(true).animate({ image: "u", prompt: "x", allowFloating: true, override: { provider: "bfl", model: "flux-3-video" } });
  expect(ok.usage.floating).toBeUndefined();
});

// ── F079.2 — text→video: ai.animate without an image ─────────────────────────────

test("ai.animate({ prompt, override:{bfl, flux-3-video} }) without an image sends mode t2v and no keyframes", async () => {
  const { createAI } = await import("../client.js");
  let body: Record<string, unknown> = {};
  const ai = createAI({
    costSink: null,
    providers: { bfl: bflAdapter({ apiKey: "k", pollIntervalMs: 1, fetch: videoFetch({ calls: [], body: (b) => (body = b) }) }) },
  });
  const r = await ai.animate({ prompt: "a fox runs through snow", allowFloating: true, override: { provider: "bfl", model: "flux-3-video" } });
  expect(body.mode).toBe("t2v");
  expect(body.keyframes).toBeUndefined();
  expect(r.usage.region).toBe("eu");
});

test("image→video-only routes refuse a missing image and name the text→video route", async () => {
  const { createAI } = await import("../client.js");
  const { geminiAdapter } = await import("./gemini.js");
  const { falAdapter } = await import("./fal.js");
  const { vertexAdapter } = await import("./vertex.js");
  const noFetch = (async () => { throw new Error("must not be called"); }) as unknown as typeof fetch;
  const msg = (p: string) => `${p} animate: needs an image (image→video). For text→video use override:{ provider:"bfl", model:"flux-3-video" }.`;
  const ai = createAI({ costSink: null, providers: { gemini: geminiAdapter({ apiKey: "k", fetch: noFetch }) } });
  const seen = await ai.animate({ prompt: "x" }).then(() => "resolved", (e: Error) => e.message);
  expect(seen).toBe(msg("gemini")); // the default animate route
  for (const [name, adapter] of [["fal", falAdapter({ apiKey: "k", fetch: noFetch })], ["vertex", vertexAdapter({ fetch: noFetch } as never)]] as const) {
    const m = await adapter.animate!({ prompt: "x", spec: { provider: name, model: "m", transport: "http" } }).then(() => "resolved", (e: Error) => e.message);
    expect({ name, m }).toEqual({ name, m: msg(name) });
  }
});

// ── F079.6 — audio:false = no audio track ───────────────────────────────────────

test("audio:false on bfl/flux-3-video → generate_audio:false and the prompt carries NO audio directive", async () => {
  const { createAI } = await import("../client.js");
  let body: Record<string, unknown> = {};
  const ai = createAI({
    costSink: null,
    providers: { bfl: bflAdapter({ apiKey: "k", pollIntervalMs: 1, fetch: videoFetch({ calls: [], body: (b) => (body = b) }) }) },
  });
  await ai.animate({ image: "u", prompt: "a man walks to the desk", audio: false, allowFloating: true, override: { provider: "bfl", model: "flux-3-video" } });
  expect(body.generate_audio).toBe(false);
  expect(body.prompt).toBe("a man walks to the desk");
});

test("audio:false on a route that always makes sound is refused; a known-silent route accepts it", async () => {
  const { createAI } = await import("../client.js");
  const { geminiAdapter } = await import("./gemini.js");
  const noFetch = (async () => { throw new Error("must not be called"); }) as unknown as typeof fetch;
  const ai = createAI({ costSink: null, providers: { gemini: geminiAdapter({ apiKey: "k", fetch: noFetch }) } });
  const m = await ai.animate({ image: "u", prompt: "x", audio: false }).then(() => "resolved", (e: Error) => e.message);
  expect(m).toBe(
    'createAI: animate route "gemini:veo-3.1-generate-preview" cannot switch audio off. For a silent clip use override:{ provider:"bfl", model:"flux-3-video" }.',
  );
  // Kling makes no audio at all (ffprobe-measured, F045) — audio:false is already true of it.
  let reached = false;
  const kling = {
    name: "fal",
    animate: async () => { reached = true; return { url: "https://x/v.mp4", usage: (await import("../cost/usage.js")).freshUsage({ provider: "fal", model: "k", transport: "http", capability: "animate", inputTokens: 0, outputTokens: 0 }) }; },
  };
  const ai2 = createAI({ costSink: null, providers: { fal: kling as never } });
  await ai2.animate({ image: "u", prompt: "x", audio: false, override: { provider: "fal", model: "fal-ai/kling-video/v2.5-turbo/pro/image-to-video" } });
  expect(reached).toBe(true);
});
