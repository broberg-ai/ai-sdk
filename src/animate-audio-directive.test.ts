// F045 — the audio directive goes only to a route that can make audio.
//
// It used to be appended to EVERY ai.animate prompt. super generated a Kling clip through
// fal and measured it with ffprobe: zero audio streams. So on that route the sentence is
// not merely wasted tokens — it describes a world with sound to a model that can only
// draw, competing for attention with the instruction that can actually be followed.
//
// EVERY ASSERTION HERE READS THE PROMPT THE ADAPTER RECEIVED, never the input object.
// The whole defect was that those two differed, so a test that inspects the input would
// pass on the bug.
import { expect, test } from "bun:test";
import { createAI } from "./client.js";
import type { ProviderAdapter } from "./types.js";
import { freshUsage } from "./cost/usage.js";

/** Records the prompt each animate call actually carried. */
function spy(name: string): { adapter: ProviderAdapter; seen: (string | undefined)[] } {
  const seen: (string | undefined)[] = [];
  const adapter: ProviderAdapter = {
    name,
    animate: async (req) => {
      seen.push(req.prompt);
      return {
        url: "https://example.test/clip.mp4",
        usage: freshUsage({
          provider: name,
          model: req.spec.model,
          transport: "http",
          capability: "animate",
          inputTokens: 0,
          outputTokens: 0,
        }),
      };
    },
  };
  return { adapter, seen };
}

const AUDIO = "ambient background sounds";

function client() {
  const gemini = spy("gemini");
  const fal = spy("fal");
  const ai = createAI({ providers: { gemini: gemini.adapter, fal: fal.adapter } });
  return { ai, gemini, fal };
}

test("the Veo default STILL carries the directive — the negative control", async () => {
  // Without this, simply deleting the directive everywhere would pass every other test
  // in this file. That would be a silent quality regression on the route we ship.
  const { ai, gemini } = client();
  await ai.animate({ image: "https://example.test/a.png", prompt: "she turns and smiles" });
  expect(gemini.seen[0]).toContain(AUDIO);
  expect(gemini.seen[0]).toContain("she turns and smiles");
});

test("a Kling override drops it — measured silent, so the sentence is noise", async () => {
  const { ai, fal } = client();
  await ai.animate({
    image: "https://example.test/a.png",
    prompt: "she turns and smiles",
    override: { provider: "fal", model: "fal-ai/kling-video/v2.5-turbo/pro/image-to-video" },
  });
  expect(fal.seen[0]).toBe("she turns and smiles");
  expect(fal.seen[0]).not.toContain(AUDIO);
});

test("Veo THROUGH fal keeps it — the rule is the model, not the provider", async () => {
  // "fal means silent" would be wrong the moment someone routes Veo via the aggregator,
  // and that is a supported override we document.
  const { ai, fal } = client();
  await ai.animate({
    image: "https://example.test/a.png",
    prompt: "she turns",
    override: { provider: "fal", model: "fal-ai/veo3.1/image-to-video" },
  });
  expect(fal.seen[0]).toContain(AUDIO);
});

test("no prompt at all: the directive is the whole prompt on Veo, and absent on Kling", async () => {
  const { ai, gemini, fal } = client();
  await ai.animate({ image: "https://example.test/a.png" });
  expect(gemini.seen[0]).toContain(AUDIO);

  await ai.animate({
    image: "https://example.test/a.png",
    override: { provider: "fal", model: "fal-ai/kling-video/v2.5-turbo/pro/image-to-video" },
  });
  // undefined, not "" — an empty string is a prompt a provider may reject or treat as
  // meaningful, and "no prompt" is what the caller actually said.
  expect(fal.seen[0]).toBeUndefined();
});

test("an UNKNOWN model keeps the directive — the safe direction", async () => {
  // Withholding it from an audio model silently degrades what we ship; sending it to a
  // silent one is ignored. So an unrecognised model errs toward including it.
  const { ai, fal } = client();
  await ai.animate({
    image: "https://example.test/a.png",
    prompt: "x",
    override: { provider: "fal", model: "fal-ai/some-model-shipped-next-month" },
  });
  expect(fal.seen[0]).toContain(AUDIO);
});
