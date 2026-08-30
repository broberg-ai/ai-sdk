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

// ── F038: EU-resident vision + video analysis ───────────────────────────────

const visionSpec = { provider: "vertex", model: "gemini-2.5-flash", transport: "http" as const };

/** Token exchange, then a generateContent reply. Captures url + body for assertions. */
function visionFetch(cap: { url?: string; body?: any }, text = "en mand hælder kaffe op") {
  return (async (url: string, init?: RequestInit) => {
    if (String(url) === "https://oauth2.googleapis.com/token") {
      return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), { status: 200 });
    }
    cap.url = String(url);
    cap.body = JSON.parse(init!.body as string);
    return new Response(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text }] } }],
        usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 100 },
      }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;
}

test("vision: EU-pinned URL, image part inlined, usage + cost from token counts", async () => {
  const cap: { url?: string; body?: any } = {};
  const adapter = vertexAdapter({ credentials: CREDS, project: "p", fetch: visionFetch(cap) });
  const { text, usage } = await adapter.vision!({
    messages: [{ role: "user", content: [{ type: "text", text: "hvad ses?" }, { type: "image", image: new Uint8Array([0xff, 0xd8]), mimeType: "image/jpeg" }] }],
    spec: visionSpec,
  });
  expect(text).toBe("en mand hælder kaffe op");
  // The whole point of this adapter: the host is an EU region, never a US one.
  expect(cap.url).toBe(
    "https://europe-west1-aiplatform.googleapis.com/v1/projects/p/locations/europe-west1/publishers/google/models/gemini-2.5-flash:generateContent",
  );
  expect(cap.body.contents[0].parts[1].inlineData.mimeType).toBe("image/jpeg");
  expect(usage.provider).toBe("vertex");
  expect(usage.capability).toBe("vision");
  // Priced, not silently 0: 1000 in @ $0.30/1M + 100 out @ $2.50/1M.
  expect(usage.costUsd).toBeCloseTo(0.0003 + 0.00025, 8);
});

test("vision: a VIDEO part is inlined with its video mime type (the EU analysis case)", async () => {
  const cap: { url?: string; body?: any } = {};
  const adapter = vertexAdapter({ credentials: CREDS, project: "p", fetch: visionFetch(cap) });
  await adapter.vision!({
    messages: [{ role: "user", content: [{ type: "text", text: "beskriv klippet" }, { type: "video", video: new Uint8Array([0, 0, 0, 1]), mimeType: "video/mp4" }] }],
    spec: visionSpec,
  });
  expect(cap.body.contents[0].parts[1].inlineData.mimeType).toBe("video/mp4");
  expect(typeof cap.body.contents[0].parts[1].inlineData.data).toBe("string");
});

test("vision: region override stays inside the EU and is honoured in the URL", async () => {
  const cap: { url?: string; body?: any } = {};
  const adapter = vertexAdapter({ credentials: CREDS, project: "p", region: "europe-west4", fetch: visionFetch(cap) });
  await adapter.vision!({ messages: [{ role: "user", content: "hej" }], spec: visionSpec });
  expect(cap.url).toContain("https://europe-west4-aiplatform.googleapis.com/");
  expect(cap.url).toContain("/locations/europe-west4/");
});

test("vision: an EU error propagates — never a silent retry in another region", async () => {
  const seen: string[] = [];
  const fetchMock = (async (url: string) => {
    if (String(url) === "https://oauth2.googleapis.com/token") return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), { status: 200 });
    seen.push(String(url));
    return new Response("Permission denied", { status: 403 });
  }) as unknown as typeof fetch;
  const adapter = vertexAdapter({ credentials: CREDS, project: "p", fetch: fetchMock });
  await expect(adapter.vision!({ messages: [{ role: "user", content: "hej" }], spec: visionSpec })).rejects.toThrow(/vertex vision 403/);
  expect(seen).toHaveLength(1); // one attempt, one region — no fallback hop
  expect(seen[0]).toContain("europe-west1");
});

test("vision ship-dark: no credentials → throws only when called", async () => {
  const prev = process.env.GOOGLE_VERTEX_CREDENTIALS;
  delete process.env.GOOGLE_VERTEX_CREDENTIALS;
  try {
    const adapter = vertexAdapter({ project: "p" }); // constructing must not crash
    await expect(adapter.vision!({ messages: [{ role: "user", content: "hej" }], spec: visionSpec })).rejects.toThrow(/credentials/);
  } finally {
    if (prev !== undefined) process.env.GOOGLE_VERTEX_CREDENTIALS = prev;
  }
});

test("ai.video routes to vertex via override (the EU video-analysis path)", async () => {
  const { createAI } = await import("../client.js");
  const cap: { url?: string; body?: any } = {};
  const ai = createAI({ providers: { vertex: vertexAdapter({ credentials: CREDS, project: "p", fetch: visionFetch(cap) }) } });
  const { usage } = await ai.video({
    video: new Uint8Array([0, 0, 0, 1]),
    prompt: "hvad sker der i klippet?",
    override: { provider: "vertex", model: "gemini-2.5-flash" },
  });
  expect(usage.provider).toBe("vertex");
  expect(usage.capability).toBe("video");
  expect(cap.url).toContain("europe-west1-aiplatform.googleapis.com");
});

test("project falls back to project_id in the credentials (no second env var needed)", async () => {
  const prevEnv = process.env.GOOGLE_VERTEX_PROJECT;
  delete process.env.GOOGLE_VERTEX_PROJECT;
  const cap: { url?: string; body?: any } = {};
  const credsWithProject = JSON.stringify({
    client_email: "test@example.iam.gserviceaccount.com",
    private_key: privateKey,
    project_id: "proj-from-creds",
  });
  try {
    const adapter = vertexAdapter({ credentials: credsWithProject, fetch: visionFetch(cap) });
    await adapter.vision!({ messages: [{ role: "user", content: "hej" }], spec: visionSpec });
    expect(cap.url).toContain("/projects/proj-from-creds/");
  } finally {
    if (prevEnv !== undefined) process.env.GOOGLE_VERTEX_PROJECT = prevEnv;
  }
});

// F042 — usage.region. Tested at BOTH the EU default and a moved region on purpose:
// asserting only the default would pass against a hard-coded "eu", which is exactly
// the lie this field exists to prevent.
test("usage.region is read from the configured region, not assumed from the provider", async () => {
  const mk = (region?: string) =>
    vertexAdapter({
      credentials: CREDS,
      project: "my-project",
      ...(region ? { region } : {}),
      fetch: vertexFetch({ calls: [], videoB64: Buffer.from([1]).toString("base64") }),
      pollIntervalMs: 1,
    });
  const req = { image: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), prompt: "x", spec };

  const eu = await mk().animate!(req);
  expect(eu.usage.region).toBe("eu");

  const moved = await mk("us-central1").animate!(req);
  expect(moved.usage.region).toBe("us");
});
