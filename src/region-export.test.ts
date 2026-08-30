// F043.8 — imports from the PACKAGE ENTRY, not from the module.
//
// Importing "./cost/region.js" already worked and proves nothing about what a consumer
// can reach: `import { regionOfHost } from "@broberg/ai-sdk"` is the call that failed.
// Same distinction as the args/arguments fault — a test one layer below the consumer
// is green for the wrong reason.
import { expect, test } from "bun:test";
import { regionOfHost, regionOfProvider, classifyRegionName } from "./index.js";
import * as internal from "./cost/region.js";

test("the region API is reachable from the package entry", () => {
  expect(typeof regionOfHost).toBe("function");
  expect(typeof regionOfProvider).toBe("function");
  expect(typeof classifyRegionName).toBe("function");
});

test("a consumer can ask where a call WOULD go, before making it", () => {
  // The pre-flight a fail-closed guard needs. Mistral's default host:
  expect(regionOfHost("https://api.mistral.ai/v1")).toBe("eu");
  // …and their own gateway, which is exactly the case a provider-name check misses.
  expect(regionOfHost("https://our-gateway.example/v1")).toBe("unknown");
  expect(regionOfProvider("openai")).toBe("us");
  expect(classifyRegionName("europe-west1")).toBe("eu");
});

test("the export is a door, not a second implementation", () => {
  // A re-export that drifted from the module would be the copy this whole feature
  // exists to prevent, so assert identity rather than equal behaviour on samples.
  expect(regionOfHost).toBe(internal.regionOfHost);
  expect(regionOfProvider).toBe(internal.regionOfProvider);
  expect(classifyRegionName).toBe(internal.classifyRegionName);
});
