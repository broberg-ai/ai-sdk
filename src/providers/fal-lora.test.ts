import { expect, test } from "bun:test";
import { inflateRawSync } from "node:zlib";
import { falAdapter, extractTrainedFiles } from "./fal.js";
import { createAI } from "../client.js";

const spec = { provider: "fal", model: "fal-ai/flux-lora-fast-training", transport: "http" as const };

/** Minimal ZIP walker: from offset 0, read each local file header, inflate its
 *  DEFLATE payload, and return { name, bytes } until the central directory. */
function readZip(zip: Uint8Array): { name: string; bytes: Uint8Array }[] {
  const buf = Buffer.from(zip);
  const out: { name: string; bytes: Uint8Array }[] = [];
  let o = 0;
  while (buf.readUInt32LE(o) === 0x04034b50) {
    const compSize = buf.readUInt32LE(o + 18);
    const nameLen = buf.readUInt16LE(o + 26);
    const extraLen = buf.readUInt16LE(o + 28);
    const name = buf.subarray(o + 30, o + 30 + nameLen).toString("utf8");
    const compStart = o + 30 + nameLen + extraLen;
    const comp = buf.subarray(compStart, compStart + compSize);
    out.push({ name, bytes: new Uint8Array(inflateRawSync(comp)) });
    o = compStart + compSize;
  }
  return out;
}

/** Fake fetch for trainStyle: serves image bytes, the fal storage upload (initiate
 *  + PUT), then the fal queue dance. Captures the uploaded zip bytes. */
function trainFetch() {
  const seen: { url: string; method?: string; body?: any }[] = [];
  let uploadedZip: Uint8Array | undefined;
  const f = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    const rec: { url: string; method?: string; body?: any } = { url: u, method: init?.method };
    if (typeof init?.body === "string") {
      try {
        rec.body = JSON.parse(init.body);
      } catch {
        rec.body = init.body;
      }
    } else if (init?.body) {
      uploadedZip = new Uint8Array(init.body as ArrayBuffer); // the storage PUT (zip bytes)
    }
    seen.push(rec);
    if (u.startsWith("https://img/")) return new Response(new Uint8Array([1, 2, 3, 4, 5]));
    if (u.endsWith("/storage/upload/initiate"))
      return new Response(JSON.stringify({ upload_url: "https://up/zip", file_url: "https://files.fal/styleset.zip" }));
    if (u === "https://up/zip") return new Response("", { status: 200 }); // PUT ack
    if (u.endsWith("/fal-ai/flux-lora-fast-training"))
      return new Response(JSON.stringify({ status_url: "https://q/status", response_url: "https://q/response" }));
    if (u === "https://q/status") return new Response(JSON.stringify({ status: "COMPLETED" }));
    if (u === "https://q/response")
      return new Response(
        JSON.stringify({ diffusers_lora_file: { url: "https://lora.safetensors" }, config_file: { url: "https://cfg.json" } }),
      );
    return new Response("{}");
  }) as unknown as typeof fetch;
  return { f, seen, getZip: () => uploadedZip };
}

test("trainStyle string[] → zip uploaded to fal storage; images_data_url is the file_url; zip round-trips (F021.2)", async () => {
  const { f, seen, getZip } = trainFetch();
  const adapter = falAdapter({ apiKey: "k", fetch: f });
  const res = await adapter.trainStyle!({ images: ["https://img/a.png", "https://img/b.png"], spec });

  // fal rejects data: URIs → SDK uploads the zip and sends the hosted file_url.
  expect(seen.some((s) => s.url.endsWith("/storage/upload/initiate"))).toBe(true);
  const submit = seen.find((s) => s.url.endsWith("/fal-ai/flux-lora-fast-training"))!;
  expect(submit.body.images_data_url).toBe("https://files.fal/styleset.zip");

  // the uploaded zip inflates back to the source bytes
  const entries = readZip(getZip()!);
  expect(entries.map((e) => e.name).sort()).toEqual(["a.png", "b.png"]);
  expect([...entries[0]!.bytes]).toEqual([1, 2, 3, 4, 5]);
  expect(res.loraUrl).toBe("https://lora.safetensors");
  expect(res.configUrl).toBe("https://cfg.json");
  expect(res.usage.costUsd).toBe(2.0);
});

test("trainStyle sends is_style + trigger_word + steps (F021.2)", async () => {
  const { f, seen } = trainFetch();
  const adapter = falAdapter({ apiKey: "k", fetch: f });
  await adapter.trainStyle!({ images: ["https://img/a.png"], spec, triggerWord: "SANNESTYLE", steps: 1200 });
  const submit = seen.find((s) => s.url.endsWith("/fal-ai/flux-lora-fast-training"))!;
  expect(submit.body.is_style).toBe(true);
  expect(submit.body.trigger_word).toBe("SANNESTYLE");
  expect(submit.body.steps).toBe(1200);
});

test("trainStyle with a hosted archive URL passes it straight through (no zipping) (F021.2)", async () => {
  const { f, seen } = trainFetch();
  const adapter = falAdapter({ apiKey: "k", fetch: f });
  await adapter.trainStyle!({ images: "https://cdn.example.com/styleset.zip", spec });
  const submit = seen.find((s) => s.url.endsWith("/fal-ai/flux-lora-fast-training"))!;
  expect(submit.body.images_data_url).toBe("https://cdn.example.com/styleset.zip");
  expect(seen.some((s) => s.url.startsWith("https://img/"))).toBe(false); // nothing fetched
});

test("ai.image with loras routes to fal-ai/flux-lora and sends the loras body (F021.1)", async () => {
  const seen: { url: string; body?: any }[] = [];
  const f = (async (url: string | URL, init?: RequestInit) => {
    seen.push({ url: String(url), body: init?.body ? JSON.parse(init.body as string) : undefined });
    return new Response(JSON.stringify({ images: [{ url: "https://out.png" }] }));
  }) as unknown as typeof fetch;
  const ai = createAI({ providers: { fal: falAdapter({ apiKey: "k", fetch: f }) } });

  const r = await ai.image({ prompt: "a cat", loras: [{ path: "https://lora.safetensors", scale: 0.8 }] });
  expect(seen[0]!.url).toBe("https://fal.run/fal-ai/flux-lora"); // routed to the LoRA model
  expect(seen[0]!.body.loras).toEqual([{ path: "https://lora.safetensors", scale: 0.8 }]);
  expect(r.url).toBe("https://out.png");
});

test("ai.image lora shorthand normalizes to loras:[{path, scale:1}] (F021.1)", async () => {
  const seen: { body?: any }[] = [];
  const f = (async (_url: string | URL, init?: RequestInit) => {
    seen.push({ body: init?.body ? JSON.parse(init.body as string) : undefined });
    return new Response(JSON.stringify({ images: [{ url: "https://out.png" }] }));
  }) as unknown as typeof fetch;
  const ai = createAI({ providers: { fal: falAdapter({ apiKey: "k", fetch: f }) } });
  await ai.image({ prompt: "a dog", lora: "https://brand.safetensors" });
  expect(seen[0]!.body.loras).toEqual([{ path: "https://brand.safetensors", scale: 1 }]);
});

test("ai.image retryOnBlack re-rolls once on an NSFW false-positive black image (F021.4)", async () => {
  let call = 0;
  const seen: any[] = [];
  const f = (async (_url: string | URL, init?: RequestInit) => {
    call++;
    seen.push(init?.body ? JSON.parse(init.body as string) : undefined);
    // first generation → flagged (black); the re-roll → clean
    const flagged = call === 1;
    return new Response(
      JSON.stringify({ images: [{ url: flagged ? "https://black.png" : "https://good.png" }], has_nsfw_concepts: [flagged] }),
    );
  }) as unknown as typeof fetch;
  const ai = createAI({ providers: { fal: falAdapter({ apiKey: "k", fetch: f }) } });

  const r = await ai.image({ prompt: "x", lora: "https://l.safetensors", retryOnBlack: true });
  expect(call).toBe(2); // re-rolled once
  expect(typeof seen[1]!.seed).toBe("number"); // retry carried a fresh seed
  expect(r.url).toBe("https://good.png"); // returns the clean re-roll
  expect(r.usage.costUsd).toBeCloseTo(0.05, 6); // two billed generations (0.025 × 2)
});

test("ai.image without retryOnBlack returns the flagged image as-is, billed once (F021.4)", async () => {
  let call = 0;
  const f = (async () => {
    call++;
    return new Response(JSON.stringify({ images: [{ url: "https://black.png" }], has_nsfw_concepts: [true] }));
  }) as unknown as typeof fetch;
  const ai = createAI({ providers: { fal: falAdapter({ apiKey: "k", fetch: f }) } });
  const r = await ai.image({ prompt: "x", lora: "https://l.safetensors" });
  expect(call).toBe(1); // no re-roll
  expect(r.url).toBe("https://black.png");
  expect(r.usage.costUsd).toBeCloseTo(0.025, 6);
});

test("extractTrainedFiles is defensive across fal output-shape variance (F021.2)", () => {
  // documented shape
  expect(
    extractTrainedFiles({ diffusers_lora_file: { url: "a.safetensors" }, config_file: { url: "c.json" } }),
  ).toEqual({ loraUrl: "a.safetensors", configUrl: "c.json" });
  // renamed field
  expect(extractTrainedFiles({ lora_file: { url: "b.safetensors" } }).loraUrl).toBe("b.safetensors");
  // a `data` wrapper
  expect(extractTrainedFiles({ data: { diffusers_lora_file: { url: "d.safetensors" } } }).loraUrl).toBe(
    "d.safetensors",
  );
  // unknown field name → fall back to scanning for any *.safetensors url
  expect(extractTrainedFiles({ outputs: [{ file: { url: "https://x/weights.safetensors" } }] }).loraUrl).toBe(
    "https://x/weights.safetensors",
  );
  // genuinely absent
  expect(extractTrainedFiles({ images: [{ url: "nope.png" }] }).loraUrl).toBeUndefined();
});

test("trainStyle resolves a renamed lora field + raises a raw-shape error otherwise (F021.2)", async () => {
  const make = (trainBody: unknown) =>
    (async (url: string | URL) => {
      const u = String(url);
      if (u.endsWith("/fal-ai/flux-lora-fast-training"))
        return new Response(JSON.stringify({ status_url: "https://q/s", response_url: "https://q/r" }));
      if (u === "https://q/s") return new Response(JSON.stringify({ status: "COMPLETED" }));
      if (u === "https://q/r") return new Response(JSON.stringify(trainBody));
      return new Response("{}");
    }) as unknown as typeof fetch;

  // renamed field → still resolves
  const ok = falAdapter({ apiKey: "k", fetch: make({ lora_file: { url: "https://x/w.safetensors" } }) });
  const r = await ok.trainStyle!({ images: "https://cdn/z.zip", spec });
  expect(r.loraUrl).toBe("https://x/w.safetensors");

  // garbage → error carries the raw payload for diagnosis
  const bad = falAdapter({ apiKey: "k", fetch: make({ unexpected: "boom" }) });
  await expect(bad.trainStyle!({ images: "https://cdn/z.zip", spec })).rejects.toThrow(/unexpected.*boom/);
});

test("fal adapter resolves the key from FAL_API_KEY when FAL_KEY is absent (F021.2)", async () => {
  const prevKey = process.env.FAL_KEY;
  const prevApi = process.env.FAL_API_KEY;
  delete process.env.FAL_KEY;
  process.env.FAL_API_KEY = "from-api-env";
  try {
    let authSeen = "";
    const f = (async (_url: string | URL, init?: RequestInit) => {
      authSeen = (init?.headers as Record<string, string>).Authorization ?? "";
      return new Response(JSON.stringify({ images: [{ url: "https://out.png" }] }));
    }) as unknown as typeof fetch;
    const adapter = falAdapter({ fetch: f }); // no apiKey → env fallback
    await adapter.image!({ prompt: "x", spec: { provider: "fal", model: "fal-ai/flux/schnell", transport: "http" } });
    expect(authSeen).toBe("Key from-api-env");
  } finally {
    if (prevKey === undefined) delete process.env.FAL_KEY;
    else process.env.FAL_KEY = prevKey;
    if (prevApi === undefined) delete process.env.FAL_API_KEY;
    else process.env.FAL_API_KEY = prevApi;
  }
});
