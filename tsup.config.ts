import { defineConfig } from "tsup";

export default defineConfig({
  // Two entries: the full root barrel, and a browser-clean subpath
  // (@broberg/ai-sdk/registry) carrying only the synchronous availability read —
  // no bun:sqlite/zlib, so it bundles in a browser build (F022.5, cardmem #4853).
  entry: { index: "src/index.ts", registry: "src/registry.ts" },
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "es2022",
  // bun:sqlite is a Bun runtime builtin — leave it unresolved for the runtime.
  external: ["bun:sqlite"],
});
