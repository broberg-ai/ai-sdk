// Live verification of ai.trainStyle (F021) on a MINIMAL set (2 images, low steps)
// — captures fal's RAW response shape and confirms the 0.10.1 defensive parser
// extracts the LoRA url. Needs FAL_KEY in .env. ~$2 on the test key. NOT the 8-image run.
import { createAI, falAdapter } from "../src/index.js";

const log: { url: string; status: number; body: string }[] = [];
const realFetch = globalThis.fetch;
const teeFetch = (async (url: string | URL, init?: RequestInit) => {
  const res = await realFetch(url as Parameters<typeof realFetch>[0], init);
  const u = String(url);
  if (u.includes("fal.run") || u.includes("fal.ai")) {
    let body = "";
    try {
      body = await res.clone().text();
    } catch {}
    log.push({ url: u, status: res.status, body: body.slice(0, 1500) });
  }
  return res;
}) as typeof fetch;

const ai = createAI({
  providers: {
    fal: falAdapter({ apiKey: process.env.FAL_KEY, fetch: teeFetch, pollIntervalMs: 5000, trainTimeoutMs: 600000 }),
  },
});

const base = "https://sanneandersen-site.fly.dev/uploads/treatments-clean/";
try {
  const r = await ai.trainStyle({
    images: [base + "face-ug6s.png", base + "ear-qhhj.png"],
    isStyle: true,
    triggerWord: "TESTSTYLE",
    steps: 100,
  });
  console.log(`\n✅ SUCCESS  loraUrl=${r.loraUrl}\n   configUrl=${r.configUrl}\n   cost=$${r.usage.costUsd}`);
} catch (e) {
  console.log(`\n❌ trainStyle threw: ${(e as Error).message}`);
}
console.log("\n=== FAL HTTP LOG (queue calls) ===");
for (const l of log) console.log(`[${l.status}] ${l.url}\n${l.body}\n---`);
