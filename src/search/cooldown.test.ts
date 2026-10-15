// F078.7 — a provider that answered 401/402/403 is skipped for 10 minutes, per key.
// field measured 14 Oct 2026: with Brave's credit empty, every call still tried Brave first.
// Each test uses its own keys, because the cooldown is process-wide state.
import { expect, test } from "bun:test";
import { search } from "../index.js";
import type { CallFailure } from "../cost/failure.js";
import type { CostSink } from "../types.js";

const OK_LINKUP = { items: [{ url: "https://l.dk", title: "L", description: "d" }] };
const OK_BRAVE = { web: { results: [{ title: "B", url: "https://b.dk", description: "d" }] } };

/** Brave answers `braveStatus`; Cloudflare (Linkup) always answers 200. Counts Brave hits. */
function world(braveStatus: number) {
  let brave = 0;
  const f = (async (url: string | URL) => {
    if (String(url).includes("brave.com")) {
      brave++;
      return braveStatus === 200
        ? new Response(JSON.stringify(OK_BRAVE), { status: 200 })
        : new Response("Prepaid credit balance is insufficient", { status: braveStatus });
    }
    return new Response(JSON.stringify(OK_LINKUP), { status: 200 });
  }) as unknown as typeof fetch;
  return { f, braveHits: () => brave };
}

function failSink() {
  const fails: CallFailure[] = [];
  const sink: CostSink = { async record() {}, async recordFailure(x) { fails.push(x); } };
  return { fails, sink };
}

const clock = (start = Date.parse("2026-10-14T03:43:00Z")) => {
  let t = start;
  return { now: () => new Date(t), advance: (ms: number) => { t += ms; } };
};
const creds = (brave: string) => ({ braveApiKey: brave, cloudflareAccountId: "acc", cloudflareApiToken: "tok" });

test("after one 402, brave is skipped for 10 min: no request, no failure row, linkup answers", async () => {
  const w = world(402); const { fails, sink } = failSink(); const c = clock();
  const opts = { fetch: w.f, credentials: creds("k-402"), cache: false as const, costSink: sink, now: c.now };
  const first = await search({ query: "nyheder", country: "DK" }, opts);
  expect({ provider: first.meta.provider, braveHits: w.braveHits(), fails: fails.length }).toEqual({ provider: "cloudflare:linkup", braveHits: 1, fails: 1 });
  for (let i = 0; i < 5; i++) {
    c.advance(60_000);
    const r = await search({ query: `nyheder ${i}`, country: "DK" }, opts);
    expect(r.meta.provider).toBe("cloudflare:linkup");
  }
  expect({ braveHits: w.braveHits(), fails: fails.length }).toEqual({ braveHits: 1, fails: 1 });
});

test("after 10 min brave is tried again", async () => {
  const w = world(402); const c = clock();
  const opts = { fetch: w.f, credentials: creds("k-retry"), cache: false as const, now: c.now };
  await search({ query: "a", country: "DK" }, opts);
  c.advance(10 * 60_000 + 1);
  await search({ query: "b", country: "DK" }, opts);
  expect(w.braveHits()).toBe(2);
});

test("401 and 403 cool down too; 429 and 5xx do not", async () => {
  for (const [status, cools] of [[401, true], [403, true], [429, false], [500, false], [503, false]] as const) {
    const w = world(status); const c = clock();
    const opts = { fetch: w.f, credentials: creds(`k-${status}`), cache: false as const, now: c.now };
    await search({ query: "a", country: "DK" }, opts);
    await search({ query: "b", country: "DK" }, opts);
    expect({ status, braveHits: w.braveHits() }).toEqual({ status, braveHits: cools ? 1 : 2 });
  }
});

test("the last provider in a chain is never skipped — an explicit provider still throws its real error", async () => {
  const w = world(402); const c = clock();
  const opts = { fetch: w.f, credentials: creds("k-last"), cache: false as const, now: c.now };
  await search({ query: "a", country: "DK" }, opts); // brave now cooling
  await expect(search({ query: "b", provider: "brave" }, opts)).rejects.toMatchObject({ status: 402 });
  expect(w.braveHits()).toBe(2);
});

test("the cooldown is per key: one tenant's empty credit does not skip the house key, or another tenant's", async () => {
  const c = clock();
  const dead = world(402);
  await search({ query: "a", country: "DK" }, { fetch: dead.f, credentials: creds("tenant-a"), byok: true, cache: false, now: c.now });
  const live = world(200);
  const house = await search({ query: "b", country: "DK" }, { fetch: live.f, credentials: creds("house-key"), cache: false, now: c.now });
  const other = await search({ query: "c", country: "DK" }, { fetch: live.f, credentials: creds("tenant-b"), byok: true, cache: false, now: c.now });
  expect({ house: house.meta.provider, other: other.meta.provider, braveHits: live.braveHits() }).toEqual({ house: "brave", other: "brave", braveHits: 2 });
});

test("a success clears the cooldown", async () => {
  const c = clock(); let status = 402; let hits = 0;
  const f = (async (url: string | URL) => {
    if (String(url).includes("brave.com")) { hits++; return status === 200 ? new Response(JSON.stringify(OK_BRAVE)) : new Response("x", { status }); }
    return new Response(JSON.stringify(OK_LINKUP));
  }) as unknown as typeof fetch;
  const opts = { fetch: f, credentials: creds("k-clear"), cache: false as const, now: c.now };
  await search({ query: "a", country: "DK" }, opts);
  status = 200;
  const explicit = await search({ query: "b", provider: "brave" }, opts); // last in chain → tried, succeeds
  expect(explicit.meta.provider).toBe("brave");
  const routed = await search({ query: "c", country: "DK" }, opts);
  expect({ provider: routed.meta.provider, hits }).toEqual({ provider: "brave", hits: 3 });
});
