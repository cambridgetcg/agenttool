/** Local probes: Mullvad's lan setting, the launch context, and the doorbell's
 * own files (pidfile, listeners, bells, fetcher status), which the fetcher and
 * `listen` write. Netcheck validates every field it keeps against an id
 * pattern, a canonical time or a closed set; a bell must pass the same full
 * validator the watcher uses (src/formats.ts).
 */
import { lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseBell, type BellState } from "./formats.js";
import { inspectPrivateDirectory, type DirectoryState, type Environment } from "./home.js";
import { isCanonicalTime } from "./lobby-cli.js";
import { childEnvironment, MULLVAD_PATHS, PS_PATH, ROOM_ID_PATTERN, type Spawner } from "./run.js";

// ── Mullvad ────────────────────────────────────────────────────────────

export const MULLVAD_TIMEOUT_MS = 3_000;
const MULLVAD_LAN = /^Local network sharing setting: (allow|block)\s*$/m;

export interface LanResult {
  /** `not_installed` counts as allow; `unknown` means the output could not be read. */
  state: "allow" | "block" | "not_installed" | "unknown";
  binary: string | null;
}

/** Follows links: /usr/local/bin/mullvad is the app bundle's symlink to its CLI. */
export function binaryPresent(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export async function probeLan(spawner: Spawner, env: Environment, exists: (path: string) => boolean = binaryPresent): Promise<LanResult> {
  const binary = MULLVAD_PATHS.find((path) => exists(path)) ?? null;
  if (binary === null) return { state: "not_installed", binary: null };
  const result = await spawner.run([binary, "lan", "get"], { env: childEnvironment(env, null), timeoutMs: MULLVAD_TIMEOUT_MS, maxBytes: 16 * 1024 });
  if (result.exitCode !== 0) return { state: "unknown", binary };
  const match = MULLVAD_LAN.exec(result.stdout);
  return { state: match === null ? "unknown" : match[1] as "allow" | "block", binary };
}

// ── launch context ─────────────────────────────────────────────────────

export interface LaunchContext {
  context: "ssh" | "terminal" | "launchd" | "unknown";
  harnesses: Array<"claude-code" | "codex">;
  local_network_exemption: "likely" | "no" | "unknown";
  basis: "environment evidence, not proof";
}

/** Read from environment variables only; the launchd value is not verified inside a real launchd agent. */
export function launchContext(env: Environment): LaunchContext {
  const harnesses: LaunchContext["harnesses"] = [];
  if (env.CLAUDECODE === "1") harnesses.push("claude-code");
  if (env.CODEX_THREAD_ID !== undefined && env.CODEX_THREAD_ID !== "") harnesses.push("codex");
  const xpc = env.XPC_SERVICE_NAME;
  const basis = "environment evidence, not proof" as const;
  if (env.SSH_CONNECTION !== undefined && env.SSH_CONNECTION !== "") {
    return { context: "ssh", harnesses, local_network_exemption: "likely", basis };
  }
  if (env.TERM_PROGRAM === "Apple_Terminal" || env.TERM_PROGRAM === "iTerm.app") {
    return { context: "terminal", harnesses, local_network_exemption: "likely", basis };
  }
  if (xpc !== undefined && xpc !== "" && xpc !== "0" && !xpc.startsWith("application.")) {
    return { context: "launchd", harnesses, local_network_exemption: "no", basis };
  }
  return { context: "unknown", harnesses, local_network_exemption: "unknown", basis };
}

// ── the doorbell's own files ───────────────────────────────────────────

const FILE_MAX = 64 * 1024;

export interface DoorbellState {
  home: DirectoryState;
  /** `unknown`: a pidfile exists but could not be read or checked. */
  fetcher: "absent" | "running" | "stale" | "unknown";
  listeners: string[];
  bells: Array<{ room_id: string; state: BellState | "unreadable" }>;
  /** Per room, from fetcher.json: the last successful poll. */
  last_ok_at: Record<string, string | null>;
  unreadable: number;
}

function readSmallJson(path: string): unknown {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.size > FILE_MAX) throw new Error("not a small regular file");
  return JSON.parse(readFileSync(path, "utf8"));
}

function roomFiles(directory: string): string[] {
  try {
    return readdirSync(directory).filter((name) => /^room_[0-9a-f]{32}\.json$/.test(name)).map((name) => name.slice(0, -5)).sort();
  } catch {
    return [];
  }
}

async function fetcherState(home: string, spawner: Spawner, env: Environment): Promise<DoorbellState["fetcher"]> {
  const path = join(home, "fetcher.pid");
  let pidfile: Record<string, unknown>;
  try {
    lstatSync(path);
  } catch {
    return "absent";
  }
  try {
    pidfile = readSmallJson(path) as Record<string, unknown>;
  } catch {
    return "unknown";
  }
  const pid = pidfile?.pid;
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid < 1 || typeof pidfile.started !== "string") return "unknown";
  // `ps -o lstart=` guards against pid reuse, as in #491's claude-hook.ts.
  const result = await spawner.run([PS_PATH, "-o", "lstart=", "-p", String(pid)], { env: childEnvironment(env, null), timeoutMs: 3_000, maxBytes: 4096 });
  if (result.timedOut || result.spawnFailed) return "unknown";
  if (result.exitCode !== 0) return "stale";
  return result.stdout.trim() === pidfile.started.trim() ? "running" : "stale";
}

export async function probeDoorbell(home: string, spawner: Spawner, env: Environment): Promise<DoorbellState> {
  const state: DoorbellState = { home: inspectPrivateDirectory(home), fetcher: "absent", listeners: [], bells: [], last_ok_at: {}, unreadable: 0 };
  if (state.home !== "ok") return state;
  state.fetcher = await fetcherState(home, spawner, env);
  state.listeners = roomFiles(join(home, "listeners"));
  for (const roomId of roomFiles(join(home, "bells"))) {
    try {
      const bell = parseBell(readSmallJson(join(home, "bells", `${roomId}.json`)), roomId);
      state.bells.push({ room_id: roomId, state: bell === null ? "unreadable" : bell.state });
      if (bell === null) state.unreadable += 1;
    } catch {
      state.bells.push({ room_id: roomId, state: "unreadable" });
      state.unreadable += 1;
    }
  }
  try {
    const status = readSmallJson(join(home, "fetcher.json")) as Record<string, unknown>;
    if (status?.format === "agenttool-lobby-fetcher/v1" && Array.isArray(status.rooms)) {
      for (const room of status.rooms as Array<Record<string, unknown>>) {
        if (typeof room?.room_id !== "string" || !ROOM_ID_PATTERN.test(room.room_id)) continue;
        state.last_ok_at[room.room_id] = isCanonicalTime(room.last_ok_at) ? room.last_ok_at : null;
      }
    }
  } catch {
    // An absent fetcher.json is normal; PR 1 never writes one.
  }
  return state;
}
