// Vision capability helper. The client owns orchestration (tier/budget/sink);
// this module owns the vision-specific message shaping so it's unit-testable and
// the capabilities/ layout stays meaningful. Default tier: "vision".
import type { VisionInput } from "../schema/inputs.js";
import type { Message, Tier } from "../types.js";

export const VISION_DEFAULT_TIER: Tier = "vision";

/** Build the multimodal message(s) (optional system + user text + image) for a
 *  vision call. A `system` instruction drives instruction-following far better
 *  than packing rules into `prompt` for instruction-heavy tasks (e.g. a JSON critic). */
export function buildVisionMessages(input: VisionInput): Message[] {
  const messages: Message[] = [];
  if (input.system) messages.push({ role: "system", content: input.system });
  messages.push({
    role: "user",
    content: [
      { type: "text", text: input.prompt },
      { type: "image", image: input.image, mimeType: input.mimeType },
    ],
  });
  return messages;
}
