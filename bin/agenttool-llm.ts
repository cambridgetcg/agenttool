#!/usr/bin/env -S bun --no-env-file
/** Explicit, bounded task handoff through the signed-in local Ollama daemon.
 * Contract: docs/OLLAMA-TASK-ROUTING.md. No account, history, or citizen files are read.
 */
import { OllamaTaskError, runOllamaTask } from "./_ollama-task";

const MAX_INPUT_BYTES = 70 * 1024;
const INPUT_TIMEOUT_MS = 5_000;
const FORMAT = "agenttool-llm-task/v1";

export const HELP = `Usage: bun --no-env-file bin/agenttool-llm.ts --cloud < task.json

Sends one explicitly supplied public or synthetic task to Ollama Cloud through
http://127.0.0.1:11434/api/chat, using the daemon's existing sign-in.
JSON input: {"data_kind":"synthetic","prompt":"Say hello briefly."}

Optional fields: system, model, backup_models, reason, max_tokens, timeout_ms.
Models: deepseek-v4.1-flash:cloud (default), kimi-k3:cloud (backup).
Set backup_models: [] to disable fallback. Default total deadline: 60000 ms.
Reasons: direct (default), rate_limit, unavailable, capability_gap.
Only HTTP 429/503 can advance to the next model. Other errors are terminal.
Denial, stop, and unknown reasons are refused before any provider request.

--cloud acknowledges that task text leaves this machine. data_kind is your
declaration, not a privacy scanner. Do not supply secrets, private records,
citizen journals, or native conversation histories. Output is JSON on stdout;
errors are JSON on stderr. No response tools are executed or history saved.
`;

class CliError extends Error {
  constructor(readonly code: string) { super(code); }
}

export async function readTaskInput(
  stream: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): Promise<unknown> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    if (signal.aborted) throw new CliError("input_interrupted");
    for (;;) {
      const { value, done } = await reader.read();
      if (signal.aborted) throw new CliError("input_interrupted");
      if (done) break;
      size += value.byteLength;
      if (size > MAX_INPUT_BYTES) throw new CliError("input_too_large");
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try {
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch { throw new CliError("invalid_json"); }
  } finally {
    signal.removeEventListener("abort", cancel);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Injection is for hermetic tests; the command has no endpoint override. */
export async function runCli(
  argv: string[],
  stdin: ReadableStream<Uint8Array>,
  options: { run?: typeof runOllamaTask; signal?: AbortSignal } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    if (argv.length === 1 && ["--help", "-h"].includes(argv[0]!)) {
      return { code: 0, stdout: HELP, stderr: "" };
    }
    if (argv.length !== 1 || argv[0] !== "--cloud") {
      throw new CliError("explicit_cloud_flag_required");
    }
    const signal = options.signal ?? new AbortController().signal;
    const inputSignal = AbortSignal.any([signal, AbortSignal.timeout(INPUT_TIMEOUT_MS)]);
    const input = await readTaskInput(stdin, inputSignal);
    const result = await (options.run ?? runOllamaTask)(input, { signal });
    return { code: 0, stdout: JSON.stringify({ format: FORMAT, ok: true, ...result }) + "\n", stderr: "" };
  } catch (error) {
    const detail = error instanceof OllamaTaskError
      ? { code: error.code, attempts: error.attempts, elapsed_ms: error.elapsed_ms }
      : { code: error instanceof CliError ? error.code : "task_failed", attempts: [] };
    return { code: 1, stdout: "", stderr: JSON.stringify({ format: FORMAT, ok: false, error: detail }) + "\n" };
  }
}

if (import.meta.main) {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  const result = await runCli(process.argv.slice(2), Bun.stdin.stream(), { signal: controller.signal });
  process.removeListener("SIGINT", stop);
  process.removeListener("SIGTERM", stop);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.code;
}
