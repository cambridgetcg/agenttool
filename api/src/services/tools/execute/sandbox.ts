/** Sandboxed code execution — Node `vm` (JS) + child_process (Python/bash).
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
 *  THE OUTER ISOLATION (Fly machine boundary) is the load-bearing wall.
 *  This sandbox is the inner fence; it stops casual mistakes, not motivated
 *  attackers. For production-grade isolation across mutually-untrusted
 *  agents, swap the subprocess layer for E2B / Daytona / Firecracker /
 *  gVisor.
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
  const logs: string[] = [];
  const errors: string[] = [];

  const sandbox = {
    console: {
      log: (...args: unknown[]) => logs.push(args.map(String).join(" ")),
      error: (...args: unknown[]) => errors.push(args.map(String).join(" ")),
      warn: (...args: unknown[]) => errors.push(args.map(String).join(" ")),
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
      stdout: logs.join("\n"),
      stderr: errors.join("\n"),
      exitCode: 0,
      durationMs: Date.now() - start,
      timedOut: false,
    };
  } catch (err: unknown) {
    const isTimeout = err instanceof Error && err.message.includes("timed out");
    return {
      stdout: logs.join("\n"),
      stderr: err instanceof Error ? err.message : String(err),
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

    let stdout = "";
    let stderr = "";

    if (req.stdin) proc.stdin.end(req.stdin);

    proc.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    proc.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });

    proc.on("close", (code, signal) => {
      resolve({
        stdout: stdout.slice(0, 50_000),
        stderr: stderr.slice(0, 10_000),
        exitCode: code ?? 1,
        durationMs: Date.now() - start,
        timedOut: signal === "SIGKILL",
      });
    });

    proc.on("error", (err) => {
      resolve({
        stdout: "",
        stderr: `Execution error: ${err.message}`,
        exitCode: 1,
        durationMs: Date.now() - start,
        timedOut: false,
      });
    });
  });
}
