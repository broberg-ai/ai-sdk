import { expect, test } from "bun:test";
import { falAdapter } from "./fal.js";
import type { ImageRequest } from "../types.js";

const req: ImageRequest = {
  prompt: "a cat in Blokhus",
  spec: { provider: "fal", model: "fal-ai/flux/schnell", transport: "http" },
  width: 512,
  height: 512,
};

test("sync mode: POSTs fal.run/{model} with Key auth, returns image url", async () => {
  const seen: { url: string; headers: Record<string, string>; body: any }[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    seen.push({ url: String(url), headers: init!.headers as Record<string, string>, body: JSON.parse(init!.body as string) });
    return new Response(JSON.stringify({ images: [{ url: "https://fal.media/out.png" }] }), { status: 200 });
  }) as unknown as typeof fetch;
  const a = falAdapter({ apiKey: "fk", fetch: fetchImpl });
  const res = await a.image!(req);
  expect(seen[0]?.url).toBe("https://fal.run/fal-ai/flux/schnell");
  expect(seen[0]?.headers["Authorization"]).toBe("Key fk");
  expect(seen[0]?.body.image_size).toEqual({ width: 512, height: 512 });
  expect(res.url).toBe("https://fal.media/out.png");
  expect(res.usage.provider).toBe("fal");
  expect(res.usage.capability).toBe("image");
  expect(res.usage.costUsd).toBeCloseTo(0.003, 6); // flux/schnell per-image estimate
});

test("pricePerImage config overrides the per-image estimate", async () => {
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ images: [{ url: "u" }] }), { status: 200 })) as unknown as typeof fetch;
  const a = falAdapter({ apiKey: "fk", pricePerImage: 0.5, fetch: fetchImpl });
  const res = await a.image!(req);
  expect(res.usage.costUsd).toBe(0.5);
});

test("queue mode: polls IN_PROGRESS → COMPLETED then fetches the result", async () => {
  let statusCalls = 0;
  const fetchImpl = (async (url: string) => {
    const u = String(url);
    if (u === "https://queue.fal.run/fal-ai/flux/dev") {
      return new Response(
        JSON.stringify({ request_id: "r1", status_url: "https://q/status", response_url: "https://q/result" }),
        { status: 200 },
      );
    }
    if (u === "https://q/status") {
      statusCalls++;
      return new Response(JSON.stringify({ status: statusCalls < 2 ? "IN_PROGRESS" : "COMPLETED" }), { status: 200 });
    }
    if (u === "https://q/result") {
      return new Response(JSON.stringify({ images: [{ url: "https://fal.media/dev.png" }] }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;
  const a = falAdapter({ apiKey: "fk", mode: "queue", pollIntervalMs: 1, fetch: fetchImpl });
  const res = await a.image!({ ...req, spec: { ...req.spec, model: "fal-ai/flux/dev" } });
  expect(res.url).toBe("https://fal.media/dev.png");
  expect(statusCalls).toBeGreaterThanOrEqual(2);
});

test("queue mode: FAILED status throws", async () => {
  const fetchImpl = (async (url: string) => {
    const u = String(url);
    if (u.startsWith("https://queue.fal.run/"))
      return new Response(JSON.stringify({ status_url: "https://q/s", response_url: "https://q/r" }), { status: 200 });
    return new Response(JSON.stringify({ status: "FAILED" }), { status: 200 });
  }) as unknown as typeof fetch;
  const a = falAdapter({ apiKey: "fk", mode: "queue", pollIntervalMs: 1, fetch: fetchImpl });
  await expect(a.image!(req)).rejects.toThrow(/FAILED/);
});

test("queue mode: times out if never COMPLETED", async () => {
  const fetchImpl = (async (url: string) => {
    const u = String(url);
    if (u.startsWith("https://queue.fal.run/"))
      return new Response(JSON.stringify({ status_url: "https://q/s", response_url: "https://q/r" }), { status: 200 });
    return new Response(JSON.stringify({ status: "IN_PROGRESS" }), { status: 200 });
  }) as unknown as typeof fetch;
  const a = falAdapter({ apiKey: "fk", mode: "queue", pollIntervalMs: 1, timeoutMs: 5, fetch: fetchImpl });
  await expect(a.image!(req)).rejects.toThrow(/timed out/);
});

test("animate: blessed Kling i2v model bills the published $0.07/sec (cost not silently 0)", async () => {
  const fetchImpl = (async (url: string) => {
    const u = String(url);
    if (u.startsWith("https://queue.fal.run/"))
      return new Response(JSON.stringify({ status_url: "https://q/s", response_url: "https://q/r" }), { status: 200 });
    if (u === "https://q/s") return new Response(JSON.stringify({ status: "COMPLETED" }), { status: 200 });
    if (u === "https://q/r")
      return new Response(JSON.stringify({ video: { url: "https://fal.media/out.mp4" } }), { status: 200 });
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;
  const a = falAdapter({ apiKey: "fk", pollIntervalMs: 1, fetch: fetchImpl });
  const res = await a.animate!({
    image: "https://ex/in.png",
    durationSec: 5,
    spec: { provider: "fal", model: "fal-ai/kling-video/v2.5-turbo/pro/image-to-video", transport: "http" },
  });
  expect(res.url).toBe("https://fal.media/out.mp4");
  expect(res.usage.capability).toBe("animate");
  expect(res.usage.costUsd).toBeCloseTo(0.35, 6); // 0.07/sec × 5s — NOT 0
});

test("animate: config.pricePerSecond overrides the blessed per-second rate", async () => {
  const fetchImpl = (async (url: string) => {
    const u = String(url);
    if (u.startsWith("https://queue.fal.run/"))
      return new Response(JSON.stringify({ status_url: "https://q/s", response_url: "https://q/r" }), { status: 200 });
    if (u === "https://q/s") return new Response(JSON.stringify({ status: "COMPLETED" }), { status: 200 });
    return new Response(JSON.stringify({ video: { url: "https://fal.media/o.mp4" } }), { status: 200 });
  }) as unknown as typeof fetch;
  const a = falAdapter({ apiKey: "fk", pricePerSecond: 0.1, pollIntervalMs: 1, fetch: fetchImpl });
  const res = await a.animate!({
    image: "https://ex/in.png",
    durationSec: 4,
    spec: { provider: "fal", model: "fal-ai/kling-video/v2.5-turbo/pro/image-to-video", transport: "http" },
  });
  expect(res.usage.costUsd).toBeCloseTo(0.4, 6); // 0.1 × 4s, override wins
});

test("missing FAL_KEY throws", async () => {
  const prev = process.env.FAL_KEY;
  delete process.env.FAL_KEY;
  await expect(falAdapter({}).image!(req)).rejects.toThrow(/FAL_KEY not set/);
  if (prev !== undefined) process.env.FAL_KEY = prev;
});
