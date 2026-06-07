// fal.ai adapter (F5.3 + F021). Image modes, both observed in the F1 inventory:
//   - sync  : POST https://fal.run/{model}, image URL straight back (sanneandersen)
//   - queue : POST https://queue.fal.run/{model} → poll status → fetch result
// F021 adds LoRA style-training (trainStyle) + LoRA inference (image loras).
// Auth header `Authorization: Key <FAL_KEY>`. No @fal-ai/client — plain fetch.
import { deflateRawSync, crc32 } from "node:zlib";
import { freshUsage } from "../cost/usage.js";
import type {
  ProviderAdapter,
  ImageRequest,
  ImageResult,
  TrainStyleRequest,
  TrainStyleResult,
} from "../types.js";

interface FalImagesResponse {
  images?: { url?: string }[];
  error?: unknown;
}
interface FalTrainResponse {
  diffusers_lora_file?: { url?: string };
  config_file?: { url?: string };
}
interface FalQueueSubmit {
  request_id?: string;
  status_url?: string;
  response_url?: string;
}
interface FalQueueStatus {
  status?: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED";
}

export interface FalAdapterConfig {
  apiKey?: string;
  /** "sync" (default — fal.run, fast models) or "queue" (queue.fal.run, polled). */
  mode?: "sync" | "queue";
  syncBaseUrl?: string;
  queueBaseUrl?: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
  /** Deadline for training jobs — they take minutes (default 600000 = 10 min). */
  trainTimeoutMs?: number;
  fetch?: typeof fetch;
  /** Override the per-image USD price (else a built-in estimate per model, 0 if unknown). */
  pricePerImage?: number;
  /** Override the flat per-training USD price (else ~$2 estimate). */
  pricePerTraining?: number;
}

// Per-image USD ESTIMATES (fal prices by megapixel/model and changes often —
// verify before relying on these; override via config.pricePerImage). fal does
// not return a price, so this is the SDK's best-effort cost for `usage.costUsd`.
const FAL_IMAGE_PRICE_ESTIMATE: Record<string, number> = {
  "fal-ai/flux/schnell": 0.003,
  "fal-ai/flux/dev": 0.025,
  "fal-ai/flux-lora": 0.025,
  "fal-ai/flux-pro": 0.05,
  "fal-ai/flux-pro/v1.1": 0.04,
};
// Flat training estimate (fal-ai/flux-lora-fast-training, ~$2; override via config).
const FAL_TRAIN_PRICE_ESTIMATE = 2.0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function falAdapter(config: FalAdapterConfig = {}): ProviderAdapter {
  const doFetch = config.fetch ?? fetch;
  const syncBase = config.syncBaseUrl ?? "https://fal.run";
  const queueBase = config.queueBaseUrl ?? "https://queue.fal.run";
  const pollIntervalMs = config.pollIntervalMs ?? 2000;
  const timeoutMs = config.timeoutMs ?? 60000;

  // sa flagged the gotcha: their env is FAL_API_KEY, the older convention is FAL_KEY.
  // Accept either so no repo has to alias one to the other.
  const resolveKey = () => config.apiKey ?? process.env.FAL_KEY ?? process.env.FAL_API_KEY;
  const authHeaders = (apiKey: string) => ({
    "content-type": "application/json",
    Authorization: `Key ${apiKey}`,
  });

  async function image(req: ImageRequest): Promise<ImageResult> {
    const apiKey = resolveKey();
    if (!apiKey) throw new Error("fal adapter: FAL_KEY not set");
    const headers = authHeaders(apiKey);

    const body: Record<string, unknown> = { prompt: req.prompt };
    if (req.width !== undefined && req.height !== undefined) {
      body.image_size = { width: req.width, height: req.height };
    }
    if (req.loras && req.loras.length > 0) {
      body.loras = req.loras.map((l) => ({ path: l.path, scale: l.scale ?? 1 }));
    }

    const mode = config.mode ?? "sync";
    const url = await (mode === "sync"
      ? runSync(req.spec.model, headers, body)
      : runQueue(req.spec.model, headers, body));

    // fal returns no price; estimate per-image (one image per call) so usage.costUsd
    // isn't silently 0. Override via config.pricePerImage.
    const usage = freshUsage({
      provider: "fal",
      model: req.spec.model,
      transport: "http",
      capability: "image",
      inputTokens: 0,
      outputTokens: 0,
    });
    usage.costUsd = config.pricePerImage ?? FAL_IMAGE_PRICE_ESTIMATE[req.spec.model] ?? 0;
    return { url, usage };
  }

  async function trainStyle(req: TrainStyleRequest): Promise<TrainStyleResult> {
    const apiKey = resolveKey();
    if (!apiKey) throw new Error("fal adapter: FAL_KEY not set");
    const headers = authHeaders(apiKey);

    const body: Record<string, unknown> = {
      images_data_url: await resolveImagesUrl(req.images, apiKey),
      is_style: req.isStyle ?? true,
    };
    if (req.triggerWord !== undefined) body.trigger_word = req.triggerWord;
    if (req.steps !== undefined) body.steps = req.steps;
    if (req.createMasks !== undefined) body.create_masks = req.createMasks;

    // Training runs on the queue and takes minutes — use the longer deadline.
    const result = (await queueResult(
      req.spec.model,
      headers,
      body,
      config.trainTimeoutMs ?? 600000,
    )) as FalTrainResponse;
    // fal's LoRA trainers vary in output shape (field renames, wrappers, multiple
    // trainer endpoints). Extract defensively across known/likely locations, then
    // fall back to scanning for any *.safetensors url. If still nothing, surface the
    // RAW response so a shape mismatch is diagnosable without a key on this side.
    const { loraUrl, configUrl } = extractTrainedFiles(result);
    if (!loraUrl) {
      throw new Error(
        `fal trainStyle: no LoRA file url in result — fal returned keys [${Object.keys(
          (result as Record<string, unknown>) ?? {},
        ).join(", ")}]: ${JSON.stringify(result).slice(0, 800)}`,
      );
    }

    const usage = freshUsage({
      provider: "fal",
      model: req.spec.model,
      transport: "http",
      capability: "trainStyle",
      inputTokens: 0,
      outputTokens: 0,
    });
    usage.costUsd = config.pricePerTraining ?? FAL_TRAIN_PRICE_ESTIMATE;
    return { loraUrl, configUrl: configUrl ?? "", usage };
  }

  /** A hosted archive URL passes straight through; an array of image URLs is fetched,
   *  zipped in-memory, and uploaded to fal storage. fal REJECTS data: URIs here
   *  ("Invalid URL: URL too long") — images_data_url must be a real http URL it can
   *  fetch, so we upload the zip and pass the returned file_url. */
  async function resolveImagesUrl(images: string | string[], apiKey: string): Promise<string> {
    if (typeof images === "string") return images;
    const files = await Promise.all(
      images.map(async (url, i) => {
        const res = await doFetch(url);
        if (!res.ok) throw new Error(`fal trainStyle: failed to fetch image ${url} (${res.status})`);
        return { name: fileNameFromUrl(url, i), data: new Uint8Array(await res.arrayBuffer()) };
      }),
    );
    return uploadToFalStorage(buildZip(files), "application/zip", "styleset.zip", apiKey);
  }

  /** Upload bytes to fal storage: initiate (auth'd) → PUT to the returned signed url
   *  → return the public file_url. fal CDN serves it back, fetchable by the trainer. */
  async function uploadToFalStorage(
    bytes: Uint8Array,
    contentType: string,
    fileName: string,
    apiKey: string,
  ): Promise<string> {
    const initiate = await doFetch("https://rest.alpha.fal.ai/storage/upload/initiate", {
      method: "POST",
      headers: { Authorization: `Key ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ content_type: contentType, file_name: fileName }),
    });
    if (!initiate.ok) {
      throw new Error(
        `fal storage initiate ${initiate.status}: ${(await initiate.text().catch(() => "")).slice(0, 200)}`,
      );
    }
    const { upload_url, file_url } = (await initiate.json()) as { upload_url: string; file_url: string };
    const put = await doFetch(upload_url, {
      method: "PUT",
      headers: { "content-type": contentType },
      body: bytes,
    });
    if (!put.ok) throw new Error(`fal storage upload PUT ${put.status}`);
    return file_url;
  }

  async function runSync(
    model: string,
    headers: Record<string, string>,
    body: unknown,
  ): Promise<string> {
    const res = await doFetch(`${syncBase}/${model}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`fal ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
    }
    const data = (await res.json()) as FalImagesResponse;
    const out = data.images?.[0]?.url;
    if (!out) throw new Error(`fal: no image url in response`);
    return out;
  }

  async function runQueue(
    model: string,
    headers: Record<string, string>,
    body: unknown,
  ): Promise<string> {
    const result = (await queueResult(model, headers, body, timeoutMs)) as FalImagesResponse;
    const out = result.images?.[0]?.url;
    if (!out) throw new Error("fal queue: no image url in result");
    return out;
  }

  /** Generic fal queue runner: submit → poll status → fetch+return the raw result JSON. */
  async function queueResult(
    model: string,
    headers: Record<string, string>,
    body: unknown,
    deadlineMs: number,
  ): Promise<unknown> {
    const submitRes = await doFetch(`${queueBase}/${model}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!submitRes.ok) {
      throw new Error(
        `fal queue submit ${submitRes.status}: ${(await submitRes.text().catch(() => "")).slice(0, 200)}`,
      );
    }
    const submit = (await submitRes.json()) as FalQueueSubmit;
    const statusUrl = submit.status_url;
    const responseUrl = submit.response_url;
    if (!statusUrl || !responseUrl) throw new Error("fal queue: missing status/response url");

    const deadline = Date.now() + deadlineMs;
    for (;;) {
      const statusRes = await doFetch(statusUrl, { headers });
      const status = (await statusRes.json()) as FalQueueStatus;
      if (status.status === "COMPLETED") break;
      if (status.status === "FAILED") throw new Error("fal queue: job FAILED");
      if (Date.now() >= deadline) throw new Error(`fal queue: timed out after ${deadlineMs}ms`);
      await sleep(pollIntervalMs);
    }

    const resultRes = await doFetch(responseUrl, { headers });
    if (!resultRes.ok) {
      throw new Error(
        `fal queue result ${resultRes.status}: ${(await resultRes.text().catch(() => "")).slice(0, 300)}`,
      );
    }
    return resultRes.json();
  }

  return { name: "fal", image, trainStyle };
}

// ── fal trained-file extraction (defensive against output-shape variance) ────

function urlOf(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && typeof (v as { url?: unknown }).url === "string") {
    return (v as { url: string }).url;
  }
  return undefined;
}

/** BFS the response for the first {url}/string url matching `match`. */
function deepFindUrl(obj: unknown, match: (url: string) => boolean): string | undefined {
  const stack: unknown[] = [obj];
  while (stack.length) {
    const cur = stack.pop();
    if (typeof cur === "string") {
      if (match(cur)) return cur;
      continue;
    }
    if (cur && typeof cur === "object") {
      const u = (cur as { url?: unknown }).url;
      if (typeof u === "string" && match(u)) return u;
      for (const v of Object.values(cur as Record<string, unknown>)) stack.push(v);
    }
  }
  return undefined;
}

/** Find the LoRA + config urls across known field names, an optional data/response/
 *  output wrapper, and — as a last resort — any *.safetensors / config *.json url
 *  anywhere in the response. fal's LoRA trainers vary in output shape. */
export function extractTrainedFiles(result: unknown): { loraUrl?: string; configUrl?: string } {
  const r = result as Record<string, unknown> | null | undefined;
  const root = (r?.data ?? r?.response ?? r?.output ?? r) as
    | Record<string, unknown>
    | null
    | undefined;
  const loraUrl =
    urlOf(root?.diffusers_lora_file) ??
    urlOf(root?.lora_file) ??
    urlOf(root?.safetensors) ??
    urlOf(root?.lora) ??
    deepFindUrl(root, (u) => /\.safetensors(\?|$)/i.test(u));
  const configUrl =
    urlOf(root?.config_file) ??
    urlOf(root?.config) ??
    deepFindUrl(root, (u) => /config[^/]*\.json(\?|$)/i.test(u));
  return { loraUrl, configUrl };
}

// ── In-memory ZIP (store via DEFLATE, node:zlib — zero new deps) ──────────────

function fileNameFromUrl(url: string, i: number): string {
  const base = url.split("?")[0]!.split("/").pop() || "";
  return /\.[a-z0-9]+$/i.test(base) ? base : `image_${i}.png`;
}

/** Build a spec-compliant ZIP (DEFLATE method) from named byte entries. */
function buildZip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const nameBuf = Buffer.from(f.name, "utf8");
    const data = Buffer.from(f.data);
    const comp = deflateRawSync(data);
    const crc = crc32(data) >>> 0;

    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0); // local file header signature
    lfh.writeUInt16LE(20, 4); // version needed
    lfh.writeUInt16LE(0, 6); // flags
    lfh.writeUInt16LE(8, 8); // method = deflate
    lfh.writeUInt16LE(0, 10); // mod time
    lfh.writeUInt16LE(0x21, 12); // mod date (1980-01-01)
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(comp.length, 18); // compressed size
    lfh.writeUInt32LE(data.length, 22); // uncompressed size
    lfh.writeUInt16LE(nameBuf.length, 26);
    lfh.writeUInt16LE(0, 28); // extra len
    parts.push(lfh, nameBuf, comp);

    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0); // central directory header signature
    cdh.writeUInt16LE(20, 4); // version made by
    cdh.writeUInt16LE(20, 6); // version needed
    cdh.writeUInt16LE(0, 8); // flags
    cdh.writeUInt16LE(8, 10); // method
    cdh.writeUInt16LE(0, 12); // mod time
    cdh.writeUInt16LE(0x21, 14); // mod date
    cdh.writeUInt32LE(crc, 16);
    cdh.writeUInt32LE(comp.length, 20);
    cdh.writeUInt32LE(data.length, 24);
    cdh.writeUInt16LE(nameBuf.length, 28);
    cdh.writeUInt16LE(0, 30); // extra len
    cdh.writeUInt16LE(0, 32); // comment len
    cdh.writeUInt16LE(0, 34); // disk number start
    cdh.writeUInt16LE(0, 36); // internal attrs
    cdh.writeUInt32LE(0, 38); // external attrs
    cdh.writeUInt32LE(offset, 42); // local header offset
    central.push(cdh, nameBuf);

    offset += lfh.length + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // end of central directory signature
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // cd start disk
  eocd.writeUInt16LE(files.length, 8); // entries this disk
  eocd.writeUInt16LE(files.length, 10); // total entries
  eocd.writeUInt32LE(cd.length, 12); // cd size
  eocd.writeUInt32LE(offset, 16); // cd offset
  eocd.writeUInt16LE(0, 20); // comment len
  return Buffer.concat([...parts, cd, eocd]);
}
