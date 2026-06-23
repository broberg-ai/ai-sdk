import { defineConfig } from "tsup";

export default defineConfig({
  // Entries: the full root barrel, plus two browser-clean subpaths —
  // @broberg/ai-sdk/registry (sync availability read, F022.5) and
  // @broberg/ai-sdk/pricing (model prices, F027). Both avoid bun:sqlite/zlib/fs
  // so they bundle in a browser/edge build (cardmem #4853, Trail edge).
  entry: { index: "src/index.ts", registry: "src/registry.ts", pricing: "src/pricing.ts" },
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "es2022",
  // bun:sqlite is a Bun runtime builtin — leave it unresolved for the runtime.
  external: ["bun:sqlite"],
});
