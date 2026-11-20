/** listen, unlisten, status, stop and resume: the doorbell's local commands.
 *
 * `listen` claims a room for the calling Claude Code session, starts that
 * session's watcher and, if none runs, the device's fetcher. Every refusal has
 * a closed code. `stop` is the brake anyone may set: it writes
 * `<lobby home>/STOP` first, then sends SIGTERM to the fetcher and watchers,
 * each only while its pid still has the recorded start time. `resume` lifts
 * the brake only after `resume` is typed at /dev/tty, so an agent cannot
 * release a brake a person set. Nothing here contacts the network.
 */
import { statSync } from "node:fs";
import { homedir } from "node:os";
import { DoorbellError } from "./errors.js";
import { fetcherState, ensureFetcher, readFetcherStatus } from "./fetcher.js";
import { LISTENER_FORMAT, MODES, type Bell, type Listener, type ListenMode } from "./formats.js";
import {
  BELLS_DIRECTORY, doorbellPath, ensurePrivateDirectory, inspectPrivateDirectory, LISTENERS_DIRECTORY, lobbyHomeState, readPrivateFile,
  refuseMisspeltEnvironment, removeStop, resolveDoorbellHome, resolveLobbyHome, stopPath, stopPresent, writeStop, appendLogLine,
  type Environment,
} from "./home.js";
import { checkLobbyEntry, defaultLobbyEntry, LobbyCli, parseCard } from "./lobby-cli.js";
import { launchContext } from "./probes.js";
import {
  claimListener, fetcherPidPath, listenerRooms, roomFiles, readBell, readListener, readPidfile, releaseListener, sameClaim, staleness, writeListener,
  type LivenessDeps, type Staleness,
} from "./registry.js";
import {
  childEnvironment, doorbellArgv, doorbellChildEnvironment, processSpawner, processStarted, processStarter, ROOM_ID_PATTERN,
  terminateIfSame, type Spawner, type Starter,
} from "./run.js";
import { defaultSeatRef } from "./seat-ref.js";
import { socketOwnerPid } from "./claude-inbox.js";
import type { Confirm } from "./tty.js";

export const MAX_LISTEN_HOURS = 12;

export interface DoorbellContext {
  env: Environment;
  homeDir: string;
  lobbyHome: string;
  doorbellHome: string;
  lobbyEntry: string;
  /** This package's bin, which the fetcher and watchers run. */
  selfEntry: string | null;
  spawner: Spawner;
  starter: Starter;
  liveness: LivenessDeps;
  now: () => number;
}

export interface ContextOptions {
  env: Environment;
  selfEntry: string | null;
  doorbellHome?: string;
  lobbyEntry?: string;
  /** Tests only. */
  homeDir?: string;
  now?: () => number;
  spawner?: (lobbyEntry: string | null) => Spawner;
  starter?: (selfEntry: string | null) => Starter;
  alive?: (pid: number) => boolean;
}

export function makeContext(options: ContextOptions): DoorbellContext {
  refuseMisspeltEnvironment(options.env);
  const homeDir = options.homeDir ?? homedir();
  const lobbyHome = resolveLobbyHome(options.env, homeDir);
  const doorbellHome = resolveDoorbellHome(options.env, lobbyHome, options.doorbellHome, homeDir);
  const lobbyEntry = options.lobbyEntry ?? defaultLobbyEntry(homeDir);
  const usable = checkLobbyEntry(lobbyEntry).state === "ok" ? lobbyEntry : null;
  const spawner = options.spawner?.(usable) ?? processSpawner(usable);
  const now = options.now ?? (() => Date.now());
  return {
    env: options.env,
    homeDir,
    lobbyHome,
    doorbellHome,
    lobbyEntry,
    selfEntry: options.selfEntry,
    spawner,
    starter: options.starter?.(options.selfEntry) ?? processStarter(options.selfEntry),
    liveness: { spawner, now, ...(options.alive === undefined ? {} : { alive: options.alive }) },
    now,
  };
}

const iso = (ms: number) => new Date(ms).toISOString();

function isSocket(path: string): boolean {
  try {
    return statSync(path).isSocket();
  } catch {
    return false;
  }
}

export function lobbyCli(ctx: DoorbellContext): LobbyCli {
  return new LobbyCli(ctx.lobbyEntry, childEnvironment(ctx.env, ctx.lobbyHome), ctx.spawner);
}

/** Starts the fetcher detached unless one runs (from a session or a terminal, never launchd). */
export async function startFetcherIfNeeded(ctx: DoorbellContext) {
  if (ctx.selfEntry === null) return { state: "failed" as const, pid: null };
  return ensureFetcher({
    home: ctx.doorbellHome,
    liveness: ctx.liveness,
    starter: ctx.starter,
    argv: doorbellArgv(ctx.selfEntry, ["fetch"]),
    env: doorbellChildEnvironment(ctx.env, ctx.lobbyHome, ctx.doorbellHome, false),
  });
}

/** Starts a watcher for the room, bound to the calling session's inbox, and records it in the listener. */
export async function startWatcher(ctx: DoorbellContext, listener: Listener): Promise<Listener | null> {
  if (ctx.selfEntry === null) return null;
  const pid = ctx.starter.start(doorbellArgv(ctx.selfEntry, ["watch", "--room", listener.room_id]),
    doorbellChildEnvironment(ctx.env, ctx.lobbyHome, ctx.doorbellHome, true));
  if (pid === null) return null;
  const started = await processStarted(ctx.spawner, pid);
  if (started === null) return null;
  // The claim may have been lost meanwhile (two reclaims of a stale listener at once): record the
  // watcher only in a listener file that still holds this claim, else stop the watcher just started.
  const current = readListener(ctx.doorbellHome, listener.room_id);
  if (current.kind !== "ok" || !sameClaim(current.listener, listener)) {
    await terminateIfSame(ctx.spawner, pid, started);
    return null;
  }
  const armed = { ...listener, watcher_pid: pid, watcher_started: started };
  writeListener(ctx.doorbellHome, armed);
  return armed;
}

/** The calling Claude Code process: named by the inbox socket, else CLAUDE_PID. */
export function ownerPidOf(env: Environment): number | null {
  const socket = env.CLAUDE_CODE_MESSAGING_SOCKET;
  const fromSocket = socket ? socketOwnerPid(socket) : null;
  if (fromSocket !== null) return fromSocket;
  const claude = env.CLAUDE_PID;
  return claude !== undefined && /^[1-9][0-9]{0,9}$/.test(claude) ? Number(claude) : null;
}

export interface ListenOptions {
  room: string;
  mode?: string;
  harness?: string;
  maxHours?: string;
  fromCursor?: string;
}

export interface ListenResult {
  status: "listening" | "already_listening";
  room_id: string;
  seat_ref: string;
  mode: ListenMode;
  expires_at: string;
  watcher_pid: number | null;
  fetcher: { state: "running" | "started" | "failed"; pid: number | null };
}

export async function listen(ctx: DoorbellContext, options: ListenOptions): Promise<ListenResult> {
  if (!ROOM_ID_PATTERN.test(options.room)) throw new DoorbellError("room_invalid", "a room id is room_ followed by 32 lowercase hex characters");
  const mode = (options.mode ?? "addressed") as ListenMode;
  if (!(MODES as readonly string[]).includes(mode)) throw new DoorbellError("usage", "--mode is addressed or all");
  const harness = options.harness ?? "claude-code";
  if (harness === "codex") throw new DoorbellError("harness_unsupported", "the Codex bell is a later PR (after a scratch-thread trial of codex queue); only claude-code rings today");
  if (harness !== "claude-code") throw new DoorbellError("usage", "--harness is claude-code");
  const hours = options.maxHours === undefined ? MAX_LISTEN_HOURS : /^(?:[1-9]|1[0-2])$/.test(options.maxHours) ? Number(options.maxHours) : NaN;
  if (!Number.isInteger(hours)) throw new DoorbellError("usage", "--max-hours is a whole number from 1 to 12");
  if (options.fromCursor !== undefined && !/^(0|[1-9][0-9]{0,18})$/.test(options.fromCursor)) throw new DoorbellError("usage", "--from-cursor is a canonical decimal cursor");

  if (stopPresent(ctx.lobbyHome)) throw new DoorbellError("stopped", `the device brake ${stopPath(ctx.lobbyHome)} is set; a person lifts it with agenttool-lobby-doorbell resume`);
  if (launchContext(ctx.env).context === "launchd") throw new DoorbellError("launchd_context", "the doorbell is started from a session or a terminal, never by launchd");
  const socket = ctx.env.CLAUDE_CODE_MESSAGING_SOCKET;
  const ownerPid = ownerPidOf(ctx.env);
  if (!socket || ownerPid === null) throw new DoorbellError("no_inbox", "run listen from a Bash command inside the Claude Code session to be rung (CLAUDE_CODE_MESSAGING_SOCKET is not set)");
  if (!isSocket(socket)) throw new DoorbellError("no_inbox", "the session's inbox socket does not exist");
  const ownerStarted = await processStarted(ctx.spawner, ownerPid);
  if (ownerStarted === null) throw new DoorbellError("no_inbox", "the Claude Code process named by the inbox socket is not running");
  const seatRef = defaultSeatRef(ctx.env);
  if (seatRef === null) throw new DoorbellError("no_inbox", "CLAUDE_CODE_SESSION_ID is not set; run listen from inside the Claude Code session");

  // The room must be in this desk's cache; the check is local (fleet card reads the cache only).
  if (lobbyHomeState(ctx.lobbyHome) !== "present") throw new DoorbellError("no_desk", "this device has no lobby desk state yet");
  if (checkLobbyEntry(ctx.lobbyEntry).state !== "ok") throw new DoorbellError("no_lobby_cli", "the pinned lobby CLI is missing or unsafe; run agenttool-lobby-doorbell netcheck");
  const card = await lobbyCli(ctx).fleetCard(options.room);
  if (card.kind === "refused" && card.code === "card_not_found") throw new DoorbellError("room_not_in_cache", "no door-verified card for that room on this desk; run agenttool-lobby fleet sync");
  if (card.kind === "refused" && (card.code === "desk_not_enrolled" || card.code === "desk_not_joined")) throw new DoorbellError("no_desk", "this desk has not joined the fleet");
  if (card.kind !== "ok" || parseCard(card.json, options.room) === null) throw new DoorbellError("room_not_in_cache", "the room's card could not be read from this desk's cache");

  ensurePrivateDirectory(ctx.doorbellHome);
  ensurePrivateDirectory(doorbellPath(ctx.doorbellHome, LISTENERS_DIRECTORY));
  ensurePrivateDirectory(doorbellPath(ctx.doorbellHome, BELLS_DIRECTORY));
  const now = ctx.now();
  const listener: Listener = {
    format: LISTENER_FORMAT,
    room_id: options.room,
    seat_ref: seatRef,
    harness: "claude-code",
    mode,
    owner_pid: ownerPid,
    owner_started: ownerStarted,
    watcher_pid: null,
    watcher_started: null,
    armed_at: iso(now),
    expires_at: iso(now + hours * 3_600_000),
    from_cursor: options.fromCursor ?? null,
  };
  const claim = await claimListener(ctx.doorbellHome, listener, ctx.liveness);
  if (!claim.claimed) {
    if (claim.holder.seat_ref !== seatRef) {
      throw new DoorbellError("listener_taken", `room ${options.room} already has a listener on this device: ${claim.holder.seat_ref} (one per room per device)`);
    }
    const fetcher = await startFetcherIfNeeded(ctx);
    return {
      status: "already_listening", room_id: options.room, seat_ref: seatRef, mode: claim.holder.mode,
      expires_at: claim.holder.expires_at, watcher_pid: claim.holder.watcher_pid, fetcher,
    };
  }
  const armed = await startWatcher(ctx, listener);
  if (armed === null) {
    const current = readListener(ctx.doorbellHome, options.room);
    if (current.kind === "ok" && sameClaim(current.listener, listener)) releaseListener(ctx.doorbellHome, options.room);
    else throw new DoorbellError("listener_race", "another process claimed the room at the same moment; try again");
    throw new DoorbellError("watcher_start_failed", "the watcher could not be started; nothing is listening");
  }
  const fetcher = await startFetcherIfNeeded(ctx);
  appendLogLine(ctx.doorbellHome, { at: iso(ctx.now()), act: "listen", room_id: options.room, mode, watcher_pid: armed.watcher_pid, fetcher: fetcher.state });
  return { status: "listening", room_id: options.room, seat_ref: seatRef, mode, expires_at: listener.expires_at, watcher_pid: armed.watcher_pid, fetcher };
}

export async function unlisten(ctx: DoorbellContext, room: string): Promise<{ status: "released" | "not_listening"; watcher_signalled: boolean }> {
  if (!ROOM_ID_PATTERN.test(room)) throw new DoorbellError("room_invalid", "a room id is room_ followed by 32 lowercase hex characters");
  const read = readListener(ctx.doorbellHome, room);
  if (read.kind === "absent") return { status: "not_listening", watcher_signalled: false };
  if (read.kind === "unreadable") throw new DoorbellError("listener_unreadable", "the room's listener file is not a valid listener");
  const listener = read.listener;
  const seatRef = defaultSeatRef(ctx.env);
  if (listener.seat_ref !== seatRef && (await staleness(listener, ctx.liveness)) === null) {
    throw new DoorbellError("not_your_listener", `the listener belongs to ${listener.seat_ref}; only that seat releases it (or anyone: agenttool-lobby-doorbell stop)`);
  }
  releaseListener(ctx.doorbellHome, room);
  const signalled = listener.watcher_pid !== null && listener.watcher_started !== null
    && await terminateIfSame(ctx.spawner, listener.watcher_pid, listener.watcher_started);
  appendLogLine(ctx.doorbellHome, { at: iso(ctx.now()), act: "unlisten", room_id: room, watcher_signalled: signalled });
  return { status: "released", watcher_signalled: signalled };
}

export interface StopResult {
  stop_file: "written" | "already_present";
  fetcher_signalled: boolean;
  watchers_signalled: number;
}

/** Brakes always: no terminal needed. STOP first, then SIGTERM where the start time still matches. */
export async function stop(ctx: DoorbellContext): Promise<StopResult> {
  const already = stopPresent(ctx.lobbyHome);
  writeStop(ctx.lobbyHome, `stopped ${iso(ctx.now())} by ${defaultSeatRef(ctx.env) ?? "a terminal or process with no seat_ref"}`);
  let fetcherSignalled = false;
  if (inspectPrivateDirectory(ctx.doorbellHome) === "ok") {
    const pidfile = readPidfile(fetcherPidPath(ctx.doorbellHome));
    if (pidfile !== null && pidfile !== "unreadable") fetcherSignalled = await terminateIfSame(ctx.spawner, pidfile.pid, pidfile.started);
  }
  let watchers = 0;
  for (const room of listenerRooms(ctx.doorbellHome)) {
    const read = readListener(ctx.doorbellHome, room);
    if (read.kind !== "ok" || read.listener.watcher_pid === null || read.listener.watcher_started === null) continue;
    if (await terminateIfSame(ctx.spawner, read.listener.watcher_pid, read.listener.watcher_started)) watchers += 1;
  }
  appendLogLine(ctx.doorbellHome, { at: iso(ctx.now()), act: "stop", fetcher_signalled: fetcherSignalled, watchers_signalled: watchers });
  return { stop_file: already ? "already_present" : "written", fetcher_signalled: fetcherSignalled, watchers_signalled: watchers };
}

export function resume(ctx: DoorbellContext, confirm: Confirm): "resumed" | "not_stopped" | "cancelled" {
  if (!stopPresent(ctx.lobbyHome)) return "not_stopped";
  const answer = confirm(
    `agenttool-lobby-doorbell: the device brake ${stopPath(ctx.lobbyHome)} is set.\n`
      + "Removing it re-enables the doorbell only; it restores nothing else. Type resume to remove it; anything else cancels: ",
    "resume",
  );
  if (answer === null) throw new DoorbellError("tty_unavailable", "resume needs a person at the controlling terminal (/dev/tty); none is available, so the brake stays");
  if (!answer) return "cancelled";
  removeStop(ctx.lobbyHome);
  appendLogLine(ctx.doorbellHome, { at: iso(ctx.now()), act: "resume" });
  return "resumed";
}

// ── status ──────────────────────────────────────────────────────────────

export interface StatusReport {
  format: "agenttool-lobby-doorbell-status/v1";
  at: string;
  stop: { present: boolean; line: string | null };
  home: "absent" | "ok" | "unsafe";
  fetcher: { state: "running" | "stale" | "absent" | "unreadable"; pid: number | null; started_at: string | null; expires_at: string | null };
  listeners: Array<{ room_id: string; seat_ref: string; mode: ListenMode; expires_at: string; watcher_pid: number | null; live: boolean; stale: Staleness } | { room_id: string; unreadable: true }>;
  bells: Array<Pick<Bell, "room_id" | "state" | "reason" | "head_cursor" | "new" | "addressed" | "unverified" | "at"> | { room_id: string; unreadable: true }>;
  rooms: Array<{ room_id: string; interval_ms: number; polls_last_hour: number; last_ok_at: string | null }>;
}

/** The STOP file's first line, only when it has the brake's own shape; anything else is reported as present. */
function stopLine(lobbyHome: string): string | null {
  try {
    const first = (readPrivateFile(stopPath(lobbyHome)) ?? "").split("\n", 1)[0] ?? "";
    return /^stopped \d{4}-\d{2}-\d{2}T[0-9:.]+Z by [A-Za-z0-9._:@/+ -]{1,200}$/.test(first) ? first : null;
  } catch {
    return null;
  }
}

export async function status(ctx: DoorbellContext): Promise<StatusReport> {
  const home = inspectPrivateDirectory(ctx.doorbellHome);
  const present = stopPresent(ctx.lobbyHome);
  const report: StatusReport = {
    format: "agenttool-lobby-doorbell-status/v1",
    at: iso(ctx.now()),
    stop: { present, line: present ? stopLine(ctx.lobbyHome) : null },
    home,
    fetcher: { state: "absent", pid: null, started_at: null, expires_at: null },
    listeners: [],
    bells: [],
    rooms: [],
  };
  if (home !== "ok") return report;
  const fetcher = await fetcherState(ctx.doorbellHome, ctx.liveness);
  const fetcherStatus = readFetcherStatus(ctx.doorbellHome);
  report.fetcher = {
    ...fetcher,
    started_at: fetcherStatus?.pid === fetcher.pid ? fetcherStatus.started_at : null,
    expires_at: fetcherStatus?.pid === fetcher.pid ? fetcherStatus.expires_at : null,
  };
  if (fetcher.state === "running" && fetcherStatus !== null && fetcherStatus.pid === fetcher.pid) {
    report.rooms = fetcherStatus.rooms.map((room) => ({ room_id: room.room_id, interval_ms: room.interval_ms, polls_last_hour: room.polls_last_hour, last_ok_at: room.last_ok_at }));
  }
  for (const room of listenerRooms(ctx.doorbellHome)) {
    const read = readListener(ctx.doorbellHome, room);
    if (read.kind !== "ok") {
      report.listeners.push({ room_id: room, unreadable: true });
      continue;
    }
    const stale = await staleness(read.listener, ctx.liveness);
    const { seat_ref, mode, expires_at, watcher_pid } = read.listener;
    report.listeners.push({ room_id: room, seat_ref, mode, expires_at, watcher_pid, live: stale === null, stale });
  }
  for (const room of roomFiles(doorbellPath(ctx.doorbellHome, BELLS_DIRECTORY))) {
    const bell = readBell(ctx.doorbellHome, room);
    if (bell === null) report.bells.push({ room_id: room, unreadable: true });
    else {
      const { state, reason, head_cursor, new: fresh, addressed, unverified, at } = bell;
      report.bells.push({ room_id: room, state, reason, head_cursor, new: fresh, addressed, unverified, at });
    }
  }
  return report;
}

export function formatStatus(report: StatusReport): string {
  const lines = [`lobby-doorbell status (${report.at})`];
  lines.push(`STOP       ${report.stop.present ? `present${report.stop.line === null ? "" : `: ${report.stop.line}`}` : "absent"}`);
  lines.push(`home       ${report.home}`);
  const fetcher = report.fetcher;
  lines.push(`fetcher    ${fetcher.state}${fetcher.pid === null ? "" : ` pid ${fetcher.pid}`}${fetcher.expires_at === null ? "" : `, expires ${fetcher.expires_at}`}`);
  for (const room of report.rooms) lines.push(`  polling  ${room.room_id} every ${room.interval_ms / 1000} s, ${room.polls_last_hour} polls in the last hour, last ok ${room.last_ok_at ?? "never"}`);
  for (const listener of report.listeners) {
    lines.push("unreadable" in listener ? `listener   ${listener.room_id} unreadable`
      : `listener   ${listener.room_id} ${listener.mode} for ${listener.seat_ref}, ${listener.live ? "live" : `stale (${listener.stale})`}, expires ${listener.expires_at}${listener.watcher_pid === null ? "" : `, watcher pid ${listener.watcher_pid}`}`);
  }
  for (const bell of report.bells) {
    lines.push("unreadable" in bell ? `bell       ${bell.room_id} unreadable`
      : `bell       ${bell.room_id} ${bell.state}${bell.reason === null ? "" : ` (${bell.reason})`}, head ${bell.head_cursor ?? "unknown"}, ${bell.new} new / ${bell.addressed} addressed / ${bell.unverified} unverified since arm`);
  }
  return `${lines.join("\n")}\n`;
}
