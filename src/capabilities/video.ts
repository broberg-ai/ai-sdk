// Video Vision capability (F019). Like vision, but the multimodal part is a
// video the model watches natively (Gemini, OpenRouter video models). The client
// owns orchestration; this module owns the message shaping. Default tier: "video".
import type { VideoInput } from "../schema/inputs.js";
import type { Message, Tier } from "../types.js";

export const VIDEO_DEFAULT_TIER: Tier = "video";

/** Build the single-user message (video + prompt) for a video-analysis call. */
export function buildVideoMessages(input: VideoInput): Message[] {
  return [
    {
      role: "user",
      content: [
        { type: "video", video: input.video, mimeType: input.mimeType },
        { type: "text", text: input.prompt },
      ],
    },
  ];
}
