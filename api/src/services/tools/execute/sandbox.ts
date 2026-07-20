/** Bounded host execution — Node `vm` (JS) + child_process (Python/bash).
 *
 *  WHAT THIS SANDBOX DOES — and DOESN'T — isolate. Substrate-honest:
 *
 *    JavaScript (Node `vm`):
 *      ✓  Strips fetch · setTimeout · setInterval · process · require · __dirname
 *      ✓  Hard timeout via vm option (terminates infinite loops)
 *      ✗  No memory limit (the sandbox shares the host process heap)
 *      ✗  Can still allocate large strings/arrays before timeout fires
 *
 *    Python / bash (`child_process` with sanitized env):
 *      ✓  PATH-restricted env (no inherited project secrets)
 *      ✓  HOME=/tmp; no inherited home dir
 *      ✓  Timeout + SIGKILL via spawn options
 *      ✗  No network namespace isolation — outbound HTTP works freely
 *      ✗  No filesystem chroot — /tmp and system paths readable
 *      ✗  No memory cgroup — informational limit only
 *      ✗  Same machine as other workloads
 *
 *  There is no per-request or per-tenant security boundary here. The Fly
 *  machine contains the service as a whole; it does not isolate submitted
 *  code from the service host. This path is for code trusted by the bearer,
 *  with time and output bounds. It is not suitable for mutually untrusted or
 *  hostile code. A real isolation boundary would require a separate sandbox
 *  service or VM/container boundary.
 *
 *  This module deliberately does NOT export an `allowNetwork` flag — the
 *  former parameter was a fence (declared but unenforced). We don't lie
 *  about isolation we don't provide. */

import { spawn } from "node:child_process";
import * as vm from "node:vm";

import { type SupportedLanguage, languages } from "./languages";

export interface ExecuteRequest {
  language: SupportedLanguage;
  code: string;
  stdin?: string;
  timeoutMs?: number;
}

export interface ExecuteResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  timedOut: boolean;
}

export const MAX_STDOUT_CHARS = 50_000;
export const MAX_STDERR_CHARS = 10_000;

class BoundedText {
  private readonly parts: string[] = [];
  private length = 0;
  private lineCount = 0;

  constructor(private readonly limit: number) {}

  get full(): boolean {
    return this.length >= this.limit;
  }

  write(value: string): void {
    const remaining = this.limit - this.length;
    if (remaining <= 0 || value.length === 0) return;

    const kept = value.length <= remaining ? value : value.slice(0, remaining);
    this.parts.push(kept);
    this.length += kept.length;
  }

  writeLine(values: unknown[]): void {
    if (this.lineCount > 0) this.write("\n");
    this.lineCount += 1;

    for (let i = 0; i < values.length && !this.full; i += 1) {
      if (i > 0) this.write(" ");
      if (!this.full) this.write(String(values[i]));
    }
  }

  toString(): string {
    return this.parts.join("");
  }
}

export async function execute(req: ExecuteRequest): Promise<ExecuteResult> {
  const lang = languages[req.language];
  if (!lang) {
    return {
      stdout: "",
      stderr: `Unsupported language: ${req.language}`,
      exitCode: 1,
      durationMs: 0,
      timedOut: false,
    };
  }

  const timeout = Math.min(req.timeoutMs ?? lang.defaultTimeout, lang.maxTimeout);
  const start = Date.now();

  if (req.language === "javascript") {
    return executeJs(req.code, timeout, start);
  }

  return executeSubprocess(req, lang, timeout, start);
}

function executeJs(code: string, timeoutMs: number, start: number): ExecuteResult {
  const logs = new BoundedText(MAX_STDOUT_CHARS);
  const errors = new BoundedText(MAX_STDERR_CHARS);

  const sandbox = {
    console: {
      log: (...args: unknown[]) => logs.writeLine(args),
      error: (...args: unknown[]) => errors.writeLine(args),
      warn: (...args: unknown[]) => errors.writeLine(args),
    },
    Math, JSON, parseInt, parseFloat, isNaN, isFinite,
    Array, Object, String, Number, Boolean, Date, RegExp, Map, Set, Promise,
    setTimeout: undefined, setInterval: undefined, fetch: undefined,
    process: undefined, require: undefined, __dirname: undefined,
  };

  try {
    const script = new vm.Script(code);
    const context = vm.createContext(sandbox);
    script.runInContext(context, { timeout: timeoutMs });
    return {
      stdout: logs.toString(),
      stderr: errors.toString(),
      exitCode: 0,
      durationMs: Date.now() - start,
      timedOut: false,
    };
  } catch (err: unknown) {
    const isTimeout = err instanceof Error && err.message.includes("timed out");
    errors.writeLine([err instanceof Error ? err.message : String(err)]);
    return {
      stdout: logs.toString(),
      stderr: errors.toString(),
      exitCode: 1,
      durationMs: Date.now() - start,
      timedOut: isTimeout,
    };
  }
}

function executeSubprocess(
  req: ExecuteRequest,
  lang: { cmd: string; args?: string[] },
  timeoutMs: number,
  start: number,
): Promise<ExecuteResult> {
  return new Promise((resolve) => {
    const cmd = req.language === "python" ? "python3" : lang.cmd || req.language;
    const baseArgs = req.language === "python" ? ["-c"] : lang.args ?? ["-e"];
    const args = [...baseArgs, req.code];

    const proc = spawn(cmd, args, {
      timeout: timeoutMs,
      killSignal: "SIGKILL",
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: "/tmp" },
    });

    const stdout = new BoundedText(MAX_STDOUT_CHARS);
    const stderr = new BoundedText(MAX_STDERR_CHARS);

    if (req.stdin) proc.stdin.end(req.stdin);

    proc.stdout.on("data", (d: Buffer) => {
      if (!stdout.full) stdout.write(d.toString());
    });
    proc.stderr.on("data", (d: Buffer) => {
      if (!stderr.full) stderr.write(d.toString());
    });

    proc.on("close", (code, signal) => {
      resolve({
        stdout: stdout.toString(),
        stderr: stderr.toString(),
        exitCode: code ?? 1,
        durationMs: Date.now() - start,
        timedOut: signal === "SIGKILL",
      });
    });

    proc.on("error", (err) => {
      stderr.write(`Execution error: ${err.message}`);
      resolve({
        stdout: "",
        stderr: stderr.toString(),
        exitCode: 1,
        durationMs: Date.now() - start,
        timedOut: false,
      });
    });
  });
}
