/** netcheck: a read-only per-device health check with exactly five states.
 *
 * Worst first: hosted-unreachable, grant-lapsed, lan-blocked, unknown,
 * hosted-ok. Unknown is never healthy and never exits 0. It changes nothing:
 * it never starts the lobby CLI when the lobby home holds no database (any
 * lobby command would create it), runs only allowlisted read commands, and
 * writes one log line only into a doorbell home that already exists.
 * Spec: ~/.kingdom/lobby/specs/doorbells.md section 7 (agent-written, 2026-10-27).
 */
import { homedir } from "node:os";
import { DoorbellError } from "./errors.js";
import { checkHealth, LOBBY_ORIGIN, type FetchLike, type HealthResult } from "./health.js";
import {
  appendLogLine,
  lobbyHomeState,
  refuseMisspeltEnvironment,
  resolveDoorbellHome,
  resolveLobbyHome,
  stopPresent,
  type Environment,
} from "./home.js";
import {
  checkLobbyEntry,
  CLI_TIMEOUT_MS,
  defaultLobbyEntry,
  LobbyCli,
  parseCachedRead,
  parseCard,
  parseFleetStatus,
  parseHubDirectory,
  type CardSeason,
  type CliOutcome,
  type DeskGrant,
  type RoomStatus,
} from "./lobby-cli.js";
import { launchContext, probeDoorbell, probeLan, type DoorbellState, type LanResult, type LaunchContext } from "./probes.js";
import { childEnvironment, processSpawner, ROOM_ID_PATTERN, type Spawner } from "./run.js";

export const STATES = ["hosted-ok", "hosted-unreachable", "lan-blocked", "grant-lapsed", "unknown"] as const;
export type NetcheckState = typeof STATES[number];
export const EXIT_CODES: Record<NetcheckState, number> = {
  "hosted-ok": 0, "grant-lapsed": 4, "hosted-unreachable": 5, "lan-blocked": 6, "unknown": 7,
};
export const WARNING_CODES = [
  "clock_skew", "grant_expiring", "season_ending", "directory_ending", "cache_stale",
  "stop_present", "fetcher_absent_with_listener", "launch_context_not_exempt",
] as const;
export const MAX_ROOMS = 20;

const HOUR = 3600;
export const THRESHOLDS = {
  skewWarnMs: 5_000,
  skewSevereMs: 30_000,
  grantExpiringS: 2 * HOUR,
  seasonEndingS: 24 * HOUR,
  directoryEndingS: 7 * 24 * HOUR,
  cacheStaleS: HOUR,
} as const;

export interface Warning {
  code: typeof WARNING_CODES[number];
  room_id?: string;
  seconds?: number;
  severe?: boolean;
}

export interface GrantView {
  state: "live" | "lapsed" | "unknown";
  reason: "expired" | "not_accepted" | "no_expiry" | "no_grant" | "not_joined" | null;
  expires_at: string | null;
  expires_in_s: number | null;
}

export interface SeasonView {
  state: "open" | "closed" | "ended" | "unknown";
  code: string | null;
  room_status: RoomStatus | null;
  mission_id: string | null;
  expires_at: string | null;
  ends_in_s: number | null;
}

export interface CacheView {
  state: "ok" | "unknown";
  code: string | null;
  synced_at: string | null;
  age_s: number | null;
  fetcher_last_ok_at: string | null;
}

export interface RoomView {
  room_id: string;
  listened: boolean;
  requested: boolean;
  /** Whether this room's lapsed grant sets grant-lapsed: listened to, asked for, or its season still open. */
  counted: boolean;
  grant: GrantView;
  season: SeasonView;
  cache: CacheView;
}

export interface DirectoryView {
  grant: GrantView;
  role: "hub" | "member" | "unknown";
  code: string | null;
  expires_at: string | null;
  expires_in_s: number | null;
  /** On a member desk the directory's end is unknown; it is known only to outlast this grant. */
  bounded_by_grant: string | null;
}

export interface NetcheckReport {
  format: "agenttool-lobby-netcheck/v1";
  at: string;
  state: NetcheckState;
  healthy: boolean;
  exit_code: number;
  warnings: Warning[];
  /** The axes that made or would make the state unknown, as `axis:code`. */
  unknown: string[];
  checks: {
    lobby_cli: { state: "ok" | "unknown"; code: string | null; commit: string | null };
    lobby_home: { state: "present" | "absent" | "empty" | "unsafe" | "unknown"; code: string | null; stop_present: boolean };
    desk: { state: "ok" | "unknown"; code: string | null; lobby_code: string | null };
    hosted: (HealthResult & { origin: typeof LOBBY_ORIGIN }) | { status: "unknown"; code: "no_fetch"; origin: typeof LOBBY_ORIGIN };
    directory: DirectoryView | null;
    rooms: RoomView[];
    rooms_skipped: number;
    lan: LanResult;
    launch: LaunchContext;
    doorbell: DoorbellState;
  };
}

export interface NetcheckOptions {
  env: Environment;
  fetchImpl: FetchLike | null;
  rooms?: string[];
  lobbyEntry?: string;
  doorbellHome?: string;
  /** Tests only. */
  now?: () => number;
  homeDir?: string;
  spawner?: (lobbyEntry: string | null) => Spawner;
  mullvadExists?: (path: string) => boolean;
  healthTimeoutMs?: number;
  cliTimeoutMs?: number;
}

function secondsUntil(time: string | null, nowMs: number): number | null {
  return time === null ? null : Math.floor((Date.parse(time) - nowMs) / 1000);
}

/** The best grant among candidates: the live one lasting longest, else the latest lapsed one. */
export function evaluateGrant(grants: readonly DeskGrant[], nowMs: number): GrantView {
  const live = grants
    .filter((grant) => grant.accepted_at !== null && grant.expires_at !== null && Date.parse(grant.expires_at) > nowMs)
    .sort((left, right) => Date.parse(right.expires_at!) - Date.parse(left.expires_at!));
  if (live[0] !== undefined) {
    return { state: "live", reason: null, expires_at: live[0].expires_at, expires_in_s: secondsUntil(live[0].expires_at, nowMs) };
  }
  if (grants.length === 0) return { state: "lapsed", reason: "no_grant", expires_at: null, expires_in_s: null };
  const latest = [...grants].sort((left, right) =>
    (right.expires_at === null ? -Infinity : Date.parse(right.expires_at)) - (left.expires_at === null ? -Infinity : Date.parse(left.expires_at)))[0]!;
  const reason = latest.accepted_at === null ? "not_accepted" : latest.expires_at === null ? "no_expiry" : "expired";
  return { state: "lapsed", reason, expires_at: latest.expires_at, expires_in_s: secondsUntil(latest.expires_at, nowMs) };
}

function outcomeCode(outcome: CliOutcome): { code: string; lobby_code: string | null } {
  if (outcome.kind === "refused") return { code: "lobby_refused", lobby_code: outcome.code };
  if (outcome.kind === "failed") return { code: outcome.code, lobby_code: null };
  return { code: "cli_unparseable", lobby_code: null };
}

function seasonFrom(outcome: CliOutcome, roomId: string, nowMs: number): SeasonView {
  const none = { room_status: null, mission_id: null, expires_at: null, ends_in_s: null };
  if (outcome.kind !== "ok") {
    const { code, lobby_code } = outcomeCode(outcome);
    return { state: "unknown", code: lobby_code === "card_not_found" ? "card_not_found" : code, ...none };
  }
  const card: CardSeason | null = parseCard(outcome.json, roomId);
  if (card === null) return { state: "unknown", code: "cli_unparseable", ...none };
  const ends = secondsUntil(card.expires_at, nowMs)!;
  const state = card.status === "closed" ? "closed" : ends <= 0 ? "ended" : "open";
  return { state, code: null, room_status: card.status, mission_id: card.mission_id, expires_at: card.expires_at, ends_in_s: ends };
}

function cacheFrom(outcome: CliOutcome, roomId: string, nowMs: number, lastOk: string | null): CacheView {
  if (outcome.kind !== "ok") return { state: "unknown", code: outcomeCode(outcome).code, synced_at: null, age_s: null, fetcher_last_ok_at: lastOk };
  const read = parseCachedRead(outcome.json, roomId);
  if (read === null) return { state: "unknown", code: "cli_unparseable", synced_at: null, age_s: null, fetcher_last_ok_at: lastOk };
  const age = read.synced_at === null ? null : Math.max(0, Math.floor((nowMs - Date.parse(read.synced_at)) / 1000));
  return { state: "ok", code: null, synced_at: read.synced_at, age_s: age, fetcher_last_ok_at: lastOk };
}

async function directoryFrom(cli: LobbyCli, grant: GrantView, nowMs: number): Promise<DirectoryView> {
  const outcome = await cli.hubShow();
  if (outcome.kind === "ok") {
    const directory = parseHubDirectory(outcome.json);
    if (directory === null) return { grant, role: "unknown", code: "cli_unparseable", expires_at: null, expires_in_s: null, bounded_by_grant: null };
    return { grant, role: "hub", code: null, expires_at: directory.expires_at, expires_in_s: secondsUntil(directory.expires_at, nowMs), bounded_by_grant: null };
  }
  if (outcome.kind === "refused" && outcome.code === "hub_not_initialised") {
    return { grant, role: "member", code: null, expires_at: null, expires_in_s: null, bounded_by_grant: grant.state === "live" ? grant.expires_at : null };
  }
  return { grant, role: "unknown", code: outcomeCode(outcome).lobby_code ?? outcomeCode(outcome).code, expires_at: null, expires_in_s: null, bounded_by_grant: null };
}

export async function runNetcheck(options: NetcheckOptions): Promise<NetcheckReport> {
  const env = options.env;
  refuseMisspeltEnvironment(env);
  const clock = options.now ?? (() => Date.now());
  const nowMs = clock();
  const home = options.homeDir ?? homedir();
  const requested = [...new Set(options.rooms ?? [])];
  for (const room of requested) {
    if (!ROOM_ID_PATTERN.test(room)) throw new DoorbellError("room_invalid", "a room id is room_ followed by 32 lowercase hex characters");
  }

  let lobbyHome: string | null = null;
  let lobbyHomeCode: string | null = null;
  try {
    lobbyHome = resolveLobbyHome(env, home);
  } catch (error) {
    if (!(error instanceof DoorbellError)) throw error;
    lobbyHomeCode = error.code;
  }
  const doorbellHome = resolveDoorbellHome(env, lobbyHome, options.doorbellHome, home);

  const entry = options.lobbyEntry ?? defaultLobbyEntry(home);
  const entryCheck = checkLobbyEntry(entry);
  const usableEntry = entryCheck.state === "ok" ? entry : null;
  const spawner = options.spawner?.(usableEntry) ?? processSpawner(usableEntry);

  const hostedPromise = options.fetchImpl === null
    ? Promise.resolve(null)
    : checkHealth({ fetchImpl: options.fetchImpl, now: clock, ...(options.healthTimeoutMs === undefined ? {} : { timeoutMs: options.healthTimeoutMs }) });
  const lanPromise = probeLan(spawner, env, options.mullvadExists);
  const doorbellPromise = probeDoorbell(doorbellHome, spawner, env);

  const homeState = lobbyHome === null ? "unknown" as const : lobbyHomeState(lobbyHome);
  const checks: NetcheckReport["checks"] = {
    lobby_cli: entryCheck.state === "ok"
      ? { state: "ok", code: null, commit: entryCheck.commit }
      : { state: "unknown", code: entryCheck.code, commit: null },
    lobby_home: {
      state: homeState,
      code: lobbyHomeCode ?? (homeState === "unsafe" ? "lobby_home_unsafe" : null),
      stop_present: lobbyHome !== null && stopPresent(lobbyHome),
    },
    desk: { state: "unknown", code: null, lobby_code: null },
    hosted: { status: "unknown", code: "no_fetch", origin: LOBBY_ORIGIN },
    directory: null,
    rooms: [],
    rooms_skipped: 0,
    lan: { state: "unknown", binary: null },
    launch: launchContext(env),
    doorbell: await doorbellPromise,
  };

  // Any lobby command opens (and would create) the desk database, so the CLI
  // runs only when that file already exists; other entries (STOP, .DS_Store) do not count.
  if (entryCheck.state !== "ok") checks.desk.code = entryCheck.code;
  else if (lobbyHome === null) checks.desk.code = lobbyHomeCode;
  else if (homeState === "absent" || homeState === "empty") checks.desk.code = "no_desk_state";
  else if (homeState === "unsafe") checks.desk.code = "lobby_home_unsafe";
  else {
    const cli = new LobbyCli(entry, childEnvironment(env, lobbyHome), spawner, options.cliTimeoutMs ?? CLI_TIMEOUT_MS);
    const statusOutcome = await cli.fleetStatus();
    const status = statusOutcome.kind === "ok" ? parseFleetStatus(statusOutcome.json, LOBBY_ORIGIN) : null;
    if (statusOutcome.kind !== "ok") Object.assign(checks.desk, outcomeCode(statusOutcome));
    else if (status === null) checks.desk.code = "cli_unparseable";
    else if (status.desk === null) checks.desk.code = "no_desk";
    else if (!status.desk.origin_matches) checks.desk.code = "origin_mismatch";
    else {
      checks.desk = { state: "ok", code: null, lobby_code: null };
      const directoryMission = status.desk.directory_mission_id;
      const directoryGrant: GrantView = directoryMission === null
        ? { state: "unknown", reason: "not_joined", expires_at: null, expires_in_s: null }
        : evaluateGrant(status.grants.filter((grant) => grant.purpose === "directory" && grant.mission_id === directoryMission), nowMs);
      checks.directory = await directoryFrom(cli, directoryGrant, nowMs);

      const listened = new Set(checks.doorbell.listeners);
      const fromGrants = status.grants.filter((grant) => grant.purpose === "season" && grant.room_id !== null).map((grant) => grant.room_id!);
      const rooms = [...new Set([...requested, ...listened, ...fromGrants.sort()])];
      checks.rooms_skipped = Math.max(0, rooms.length - MAX_ROOMS);
      for (const roomId of rooms.slice(0, MAX_ROOMS)) {
        const season = seasonFrom(await cli.fleetCard(roomId), roomId, nowMs);
        const roomGrants = status.grants.filter((grant) => grant.purpose === "season" && grant.room_id === roomId
          && (season.mission_id === null || grant.mission_id === season.mission_id));
        const isListened = listened.has(roomId);
        const isRequested = requested.includes(roomId);
        checks.rooms.push({
          room_id: roomId,
          listened: isListened,
          requested: isRequested,
          counted: isListened || isRequested || season.state === "open",
          grant: evaluateGrant(roomGrants, nowMs),
          season,
          cache: cacheFrom(await cli.cachedRead(roomId), roomId, nowMs, checks.doorbell.last_ok_at[roomId] ?? null),
        });
      }
    }
  }

  const hosted = await hostedPromise;
  if (hosted !== null) checks.hosted = { ...hosted, origin: LOBBY_ORIGIN };
  checks.lan = await lanPromise;
  return finish(checks, nowMs, doorbellHome);
}

function unknownAxes(checks: NetcheckReport["checks"]): string[] {
  const found: string[] = [];
  if (checks.hosted.status === "unknown") found.push(`hosted:${checks.hosted.code}`);
  if (checks.lobby_cli.state === "unknown") found.push(`lobby_cli:${checks.lobby_cli.code}`);
  if (checks.desk.state === "unknown") found.push(`desk:${checks.desk.code}`);
  if (checks.directory !== null) {
    if (checks.directory.grant.state === "unknown") found.push(`directory_grant:${checks.directory.grant.reason}`);
    if (checks.directory.role === "unknown") found.push(`directory:${checks.directory.code}`);
  }
  for (const room of checks.rooms) {
    if (room.season.state === "unknown") found.push(`season:${room.room_id}:${room.season.code}`);
    if (room.cache.state === "unknown") found.push(`cache:${room.room_id}:${room.cache.code}`);
  }
  if (checks.lan.state === "unknown") found.push("lan:unreadable");
  if (checks.doorbell.home === "unsafe") found.push("doorbell:home_unsafe");
  if (checks.doorbell.fetcher === "unknown") found.push("doorbell:pidfile_unreadable");
  if (checks.doorbell.unreadable > 0) found.push("doorbell:bell_unreadable");
  return found;
}

function warningsOf(checks: NetcheckReport["checks"]): Warning[] {
  const warnings: Warning[] = [];
  const hosted = checks.hosted;
  if (hosted.status !== "unknown" && hosted.skew_ms !== null && Math.abs(hosted.skew_ms) > THRESHOLDS.skewWarnMs) {
    warnings.push({ code: "clock_skew", seconds: Math.round(hosted.skew_ms / 1000), severe: Math.abs(hosted.skew_ms) > THRESHOLDS.skewSevereMs });
  }
  const directory = checks.directory;
  if (directory?.grant.state === "live" && directory.grant.expires_in_s! < THRESHOLDS.grantExpiringS) {
    warnings.push({ code: "grant_expiring", seconds: directory.grant.expires_in_s! });
  }
  for (const room of checks.rooms) {
    if (room.counted && room.grant.state === "live" && room.grant.expires_in_s! < THRESHOLDS.grantExpiringS) {
      warnings.push({ code: "grant_expiring", room_id: room.room_id, seconds: room.grant.expires_in_s! });
    }
    if (room.season.state === "open" && room.season.ends_in_s! < THRESHOLDS.seasonEndingS) {
      warnings.push({ code: "season_ending", room_id: room.room_id, seconds: room.season.ends_in_s! });
    }
    if (room.listened && room.cache.state === "ok" && (room.cache.age_s === null || room.cache.age_s > THRESHOLDS.cacheStaleS)) {
      warnings.push({ code: "cache_stale", room_id: room.room_id, ...(room.cache.age_s === null ? {} : { seconds: room.cache.age_s }) });
    }
  }
  if (directory?.role === "hub" && directory.expires_in_s !== null && directory.expires_in_s < THRESHOLDS.directoryEndingS) {
    warnings.push({ code: "directory_ending", seconds: directory.expires_in_s });
  }
  if (checks.lobby_home.stop_present) warnings.push({ code: "stop_present" });
  if (checks.doorbell.listeners.length > 0 && checks.doorbell.fetcher !== "running") warnings.push({ code: "fetcher_absent_with_listener" });
  if (checks.launch.local_network_exemption === "no") warnings.push({ code: "launch_context_not_exempt" });
  return warnings;
}

/** The precedence table, worst first. */
export function overallState(checks: NetcheckReport["checks"], unknown: readonly string[]): NetcheckState {
  if (checks.hosted.status === "unreachable") return "hosted-unreachable";
  const lapsed = checks.directory?.grant.state === "lapsed"
    || checks.rooms.some((room) => room.counted && room.grant.state === "lapsed");
  if (lapsed) return "grant-lapsed";
  if (checks.lan.state === "block") return "lan-blocked";
  if (unknown.length > 0) return "unknown";
  return "hosted-ok";
}

function finish(checks: NetcheckReport["checks"], nowMs: number, doorbellHome: string): NetcheckReport {
  const unknown = unknownAxes(checks);
  const state = overallState(checks, unknown);
  const warnings = warningsOf(checks);
  const report: NetcheckReport = {
    format: "agenttool-lobby-netcheck/v1",
    at: new Date(nowMs).toISOString(),
    state,
    healthy: state === "hosted-ok",
    exit_code: EXIT_CODES[state],
    warnings,
    unknown,
    checks,
  };
  appendLogLine(doorbellHome, { at: report.at, act: "netcheck", state, unknown, warnings: warnings.map((warning) => warning.code) });
  return report;
}

// ── human output ───────────────────────────────────────────────────────

export function formatDuration(seconds: number | null): string {
  if (seconds === null) return "?";
  const past = seconds < 0;
  let rest = Math.abs(seconds);
  const days = Math.floor(rest / 86400);
  rest -= days * 86400;
  const hours = Math.floor(rest / 3600);
  rest -= hours * 3600;
  const minutes = Math.floor(rest / 60);
  const text = days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h ${minutes}m` : minutes > 0 ? `${minutes}m ${rest % 60}s` : `${rest}s`;
  return past ? `${text} ago` : `in ${text}`;
}

function grantLine(grant: GrantView): string {
  if (grant.state === "live") return `live, expires ${formatDuration(grant.expires_in_s)}`;
  if (grant.expires_at === null) return `${grant.state} (${grant.reason})`;
  // A grant never accepted can lapse before its expiry.
  const verb = grant.expires_in_s !== null && grant.expires_in_s > 0 ? "expires" : "expired";
  return `${grant.state} (${grant.reason}), ${verb} ${formatDuration(grant.expires_in_s)}`;
}

export function formatReport(report: NetcheckReport): string {
  const { checks } = report;
  const lines = [`lobby-netcheck: ${report.state}${report.healthy ? "" : " (not healthy)"}`];
  for (const warning of report.warnings) {
    const room = warning.room_id === undefined ? "" : ` ${warning.room_id}`;
    const amount = warning.seconds === undefined ? ""
      : warning.code === "clock_skew" ? ` ${warning.seconds > 0 ? "+" : ""}${warning.seconds}s${warning.severe ? " (severe)" : ""}`
      : warning.code === "cache_stale" ? ` ${formatDuration(-warning.seconds)}` : ` ${formatDuration(warning.seconds)}`;
    lines.push(`warning: ${warning.code}${room}${amount}`);
  }
  const hosted = checks.hosted;
  lines.push(hosted.status === "unknown" ? "hosted     unknown (no fetch)"
    : hosted.status === "ok" ? `hosted     ok ${hosted.latency_ms} ms${hosted.skew_ms === null ? "" : `, clock skew ${(hosted.skew_ms / 1000).toFixed(1)} s`}`
    : `hosted     unreachable (${hosted.code}${hosted.detail === null ? "" : `: ${hosted.detail}`})`);
  lines.push(`lobby cli  ${checks.lobby_cli.state === "ok" ? `ok${checks.lobby_cli.commit === null ? "" : ` (commit ${checks.lobby_cli.commit.slice(0, 12)})`}` : `unknown (${checks.lobby_cli.code})`}`);
  lines.push(`desk       ${checks.desk.state === "ok" ? "ok" : `unknown (${checks.desk.code}${checks.desk.lobby_code === null ? "" : `: ${checks.desk.lobby_code}`})`}`);
  const directory = checks.directory;
  if (directory !== null) {
    lines.push(`directory  grant ${grantLine(directory.grant)}; ${directory.role === "hub" ? `directory ends ${formatDuration(directory.expires_in_s)}`
      : directory.role === "member" ? "directory end unknown on a member desk (outlasts the grant)" : `directory unknown (${directory.code})`}`);
  }
  for (const room of checks.rooms) {
    const tags = [room.listened ? "listened" : "", room.requested ? "asked" : "", room.counted ? "" : "not counted"].filter(Boolean).join(", ");
    lines.push(`room       ${room.room_id}${tags === "" ? "" : ` (${tags})`}`);
    lines.push(`  grant    ${grantLine(room.grant)}`);
    lines.push(`  season   ${room.season.state === "unknown" ? `unknown (${room.season.code})` : `${room.season.state}, ${room.season.room_status}, ends ${formatDuration(room.season.ends_in_s)}`}`);
    lines.push(`  cache    ${room.cache.state === "unknown" ? `unknown (${room.cache.code})` : room.cache.synced_at === null ? "never synced" : `synced ${formatDuration(-(room.cache.age_s ?? 0))}`}`);
  }
  if (checks.rooms_skipped > 0) lines.push(`(${checks.rooms_skipped} more rooms not checked; at most ${MAX_ROOMS} per run)`);
  lines.push(`lan        ${checks.lan.state}${checks.lan.state === "not_installed" ? " (Mullvad not found; counts as allow)" : ""}`);
  const launch = checks.launch;
  lines.push(`launch     ${launch.context}${launch.harnesses.length === 0 ? "" : ` + ${launch.harnesses.join(" + ")}`}; local-network exemption ${launch.local_network_exemption} (${launch.basis})`);
  const doorbell = checks.doorbell;
  lines.push(`doorbell   STOP ${checks.lobby_home.stop_present ? "present" : "absent"}; home ${doorbell.home}; fetcher ${doorbell.fetcher}; ${doorbell.listeners.length} listener(s); ${doorbell.bells.length} bell(s)`);
  if (report.unknown.length > 0) lines.push(`unknown    ${report.unknown.join(", ")}`);
  return `${lines.join("\n")}\n`;
}
