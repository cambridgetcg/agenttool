/** The pinned lobby CLI, run as a child, and the few fields netcheck keeps.
 *
 * Everything else the CLI prints (display names, card titles and purposes,
 * roster entries, table talk) is dropped at parse time: each parser builds a
 * new object from validated ids, canonical times and closed sets only. The
 * shapes parsed here are pinned against the lobby source by
 * contract/lobby-contract.ts, so drift fails CI instead of mis-parsing.
 */
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { CURSOR_AFTER_ALL, lobbyArgv, ROOM_ID_PATTERN, type Spawner } from "./run.js";

export const DEFAULT_LOBBY_ENTRY_PARTS = [".kingdom", "tools", "agenttool-lobby", "bin", "agenttool-lobby.ts"] as const;
export const CLI_TIMEOUT_MS = 15_000;
const CLI_STDOUT_MAX = 1024 * 1024;
const RECEIPT_MAX = 64 * 1024;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** `agenttool-lobby: <code>: <message>` (packages/lobby/src/cli.ts); only the code is kept. */
const REFUSAL_LINE = /^agenttool-lobby: ([a-z_]{1,64}): /;
/** Lobby refusal codes netcheck interprets; any other code is reported as `other`. */
export const KNOWN_LOBBY_CODES = [
  "hub_not_initialised", "hub_directory_pending", "card_not_found", "desk_not_enrolled", "desk_not_joined",
  "door_not_pinned", "not_seated", "lobby_home_not_absolute", "state_dir_not_private", "state_dir_unsafe",
  "state_file_not_private", "state_file_unsafe", "state_not_owned", "internal_error",
] as const;
export const ROOM_STATUSES = ["recruiting", "in_play", "resting", "closed"] as const;
export type RoomStatus = typeof ROOM_STATUSES[number];

export function defaultLobbyEntry(home: string = homedir()): string {
  return join(home, ...DEFAULT_LOBBY_ENTRY_PARTS);
}

/** A canonical UTC timestamp with millisecond precision, as the lobby writes them. */
export function isCanonicalTime(value: unknown): value is string {
  if (typeof value !== "string" || value.length !== 24) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function timeOrNull(value: unknown): string | null | undefined {
  if (value === null) return null;
  return isCanonicalTime(value) ? value : undefined;
}

// ── the entry file ─────────────────────────────────────────────────────

export type EntryCheck =
  | { state: "ok"; entry: string; commit: string | null }
  | { state: "unknown"; code: "lobby_cli_missing" | "lobby_cli_unsafe" };

/** The entry must be absolute, a regular file after resolving links, owned by this
 * user and not writable by group or others; so must the directory holding it. */
export function checkLobbyEntry(entry: string): EntryCheck {
  if (!isAbsolute(entry)) return { state: "unknown", code: "lobby_cli_unsafe" };
  let real: string;
  try {
    real = realpathSync(entry);
  } catch {
    return { state: "unknown", code: "lobby_cli_missing" };
  }
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  for (const path of [real, dirname(real)]) {
    const stat = lstatSync(path);
    const kindOk = path === real ? stat.isFile() : stat.isDirectory();
    if (!kindOk || (uid !== undefined && stat.uid !== uid) || (stat.mode & 0o022) !== 0) {
      return { state: "unknown", code: "lobby_cli_unsafe" };
    }
  }
  return { state: "ok", entry, commit: receiptCommit(join(dirname(dirname(real)), "INSTALL-RECEIPT.json")) };
}

/** The install receipt's commit: a `commit` field, else the first 40-hex id in `source`. */
export function receiptCommit(path: string): string | null {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.size > RECEIPT_MAX) return null;
    const receipt = record(JSON.parse(readFileSync(path, "utf8")));
    if (receipt === null) return null;
    if (typeof receipt.commit === "string" && /^[0-9a-f]{40}$/.test(receipt.commit)) return receipt.commit;
    const match = typeof receipt.source === "string" ? /\b([0-9a-f]{40})\b/.exec(receipt.source) : null;
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

// ── running a command ──────────────────────────────────────────────────

export type CliOutcome =
  | { kind: "ok"; json: unknown }
  | { kind: "refused"; code: string }
  | { kind: "failed"; code: "cli_timeout" | "cli_oversize" | "cli_spawn_failed" | "cli_exit" | "cli_unparseable" };

export class LobbyCli {
  constructor(
    private readonly entry: string,
    private readonly env: Record<string, string>,
    private readonly spawner: Spawner,
    private readonly timeoutMs: number = CLI_TIMEOUT_MS,
  ) {}

  async run(args: readonly string[]): Promise<CliOutcome> {
    const result = await this.spawner.run(lobbyArgv(this.entry, args), { env: this.env, timeoutMs: this.timeoutMs, maxBytes: CLI_STDOUT_MAX });
    if (result.spawnFailed) return { kind: "failed", code: "cli_spawn_failed" };
    if (result.timedOut) return { kind: "failed", code: "cli_timeout" };
    if (result.truncated) return { kind: "failed", code: "cli_oversize" };
    if (result.exitCode === 1) {
      const code = REFUSAL_LINE.exec(result.stderrFirstLine)?.[1];
      if (code === undefined) return { kind: "failed", code: "cli_unparseable" };
      return { kind: "refused", code: (KNOWN_LOBBY_CODES as readonly string[]).includes(code) ? code : "other" };
    }
    if (result.exitCode !== 0) return { kind: "failed", code: "cli_exit" };
    try {
      return { kind: "ok", json: JSON.parse(result.stdout) };
    } catch {
      return { kind: "failed", code: "cli_unparseable" };
    }
  }

  fleetStatus(): Promise<CliOutcome> {
    return this.run(["fleet", "status", "--json"]);
  }

  fleetCard(roomId: string): Promise<CliOutcome> {
    return this.run(["fleet", "card", roomId, "--json"]);
  }

  hubShow(): Promise<CliOutcome> {
    return this.run(["hub", "show", "--json"]);
  }

  /** No network and no message: the cursor is past every event, so only `synced_at` is new. */
  cachedRead(roomId: string): Promise<CliOutcome> {
    return this.run(["room", "read", roomId, "--cached", "--json", "--limit", "1", "--after", CURSOR_AFTER_ALL]);
  }
}

// ── parsers: new objects from validated fields only ────────────────────

export interface DeskGrant {
  purpose: "directory" | "season";
  room_id: string | null;
  mission_id: string | null;
  expires_at: string | null;
  accepted_at: string | null;
}

export type FleetStatus =
  | { desk: null }
  | { desk: { origin_matches: boolean; directory_mission_id: string | null }; grants: DeskGrant[] };

export function parseFleetStatus(json: unknown, origin: string): FleetStatus | null {
  const top = record(json);
  if (top === null || !("desk" in top)) return null;
  if (top.desk === null) return { desk: null };
  const desk = record(top.desk);
  if (desk === null || !Array.isArray(top.grants)) return null;
  const directory = desk.directory_mission_id;
  if (directory !== null && (typeof directory !== "string" || !UUID_PATTERN.test(directory))) return null;
  const grants: DeskGrant[] = [];
  for (const item of top.grants) {
    const grant = record(item);
    if (grant === null || (grant.purpose !== "directory" && grant.purpose !== "season")) return null;
    const roomId = grant.room_id === null ? null : typeof grant.room_id === "string" && ROOM_ID_PATTERN.test(grant.room_id) ? grant.room_id : undefined;
    const expires = timeOrNull(grant.expires_at);
    const accepted = timeOrNull(grant.accepted_at);
    if (roomId === undefined || expires === undefined || accepted === undefined) return null;
    const mission = typeof grant.mission_id === "string" && UUID_PATTERN.test(grant.mission_id) ? grant.mission_id : null;
    grants.push({ purpose: grant.purpose, room_id: roomId, mission_id: mission, expires_at: expires, accepted_at: accepted });
  }
  return { desk: { origin_matches: desk.origin === origin, directory_mission_id: directory }, grants };
}

export interface CardSeason {
  status: RoomStatus;
  mission_id: string | null;
  expires_at: string;
}

/** `fleet card --json`: keeps only the door-signed status and season end; all card text is dropped. */
export function parseCard(json: unknown, roomId: string): CardSeason | null {
  const fields = record(record(json)?.fields);
  const room = record(fields?.room_id)?.value;
  const status = record(fields?.status)?.value;
  const season = record(record(fields?.season)?.value);
  if (room !== roomId || typeof status !== "string" || !(ROOM_STATUSES as readonly string[]).includes(status)) return null;
  if (season === null || !isCanonicalTime(season.expires_at)) return null;
  const mission = typeof season.mission_id === "string" && UUID_PATTERN.test(season.mission_id) ? season.mission_id : null;
  return { status: status as RoomStatus, mission_id: mission, expires_at: season.expires_at };
}

/** `hub show --json`: keeps only `directory.expires_at`. */
export function parseHubDirectory(json: unknown): { expires_at: string } | null {
  const expires = record(record(json)?.directory)?.expires_at;
  return isCanonicalTime(expires) ? { expires_at: expires } : null;
}

/** `room read --cached --json`: keeps only `synced_at`, and refuses an output that carries a message. */
export function parseCachedRead(json: unknown, roomId: string): { synced_at: string | null } | null {
  const top = record(json);
  if (top === null || top.room_id !== roomId || !Array.isArray(top.messages) || top.messages.length !== 0) return null;
  const synced = timeOrNull(top.synced_at);
  return synced === undefined ? null : { synced_at: synced };
}
