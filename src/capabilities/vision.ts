// Vision capability helper. The client owns orchestration (tier/budget/sink);
// this module owns the vision-specific message shaping so it's unit-testable and
// the capabilities/ layout stays meaningful. Default tier: "vision".
import type { VisionInput } from "../schema/inputs.js";
import type { Message, Tier } from "../types.js";

export const VISION_DEFAULT_TIER: Tier = "vision";

/** Build the single-user multimodal message (text + image) for a vision call. */
export function buildVisionMessages(input: VisionInput): Message[] {
  return [
    {
      role: "user",
      content: [
        { type: "text", text: input.prompt },
        { type: "image", image: input.image, mimeType: input.mimeType },
      ],
    },
  ];
}
