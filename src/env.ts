// F093 — the ONE place the SDK reads the process environment.
//
// A browser or a Tauri/WebKit webview has no global `process`, and touching
// `process.env` there throws `ReferenceError: Can't find variable: process` —
// measured by messages on 0.75.0, where createAI() died at construction even with
// byok:true and costSink:null. Read through env() instead: in Node/Bun it is
// process.env itself (read at call time, so late-set vars still work); elsewhere it
// is an empty object, so each caller falls through to its own "not set" handling.
// env-guard.test.ts fails if a bare `process.env` appears anywhere else in src/.
export function env(): Record<string, string | undefined> {
  return typeof process !== "undefined" && process.env ? process.env : {};
}
