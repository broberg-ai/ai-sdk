import { expect, test } from "bun:test";
import { mistralAdapter } from "./mistral.js";
import { createAI } from "../client.js";

const spec = { provider: "mistral", model: "mistral-small-latest", transport: "http" as const };

/** Fake fetch routing by URL: /files → fileId, /batch/jobs → job. */
function batchFetch() {
  const seen: { url: string; method?: string }[] = [];
  const f = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    seen.push({ url: u, method: init?.method });
    if (u.endsWith("/files")) return new Response(JSON.stringify({ id: "file-123" }), { status: 200 });
    if (u.endsWith("/batch/jobs")) return new Response(JSON.stringify({ id: "job-abc", status: "QUEUED", total_requests: 2 }), { status: 200 });
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  return { f, seen };
}

test("batchSubmit uploads a JSONL file then creates a job (F016.1)", async () => {
  const { f, seen } = batchFetch();
  const adapter = mistralAdapter({ apiKey: "k", fetch: f });
  const job = await adapter.batchSubmit!({
    items: [
      { customId: "a", prompt: "Summarize doc A" },
      { customId: "b", prompt: "Summarize doc B" },
    ],
    spec,
  });
  expect(seen[0]!.url).toBe("https://api.mistral.ai/v1/files"); // upload first
  expect(seen[1]!.url).toBe("https://api.mistral.ai/v1/batch/jobs"); // then create job
  expect(job.jobId).toBe("job-abc");
  expect(job.status).toBe("QUEUED");
  expect(job.total).toBe(2);
});

test("ai.batch.submit routes to mistral by default", async () => {
  const { f } = batchFetch();
  const ai = createAI({ providers: { mistral: mistralAdapter({ apiKey: "k", fetch: f }) } });
  const job = await ai.batch.submit({ requests: [{ customId: "1", prompt: "hej" }] });
  expect(job.jobId).toBe("job-abc");
});

test("batchResults parses the output JSONL into {customId, text}", async () => {
  const f = (async (url: string | URL) => {
    const u = String(url);
    if (u.includes("/batch/jobs/")) return new Response(JSON.stringify({ output_file: "out-1" }), { status: 200 });
    if (u.includes("/files/out-1/content")) {
      const jsonl = [
        JSON.stringify({ custom_id: "a", response: { body: { choices: [{ message: { content: "Result A" } }] } } }),
        JSON.stringify({ custom_id: "b", response: { body: { choices: [{ message: { content: "Result B" } }] } } }),
      ].join("\n");
      return new Response(jsonl, { status: 200 });
    }
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  const adapter = mistralAdapter({ apiKey: "k", fetch: f });
  const results = await adapter.batchResults!({ jobId: "job-abc", spec });
  expect(results).toEqual([
    { customId: "a", text: "Result A" },
    { customId: "b", text: "Result B" },
  ]);
});
