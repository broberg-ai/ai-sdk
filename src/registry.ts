// F022.5 — browser-clean subpath entry: `@broberg/ai-sdk/registry`.
//
// The root entry (./index.ts) transitively imports bun:sqlite (budget-store,
// sqlite-sink) + node:zlib (fal), so a Vite/Rollup BROWSER build of the root
// barrel hard-fails ("Rollup failed to resolve import 'bun:sqlite'"). UI pickers
// only need the synchronous, zero-I/O availability READ — and src/availability/*
// has none of those native deps. This entry re-exports exactly that surface so a
// browser bundle can import it directly (cardmem #4853 — true zero-fetch).
//
// NOTE: refreshAvailability is intentionally NOT here — it touches fetch +
// process.env (a server/host concern) and lives on the root entry only.
export { resolveModel, listModels } from "./availability/resolve.js";
export type { ResolveOptions } from "./availability/resolve.js";
export { ModelUnavailableError } from "./availability/types.js";
export type { ModelStatus, ResolveResult, AvailabilityStatus, AvailabilitySource } from "./availability/types.js";
