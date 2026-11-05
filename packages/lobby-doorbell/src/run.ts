/** The package's only process module. Every child gets a fixed argv from a
 * closed allowlist, no shell, an environment built from an allowlist (so proxy,
 * TLS-override, BUN_OPTIONS and NODE_OPTIONS variables never reach it), a time
 * limit and bounded output. Only the first stderr line is kept.
 *
 * Two kinds of child: a waited-for read (the pinned lobby CLI's read commands,
 * `mullvad lan get`, `ps -o lstart=`), and a detached doorbell process
 * (`fetch`, or `watch --room R`) started by `listen` or the SessionStart hook
 * from a session or a terminal, never by launchd. Signals are sent only here,
 * only SIGTERM, and only after the caller matched the pid's `ps` start time.
 */
import { isAbsolute } from "node:path";
import { DoorbellError } from "./errors.js";
import type { Environment } from "./home.js";

export const ROOM_ID_PATTERN = /^room_[0-9a-f]{32}$/;
/** Larger than any cursor (`cursorFlag` allows 19 digits), so a cached read returns no message. */
export const CURSOR_AFTER_ALL = "9223372036854775807";
export const MULLVAD_PATHS = ["/usr/local/bin/mullvad", "/opt/homebrew/bin/mullvad"] as const;
export const PS_PATH = "/bin/ps";
/** Flags placed before the lobby entry: no .env file and no bunfig.toml reach the child. */
export const BUN_CHILD_FLAGS = ["--no-env-file", "--config=/dev/null"] as const;
const STDERR_MAX = 4096;

export interface RunOptions {
  env: Record<string, string>;
  timeoutMs: number;
  maxBytes: number;
}

export interface RunResult {
  /** null when the child was killed or could not start. */
  exitCode: number | null;
  stdout: string;
  stderrFirstLine: string;
  timedOut: boolean;
  truncated: boolean;
  spawnFailed: boolean;
}

export interface Spawner {
  run(argv: readonly string[], options: RunOptions): Promise<RunResult>;
}

/** Starts a detached doorbell child (stdio ignored, its own session) and returns its pid, or null. */
export interface Starter {
  start(argv: readonly string[], env: Record<string, string>): number | null;
}

/** A page of table talk is at most this many items (the lobby's READ_LIMIT_MAX). */
export const READ_PAGE_LIMIT = "50";
const CURSOR = /^(0|[1-9][0-9]{0,18})$/;
/** The doorbell's own entry ends so; a detached child must run exactly that file. */
const DOORBELL_ENTRY = /\/bin\/agenttool-lobby-doorbell\.ts$/;

/** The lobby CLI commands the doorbell may run. None of them sends anything or needs a terminal:
 * netcheck's local reads, and the fetcher's table reads (one sync, then cached pages). */
function allowedLobbyArgs(args: readonly string[]): boolean {
  const shape = args.join(" ");
  if (shape === "fleet status --json" || shape === "hub show --json") return true;
  if (args.length === 4 && args[0] === "fleet" && args[1] === "card" && ROOM_ID_PATTERN.test(args[2]!) && args[3] === "--json") return true;
  if (args.length < 3 || args[0] !== "room" || args[1] !== "read" || !ROOM_ID_PATTERN.test(args[2]!)) return false;
  const flags = args.slice(3);
  if (flags.join(" ") === `--cached --json --limit 1 --after ${CURSOR_AFTER_ALL}`) return true;
  // The fetcher: `--json --after C --limit 50` syncs once; with `--cached` first it pages the cache, no network.
  const paged = flags[0] === "--cached" ? flags.slice(1) : flags;
  return paged.length === 5 && paged[0] === "--json" && paged[1] === "--after" && CURSOR.test(paged[2]!)
    && paged[3] === "--limit" && paged[4] === READ_PAGE_LIMIT;
}

/** The detached doorbell commands: the fetcher, and one watcher per room. */
function allowedDoorbellArgs(args: readonly string[]): boolean {
  if (args.length === 1 && args[0] === "fetch") return true;
  return args.length === 3 && args[0] === "watch" && args[1] === "--room" && ROOM_ID_PATTERN.test(args[2]!);
}

/** Refuses every argv outside the allowlist, before anything starts. */
export function assertAllowedArgv(argv: readonly string[], lobbyEntry: string | null): void {
  const [program, ...rest] = argv;
  if (program === process.execPath && lobbyEntry !== null
    && rest[0] === BUN_CHILD_FLAGS[0] && rest[1] === BUN_CHILD_FLAGS[1] && rest[2] === lobbyEntry
    && allowedLobbyArgs(rest.slice(3))) return;
  if ((MULLVAD_PATHS as readonly string[]).includes(program ?? "") && rest.join(" ") === "lan get") return;
  if (program === PS_PATH && rest.length === 4 && rest[0] === "-o" && rest[1] === "lstart=" && rest[2] === "-p"
    && /^[1-9][0-9]{0,9}$/.test(rest[3]!)) return;
  throw new DoorbellError("argv_not_allowed", "that command is not on the doorbell's allowlist");
}

/** The detached allowlist: only this doorbell's own entry, with `fetch` or `watch --room R`. */
export function assertAllowedDetachedArgv(argv: readonly string[], selfEntry: string | null): void {
  const [program, ...rest] = argv;
  if (program === process.execPath && selfEntry !== null && isAbsolute(selfEntry) && DOORBELL_ENTRY.test(selfEntry)
    && rest[0] === BUN_CHILD_FLAGS[0] && rest[1] === BUN_CHILD_FLAGS[1] && rest[2] === selfEntry
    && allowedDoorbellArgs(rest.slice(3))) return;
  throw new DoorbellError("argv_not_allowed", "that command is not on the doorbell's detached allowlist");
}

export function lobbyArgv(lobbyEntry: string, args: readonly string[]): string[] {
  return [process.execPath, ...BUN_CHILD_FLAGS, lobbyEntry, ...args];
}

export function doorbellArgv(selfEntry: string, args: readonly string[]): string[] {
  return [process.execPath, ...BUN_CHILD_FLAGS, selfEntry, ...args];
}

/** Launch-context evidence a detached doorbell child keeps, so it can refuse a launchd context itself. */
export const LAUNCH_EVIDENCE = ["SSH_CONNECTION", "TERM_PROGRAM", "XPC_SERVICE_NAME", "CLAUDECODE", "CODEX_THREAD_ID"] as const;
/** The Claude Code inbox a watcher rings; only a watcher gets these. */
export const INBOX_VARIABLES = ["CLAUDE_CODE_MESSAGING_SOCKET", "CLAUDE_CODE_MESSAGING_TOKEN", "CLAUDE_PID"] as const;

/** A detached doorbell child: the lobby CLI's environment, the resolved doorbell home, the launch
 * evidence, and (watchers only) the inbox variables. Nothing else is inherited. */
export function doorbellChildEnvironment(parent: Environment, lobbyHome: string, doorbellHome: string, inbox: boolean): Record<string, string> {
  const env = childEnvironment(parent, lobbyHome);
  env.AGENTTOOL_LOBBY_DOORBELL_HOME = doorbellHome;
  for (const name of [...LAUNCH_EVIDENCE, ...(inbox ? INBOX_VARIABLES : [])]) {
    const value = parent[name];
    if (value !== undefined && value !== "") env[name] = value;
  }
  return env;
}

/** HOME, a fixed PATH, LANG and the resolved lobby home. Nothing else is inherited. */
export function childEnvironment(parent: Environment, lobbyHome: string | null): Record<string, string> {
  const env: Record<string, string> = { PATH: "/usr/bin:/bin" };
  if (parent.HOME !== undefined && parent.HOME !== "") env.HOME = parent.HOME;
  if (parent.LANG !== undefined && parent.LANG !== "") env.LANG = parent.LANG;
  if (lobbyHome !== null) env.AGENTTOOL_LOBBY_HOME = lobbyHome;
  return env;
}

async function readBounded(stream: ReadableStream<Uint8Array>, max: number): Promise<{ text: string; truncated: boolean }> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    length += part.value.byteLength;
    if (length > max) {
      await reader.cancel().catch(() => undefined);
      return { text: "", truncated: true };
    }
    chunks.push(part.value);
  }
  return { text: Buffer.concat(chunks).toString("utf8"), truncated: false };
}

/** Keeps the first `max` bytes and drains the rest unread, so the child never blocks on a full pipe. */
async function readHead(stream: ReadableStream<Uint8Array>, max: number): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    if (length < max) chunks.push(part.value.subarray(0, max - length));
    length += part.value.byteLength;
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** The package's one spawn call: a waited-for read with piped output, or a detached child with no stdio. */
function spawnChild(argv: readonly string[], env: Record<string, string>, detached: boolean) {
  return Bun.spawn([...argv], detached
    ? { cwd: "/", env, stdin: "ignore", stdout: "ignore", stderr: "ignore", detached: true }
    : { cwd: "/", env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
}

/** Starts the fetcher or a watcher, detached; checks the detached allowlist itself. */
export function processStarter(selfEntry: string | null): Starter {
  return {
    start(argv, env) {
      assertAllowedDetachedArgv(argv, selfEntry);
      try {
        const child = spawnChild(argv, env, true);
        child.unref();
        return child.pid;
      } catch {
        return null;
      }
    },
  };
}

/** Whether a process with that pid exists (signal 0 sends nothing). */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** `ps -o lstart=` for a pid: its start time, to tell a reused pid apart. Null when gone or unreadable. */
export async function processStarted(spawner: Spawner, pid: number): Promise<string | null> {
  if (!Number.isInteger(pid) || pid < 1) return null;
  const result = await spawner.run([PS_PATH, "-o", "lstart=", "-p", String(pid)], { env: { PATH: "/usr/bin:/bin" }, timeoutMs: 3_000, maxBytes: 4096 });
  const text = result.exitCode === 0 ? result.stdout.trim() : "";
  return /^[A-Za-z0-9 :]{1,64}$/.test(text) ? text : null;
}

/** SIGTERM, only when the pid's start time still equals the recorded one. Never SIGKILL. */
export async function terminateIfSame(spawner: Spawner, pid: number, started: string): Promise<boolean> {
  const now = await processStarted(spawner, pid);
  if (now === null || now !== started) return false;
  try {
    process.kill(pid, "SIGTERM");
    return true;
  } catch {
    return false;
  }
}

/** The real spawner: checks the allowlist itself, so no caller can widen it. */
export function processSpawner(lobbyEntry: string | null): Spawner {
  return {
    async run(argv, options) {
      assertAllowedArgv(argv, lobbyEntry);
      let child: ReturnType<typeof spawnChild>;
      try {
        child = spawnChild(argv, options.env, false);
      } catch {
        return { exitCode: null, stdout: "", stderrFirstLine: "", timedOut: false, truncated: false, spawnFailed: true };
      }
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, options.timeoutMs);
      try {
        const [out, err] = await Promise.all([
          readBounded(child.stdout as ReadableStream<Uint8Array>, options.maxBytes).then((result) => {
            // Oversized output is not parsed; stop the child rather than wait for it.
            if (result.truncated) child.kill("SIGTERM");
            return result;
          }),
          readHead(child.stderr as ReadableStream<Uint8Array>, STDERR_MAX),
        ]);
        const exitCode = await child.exited;
        return {
          exitCode: timedOut || out.truncated ? null : exitCode,
          stdout: out.text,
          stderrFirstLine: err.split("\n", 1)[0] ?? "",
          timedOut,
          truncated: out.truncated,
          spawnFailed: false,
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
