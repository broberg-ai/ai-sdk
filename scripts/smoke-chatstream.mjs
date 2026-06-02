// Live OpenRouter smoke for ai.chatStream (F8.2). Not part of the test suite —
// run manually with OPENROUTER_API_KEY set. Streams a text turn + a tool-call turn.
import { createAI } from "../dist/index.js";

const ai = createAI();
const override = { provider: "openrouter", model: "google/gemini-2.5-flash", transport: "http" };

console.log("── text turn ─────────────────────────────");
let text = "";
let sawUsage = false;
for await (const ev of ai.chatStream({
  prompt: "Say exactly: streaming works. Nothing else.",
  override,
})) {
  if (ev.type === "text") { text += ev.delta; process.stdout.write(ev.delta); }
  if (ev.type === "usage") { sawUsage = true; console.log(`\n[usage] $${ev.costUsd} model=${ev.model} in=${ev.usage.inputTokens} out=${ev.usage.outputTokens}`); }
  if (ev.type === "finish") console.log(`[finish] ${ev.reason}`);
  if (ev.type === "error") console.log(`[error] ${ev.message} (${ev.status ?? "-"})`);
}
console.log(`\nTEXT_OK=${text.toLowerCase().includes("streaming works")} USAGE_OK=${sawUsage}`);

console.log("\n── tool-call turn ────────────────────────");
const tools = [{
  name: "get_weather",
  description: "Get the current weather for a city",
  parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
}];
let toolCall = null;
let finishReason = null;
for await (const ev of ai.chatStream({
  prompt: "What is the weather in Aalborg? Use the get_weather tool.",
  tools,
  override,
})) {
  if (ev.type === "text") process.stdout.write(ev.delta);
  if (ev.type === "tool_call") { toolCall = ev; console.log(`\n[tool_call] ${ev.name}(${JSON.stringify(ev.args)}) id=${ev.id}`); }
  if (ev.type === "usage") console.log(`[usage] $${ev.costUsd} model=${ev.model}`);
  if (ev.type === "finish") { finishReason = ev.reason; console.log(`[finish] ${ev.reason}`); }
  if (ev.type === "error") console.log(`[error] ${ev.message} (${ev.status ?? "-"})`);
}
console.log(`\nTOOLCALL_OK=${!!toolCall && toolCall.name === "get_weather" && typeof toolCall.args?.city === "string"} FINISH=${finishReason}`);
