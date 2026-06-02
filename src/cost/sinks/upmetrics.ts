// upmetricsSink — the canonical cost sink. Forwards each Usage to the upmetrics
// agent-run ingest (POST /api/agent, mode:"record"). Field mapping follows
// upmetrics/docs/AGENT-SCHEMA.md "For cost-sink authors" exactly:
//   - agent_kind / agent_name are injected (not in Usage; required by ingest)
//   - camelCase Usage → snake_case wire fields
//   - capability + transport ride in tags (no top-level column)
//   - toolCalls[].errorCount → tool_calls[].error_count (deep rename)
//   - latencyMs → duration_ms; ts → started_at; ended_at = ts + latency
// Errors never propagate (CostSink invariant). Do NOT use @upmetrics/agent
// wrapAnthropic here — the SDK already owns the provider call.
import { SDK_TAG } from "../../version.js";
import type { CostSink, Usage } from "../../types.js";

export interface UpmetricsSinkConfig {
  /** Ingest base URL, e.g. https://upmetrics.org */
  baseUrl: string;
  /** Per-project api_key → sent as the X-Upmetrics-Key header. */
  apiKey: string;
  /** Consumer name dashboards group by (e.g. "cms", "trail", "xrt81") — NOT the
   *  capability. */
  agentName: string;
  /** Defaults to "chatbot" ("embedding" auto-selected for embedding calls). */
  agentKind?: string;
  /** When true, guarantees no prompt/response content is ever sent (the sink
   *  sends none regardless — Usage carries no excerpts — so this is belt-and-
   *  suspenders for GDPR-health projects). */
  complianceMode?: boolean;
  /** Injectable fetch for testing; defaults to global fetch. */
  fetch?: typeof fetch;
  /** Optional error hook (errors are otherwise swallowed silently). */
  onError?: (err: unknown) => void;
}

export function upmetricsSink(config: UpmetricsSinkConfig): CostSink {
  const doFetch = config.fetch ?? fetch;
  const url = `${config.baseUrl.replace(/\/$/, "")}/api/agent`;

  return {
    async record(usage: Usage): Promise<void> {
      try {
        const startedAt = usage.ts || new Date().toISOString();
        const endedAt = new Date(
          new Date(startedAt).getTime() + (usage.latencyMs || 0),
        ).toISOString();

        const agentKind =
          config.agentKind ?? (usage.capability === "embedding" ? "embedding" : "chatbot");

        const body: Record<string, unknown> = {
          mode: "record",
          agent_kind: agentKind,
          agent_name: config.agentName,
          provider: usage.provider,
          model: usage.model,
          status: "success",
          input_tokens: usage.inputTokens,
          output_tokens: usage.outputTokens,
          cache_read_tokens: usage.cacheReadTokens,
          cache_creation_tokens: usage.cacheCreationTokens,
          cost_usd: usage.costUsd,
          duration_ms: usage.latencyMs,
          started_at: startedAt,
          ended_at: endedAt,
          tags: {
            // Consumer attribution labels (e.g. tenantId) ride in tags so no new
            // top-level field risks the strict-shape ingest schema (F011). The
            // SDK-owned keys win — a label can never clobber capability/transport/sdk.
            ...usage.labels,
            capability: usage.capability,
            transport: usage.transport,
            sdk: SDK_TAG,
          },
        };
        if (usage.tier !== undefined) body.tier = usage.tier;
        if (usage.purpose !== undefined) body.purpose = usage.purpose;
        if (usage.toolCalls) {
          body.tool_calls = usage.toolCalls.map((t) => ({
            name: t.name,
            count: t.count,
            error_count: t.errorCount ?? 0,
          }));
        }
        // complianceMode is a no-op today (we never send excerpts) but documents intent.
        void config.complianceMode;

        const res = await doFetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "X-Upmetrics-Key": config.apiKey,
          },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          config.onError?.(
            new Error(`upmetricsSink: ingest returned ${res.status}: ${text.slice(0, 200)}`),
          );
        }
      } catch (err) {
        // Never let a sink failure crash a real AI call.
        config.onError?.(err);
      }
    },
  };
}
