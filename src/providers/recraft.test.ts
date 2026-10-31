// F070 — Recraft vectorize.
import { expect, test } from "bun:test";
import { recraftAdapter } from "./recraft.js";
import { createAI } from "../client.js";

const SPEC = { provider: "recraft", model: "vectorize", transport: "http" as const };
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h10v10z"/></svg>';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function recorder(svgBody = SVG) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const f = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/images/vectorize")) {
      return new Response(JSON.stringify({ created: 1, credits: 10, image: { image_id: "x", url: "https://img.recraft.ai/x.svg" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(svgBody, { status: 200, headers: { "content-type": "image/svg+xml" } });
  }) as typeof fetch;
  return { calls, f };
}

test("bytes go inline as a data: URL with the Bearer token; the SVG is downloaded and priced", async () => {
  const { calls, f } = recorder();
  const r = await recraftAdapter({ apiKey: "rk", fetch: f }).vectorize!({ image: PNG, spec: SPEC });
  expect(calls[0]!.url).toBe("https://external.api.recraft.ai/v1/images/vectorize");
  const h = calls[0]!.init!.headers as Record<string, string>;
  expect(h.authorization).toBe("Bearer rk");
  const body = JSON.parse(String(calls[0]!.init!.body));
  expect(body.image_url.startsWith("data:image/png;base64,")).toBe(true);
  expect(calls[1]!.url).toBe("https://img.recraft.ai/x.svg");
  expect(r.svg).toBe(SVG);
  expect(r.usage.provider).toBe("recraft");
  expect(r.usage.costUsd).toBe(0.01);
  expect(r.usage.region).toBe("unknown");
});

test("an https URL is passed through and shape_stacking is forwarded", async () => {
  const { calls, f } = recorder();
  await recraftAdapter({ apiKey: "rk", fetch: f }).vectorize!({ image: "https://x/logo.png", shapeStacking: "cut_out", spec: SPEC });
  const body = JSON.parse(String(calls[0]!.init!.body));
  expect(body).toEqual({ image_url: "https://x/logo.png", shape_stacking: "cut_out" });
});

test("no token → throws before any request", async () => {
  const saved = process.env.RECRAFT_API_TOKEN;
  delete process.env.RECRAFT_API_TOKEN;
  const { calls, f } = recorder();
  try {
    await expect(recraftAdapter({ fetch: f }).vectorize!({ image: PNG, spec: SPEC })).rejects.toThrow(/RECRAFT_API_TOKEN/);
    expect(calls).toHaveLength(0);
  } finally {
    if (saved !== undefined) process.env.RECRAFT_API_TOKEN = saved;
  }
});

test("a download that is not an SVG is refused, not returned as one", async () => {
  const { f } = recorder("<html>expired</html>");
  await expect(recraftAdapter({ apiKey: "rk", fetch: f }).vectorize!({ image: PNG, spec: SPEC })).rejects.toThrow(/not an SVG/);
});

test("ai.vectorize routes to recraft by default and reports the cost", async () => {
  const { f } = recorder();
  const rows: unknown[] = [];
  const ai = createAI({ providers: { recraft: recraftAdapter({ apiKey: "rk", fetch: f }) }, costSink: { record: (u) => void rows.push(u) } });
  const r = await ai.vectorize({ image: PNG });
  expect(r.svg).toBe(SVG);
  expect(r.usage.capability).toBe("vectorize");
  expect(rows).toHaveLength(1);
});
