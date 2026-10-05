// F067.6 — the report shows what is NEW since last run, not everything we do not price.
import { expect, test } from "bun:test";
import { diffCatalogue, undatedBase } from "./diff.js";
import { newSinceLastRun, nextSeen } from "./seen.js";
import type { CatalogueModel } from "./types.js";

const oa = (model: string): CatalogueModel => ({ provider: "openai", model });

test("undatedBase strips the date forms the providers use", () => {
  expect(undatedBase("gpt-4o-2024-08-06")).toBe("gpt-4o");
  expect(undatedBase("claude-sonnet-4-5-20250929")).toBe("claude-sonnet-4-5");
  expect(undatedBase("gpt-4-0613")).toBe("gpt-4");
  expect(undatedBase("gpt-5.4")).toBe("gpt-5.4");
});

test("a dated snapshot listed beside its undated name is folded in, the undated one stays", () => {
  const diff = diffCatalogue([oa("gpt-9-mini"), oa("gpt-9-mini-2026-09-01"), oa("gpt-9-solo-2026-09-01")], {
    fetchedProviders: ["openai"],
  });
  const ids = diff.added.map((m) => m.model);
  expect(ids).toContain("gpt-9-mini");
  expect(ids).not.toContain("gpt-9-mini-2026-09-01");
  // A snapshot whose undated name is neither listed nor known is still news.
  expect(ids).toContain("gpt-9-solo-2026-09-01");
});

test("two runs: the second reports only what was not there the first time", () => {
  const run1 = [oa("gpt-3.5-turbo"), oa("gpt-4")];
  const seen1 = nextSeen(run1, ["openai"], {});
  const run2Unknown = [oa("gpt-3.5-turbo"), oa("gpt-4"), oa("gpt-10")];
  expect(newSinceLastRun(run2Unknown, seen1).map((m) => m.model)).toEqual(["gpt-10"]);
});

test("a provider with no stored list reports everything unknown — eleven_v4 is not swallowed", () => {
  const seen = { openai: ["gpt-4"] };
  const unknown: CatalogueModel[] = [{ provider: "elevenlabs", model: "eleven_v4" }];
  expect(newSinceLastRun(unknown, seen).map((m) => m.model)).toEqual(["eleven_v4"]);
});

test("a provider not fetched this run keeps last run's list; openrouter is never stored", () => {
  const prev = { elevenlabs: ["eleven_v3"] };
  const next = nextSeen([oa("gpt-4"), { provider: "openrouter", model: "x/y" }], ["openai", "openrouter"], prev);
  expect(next.elevenlabs).toEqual(["eleven_v3"]);
  expect(next.openai).toEqual(["gpt-4"]);
  expect(next.openrouter).toBeUndefined();
});
