import { expect, test } from "bun:test";
import { geminiAdapter } from "./gemini.js";

const spec = { provider: "gemini", model: "veo-3.1-generate-preview", transport: "http" as const };

/** Scripts the Veo flow: submit → poll(once pending, then done) → download bytes. */
function veoFetch(opts: { calls: string[]; bodies?: unknown[]; uri?: string; videoBytes?: Uint8Array }) {
  let polls = 0;
  return (async (url: string, init?: RequestInit) => {
    opts.calls.push(url);
    const json = (p: unknown) => new Response(JSON.stringify(p), { status: 200, headers: { "content-type": "application/json" } });
    if (typeof url === "string" && url.includes(":predictLongRunning")) {
      opts.bodies?.push(JSON.parse(String(init?.body)));
      return json({ name: "operations/abc123" });
    }
    if (typeof url === "string" && url.includes("operations/abc123")) {
      polls++;
      if (polls < 2) return json({ done: false });
      return json({
        done: true,
        response: { generateVideoResponse: { generatedSamples: [{ video: { uri: opts.uri ?? "https://generativelanguage.googleapis.com/v1beta/files/xyz:download" } }] } },
      });
    }
    // the video download
    return new Response(opts.videoBytes ?? new Uint8Array([0, 1, 2, 3]), { status: 200, headers: { "content-type": "video/mp4" } });
  }) as unknown as typeof fetch;
}

test("Veo image-to-video: submit → poll → download bytes, builds inlineData + parameters", async () => {
  const calls: string[] = [];
  const bodies: unknown[] = [];
  const adapter = geminiAdapter({ apiKey: "k", pollIntervalMs: 1, fetch: veoFetch({ calls, bodies, videoBytes: new Uint8Array([9, 9, 9]) }) });
  const { url, bytes, mimeType, usage } = await adapter.animate!({
    image: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), // PNG magic
    prompt: "the subject turns and smiles",
    durationSec: 8,
    resolution: "720p",
    spec,
  });
  expect(url).toContain(":download");
  expect(bytes).toEqual(new Uint8Array([9, 9, 9])); // downloaded video bytes
  expect(mimeType).toBe("video/mp4");
  expect(usage.capability).toBe("animate");
  expect(usage.provider).toBe("gemini");
  // request shape
  const body = bodies[0] as { instances: { prompt: string; image: { bytesBase64Encoded: string; mimeType: string } }[]; parameters: Record<string, unknown> };
  const inst = body.instances[0]!;
  expect(inst.prompt).toBe("the subject turns and smiles");
  expect(inst.image.mimeType).toBe("image/png"); // sniffed from PNG magic
  expect(typeof inst.image.bytesBase64Encoded).toBe("string"); // Veo's predict image field
  expect(body.parameters.durationSeconds).toBe(8); // number, per the live Veo API
  expect(body.parameters.resolution).toBe("720p");
  // submit + 2 polls + download
  expect(calls.some((u) => u.includes(":predictLongRunning"))).toBe(true);
  expect(calls.filter((u) => u.includes("operations/abc123")).length).toBe(2);
});

test("a done operation with no video uri throws", async () => {
  const fetchMock = (async (url: string) => {
    const json = (p: unknown) => new Response(JSON.stringify(p), { status: 200 });
    if (typeof url === "string" && url.includes(":predictLongRunning")) return json({ name: "operations/x" });
    return json({ done: true, response: {} });
  }) as unknown as typeof fetch;
  const adapter = geminiAdapter({ apiKey: "k", pollIntervalMs: 1, fetch: fetchMock });
  await expect(adapter.animate!({ image: new Uint8Array([1]), spec })).rejects.toThrow(/no video uri/);
});

test("ai.animate({ image }) routes to gemini Veo by default", async () => {
  const { createAI } = await import("../client.js");
  const calls: string[] = [];
  const ai = createAI({ providers: { gemini: geminiAdapter({ apiKey: "k", pollIntervalMs: 1, fetch: veoFetch({ calls }) }) } });
  const { usage } = await ai.animate({ image: new Uint8Array([0xff, 0xd8]), prompt: "move" });
  expect(usage.provider).toBe("gemini");
  expect(usage.model).toBe("veo-3.1-generate-preview");
  expect(calls.some((u) => u.includes("veo-3.1-generate-preview:predictLongRunning"))).toBe(true);
});
