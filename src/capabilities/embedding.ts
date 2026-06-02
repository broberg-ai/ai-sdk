// Embedding capability marker. The client orchestrates; this names the default
// tier (OpenAI text-embedding-3-small via the embedding tier).
import type { Tier } from "../types.js";

export const EMBEDDING_DEFAULT_TIER: Tier = "embedding";
