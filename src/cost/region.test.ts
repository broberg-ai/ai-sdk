// F042 — usage.region. The point of these tests is NOT that the table has the right
// strings in it; it is that the region is read from the endpoint a call actually used.
// So the three adapters a consumer can point elsewhere are each tested TWICE: once at
// their EU default, once moved. A test that only checks the default would pass on a
// hard-coded "eu" — which is exactly the bug this feature exists to prevent.
import { expect, test } from "bun:test";
import { classifyRegionName, regionOfProvider, regionOfHost } from "./region.js";
import { freshUsage } from "./usage.js";
import { defaultProviders } from "../providers/registry.js";
import { bflAdapter } from "../providers/bfl.js";
import { azureAdapter } from "../providers/azure.js";

test("providers with a truly fixed endpoint report their region by name", () => {
  expect(regionOfProvider("openai")).toBe("us");
  expect(regionOfProvider("anthropic")).toBe("us");
  expect(regionOfProvider("elevenlabs")).toBe("us");
});

test("a provider whose base URL is configurable is NOT in the name table", () => {
  // mistral and deepl both accept config.baseUrl, so their region is a property of
  // the URL. Claiming "eu" by name would be a false EU claim on the designated
  // personal-data route — the exact failure this module exists to prevent, which the
  // first version of it committed. Found in review of F042 itself.
  expect(regionOfProvider("mistral")).toBe("unknown");
  expect(regionOfProvider("deepl")).toBe("unknown");
});

test("region comes from the HOST a call will actually hit", () => {
  expect(regionOfHost("https://api.mistral.ai/v1")).toBe("eu");
  expect(regionOfHost("https://api.deepl.com")).toBe("eu");
  expect(regionOfHost("https://api-free.deepl.com")).toBe("eu");
  expect(regionOfHost("https://api.openai.com/v1")).toBe("us");
  expect(regionOfHost("https://api.deepseek.com/v1")).toBe("cn");
  expect(regionOfHost("https://openrouter.ai/api/v1")).toBe("unknown");
});

test("a custom gateway in front of an EU provider does NOT inherit its EU claim", () => {
  // The concrete regression: mistralAdapter({ baseUrl: "https://my-gateway.example" })
  // used to report "eu" because the table was keyed on the name.
  expect(regionOfHost("https://my-gateway.example/v1")).toBe("unknown");
  expect(regionOfHost("https://mistral.some-cloud.us/v1")).toBe("unknown");
  expect(regionOfHost("not a url")).toBe("unknown");
  expect(regionOfHost(undefined)).toBe("unknown");
});

test("aggregators report unknown — they pick their own upstream, so we cannot know", () => {
  expect(regionOfProvider("openrouter")).toBe("unknown");
  expect(regionOfProvider("requesty")).toBe("unknown");
});

test("an untracked provider is unknown, never a guess in the reassuring direction", () => {
  expect(regionOfProvider("some-new-provider")).toBe("unknown");
  // Specifically: it must not inherit "eu" from anywhere.
  expect(regionOfProvider("some-new-provider")).not.toBe("eu");
});

test("region NAMES classify by the endpoint, and an unrecognised one is unknown", () => {
  expect(classifyRegionName("europe-west1")).toBe("eu");
  expect(classifyRegionName("europe-north1")).toBe("eu");
  expect(classifyRegionName("westeurope")).toBe("eu");
  expect(classifyRegionName("swedencentral")).toBe("eu");
  expect(classifyRegionName("us-central1")).toBe("us");
  expect(classifyRegionName("eastus")).toBe("us");
  // Adequate, but NOT EU/EEA. Folding these into "eu" would make the field mean
  // something softer than it says, which is how a residency claim goes wrong.
  expect(classifyRegionName("uksouth")).toBe("unknown");
  expect(classifyRegionName("switzerlandnorth")).toBe("unknown");
  expect(classifyRegionName("mars-central1")).toBe("unknown");
  expect(classifyRegionName(undefined)).toBe("unknown");
  expect(classifyRegionName("")).toBe("unknown");
});

test('"unknown" is NOT a positive residency claim — only "eu" is', () => {
  // The dangerous consumer pattern this asserts against:
  //     if (usage.region !== "us") allowPersonalData()
  // …which passes on every OpenRouter call. Stated as a test so the contract
  // survives a later tidy-up of the union.
  const openrouter = regionOfProvider("openrouter");
  expect(openrouter).not.toBe("us");
  expect(openrouter).not.toBe("eu");
  const euSafe = (r: string) => r === "eu";
  expect(euSafe(openrouter)).toBe(false);
});

test("freshUsage stamps the provider's region when the adapter passes none", () => {
  const u = freshUsage({
    provider: "openai",
    model: "gpt-4o-mini",
    transport: "http",
    capability: "chat",
    inputTokens: 10,
    outputTokens: 5,
  });
  expect(u.region).toBe("us");
});

test("an explicit region from the adapter wins over the provider table", () => {
  const u = freshUsage({
    provider: "vertex",
    model: "gemini-2.5-flash",
    transport: "http",
    capability: "vision",
    inputTokens: 1,
    outputTokens: 1,
    region: "us",
  });
  expect(u.region).toBe("us");
});

test("every registered adapter is reachable and the registry is not empty", () => {
  // Guards the coverage claim below: if an adapter disappears from the registry the
  // per-adapter assertions would silently stop testing anything.
  const names = Object.keys(defaultProviders);
  expect(names.length).toBeGreaterThanOrEqual(14);
  expect(names).toContain("vertex");
  expect(names).toContain("azure");
  expect(names).toContain("bfl");
});

// ── the three that a consumer can move ───────────────────────────────────────

test("bfl: the EU pin is READ, not presumed", async () => {
  const fakeFetch = (async (url: string) => {
    if (String(url).includes("/v1/flux")) {
      return new Response(JSON.stringify({ id: "task-1", cost: 1 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(
      JSON.stringify({ status: "Ready", result: { sample: "https://example.test/i.png" } }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as unknown as typeof fetch;

  const req = {
    prompt: "a cat",
    referenceImages: ["https://example.test/ref.png"],
    spec: { provider: "bfl", model: "flux-pro-1.1", transport: "http" as const },
  };

  const eu = bflAdapter({ apiKey: "k", fetch: fakeFetch });
  const moved = bflAdapter({ apiKey: "k", fetch: fakeFetch, baseUrl: "https://api.bfl.ai" });

  const a = await eu.image!(req as never);
  const b = await moved.image!(req as never);

  expect(a.usage.region).toBe("eu");
  // The global host auto-failovers, so where it landed is not observable from here.
  // The requirement is only that it stops claiming EU.
  expect(b.usage.region).not.toBe("eu");
});

test("azure: the configured region decides, not the provider name", async () => {
  const audio = new Uint8Array([1, 2, 3]);
  const fakeFetch = (async () =>
    new Response(audio, { status: 200, headers: { "content-type": "audio/mpeg" } })) as unknown as typeof fetch;

  const req = {
    text: "hej",
    voiceId: "christel",
    spec: { provider: "azure", model: "tts", transport: "http" as const },
  };

  const eu = azureAdapter({ apiKey: "k", fetch: fakeFetch });
  const moved = azureAdapter({ apiKey: "k", fetch: fakeFetch, region: "eastus" });

  const a = await eu.tts!(req as never);
  const b = await moved.tts!(req as never);

  expect(a.usage.region).toBe("eu");
  expect(b.usage.region).toBe("us");
});

test("an inherited Object key is unknown, not a function off the prototype", () => {
  // A bare `TABLE[name] ?? "unknown"` returns Object.prototype.constructor here, so the
  // fallback never fires and usage.region becomes a function — which then vanishes
  // through JSON.stringify into a cost sink. Found in security review of this feature.
  for (const key of ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__"]) {
    expect(regionOfProvider(key)).toBe("unknown");
    expect(typeof regionOfProvider(key)).toBe("string");
  }
});

// F043.8 round two — components measured every one of these against 0.36.5.
test("a BARE hostname is valid input — the trap that made the fix useless", () => {
  // "api.mistral.ai" is the most natural thing to hand a function called
  // regionOfHost. It answered "unknown", so a fail-closed guard built on it rejected
  // everything — the exact fault we had just warned about in regionOfProvider, one
  // function to the left. We fixed the name-keyed one and left this with the same shape.
  expect(regionOfHost("api.mistral.ai")).toBe("eu");
  expect(regionOfHost("https://api.mistral.ai/v1")).toBe("eu");
  expect(regionOfHost("api.mistral.ai/v1")).toBe("eu");
  expect(regionOfHost("api.mistral.ai:443")).toBe("eu");
  expect(regionOfHost("  api.mistral.ai  ")).toBe("eu");
});

test("case does not matter — and it did NOT work before, on a bare host", () => {
  // components listed this as working. It was not: an uppercase BARE host failed at
  // the URL parse, before case was ever considered. Worth a test in both forms.
  expect(regionOfHost("API.MISTRAL.AI")).toBe("eu");
  expect(regionOfHost("HTTPS://API.MISTRAL.AI/v1")).toBe("eu");
});

test("a suffix must never inherit the EU claim", () => {
  // The one that would actually hurt: an endsWith() check would hand evil.com Mistral's
  // residency. Exact match only, asserted from both a URL and a bare host.
  expect(regionOfHost("https://api.mistral.ai.evil.com/v1")).toBe("unknown");
  expect(regionOfHost("api.mistral.ai.evil.com")).toBe("unknown");
  expect(regionOfHost("notapi.mistral.ai")).toBe("unknown");
  expect(regionOfHost("evil.com/api.mistral.ai")).toBe("unknown");
});

test("credentials in the authority do not smuggle a host past the check", () => {
  // user@evil.com is a real URL shape; the host is evil.com, not the part before the @.
  expect(regionOfHost("https://api.mistral.ai@evil.com/v1")).toBe("unknown");
  expect(regionOfHost("api.mistral.ai@evil.com")).toBe("unknown");
});

test("a Region handed back in is answered by identity, not by 'unknown'", () => {
  // "eu" is what this function RETURNS and what a consumer compares against, so
  // passing it in is the obvious mistake. Answering "unknown" to "eu" is the confident
  // wrong answer this module keeps having to remove.
  expect(classifyRegionName("eu")).toBe("eu");
  expect(classifyRegionName("us")).toBe("us");
  expect(classifyRegionName("cn")).toBe("cn");
  expect(classifyRegionName("EU")).toBe("eu");
  // …and a genuinely unrecognised name is still unknown.
  expect(classifyRegionName("atlantis-north1")).toBe("unknown");
});
