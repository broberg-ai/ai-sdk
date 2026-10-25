// Microsoft-Decision-1 adapter (F081.2) — the EU decision model behind ai.judge, beside
// Jev. Same "System One" protocol as TypeSafe (measured live 2026-10-26), so it shares
// the answer mapping in system-one.ts. Judge only; there is no chat route.
//
// Deployed in Microsoft Foundry, Sweden Central, Data Zone Standard (the EU data zone:
// EU + Norway + Switzerland). Our own deployment: scripts/azure-decision-deploy.sh.
//
// The wire `model` is the DEPLOYMENT name, not a model id — Azure routes by deployment.
// Our model id ("microsoft-decision-1-v1") is what usage and pricing are keyed on.
//
// BYOK: pass { endpoint, apiKey, deployment } (a customer's own Azure resource) via
// createAI({ providers: { "microsoft-decision": microsoftDecisionAdapter({...}) } }).
// Env is only the fallback. Ships dark: nothing happens until judge is called.
import { classifyRegionName } from "../cost/region.js";
import { freshUsage } from "../cost/usage.js";
import type { JudgeRequest, JudgeResult, ProviderAdapter } from "../types.js";
import { mapSystemOneAnswers, type SystemOneWireAnswer } from "./system-one.js";

export const MICROSOFT_DECISION_DEFAULT_DEPLOYMENT = "decision-1-eu";

export function microsoftDecisionAdapter(
  config: { endpoint?: string; apiKey?: string; deployment?: string; fetch?: typeof fetch } = {},
): ProviderAdapter {
  const fetchImpl = config.fetch ?? fetch;

  function endpoint(): string {
    // A key and its endpoint are one credential: an Azure key only works on its own
    // resource. An explicit (customer) key with OUR env endpoint would post the
    // customer's content to the fleet's resource and fail there — so refuse to mix.
    // byokAdapter guards the key; this guards the half it cannot see.
    if (config.apiKey !== undefined && config.endpoint === undefined) {
      throw new Error("microsoft-decision adapter: an explicit apiKey needs its own endpoint — pass both (never the env endpoint with a caller's key)");
    }
    const e = config.endpoint ?? process.env.AZURE_DECISION_ENDPOINT;
    if (!e) throw new Error("microsoft-decision adapter: endpoint not set (env AZURE_DECISION_ENDPOINT)");
    return e.replace(/\/$/, "");
  }
  function key(): string {
    const k = config.apiKey ?? process.env.AZURE_DECISION_API_KEY;
    if (!k) throw new Error("microsoft-decision adapter: API key not set (env AZURE_DECISION_API_KEY)");
    return k;
  }

  async function judge(req: JudgeRequest): Promise<JudgeResult> {
    const url = `${endpoint()}/providers/microsoft/v1/systemone`;
    const apiKey = key();
    const deployment = config.deployment ?? process.env.AZURE_DECISION_DEPLOYMENT ?? MICROSOFT_DECISION_DEFAULT_DEPLOYMENT;
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", "api-key": apiKey },
      body: JSON.stringify({ model: deployment, state: req.state, questions: req.questions }),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(`microsoft-decision judge ${res.status}: ${errBody.slice(0, 300)}`);
    }
    const data = (await res.json()) as {
      answers?: Record<string, SystemOneWireAnswer>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    return {
      answers: mapSystemOneAnswers("microsoft-decision judge", req.questions, data.answers),
      usage: freshUsage({
        provider: "microsoft-decision",
        model: req.spec.model,
        // Measured per call: Azure names the region that served it ("Sweden Central").
        // A Foundry host (<resource>.cognitiveservices.azure.com) carries no region, so
        // without this header the honest answer is "unknown", never an assumed "eu".
        region: classifyRegionName(res.headers.get("x-ms-region")?.replace(/\s+/g, "") ?? undefined),
        transport: "http",
        capability: "judge",
        inputTokens: data.usage?.input_tokens ?? 0,
        outputTokens: data.usage?.output_tokens ?? 0,
      }),
    };
  }

  return { name: "microsoft-decision", judge };
}
