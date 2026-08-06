// Test preload (F034 safety). Bun auto-loads `.env` into process.env for
// `bun test`, and since v0.24.0 a bare createAI() auto-wires the upmetrics cost
// sink whenever UPMETRICS_API_KEY is present. The fleet rollout tells every repo
// to put exactly that key in its env — so without this, the moment the key lands
// in this repo's .env, the test files that call createAI() would POST fabricated
// test usage into PRODUCTION cost telemetry.
//
// Strip the WHOLE UPMETRICS_ prefix, not a hand-listed set of names: a guard you
// must remember to update every time the sink reads a new variable is a guard
// that is one day silently out of date. (Sharpened by cardmem, who hit the same
// trap and adopted this fix with the prefix generalisation — commit f82ba42.)
//
// Tests that exercise the auto-wiring set these vars explicitly and restore them
// in a finally block.
for (const key of Object.keys(process.env)) {
  if (key.startsWith("UPMETRICS_")) delete process.env[key];
}
