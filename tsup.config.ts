import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "es2022",
  // bun:sqlite is a Bun runtime builtin — leave it unresolved for the runtime.
  external: ["bun:sqlite"],
});
