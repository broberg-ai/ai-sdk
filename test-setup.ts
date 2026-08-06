// Test preload (F034 safety). Bun auto-loads `.env` into process.env for
// `bun test`, and since v0.24.0 a bare createAI() auto-wires the upmetrics cost
// sink whenever UPMETRICS_API_KEY is present. The fleet rollout tells every repo
// to put exactly that key in its env — so without this, the moment the key lands
// in this repo's .env, the ~26 test files that call createAI() would POST
// fabricated test usage into PRODUCTION cost telemetry.
//
// Strip the upmetrics env before any test runs. Tests that exercise the
// auto-wiring set these vars explicitly (and restore them in a finally block).
for (const key of [
  "UPMETRICS_API_KEY",
  "UPMETRICS_AGENT_NAME",
  "UPMETRICS_BASE_URL",
  "UPMETRICS_COMPLIANCE",
]) {
  delete process.env[key];
}
