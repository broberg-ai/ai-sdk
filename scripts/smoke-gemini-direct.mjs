// Live Gemini-DIRECT smoke (F4.2 chat + F8.6 chatStream + F013 image). Not part
// of the test suite — run manually with GEMINI_API_KEY (or GOOGLE_API_KEY) set.
// Exercises the three gemini-direct paths against the real API end-to-end.
import { createAI } from "../dist/index.js";

const ai = createAI();
const chatModel = "gemini-2.5-flash";
const imageModel = "gemini-3-pro-image-preview";

// ── 1. discrete chat ───────────────────────────────────────────────
console.log("── ai.chat (gemini-direct) ───────────────");
{
  const { text, usage } = await ai.chat({
    prompt: "Reply with exactly: CHAT_OK",
    override: { provider: "gemini", model: chatModel, transport: "http" },
  });
  console.log(`text=${JSON.stringify(text)}`);
  console.log(`[usage] $${usage.costUsd} model=${usage.model} in=${usage.inputTokens} out=${usage.outputTokens}`);
  console.log(`CHAT_OK=${text.includes("CHAT_OK")}`);
}

// ── 2. streaming chat ──────────────────────────────────────────────
console.log("\n── ai.chatStream (gemini-direct) ─────────");
{
  let text = "", sawUsage = false, finish = null;
  for await (const ev of ai.chatStream({
    prompt: "Count from 1 to 5, space-separated. Nothing else.",
    override: { provider: "gemini", model: chatModel, transport: "http" },
  })) {
    if (ev.type === "text") { text += ev.delta; process.stdout.write(ev.delta); }
    if (ev.type === "usage") { sawUsage = true; console.log(`\n[usage] $${ev.costUsd} in=${ev.usage.inputTokens} out=${ev.usage.outputTokens}`); }
    if (ev.type === "finish") { finish = ev.reason; }
    if (ev.type === "error") console.log(`[error] ${ev.message} (${ev.status ?? "-"})`);
  }
  console.log(`STREAM_OK=${text.replace(/\s/g, "").includes("12345")} USAGE_OK=${sawUsage} finish=${finish}`);
}

// ── 3. image generation ────────────────────────────────────────────
console.log("\n── ai.image (gemini-direct) ──────────────");
{
  try {
    const { url, usage } = await ai.image({
      prompt: "A simple red circle on a white background.",
      override: { provider: "gemini", model: imageModel, transport: "http" },
    });
    const head = url.slice(0, 40);
    const bytes = url.includes(",") ? url.split(",")[1].length : 0;
    console.log(`url=${head}… (${bytes} b64 chars)`);
    console.log(`[usage] $${usage.costUsd} capability=${usage.capability}`);
    console.log(`IMAGE_OK=${url.startsWith("data:image/")}`);
  } catch (e) {
    console.log(`IMAGE_ERR=${e.message}`);
  }
}
