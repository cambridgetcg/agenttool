/** The package's only process module. Every child gets a fixed argv from a
 * closed allowlist, no shell, an environment built from an allowlist (so proxy,
 * TLS-override, BUN_OPTIONS and NODE_OPTIONS variables never reach it), a time
 * limit and bounded output. Only the first stderr line is kept.
 */
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

/** The lobby CLI commands netcheck may run. None of them sends anything or needs a terminal. */
function allowedLobbyArgs(args: readonly string[]): boolean {
  const shape = args.join(" ");
  if (shape === "fleet status --json" || shape === "hub show --json") return true;
  if (args.length === 4 && args[0] === "fleet" && args[1] === "card" && ROOM_ID_PATTERN.test(args[2]!) && args[3] === "--json") return true;
  return args.length === 9 && args[0] === "room" && args[1] === "read" && ROOM_ID_PATTERN.test(args[2]!)
    && args.slice(3).join(" ") === `--cached --json --limit 1 --after ${CURSOR_AFTER_ALL}`;
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

export function lobbyArgv(lobbyEntry: string, args: readonly string[]): string[] {
  return [process.execPath, ...BUN_CHILD_FLAGS, lobbyEntry, ...args];
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

/** The real spawner: checks the allowlist itself, so no caller can widen it. */
export function processSpawner(lobbyEntry: string | null): Spawner {
  return {
    async run(argv, options) {
      assertAllowedArgv(argv, lobbyEntry);
      let child: ReturnType<typeof Bun.spawn>;
      try {
        child = Bun.spawn([...argv], { cwd: "/", env: options.env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
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
