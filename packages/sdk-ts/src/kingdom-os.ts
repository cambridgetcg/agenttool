/**
 * Bounded local adapter for KINGDOM OS repository discovery.
 *
 * This client invokes only the committed machine-readable `kingdom repos`
 * surfaces. It never uses the hosted AgentTool transport, opens a shell,
 * mutates repository state, runs Kingdom routines, or uploads local paths.
 *
 * Doctrine: docs/KINGDOM-OS-SDK.md.
 */

import { AgentToolError } from "./errors.js";

/** One local Git root reported by `kingdom repos --json`. */
export interface KingdomOSRepository {
  path: string;
  name: string;
  kind: string;
  layer: string;
  domain: string;
  state: string;
  place: string;
  metadataSource: string;
  purpose: string;
}

/** Exact fixed command presented to an injected local runner. */
export interface KingdomOSCommand {
  executable: string;
  args: readonly string[];
  timeoutMs: number;
  maxOutputBytes: number;
  env: Readonly<Record<string, string>>;
}

/** Captured outcome from an injected local runner. */
export interface KingdomOSCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Injectable seam for tests and non-Node hosts. */
export type KingdomOSRunner = (
  command: KingdomOSCommand,
) => Promise<KingdomOSCommandResult>;

/** Local KINGDOM OS adapter configuration. */
export interface KingdomOSOptions {
  /** Executable path or PATH-resolved command. Defaults to `kingdom`. */
  executable?: string;
  /** Command timeout in seconds. Defaults to 10. */
  timeout?: number;
  /** Combined stdout/stderr ceiling. Defaults to 1 MiB. */
  maxOutputBytes?: number;
  /** Optional host-owned runner. No arbitrary command method is exposed. */
  runner?: KingdomOSRunner;
}

const DEFAULT_TIMEOUT_SECONDS = 10;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const MAX_TERMS = 32;
const MAX_TERM_BYTES = 256;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function guidedError(
  message: string,
  code: string,
  hint: string,
  details?: unknown,
): AgentToolError {
  return new AgentToolError(message, {
    code,
    hint,
    details,
    safety: "docs/KINGDOM-OS-SDK.md",
  });
}

function safeChildEnvironment(): Readonly<Record<string, string>> {
  const source =
    typeof process !== "undefined" ? process.env : ({} as Record<string, string | undefined>);
  const env: Record<string, string> = {
    NO_COLOR: "1",
    TERM: "dumb",
  };
  for (const name of ["HOME", "PATH", "LANG", "LC_ALL", "TMPDIR"]) {
    const value = source[name];
    if (typeof value === "string" && value.length > 0) env[name] = value;
  }
  return Object.freeze(env);
}

function cleanDiagnostic(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "\uFFFD")
    .trim()
    .slice(0, 512);
}

function validateOptions(options: KingdomOSOptions): {
  executable: string;
  timeoutMs: number;
  maxOutputBytes: number;
  runner: KingdomOSRunner;
} {
  const executable = options.executable ?? "kingdom";
  if (
    !executable
    || CONTROL_CHARACTERS.test(executable)
    || hasUnpairedSurrogate(executable)
  ) {
    throw guidedError(
      "KINGDOM OS executable is invalid.",
      "kingdom_os_invalid_options",
      "Pass a non-empty executable path without control characters.",
    );
  }

  const timeout = options.timeout ?? DEFAULT_TIMEOUT_SECONDS;
  if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 300) {
    throw guidedError(
      "KINGDOM OS timeout is invalid.",
      "kingdom_os_invalid_options",
      "Use a finite timeout greater than 0 and no more than 300 seconds.",
    );
  }

  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  if (
    !Number.isSafeInteger(maxOutputBytes)
    || maxOutputBytes < 1024
    || maxOutputBytes > 16 * 1024 * 1024
  ) {
    throw guidedError(
      "KINGDOM OS output limit is invalid.",
      "kingdom_os_invalid_options",
      "Use an integer maxOutputBytes between 1024 and 16777216.",
    );
  }

  return {
    executable,
    timeoutMs: timeout * 1000,
    maxOutputBytes,
    runner: options.runner ?? runLocalCommand,
  };
}

function validateTerms(terms: readonly string[], required: boolean): string[] {
  if (!Array.isArray(terms)) {
    throw guidedError(
      "KINGDOM OS repository query terms are invalid.",
      "kingdom_os_invalid_query",
      "Pass query terms as an array of strings.",
    );
  }
  if (required && terms.length === 0) {
    throw guidedError(
      "A KINGDOM OS repository query is required.",
      "kingdom_os_query_required",
      "Pass one or more repository name, path, layer, state, or purpose terms.",
    );
  }
  if (terms.length > MAX_TERMS) {
    throw guidedError(
      "Too many KINGDOM OS repository query terms.",
      "kingdom_os_invalid_query",
      `Pass no more than ${MAX_TERMS} terms.`,
    );
  }

  return terms.map((term) => {
    if (
      typeof term !== "string"
      || term.length === 0
      || CONTROL_CHARACTERS.test(term)
      || hasUnpairedSurrogate(term)
      || new TextEncoder().encode(term).byteLength > MAX_TERM_BYTES
    ) {
      throw guidedError(
        "A KINGDOM OS repository query term is invalid.",
        "kingdom_os_invalid_query",
        `Use non-empty terms without control characters, each at most ${MAX_TERM_BYTES} UTF-8 bytes.`,
      );
    }
    return term;
  });
}

async function runLocalCommand(
  command: KingdomOSCommand,
): Promise<KingdomOSCommandResult> {
  let spawn: typeof import("node:child_process").spawn;
  try {
    ({ spawn } = await import("node:child_process"));
  } catch (error) {
    throw guidedError(
      "This runtime cannot launch the local KINGDOM OS executable.",
      "kingdom_os_runtime_unavailable",
      "Use Node or Bun, or pass a host-owned KingdomOSRunner.",
      { reason: error instanceof Error ? error.message : String(error) },
    );
  }

  return await new Promise<KingdomOSCommandResult>((resolve, reject) => {
    const stdoutChunks: Uint8Array[] = [];
    const stderrChunks: Uint8Array[] = [];
    let outputBytes = 0;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const child = spawn(command.executable, [...command.args], {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...command.env },
    });

    const finishReject = (error: AgentToolError): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      child.kill("SIGKILL");
      child.stdout.destroy();
      child.stderr.destroy();
      reject(error);
    };

    const collect = (stream: "stdout" | "stderr", chunk: Uint8Array): void => {
      if (settled) return;
      outputBytes += chunk.byteLength;
      if (outputBytes > command.maxOutputBytes) {
        finishReject(
          guidedError(
            "KINGDOM OS command output exceeded the configured limit.",
            "kingdom_os_output_too_large",
            "Narrow the repository query or raise maxOutputBytes deliberately.",
          ),
        );
        return;
      }
      const value = Uint8Array.from(chunk);
      if (stream === "stdout") stdoutChunks.push(value);
      else stderrChunks.push(value);
    };

    child.stdout.on("data", (chunk: Uint8Array) => collect("stdout", chunk));
    child.stderr.on("data", (chunk: Uint8Array) => collect("stderr", chunk));

    child.once("error", (error: NodeJS.ErrnoException) => {
      finishReject(
        guidedError(
          "Could not launch the local KINGDOM OS executable.",
          error.code === "ENOENT" ? "kingdom_os_cli_not_found" : "kingdom_os_launch_failed",
          "Install KINGDOM OS on PATH or pass its exact executable path.",
          { reason: error.message },
        ),
      );
    });

    child.once("close", (code) => {
      if (settled) return;
      let stdout: string;
      let stderr: string;
      try {
        const decoder = new TextDecoder("utf-8", { fatal: true });
        stdout = decoder.decode(Buffer.concat(stdoutChunks));
        stderr = decoder.decode(Buffer.concat(stderrChunks));
      } catch {
        finishReject(
          guidedError(
            "KINGDOM OS returned output that was not valid UTF-8.",
            "kingdom_os_invalid_response",
            "Update KINGDOM OS or pass a compatible local runner.",
          ),
        );
        return;
      }
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      resolve({
        exitCode: typeof code === "number" ? code : 1,
        stdout,
        stderr,
      });
    });

    timer = setTimeout(() => {
      finishReject(
        guidedError(
          "KINGDOM OS command timed out.",
          "kingdom_os_timeout",
          "Narrow the repository query or increase the local timeout deliberately.",
        ),
      );
    }, command.timeoutMs);
  });
}

function repositoryFrom(value: unknown, index: number): KingdomOSRepository {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw guidedError(
      "KINGDOM OS returned an invalid repository inventory.",
      "kingdom_os_invalid_response",
      "Update KINGDOM OS or use a compatible runner that returns `kingdom repos --json`.",
      { index },
    );
  }

  const input = value as Record<string, unknown>;
  const keys = [
    "path",
    "name",
    "kind",
    "layer",
    "domain",
    "state",
    "place",
    "metadataSource",
    "purpose",
  ] as const;
  for (const key of keys) {
    if (
      typeof input[key] !== "string"
      || CONTROL_CHARACTERS.test(input[key] as string)
      || hasUnpairedSurrogate(input[key] as string)
    ) {
      throw guidedError(
        "KINGDOM OS returned an invalid repository inventory.",
        "kingdom_os_invalid_response",
        "Update KINGDOM OS or use a compatible runner that returns the nine-field repository schema.",
        { index, field: key },
      );
    }
  }
  if (!(input.path as string).startsWith("/")) {
    throw guidedError(
      "KINGDOM OS returned a non-absolute repository path.",
      "kingdom_os_invalid_response",
      "Use the canonical `kingdom repos --json` command, which emits absolute local paths.",
      { index, field: "path" },
    );
  }

  return {
    path: input.path as string,
    name: input.name as string,
    kind: input.kind as string,
    layer: input.layer as string,
    domain: input.domain as string,
    state: input.state as string,
    place: input.place as string,
    metadataSource: input.metadataSource as string,
    purpose: input.purpose as string,
  };
}

/** Read-only local client for the committed KINGDOM OS repository seams. */
export class KingdomOSClient {
  private readonly executable: string;
  private readonly timeoutMs: number;
  private readonly maxOutputBytes: number;
  private readonly runner: KingdomOSRunner;

  constructor(options: KingdomOSOptions = {}) {
    const validated = validateOptions(options);
    this.executable = validated.executable;
    this.timeoutMs = validated.timeoutMs;
    this.maxOutputBytes = validated.maxOutputBytes;
    this.runner = validated.runner;
  }

  /** List discovered local Git roots matching every supplied term. */
  async repositories(terms: readonly string[] = []): Promise<KingdomOSRepository[]> {
    const result = await this.execute([
      "repos",
      "--json",
      "--",
      ...validateTerms(terms, false),
    ]);
    if (result.exitCode !== 0) {
      throw this.commandFailure(result);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      throw guidedError(
        "KINGDOM OS returned invalid repository JSON.",
        "kingdom_os_invalid_response",
        "Update KINGDOM OS or pass a compatible local runner.",
      );
    }
    if (!Array.isArray(parsed)) {
      throw guidedError(
        "KINGDOM OS returned an invalid repository inventory.",
        "kingdom_os_invalid_response",
        "Expected the JSON array emitted by `kingdom repos --json`.",
      );
    }
    return parsed.map(repositoryFrom);
  }

  /** Resolve one query to exactly one canonical absolute Git root. */
  async resolve(terms: readonly string[]): Promise<string> {
    const result = await this.execute([
      "repos",
      "--path",
      "--",
      ...validateTerms(terms, true),
    ]);
    if (result.exitCode !== 0) {
      throw this.commandFailure(result, true);
    }

    let path = result.stdout;
    if (path.endsWith("\n")) path = path.slice(0, -1);
    if (path.endsWith("\r")) path = path.slice(0, -1);
    if (
      !path.startsWith("/")
      || CONTROL_CHARACTERS.test(path)
      || hasUnpairedSurrogate(path)
    ) {
      throw guidedError(
        "KINGDOM OS returned an invalid repository path.",
        "kingdom_os_invalid_response",
        "Expected one canonical absolute path from `kingdom repos --path`.",
      );
    }
    return path;
  }

  private async execute(args: readonly string[]): Promise<KingdomOSCommandResult> {
    try {
      const result = await this.runner({
        executable: this.executable,
        args,
        timeoutMs: this.timeoutMs,
        maxOutputBytes: this.maxOutputBytes,
        env: safeChildEnvironment(),
      });
      if (
        typeof result !== "object"
        || result === null
        || !Number.isInteger(result.exitCode)
        || typeof result.stdout !== "string"
        || typeof result.stderr !== "string"
        || hasUnpairedSurrogate(result.stdout)
        || hasUnpairedSurrogate(result.stderr)
      ) {
        throw guidedError(
          "The configured KINGDOM OS runner returned an invalid result.",
          "kingdom_os_runner_failed",
          "Return a KingdomOSCommandResult with integer exitCode and well-formed Unicode text streams.",
        );
      }
      const resultBytes =
        new TextEncoder().encode(result.stdout).byteLength
        + new TextEncoder().encode(result.stderr).byteLength;
      if (resultBytes > this.maxOutputBytes) {
        throw guidedError(
          "KINGDOM OS command output exceeded the configured limit.",
          "kingdom_os_output_too_large",
          "Narrow the repository query or raise maxOutputBytes deliberately.",
        );
      }
      return result;
    } catch (error) {
      if (error instanceof AgentToolError) throw error;
      throw guidedError(
        "The configured KINGDOM OS runner failed.",
        "kingdom_os_runner_failed",
        "Inspect the host-owned runner and retry the same read-only operation.",
        { reason: error instanceof Error ? error.message : String(error) },
      );
    }
  }

  private commandFailure(
    result: KingdomOSCommandResult,
    resolving = false,
  ): AgentToolError {
    const diagnostic = cleanDiagnostic(result.stderr);
    if (resolving && result.exitCode === 1) {
      return guidedError(
        "No local repository matched the KINGDOM OS query.",
        "kingdom_os_repo_not_found",
        diagnostic || "Check the repository name or inspect repositories() first.",
        { exit_code: result.exitCode },
      );
    }
    if (resolving && result.exitCode === 2) {
      return guidedError(
        "The KINGDOM OS repository query was ambiguous or invalid.",
        "kingdom_os_repo_ambiguous",
        diagnostic || "Refine the query until it names exactly one repository.",
        { exit_code: result.exitCode },
      );
    }
    return guidedError(
      "KINGDOM OS repository discovery failed.",
      result.exitCode === 127
        ? "kingdom_os_cli_dependency_missing"
        : "kingdom_os_command_failed",
      diagnostic || "Run `kingdom repos --json` locally to inspect the failure.",
      { exit_code: result.exitCode },
    );
  }
}
