// F043 — the error handler must not be the thing that crashes.
import { expect, test } from "bun:test";
import { errorBody } from "./http.js";
import { makeOpenAICompatibleAdapter } from "../providers/openai-compatible.js";

test("the raw body is shown when it will not parse as JSON", () => {
  expect(errorBody(undefined, "<html>502 Bad Gateway</html>")).toBe("<html>502 Bad Gateway</html>");
  expect(errorBody(undefined, "   ")).toBe("(no body)");
  expect(errorBody(undefined, "x".repeat(1000)).length).toBe(300);
});

test("a non-JSON body yields a description instead of a TypeError", () => {
  // This is the exact input that crashed: httpTransport sets json to undefined when
  // the body will not parse, and JSON.stringify(undefined) is undefined, not a string.
  expect(() => errorBody(undefined)).not.toThrow();
  expect(errorBody(undefined)).toBe("(no body)");
  expect(errorBody(null)).toBe("(no body)");
});

test("a real error payload is still shown, and truncated", () => {
  expect(errorBody({ message: "Invalid model" })).toBe('{"message":"Invalid model"}');
  expect(errorBody({ m: "x".repeat(1000) }).length).toBe(300);
  expect(errorBody("plain text error")).toBe("plain text error");
});

test("a circular payload degrades instead of throwing", () => {
  const a: Record<string, unknown> = {};
  a.self = a;
  expect(() => errorBody(a)).not.toThrow();
  expect(errorBody(a)).toBe("(no body)");
});

test("end to end: a 502 with an HTML body surfaces the STATUS, not a TypeError", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response("<html><body>502 Bad Gateway</body></html>", {
      status: 502,
      headers: { "content-type": "text/html" },
    })) as unknown as typeof fetch;
  try {
    const adapter = makeOpenAICompatibleAdapter({
      name: "mistral",
      baseUrl: "https://mistral.test/v1",
      apiKey: "k",
    });
    const call = adapter.chat!({
      messages: [{ role: "user", content: "hi" }],
      spec: { provider: "mistral", model: "mistral-small-latest", transport: "http" },
    });
    // Before the fix this rejected with "Cannot read properties of undefined
    // (reading 'slice')" — an error about our own code, pointing nowhere near the 502.
    await expect(call).rejects.toThrow(/mistral 502/);
    await expect(call).rejects.not.toThrow(/reading 'slice'/);
    // And the gateway page itself must SURVIVE — "(no body)" is a fixed crash with
    // the diagnostic still thrown away, which is what the first version shipped.
    await expect(call).rejects.toThrow(/502 Bad Gateway/);
    await expect(call).rejects.not.toThrow(/\(no body\)/);
  } finally {
    globalThis.fetch = realFetch;
  }
});
