/** The package's only process module (the `ask` look's runner).
 *
 * Every child gets a fixed argv from a closed allowlist, no shell, an
 * environment of a fixed PATH and HOME and one fixed Bun setting (so proxy,
 * TLS-override, BUN_OPTIONS, NODE_OPTIONS and the collab switches never reach
 * it), a time limit and bounded output. Standard error is drained and dropped:
 * no text of it survives. The allowlist is the collab host's `--help` and
 * `weather`, run by this same Bun from the current collab install; nothing that
 * takes a session, a journal or a network.
 *
 * The time limit is a bound on the survey, not a request to the child: at the
 * limit the child's whole process group is sent SIGTERM, then SIGKILL after a
 * short grace, and the runner stops reading whether or not anything still holds
 * the pipes. It returns within the limit and two graces.
 */
import { join } from "node:path";
import { VERSION_NAME, SHARE_REL } from "./places.js";

/**
 * Flags placed before the entry: no auto-install (without it, a bare import that
 * does not resolve makes Bun 1.3.5 ask a package registry and create a package
 * cache in the home), no .env file and no bunfig.toml.
 */
export const BUN_CHILD_FLAGS = ["--no-install", "--no-env-file", "--config=/dev/null"] as const;
export const COLLAB_HOST_FILE = "agenttool-collab-host.js";
export const ASK_ARGS = { help: ["--help"], weather: ["weather"] } as const;
export type AskName = keyof typeof ASK_ARGS;
const CHILD_PATH = "/usr/bin:/bin";
/** How long a signalled child is given to leave before the next step. */
export const KILL_GRACE_MS = 500;

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
  const flags = BUN_CHILD_FLAGS.length;
  const [program, ...rest] = argv;
  const entry = rest[flags];
  const args = rest.slice(flags + 1);
  if (program === process.execPath && BUN_CHILD_FLAGS.every((flag, index) => rest[index] === flag)
    && entry !== undefined && isCollabHostEntry(entry, home)
    && args.length === 1 && (args[0] === ASK_ARGS.help[0] || args[0] === ASK_ARGS.weather[0])) return;
  throw new ArgvRefused();
}

export function askArgv(entry: string, ask: AskName): string[] {
  return [process.execPath, ...BUN_CHILD_FLAGS, entry, ...ASK_ARGS[ask]];
}

/** A fixed PATH and HOME, and no transpiler cache (Bun would otherwise write one into the home for a large bundle without the `// @bun` mark). Nothing else is inherited. */
export function childEnvironment(home: string): Record<string, string> {
  return { PATH: CHILD_PATH, HOME: home, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" };
}

type Reader = ReadableStreamDefaultReader<Uint8Array>;

async function readBounded(reader: Reader, max: number, onFlood: () => void): Promise<{ text: string; truncated: boolean }> {
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    length += part.value.byteLength;
    if (length > max) {
      onFlood();
      return { text: "", truncated: true };
    }
    chunks.push(part.value);
  }
  return { text: Buffer.concat(chunks).toString("utf8"), truncated: false };
}

/** Reads and drops everything, so the child never blocks on a full pipe. */
async function drain(reader: Reader): Promise<void> {
  for (;;) {
    const part = await reader.read();
    if (part.done) return;
  }
}

function after(ms: number): { promise: Promise<"late">; clear: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<"late">((resolve) => {
    timer = setTimeout(() => resolve("late"), ms);
  });
  return { promise, clear: () => clearTimeout(timer) };
}

async function within(ending: Promise<unknown>, ms: number): Promise<boolean> {
  const late = after(ms);
  try {
    return (await Promise.race([ending.then(() => "ended" as const), late.promise])) === "ended";
  } finally {
    late.clear();
  }
}

/** The child leads its own process group (it was spawned detached), so the signal reaches what it started too. */
function signalGroup(child: { pid: number; kill(signal?: number | NodeJS.Signals): void }, signal: "SIGTERM" | "SIGKILL"): void {
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // Already gone.
    }
  }
}

/** The real runner: checks the allowlist itself, so no caller can widen it. */
export function processRunner(home: string): Runner {
  return {
    async run(argv, options) {
      assertAllowedArgv(argv, home);
      let child: ReturnType<typeof Bun.spawn>;
      try {
        child = Bun.spawn([...argv], { cwd: "/", env: options.env, stdin: "ignore", stdout: "pipe", stderr: "pipe", detached: true });
      } catch {
        return { exitCode: null, stdout: "", timedOut: false, truncated: false, spawnFailed: true };
      }
      const out = (child.stdout as ReadableStream<Uint8Array>).getReader();
      const err = (child.stderr as ReadableStream<Uint8Array>).getReader();
      let flood: () => void = () => undefined;
      const flooded = new Promise<"flooded">((resolve) => {
        flood = () => resolve("flooded");
      });
      const reading = readBounded(out, options.maxBytes, () => flood());
      const done = Promise.all([reading, drain(err), child.exited]).then(() => "done" as const);
      const late = after(options.timeoutMs);
      let ending: "done" | "late" | "flooded";
      try {
        ending = await Promise.race([done, late.promise, flooded]);
      } finally {
        late.clear();
      }
      if (ending === "done") {
        const read = await reading;
        if (!read.truncated) {
          return { exitCode: await child.exited, stdout: read.text, timedOut: false, truncated: false, spawnFailed: false };
        }
        ending = "flooded";
      }
      // Late or flooding: stop the child and everything it started, and stop waiting on the pipes.
      signalGroup(child, "SIGTERM");
      if (!(await within(child.exited, KILL_GRACE_MS))) signalGroup(child, "SIGKILL");
      await within(Promise.all([out.cancel().catch(() => undefined), err.cancel().catch(() => undefined)]), KILL_GRACE_MS);
      await within(child.exited, KILL_GRACE_MS);
      return { exitCode: null, stdout: "", timedOut: ending === "late", truncated: ending === "flooded", spawnFailed: false };
    },
  };
}
