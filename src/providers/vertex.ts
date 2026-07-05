// Google Cloud Vertex AI adapter (F031) — EU-resident `ai.animate` (Veo). Reuses
// the exact Veo request/poll/download shape proven live in gemini.ts (F024), but
// swaps: (a) endpoint → a region-pinned Vertex host (default europe-west1, the
// whole reason this adapter exists), (b) auth → a GCP service-account OAuth2
// Bearer token, self-minted via node:crypto (zero extra deps), not an API key.
//
// UNVERIFIED SHAPE NOTE: the inline-bytes response parsing below (`response.
// videos[].bytesBase64Encoded`) is our best-effort read of Vertex's public Veo
// docs — it has not yet been proven against a real Vertex response (F031.3's
// live smoke does that). A `gcsUri`-shaped response throws a clear error rather
// than silently mis-parsing.
import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { toInlineImage } from "./media.js";
import { freshUsage } from "../cost/usage.js";
import type { ProviderAdapter, AnimateRequest, AnimateResult } from "../types.js";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const DEFAULT_REGION = "europe-west1";
const CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";

/** Per-SECOND USD for Veo on Vertex — same model family/pricing as the consumer
 *  Gemini API (F024's VEO_PRICE_PER_SEC). Override per call via config.pricePerSecond. */
const VERTEX_VEO_PRICE_PER_SEC: Record<string, number> = {
  "veo-3.1-generate-preview": 0.4,
  "veo-3.1-fast-generate-preview": 0.1,
  "veo-3.1-lite-generate-preview": 0.05,
  "veo-3.0-generate-001": 0.4,
  "veo-3.0-fast-generate-001": 0.1,
};

interface ServiceAccountCredentials {
  client_email: string;
  private_key: string;
}

interface VertexOperation {
  done?: boolean;
  error?: { message?: string };
  response?: {
    videos?: { bytesBase64Encoded?: string; gcsUri?: string; mimeType?: string }[];
  };
}

function base64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function resolveCredentials(config: { credentials?: string }): ServiceAccountCredentials {
  const inline = config.credentials ?? process.env.GOOGLE_VERTEX_CREDENTIALS;
  if (inline) {
    try {
      return JSON.parse(inline) as ServiceAccountCredentials;
    } catch {
      throw new Error("vertex adapter: GOOGLE_VERTEX_CREDENTIALS is not valid JSON");
    }
  }
  const path = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (path) {
    let raw: string;
    try {
      raw = readFileSync(path, "utf8");
    } catch (err) {
      throw new Error(`vertex adapter: failed to read GOOGLE_APPLICATION_CREDENTIALS file: ${(err as Error).message}`);
    }
    return JSON.parse(raw) as ServiceAccountCredentials;
  }
  throw new Error(
    "vertex adapter: service-account credentials not set (env GOOGLE_VERTEX_CREDENTIALS inline JSON, or GOOGLE_APPLICATION_CREDENTIALS file path)",
  );
}

/** Self-sign a JWT and exchange it for a Bearer access token — no google-auth-library dep. */
async function mintAccessToken(
  creds: ServiceAccountCredentials,
  fetchImpl: typeof fetch,
): Promise<{ token: string; expiresAt: number }> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: creds.client_email,
    scope: CLOUD_PLATFORM_SCOPE,
    aud: TOKEN_ENDPOINT,
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(creds.private_key);
  const jwt = `${unsigned}.${base64url(signature)}`;

  const res = await fetchImpl(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }).toString(),
  });
  if (!res.ok) {
    throw new Error(`vertex adapter: token exchange failed ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
  }
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error("vertex adapter: token exchange returned no access_token");
  return { token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
}

export function vertexAdapter(
  config: {
    /** Inline service-account JSON; else env GOOGLE_VERTEX_CREDENTIALS or GOOGLE_APPLICATION_CREDENTIALS (file path). */
    credentials?: string;
    /** GCP project id; else env GOOGLE_VERTEX_PROJECT. Required — never guessed. */
    project?: string;
    /** Vertex region; default "europe-west1" (EU by default — this adapter's reason to exist). */
    region?: string;
    fetch?: typeof fetch;
    pricePerSecond?: number;
    pollIntervalMs?: number;
    videoTimeoutMs?: number;
  } = {},
): ProviderAdapter {
  const fetchImpl = config.fetch ?? fetch;
  let cached: { token: string; expiresAt: number } | null = null;

  function region(): string {
    return config.region ?? process.env.GOOGLE_VERTEX_REGION ?? DEFAULT_REGION;
  }
  function project(): string {
    const p = config.project ?? process.env.GOOGLE_VERTEX_PROJECT;
    if (!p) throw new Error("vertex adapter: project not set (config.project or env GOOGLE_VERTEX_PROJECT)");
    return p;
  }
  async function accessToken(): Promise<string> {
    if (cached && cached.expiresAt - 60_000 > Date.now()) return cached.token;
    const creds = resolveCredentials(config);
    cached = await mintAccessToken(creds, fetchImpl);
    return cached.token;
  }

  async function animate(req: AnimateRequest): Promise<AnimateResult> {
    const token = await accessToken();
    const proj = project();
    const reg = region();
    const pollIntervalMs = config.pollIntervalMs ?? 5000;
    const deadline = Date.now() + (config.videoTimeoutMs ?? 300000);
    const baseUrl = `https://${reg}-aiplatform.googleapis.com/v1`;

    const { data, mimeType } = await toInlineImage(req.image, fetchImpl);
    const parameters: Record<string, unknown> = {};
    if (req.durationSec !== undefined) parameters.durationSeconds = req.durationSec;
    if (req.resolution !== undefined) parameters.resolution = req.resolution;
    const body = {
      instances: [{ prompt: req.prompt ?? "", image: { bytesBase64Encoded: data, mimeType } }],
      ...(Object.keys(parameters).length ? { parameters } : {}),
    };

    const submit = await fetchImpl(
      `${baseUrl}/projects/${proj}/locations/${reg}/publishers/google/models/${req.spec.model}:predictLongRunning`,
      {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      },
    );
    if (!submit.ok) {
      throw new Error(`vertex animate ${submit.status}: ${(await submit.text().catch(() => "")).slice(0, 300)}`);
    }
    const op = (await submit.json()) as { name?: string };
    if (!op.name) throw new Error("vertex animate: no operation name in submit response");

    let videoB64: string | undefined;
    let videoMime = "video/mp4";
    for (;;) {
      const poll = await fetchImpl(`${baseUrl}/${op.name}`, { headers: { authorization: `Bearer ${token}` } });
      if (!poll.ok) throw new Error(`vertex animate poll ${poll.status}`);
      const opData = (await poll.json()) as VertexOperation;
      if (opData.error) throw new Error(`vertex animate: ${opData.error.message ?? "operation error"}`);
      if (opData.done) {
        const video = opData.response?.videos?.[0];
        if (!video) {
          throw new Error(`vertex animate: done but no video in response: ${JSON.stringify(opData.response).slice(0, 300)}`);
        }
        if (!video.bytesBase64Encoded) {
          if (video.gcsUri) {
            throw new Error(
              `vertex animate: response returned a gcsUri ("${video.gcsUri}") — GCS download not yet supported (F031.x); this build only handles inline bytes`,
            );
          }
          throw new Error(`vertex animate: done but no bytesBase64Encoded in response: ${JSON.stringify(opData.response).slice(0, 300)}`);
        }
        videoB64 = video.bytesBase64Encoded;
        videoMime = video.mimeType ?? "video/mp4";
        break;
      }
      if (Date.now() >= deadline) throw new Error("vertex animate: timed out");
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }

    const usage = freshUsage({
      provider: "vertex",
      model: req.spec.model,
      transport: "http",
      capability: "animate",
      inputTokens: 0,
      outputTokens: 0,
    });
    const perSec = config.pricePerSecond ?? VERTEX_VEO_PRICE_PER_SEC[req.spec.model] ?? 0;
    usage.costUsd = perSec * (req.durationSec ?? 8);
    return { url: `vertex://${op.name}`, bytes: Buffer.from(videoB64, "base64"), mimeType: videoMime, usage };
  }

  return { name: "vertex", animate };
}
