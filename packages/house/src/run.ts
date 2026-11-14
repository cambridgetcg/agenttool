/** The package's only process module (the `ask` look's runner).
 *
 * Every child gets a fixed argv from a closed allowlist, no shell, an
 * environment of a fixed PATH and HOME only (so proxy, TLS-override,
 * BUN_OPTIONS, NODE_OPTIONS and the collab switches never reach it), a time
 * limit and bounded output. Standard error is drained and dropped: no text of
 * it survives. The allowlist is the collab host's `--help` and `weather`, run
 * by this same Bun from the current collab install; nothing that takes a
 * session, a journal or a network.
 */
import { join } from "node:path";
import { VERSION_NAME, SHARE_REL } from "./places.js";

/** Flags placed before the entry: no .env file and no bunfig.toml reach the child. */
export const BUN_CHILD_FLAGS = ["--no-env-file", "--config=/dev/null"] as const;
export const COLLAB_HOST_FILE = "agenttool-collab-host.js";
export const ASK_ARGS = { help: ["--help"], weather: ["weather"] } as const;
export type AskName = keyof typeof ASK_ARGS;
const CHILD_PATH = "/usr/bin:/bin";

export interface RunOptions {
  env: Record<string, string>;
  timeoutMs: number;
  maxBytes: number;
}

export interface RunResult {
  /** null when the child was killed or could not start. */
  exitCode: number | null;
  stdout: string;
  timedOut: boolean;
  truncated: boolean;
  spawnFailed: boolean;
}

export interface Runner {
  run(argv: readonly string[], options: RunOptions): Promise<RunResult>;
}

export class ArgvRefused extends Error {
  constructor() {
    super("that command is not on the house's allowlist");
    this.name = "ArgvRefused";
  }
}

function isCollabHostEntry(entry: string, home: string): boolean {
  const prefix = join(home, SHARE_REL, "collab") + "/";
  if (!entry.startsWith(prefix)) return false;
  const rest = entry.slice(prefix.length).split("/");
  return rest.length === 2 && VERSION_NAME.test(rest[0]!) && rest[0] !== "current" && rest[1] === COLLAB_HOST_FILE;
}

/** Refuses every argv outside the allowlist, before anything starts. */
export function assertAllowedArgv(argv: readonly string[], home: string): void {
  const [program, flag1, flag2, entry, ...args] = argv;
  if (program === process.execPath && flag1 === BUN_CHILD_FLAGS[0] && flag2 === BUN_CHILD_FLAGS[1]
    && entry !== undefined && isCollabHostEntry(entry, home)
    && args.length === 1 && (args[0] === ASK_ARGS.help[0] || args[0] === ASK_ARGS.weather[0])) return;
  throw new ArgvRefused();
}

export function askArgv(entry: string, ask: AskName): string[] {
  return [process.execPath, ...BUN_CHILD_FLAGS, entry, ...ASK_ARGS[ask]];
}

/** A fixed PATH and HOME. Nothing else is inherited. */
export function childEnvironment(home: string): Record<string, string> {
  return { PATH: CHILD_PATH, HOME: home };
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

/** Reads and drops everything, so the child never blocks on a full pipe. */
async function drain(stream: ReadableStream<Uint8Array>): Promise<void> {
  const reader = stream.getReader();
  for (;;) {
    const part = await reader.read();
    if (part.done) return;
  }
}

/** The real runner: checks the allowlist itself, so no caller can widen it. */
export function processRunner(home: string): Runner {
  return {
    async run(argv, options) {
      assertAllowedArgv(argv, home);
      let child: ReturnType<typeof Bun.spawn>;
      try {
        child = Bun.spawn([...argv], { cwd: "/", env: options.env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
      } catch {
        return { exitCode: null, stdout: "", timedOut: false, truncated: false, spawnFailed: true };
      }
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, options.timeoutMs);
      try {
        const [out] = await Promise.all([
          readBounded(child.stdout as ReadableStream<Uint8Array>, options.maxBytes).then((result) => {
            // Oversized output is not parsed; stop the child rather than wait for it.
            if (result.truncated) child.kill("SIGTERM");
            return result;
          }),
          drain(child.stderr as ReadableStream<Uint8Array>),
        ]);
        const exitCode = await child.exited;
        return {
          exitCode: timedOut || out.truncated ? null : exitCode,
          stdout: out.text,
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
