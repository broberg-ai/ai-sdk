// F049 — Mistral's `prefix`: sent, refused where it cannot work, and stripped back off.
//
// Requested by vn-leker, who verified the feature against docs.mistral.ai before asking:
// `{"role":"assistant","content":prefix,"prefix":True}`, "Language Adherence" listed
// first among use cases, and Mistral's own example stripping it by hand with
// `content[len(prefix):]`.
//
// Every failure mode here is SILENT if unhandled. That is why each gets a test rather
// than a comment: an ignored flag succeeds, an un-stripped prefix looks like formatting.
import { expect, test } from "bun:test";
import { buildChatBody, assertPrefixUsage, stripPrefix, makeStreamPrefixStripper, prefixText } from "./openai-compatible.js";
import type { Message } from "../types.js";

const MISTRAL = { name: "mistral", supportsPrefix: true } as const;
const OPENAI = { name: "openai" } as const;
const PFX = "Her er svaret på norsk bokmål:";

function msgs(...m: Message[]): Message[] {
  return m;
}

// ── validation ──────────────────────────────────────────────────────────────

test("a trailing assistant prefix on mistral is accepted", () => {
  expect(() =>
    assertPrefixUsage(
      msgs({ role: "user", content: "q" }, { role: "assistant", content: PFX, prefix: true }),
      MISTRAL,
    ),
  ).not.toThrow();
});

test("ANOTHER PROVIDER throws — it must not be silently dropped", () => {
  // The dangerous version: openai ignores an unknown field, the call succeeds, the
  // language is not pinned, and the caller believes it is. A test that only checked
  // "mistral works" would be green on a build that dropped the flag everywhere else.
  expect(() =>
    assertPrefixUsage(
      msgs({ role: "user", content: "q" }, { role: "assistant", content: PFX, prefix: true }),
      OPENAI,
    ),
  ).toThrow(/not supported by "openai"/);
});

test("not the last message throws, and the error says where it was", () => {
  expect(() =>
    assertPrefixUsage(
      msgs(
        { role: "assistant", content: PFX, prefix: true },
        { role: "user", content: "q" },
      ),
      MISTRAL,
    ),
  ).toThrow(/only valid on the LAST message \(found at index 0 of 2\)/);
});

test("not an assistant message throws", () => {
  // The prefix IS the start of the assistant's reply; on a user turn it is not the
  // feature at all, and Mistral would treat it as an ordinary message.
  expect(() =>
    assertPrefixUsage(msgs({ role: "user", content: PFX, prefix: true }), MISTRAL),
  ).toThrow(/only valid on an "assistant" message \(found on "user"\)/);
});

test("content blocks throw — a prefix is text the reply continues from", () => {
  expect(() =>
    assertPrefixUsage(
      msgs({ role: "assistant", content: [{ type: "text", text: PFX }], prefix: true }, ),
      MISTRAL,
    ),
  ).toThrow(/must be a plain string/);
});

test("no prefix anywhere: every provider passes — the negative control", () => {
  // Without this, an assertPrefixUsage that threw unconditionally would satisfy every
  // test above and break every ordinary call.
  const plain = msgs({ role: "user", content: "q" });
  expect(() => assertPrefixUsage(plain, OPENAI)).not.toThrow();
  expect(() => assertPrefixUsage(plain, MISTRAL)).not.toThrow();
  expect(prefixText(plain)).toBeUndefined();
});

// ── the request body ────────────────────────────────────────────────────────

test("the flag reaches the WIRE — asserted on the body we build, not on the input", () => {
  // Through buildChatBody rather than a live call: httpTransport takes no injectable
  // fetch, so the non-streaming path cannot be exercised offline. The first version of
  // this test used config.fetch — which is the STREAMING path only — and made a REAL
  // request to api.mistral.ai that failed 401. Same shape as the fal test fixed earlier
  // today: a suite quietly reaching the network.
  const body = buildChatBody(
    {
      messages: msgs({ role: "user", content: "q" }, { role: "assistant", content: PFX, prefix: true }),
      spec: { provider: "mistral", model: "mistral-large-latest", transport: "http" },
    } as never,
    { name: "mistral", supportsPrefix: true },
  );
  const sent = (body.messages as Record<string, unknown>[])[1]!;
  expect(sent).toMatchObject({ role: "assistant", content: PFX, prefix: true });
});

test("a message WITHOUT the flag carries no prefix key at all", () => {
  // Negative control: emitting `prefix: false` would be a different request, and some
  // providers reject unknown falsy fields rather than ignoring them.
  const body = buildChatBody(
    {
      messages: msgs({ role: "user", content: "q" }),
      spec: { provider: "mistral", model: "mistral-large-latest", transport: "http" },
    } as never,
    { name: "mistral", supportsPrefix: true },
  );
  expect((body.messages as Record<string, unknown>[])[0]!).not.toHaveProperty("prefix");
});

// ── stripping ───────────────────────────────────────────────────────────────

test("stripPrefix removes an exact leading match and nothing else", () => {
  expect(stripPrefix(`${PFX} Takk.`, PFX)).toBe("Takk.");
  // A reply that does NOT start with the prefix is untouched — slicing by length
  // would eat real content.
  expect(stripPrefix("Takk for henvendelsen.", PFX)).toBe("Takk for henvendelsen.");
  // No prefix requested → never strip.
  expect(stripPrefix("Her er svaret", undefined)).toBe("Her er svaret");
});

test("the STREAM stripper buffers across deltas — the half that is easy to miss", () => {
  const strip = makeStreamPrefixStripper(PFX);
  const chunks = ["Her er ", "svaret på ", "norsk bokmål:", " Takk", " for det."];
  const out = chunks.map(strip).join("");
  expect(out).toBe("Takk for det.");
});

test("a stream that DIVERGES releases what it buffered instead of swallowing it", () => {
  // The model may simply not echo the prefix. Buffering forever would drop the real
  // reply and look like an empty response — worse than an unstripped prefix.
  const strip = makeStreamPrefixStripper(PFX);
  const out = ["Takk", " for henvendelsen."].map(strip).join("");
  expect(out).toBe("Takk for henvendelsen.");
});

test("without a prefix the stream is byte-for-byte unchanged — negative control", () => {
  const strip = makeStreamPrefixStripper(undefined);
  const chunks = ["Her ", "er ", "svaret"];
  expect(chunks.map(strip).join("")).toBe("Her er svaret");
});
