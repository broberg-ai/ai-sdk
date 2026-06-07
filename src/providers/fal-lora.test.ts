import { expect, test } from "bun:test";
import { inflateRawSync } from "node:zlib";
import { falAdapter } from "./fal.js";
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

/** Fake fetch for trainStyle: serves image bytes, then the fal queue dance. */
function trainFetch() {
  const seen: { url: string; method?: string; body?: any; headers?: any }[] = [];
  const f = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    seen.push({
      url: u,
      method: init?.method,
      body: init?.body ? JSON.parse(init.body as string) : undefined,
      headers: init?.headers,
    });
    if (u.startsWith("https://img/")) return new Response(new Uint8Array([1, 2, 3, 4, 5]));
    if (u.endsWith("/fal-ai/flux-lora-fast-training"))
      return new Response(JSON.stringify({ status_url: "https://q/status", response_url: "https://q/response" }));
    if (u === "https://q/status") return new Response(JSON.stringify({ status: "COMPLETED" }));
    if (u === "https://q/response")
      return new Response(
        JSON.stringify({ diffusers_lora_file: { url: "https://lora.safetensors" }, config_file: { url: "https://cfg.json" } }),
      );
    return new Response("{}");
  }) as unknown as typeof fetch;
  return { f, seen };
}

test("buildZip round-trips: trainStyle string[] → data-uri zip that inflates back to the source bytes (F021.1)", async () => {
  const { f, seen } = trainFetch();
  const adapter = falAdapter({ apiKey: "k", fetch: f });
  const res = await adapter.trainStyle!({ images: ["https://img/a.png", "https://img/b.png"], spec });

  const submit = seen.find((s) => s.url.endsWith("/fal-ai/flux-lora-fast-training"))!;
  const dataUrl = submit.body.images_data_url as string;
  expect(dataUrl.startsWith("data:application/zip;base64,")).toBe(true);

  const zip = new Uint8Array(Buffer.from(dataUrl.split(",")[1]!, "base64"));
  const entries = readZip(zip);
  expect(entries.map((e) => e.name).sort()).toEqual(["a.png", "b.png"]);
  expect([...entries[0]!.bytes]).toEqual([1, 2, 3, 4, 5]); // inflated === original
  expect(res.loraUrl).toBe("https://lora.safetensors");
  expect(res.configUrl).toBe("https://cfg.json");
  expect(res.usage.costUsd).toBe(2.0); // non-zero flat training estimate
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

test("fal adapter resolves the key from FAL_API_KEY when FAL_KEY is absent (F021.2)", async () => {
  const prevKey = process.env.FAL_KEY;
  const prevApi = process.env.FAL_API_KEY;
  delete process.env.FAL_KEY;
  process.env.FAL_API_KEY = "from-api-env";
  try {
    let authSeen = "";
    const f = (async (_url: string | URL, init?: RequestInit) => {
      authSeen = (init?.headers as Record<string, string>).Authorization;
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
