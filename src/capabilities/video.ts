// Video Vision capability (F019). Like vision, but the multimodal part is a
// video the model watches natively (Gemini, OpenRouter video models). The client
// owns orchestration; this module owns the message shaping. Default tier: "video".
import type { VideoInput } from "../schema/inputs.js";
import type { Message, Tier } from "../types.js";

export const VIDEO_DEFAULT_TIER: Tier = "video";

/** Build the message(s) (optional system + video + prompt) for a video-analysis call. */
export function buildVideoMessages(input: VideoInput): Message[] {
  const messages: Message[] = [];
  if (input.system) messages.push({ role: "system", content: input.system });
  messages.push({
    role: "user",
    content: [
      { type: "video", video: input.video, mimeType: input.mimeType },
      { type: "text", text: input.prompt },
    ],
  });
  return messages;
}
