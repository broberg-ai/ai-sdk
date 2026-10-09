// F078.4 — `web_search` as a tool a model (Scout) can call. The MODEL chooses only what
// to search for; who pays, which keys, the cap and whether customer data forbids
// providers that keep queries all come from the app's context, never from the model.
import type { Tool } from "../types.js";
import { search } from "./index.js";
import type { SearchOptions, SearchPurpose, SearchRequest } from "./types.js";

const PURPOSES: SearchPurpose[] = ["agent", "grounding", "discovery", "monitor"];

export const webSearchTool: Tool = {
  name: "web_search",
  description:
    "Search the open web. Returns up to 10 results with title, url and snippet. " +
    "Set lang to the query's language (e.g. 'da', 'en'). Set fresh when the answer must be recent (news, prices, events).",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", minLength: 1, maxLength: 1024, description: "What to search for." },
      lang: { type: "string", description: "Language of the query, e.g. 'da' or 'en'." },
      limit: { type: "integer", minimum: 1, maximum: 10, description: "Number of results (default 10)." },
      purpose: { type: "string", enum: PURPOSES, description: "agent (default), grounding, discovery or monitor." },
      fresh: { type: "boolean", description: "Results must be recent." },
    },
    required: ["query"],
    additionalProperties: false,
  },
};

/** What the app decides — never the model. */
export interface WebSearchContext extends SearchOptions {
  /** Customer data may be in the query: only Zero-Data-Retention providers. */
  zdr?: boolean;
  /** Attribution, e.g. { tenantId } — also selects the tenant's daily cap. */
  labels?: Record<string, string>;
}

export interface WebSearchToolResult {
  provider: string;
  results: { title: string; url: string; snippet: string }[];
}

/** Run a `web_search` tool call. Throws on invalid arguments before any request. */
export async function runWebSearch(args: Record<string, unknown>, ctx: WebSearchContext = {}): Promise<WebSearchToolResult> {
  const { query, lang, limit, purpose, fresh } = args;
  if (typeof query !== "string" || query.trim() === "") throw new Error("web_search: `query` must be a non-empty string");
  if (lang !== undefined && typeof lang !== "string") throw new Error("web_search: `lang` must be a string");
  if (limit !== undefined && (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 10)) throw new Error("web_search: `limit` must be an integer 1–10");
  if (purpose !== undefined && !PURPOSES.includes(purpose as SearchPurpose)) throw new Error(`web_search: \`purpose\` must be one of ${PURPOSES.join(", ")}`);
  if (fresh !== undefined && typeof fresh !== "boolean") throw new Error("web_search: `fresh` must be a boolean");

  const { zdr, labels, ...opts } = ctx;
  // Built field by field: anything else the model sent (provider, zdr, labels …) is dropped.
  const req: SearchRequest = {
    query,
    ...(lang !== undefined ? { lang: lang as string } : {}),
    ...(limit !== undefined ? { limit: limit as number } : {}),
    ...(purpose !== undefined ? { purpose: purpose as SearchPurpose } : {}),
    ...(fresh !== undefined ? { fresh: fresh as boolean } : {}),
    ...(zdr ? { zdr } : {}),
    ...(labels ? { labels } : {}),
  };
  const r = await search(req, opts);
  return { provider: r.meta.provider, results: r.items.map((i) => ({ title: i.title, url: i.url, snippet: i.description })) };
}
