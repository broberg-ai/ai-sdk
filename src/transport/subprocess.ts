// Subprocess transport: runs the local `claude -p` CLI (Anthropic Max plan).
// No API key, no metered charge — costUsd is always 0, flagged subprocess:true so
// dashboards can split free (Max) from paid (API). Token counts still come back
// from the CLI's JSON so usage is tracked even when cost is zero.
import type { TransportRequest, SubprocessResponse } from "./types.js";

/** The subset of `claude -p --output-format json` output we read. The CLI emits
 *  more fields; we only need the result text + token usage. */
interface ClaudeCliJson {
  result?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

/** Pure parser for the `claude -p --output-format json` stdout. Exported so it
 *  can be unit-tested without spawning the binary. costUsd is pinned to 0. */
export function parseClaudeCliJson(raw: string): SubprocessResponse {
  let parsed: ClaudeCliJson;
  try {
    parsed = JSON.parse(raw) as ClaudeCliJson;
  } catch {
    throw new Error(
      `subprocessTransport: could not parse claude -p JSON output: ${raw.slice(0, 200)}`,
    );
  }
  const u = parsed.usage ?? {};
  return {
    text: parsed.result ?? "",
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheCreationTokens: u.cache_creation_input_tokens ?? 0,
    costUsd: 0,
    subprocess: true,
  };
}

export async function subprocessTransport(
  req: TransportRequest,
): Promise<SubprocessResponse> {
  if (!req.subprocess) {
    throw new Error("subprocessTransport: req.subprocess is required for subprocess transport");
  }
  const { prompt, systemPrompt } = req.subprocess;

  const cmd = ["claude", "-p", "--output-format", "json", "--model", req.spec.model];
  if (systemPrompt) cmd.push("--system-prompt", systemPrompt);

  // Prompt goes in on stdin as a Blob (no argv length limit, no manual FileSink).
  const proc = (() => {
    try {
      return Bun.spawn(cmd, {
        stdin: new Blob([prompt]),
        stdout: "pipe",
        stderr: "pipe",
      });
    } catch (err) {
      throw new Error(
        `subprocessTransport: failed to spawn 'claude' — is the CLI installed and on PATH? (${String(err)})`,
      );
    }
  })();

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(
      `subprocessTransport: claude -p exited ${exitCode}: ${stderr.slice(0, 300) || stdout.slice(0, 300)}`,
    );
  }

  return parseClaudeCliJson(stdout);
}
