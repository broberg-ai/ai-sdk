// discordSink — posts a per-call cost embed to a Discord webhook. Secondary sink
// (upmetricsSink is canonical); handy for repos not wired to Upmetrics or for an
// at-a-glance spend feed. Plain fetch, no Discord SDK. Errors never propagate.
import type { CostSink, Usage } from "../../types.js";

export interface DiscordSinkConfig {
  webhookUrl: string;
  /** Skip posting paid calls below this USD threshold (anti-spam). Subprocess
   *  (Max-plan free) calls always post so the "free" feed stays visible.
   *  Default 0 → post everything. */
  minUsd?: number;
  fetch?: typeof fetch;
  onError?: (err: unknown) => void;
}

export function discordSink(config: DiscordSinkConfig): CostSink {
  const doFetch = config.fetch ?? fetch;
  const minUsd = config.minUsd ?? 0;

  return {
    async record(usage: Usage): Promise<void> {
      try {
        // Skip cheap PAID calls; always show subprocess (free) calls.
        if (!usage.subprocess && usage.costUsd < minUsd) return;

        const costLabel = usage.subprocess
          ? "Max plan (free)"
          : `$${usage.costUsd.toFixed(6)}`;

        const embed = {
          title: `AI call — ${usage.capability}`,
          fields: [
            { name: "Provider", value: usage.provider, inline: true },
            { name: "Model", value: usage.model, inline: true },
            { name: "Transport", value: usage.transport, inline: true },
            { name: "Cost", value: costLabel, inline: true },
            {
              name: "Tokens",
              value: `${usage.inputTokens} in / ${usage.outputTokens} out`,
              inline: true,
            },
            { name: "Latency", value: `${usage.latencyMs} ms`, inline: true },
          ],
          timestamp: usage.ts || new Date().toISOString(),
        };

        const res = await doFetch(config.webhookUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ embeds: [embed] }),
        });
        if (!res.ok) {
          config.onError?.(new Error(`discordSink: webhook returned ${res.status}`));
        }
      } catch (err) {
        config.onError?.(err);
      }
    },
  };
}
