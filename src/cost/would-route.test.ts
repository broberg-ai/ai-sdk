// F056 — the forecast, and the gate that stops a ninth copy of a host appearing.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { wouldRouteTo, wouldProviderRouteTo } from "./would-route.js";
import { DEFAULT_BASE_URLS, CONFIG_DERIVED_HOSTS } from "./default-hosts.js";
import { regionOfProvider } from "./region.js";

describe("F056.1 — ONE source for the default host, enforced by FORM", () => {
  const dir = join(import.meta.dir, "../providers");
  const files = readdirSync(dir).filter(
    (f) => f.endsWith(".ts") && !f.includes(".test.") && !["stub.ts", "registry.ts"].includes(f),
  );

  test("no adapter re-introduces a LITERAL default host", () => {
    // The FORM, not the names. Precedent in this repo (F046.4): a scanner for the shape
    // of a defect found 10 more cases than a grep for the 4 known names.
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(join(dir, f), "utf8");
      for (const m of src.matchAll(/baseUrl\s*\?\?\s*"(https:\/\/[^"]+)"/g)) {
        offenders.push(`${f}: ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("CONTROL — the scanner actually read the adapters", () => {
    // A scanner that read 0 files reports 0 violations and looks identical to a clean
    // repo. This is the check that "we found nothing" and "we never looked" differ.
    expect(files.length).toBeGreaterThan(10);
    const total = files.reduce((n, f) => n + readFileSync(join(dir, f), "utf8").length, 0);
    expect(total).toBeGreaterThan(10_000);
  });

  test("CONTROL — the scanner CAN see the form it forbids", () => {
    // Negative control in the other direction: prove the regex matches a real instance,
    // so an "always empty" scanner cannot pass by being broken.
    const sample = 'const baseUrl = config.baseUrl ?? "https://api.example.com/v1";';
    expect([...sample.matchAll(/baseUrl\s*\?\?\s*"(https:\/\/[^"]+)"/g)].length).toBe(1);
  });

  test("every adapter with a table entry actually READS the table", () => {
    for (const provider of Object.keys(DEFAULT_BASE_URLS)) {
      const src = readFileSync(join(dir, `${provider}.ts`), "utf8");
      expect(src).toContain(`DEFAULT_BASE_URLS.${provider}`);
    }
  });
});

describe("F056.2 — the forecast answers what regionOfProvider cannot", () => {
  test("smart routes EU — the exact hole helpdesk measured", () => {
    const f = wouldRouteTo("smart");
    expect(f.kind).toBe("forecast");
    if (f.kind !== "forecast") throw new Error("narrow");
    expect(f.provider).toBe("mistral");
    expect(f.host).toBe("https://api.mistral.ai/v1");
    expect(f.wouldRouteTo).toBe("eu");
    // THE WHOLE POINT, asserted side by side: the name cannot answer, the host can.
    expect(regionOfProvider("mistral")).toBe("unknown");
  });

  test("video and embedding leave the EU, and say so", () => {
    for (const tier of ["video", "embedding"] as const) {
      const f = wouldRouteTo(tier);
      if (f.kind !== "forecast") throw new Error("narrow");
      expect(f.wouldRouteTo).toBe("us");
    }
  });

  test("every text tier forecasts EU", () => {
    for (const tier of ["fast", "smart", "powerful", "cheap", "vision"] as const) {
      const f = wouldRouteTo(tier);
      if (f.kind !== "forecast") throw new Error(`${tier} not a forecast`);
      expect(f.wouldRouteTo).toBe("eu");
    }
  });

  test("the ASSUMPTIONS come back with the answer, never empty", () => {
    const f = wouldRouteTo("smart");
    expect(f.onlyIf.length).toBeGreaterThan(0);
    // The fallback clause is load-bearing: a caller-supplied fallback to a US route is
    // taken when the EU call has a bad five minutes, and it fails GREEN.
    expect(f.onlyIf.join(" ")).toContain("fallback");
    expect(f.onlyIf.join(" ")).toContain("baseUrl");
  });

  test("NO field called `region` — a forecast must not wear a fact's clothes", () => {
    // components' rule, enforced rather than documented. usage.region is the fact; if this
    // shape ever grows a `region`, two things with one name disagree about truth.
    const f = wouldRouteTo("smart");
    expect(Object.keys(f)).not.toContain("region");
    const src = readFileSync(join(import.meta.dir, "would-route.ts"), "utf8");
    // No property DECLARATION named region in the returned type either.
    expect(src).not.toMatch(/^\s+region[?]?:/m);
  });

  test("a CONFIG-DERIVED host gets no guess — requesty is why", () => {
    for (const provider of Object.keys(CONFIG_DERIVED_HOSTS)) {
      const f = wouldProviderRouteTo(provider);
      expect(f.kind).toBe("depends-on-config");
      if (f.kind !== "depends-on-config") throw new Error("narrow");
      expect(f.because.length).toBeGreaterThan(0);
      // It must not carry a region at all: requesty has BOTH an EU and a non-EU host, so
      // any answer here would be a residency claim decided by a table, not by a route.
      expect(f).not.toHaveProperty("wouldRouteTo");
    }
  });

  test("bfl is locally pinned and still forecasts EU", () => {
    const f = wouldProviderRouteTo("bfl");
    if (f.kind !== "forecast") throw new Error("narrow");
    expect(f.wouldRouteTo).toBe("eu");
  });

  test("IT IS NOT A GUARD — it never throws, not even on nonsense", () => {
    // Christian rejected a euOnly blocker in the package: residency is the consumer's
    // decision, in dialogue with him. This informs that decision; it refuses nothing.
    expect(() => wouldProviderRouteTo("nonsense-provider")).not.toThrow();
    expect(wouldProviderRouteTo("nonsense-provider").kind).toBe("unknown-provider");
    // @ts-expect-error — deliberately bad tier, the shape a stale string would have.
    expect(() => wouldRouteTo("smrt")).not.toThrow();
  });
});
