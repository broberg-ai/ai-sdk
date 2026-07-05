import { expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { vertexAdapter } from "./vertex.js";

const spec = { provider: "vertex", model: "veo-3.1-generate-preview", transport: "http" as const };

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const CREDS = JSON.stringify({ client_email: "test@example.iam.gserviceaccount.com", private_key: privateKey });

/** Scripts the full Vertex flow: token exchange → submit → poll(pending, then done) → inline bytes. */
function vertexFetch(opts: {
  calls: string[];
  bodies?: unknown[];
  headers?: Headers[];
  videoB64?: string;
  video?: { bytesBase64Encoded?: string; gcsUri?: string; mimeType?: string };
  tokenCalls?: { count: number };
}) {
  let polls = 0;
  return (async (url: string, init?: RequestInit) => {
    opts.calls.push(url);
    opts.headers?.push(new Headers(init?.headers));
    const json = (p: unknown, status = 200) => new Response(JSON.stringify(p), { status, headers: { "content-type": "application/json" } });
    if (url === "https://oauth2.googleapis.com/token") {
      if (opts.tokenCalls) opts.tokenCalls.count++;
      return json({ access_token: "fake-access-token", expires_in: 3600 });
    }
    if (url.includes(":predictLongRunning")) {
      opts.bodies?.push(JSON.parse(String(init?.body)));
      return json({ name: "projects/p/locations/europe-west1/operations/abc123" });
    }
    if (url.includes("operations/abc123")) {
      polls++;
      if (polls < 2) return json({ done: false });
      const video = opts.video ?? { bytesBase64Encoded: opts.videoB64 ?? Buffer.from([9, 9, 9]).toString("base64"), mimeType: "video/mp4" };
      return json({ done: true, response: { videos: [video] } });
    }
    return json({}, 404);
  }) as unknown as typeof fetch;
}

test("animate: mints Bearer token, submits to region-pinned EU URL, polls, decodes inline bytes", async () => {
  const calls: string[] = [];
  const bodies: unknown[] = [];
  const headers: Headers[] = [];
  const adapter = vertexAdapter({
    credentials: CREDS,
    project: "my-project",
    fetch: vertexFetch({ calls, bodies, headers, videoB64: Buffer.from([1, 2, 3]).toString("base64") }),
    pollIntervalMs: 1,
  });
  const { url, bytes, mimeType, usage } = await adapter.animate!({
    image: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), // PNG magic
    prompt: "the subject turns and smiles",
    durationSec: 8,
    resolution: "720p",
    spec,
  });

  expect(url).toContain("operations/abc123");
  expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
  expect(mimeType).toBe("video/mp4");
  expect(usage.provider).toBe("vertex");
  expect(usage.capability).toBe("animate");
  expect(usage.costUsd).toBeCloseTo(0.4 * 8, 9); // veo-3.1-generate-preview rate

  // region-pinned EU host + correct project/model in the submit URL
  const submitUrl = calls.find((u) => u.includes(":predictLongRunning"))!;
  expect(submitUrl).toBe(
    "https://europe-west1-aiplatform.googleapis.com/v1/projects/my-project/locations/europe-west1/publishers/google/models/veo-3.1-generate-preview:predictLongRunning",
  );
  // Bearer auth header carries the minted token
  const submitHeaders = headers[calls.indexOf(submitUrl)]!;
  expect(submitHeaders.get("authorization")).toBe("Bearer fake-access-token");

  // request body matches the proven Veo shape
  const body = bodies[0] as { instances: { prompt: string; image: { bytesBase64Encoded: string; mimeType: string } }[]; parameters: Record<string, unknown> };
  expect(body.instances[0]!.prompt).toBe("the subject turns and smiles");
  expect(body.instances[0]!.image.mimeType).toBe("image/png");
  expect(body.parameters.durationSeconds).toBe(8); // number, not string
  expect(body.parameters.resolution).toBe("720p");

  expect(calls.some((u) => u === "https://oauth2.googleapis.com/token")).toBe(true);
  expect(calls.filter((u) => u.includes("operations/abc123")).length).toBe(2);
});

test("custom region overrides the default europe-west1", async () => {
  const calls: string[] = [];
  const adapter = vertexAdapter({ credentials: CREDS, project: "p", region: "europe-north1", fetch: vertexFetch({ calls }), pollIntervalMs: 1 });
  await adapter.animate!({ image: new Uint8Array([1]), spec });
  expect(calls.some((u) => u.startsWith("https://europe-north1-aiplatform.googleapis.com/"))).toBe(true);
});

test("a gcsUri-only response throws a clear 'not supported yet' error, not a silent mis-parse", async () => {
  const adapter = vertexAdapter({
    credentials: CREDS,
    project: "p",
    fetch: vertexFetch({ calls: [], video: { gcsUri: "gs://bucket/clip.mp4" } }),
    pollIntervalMs: 1,
  });
  await expect(adapter.animate!({ image: new Uint8Array([1]), spec })).rejects.toThrow(/gcsUri/);
});

test("a done operation with no video throws", async () => {
  const fetchMock = (async (url: string) => {
    const json = (p: unknown) => new Response(JSON.stringify(p), { status: 200 });
    if (url === "https://oauth2.googleapis.com/token") return json({ access_token: "t", expires_in: 3600 });
    if (url.includes(":predictLongRunning")) return json({ name: "operations/x" });
    return json({ done: true, response: {} });
  }) as unknown as typeof fetch;
  const adapter = vertexAdapter({ credentials: CREDS, project: "p", fetch: fetchMock, pollIntervalMs: 1 });
  await expect(adapter.animate!({ image: new Uint8Array([1]), spec })).rejects.toThrow(/no video/);
});

test("token is cached across calls (only one token exchange for two animate calls)", async () => {
  const tokenCalls = { count: 0 };
  const adapter = vertexAdapter({ credentials: CREDS, project: "p", fetch: vertexFetch({ calls: [], tokenCalls }), pollIntervalMs: 1 });
  await adapter.animate!({ image: new Uint8Array([1]), spec });
  await adapter.animate!({ image: new Uint8Array([1]), spec });
  expect(tokenCalls.count).toBe(1);
});

test("ship-dark: no credentials → throws only when animate is called (no construction-time crash)", async () => {
  const prevCreds = process.env.GOOGLE_VERTEX_CREDENTIALS;
  const prevProject = process.env.GOOGLE_VERTEX_PROJECT;
  delete process.env.GOOGLE_VERTEX_CREDENTIALS;
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  delete process.env.GOOGLE_VERTEX_PROJECT;
  try {
    const adapter = vertexAdapter(); // no throw at construction
    await expect(adapter.animate!({ image: new Uint8Array([1]), spec })).rejects.toThrow(/credentials/);
  } finally {
    if (prevCreds !== undefined) process.env.GOOGLE_VERTEX_CREDENTIALS = prevCreds;
    if (prevProject !== undefined) process.env.GOOGLE_VERTEX_PROJECT = prevProject;
  }
});

test("project not set → clear error even with credentials present", async () => {
  const adapter = vertexAdapter({ credentials: CREDS, fetch: vertexFetch({ calls: [] }) });
  await expect(adapter.animate!({ image: new Uint8Array([1]), spec })).rejects.toThrow(/project/);
});

test("non-200 submit surfaces the Vertex error body", async () => {
  const fetchMock = (async (url: string) => {
    if (url === "https://oauth2.googleapis.com/token") return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), { status: 200 });
    return new Response("Permission denied", { status: 403 });
  }) as unknown as typeof fetch;
  const adapter = vertexAdapter({ credentials: CREDS, project: "p", fetch: fetchMock });
  await expect(adapter.animate!({ image: new Uint8Array([1]), spec })).rejects.toThrow(/vertex animate 403/);
});

test("ai.animate routes to vertex via override", async () => {
  const { createAI } = await import("../client.js");
  const calls: string[] = [];
  const ai = createAI({ providers: { vertex: vertexAdapter({ credentials: CREDS, project: "p", fetch: vertexFetch({ calls }), pollIntervalMs: 1 }) } });
  const { usage } = await ai.animate({ image: new Uint8Array([0xff, 0xd8]), prompt: "hej", override: { provider: "vertex", model: "veo-3.1-generate-preview" } });
  expect(usage.provider).toBe("vertex");
  expect(calls.some((u) => u.includes(":predictLongRunning"))).toBe(true);
});
