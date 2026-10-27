/** The doorbell's file formats. Every field is a validated id, cursor, count,
 * pid, canonical time or closed code; there is no text field of any kind.
 * Each format is checked when it is written and again when it is read, so a
 * forged or damaged file is refused, never half-trusted.
 *
 * - agenttool-lobby-bell/v1      bells/<room>.json, written by the fetcher only
 * - agenttool-lobby-listener/v1  listeners/<room>.json, the one-per-room claim
 * - agenttool-lobby-mark/v1      listeners/<room>.rung.json (the watcher's) and
 *                                listeners/<room>.noted.json (the prompt hook's)
 * - agenttool-lobby-fetcher/v1   fetcher.json, the fetcher's status
 * - fetcher.pid                  {pid, started, at}
 */
import { isCanonicalTime } from "./lobby-cli.js";
import { ROOM_ID_PATTERN } from "./run.js";
import { isSeatRef } from "./seat-ref.js";

export const BELL_FORMAT = "agenttool-lobby-bell/v1";
export const LISTENER_FORMAT = "agenttool-lobby-listener/v1";
export const MARK_FORMAT = "agenttool-lobby-mark/v1";
export const FETCHER_FORMAT = "agenttool-lobby-fetcher/v1";

export const CURSOR_PATTERN = /^(0|[1-9][0-9]{0,18})$/;
/** `ps -o lstart=` output, e.g. `Mon Oct 27 14:00:00 2026`. */
const LSTART_PATTERN = /^[A-Za-z0-9 :]{1,64}$/;
export const MAX_COUNT = 1_000_000;
export const MAX_PID = 99_999_999;

export const BELL_STATES = ["ok", "grant-lapsed", "hosted-unreachable", "stopped"] as const;
export type BellState = typeof BELL_STATES[number];
/** Closed reason codes. Nothing else ever appears in a bell, a ring or a note. */
export const BELL_REASONS = [
  "no_seat", "not_seated", "refused_401", "refused_403", "refused_404", "rate_limited", "hosted_uncertain",
  "hosted_invalid_response", "hosted_5xx", "cli_timeout", "page_limit", "cli_unparseable", "cli_failed", "lobby_refused",
  "stopped", "fetcher_lifetime", "fetcher_stopped", "no_listeners",
] as const;
export type BellReason = typeof BELL_REASONS[number];
export const MODES = ["addressed", "all"] as const;
export type ListenMode = typeof MODES[number];
export const HARNESSES = ["claude-code"] as const;
export type Harness = typeof HARNESSES[number];

export interface Counters {
  new: number;
  addressed: number;
  unverified: number;
}

export interface Bell extends Counters {
  format: typeof BELL_FORMAT;
  room_id: string;
  /** The listener arm these counts belong to; a new arm starts them at zero. */
  armed_at: string;
  /** Increases on every change of head, counts or state. */
  seq: number;
  /** The head when counting began: history up to here never rings. Null until the first catch-up ends. */
  base_cursor: string | null;
  head_cursor: string | null;
  state: BellState;
  reason: BellReason | null;
  last_change: ({ from_cursor: string; to_cursor: string } & Counters) | null;
  at: string;
  fetcher_pid: number;
}

export interface Listener {
  format: typeof LISTENER_FORMAT;
  room_id: string;
  seat_ref: string;
  harness: Harness;
  mode: ListenMode;
  owner_pid: number;
  owner_started: string;
  /** Null only while `listen` is starting the watcher. */
  watcher_pid: number | null;
  watcher_started: string | null;
  armed_at: string;
  expires_at: string;
  /** `--from-cursor`: count from here instead of the head at the first poll. */
  from_cursor: string | null;
}

/** How far a reader (the watcher's rings, the hook's notes) has told the agent. */
export interface Mark extends Counters {
  format: typeof MARK_FORMAT;
  room_id: string;
  armed_at: string;
  seq: number;
  cursor: string | null;
  state: BellState;
  reason: BellReason | null;
}

export interface FetcherRoomStatus {
  room_id: string;
  interval_ms: number;
  last_poll_at: string | null;
  last_ok_at: string | null;
  state: BellState | "catching-up";
  reason: BellReason | null;
  polls_last_hour: number;
}

export interface FetcherStatus {
  format: typeof FETCHER_FORMAT;
  pid: number;
  started_at: string;
  expires_at: string;
  rooms: FetcherRoomStatus[];
  launch_context: "ssh" | "terminal" | "launchd" | "unknown";
}

export interface Pidfile {
  pid: number;
  started: string;
  at: string;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export const isRoomId = (value: unknown): value is string => typeof value === "string" && ROOM_ID_PATTERN.test(value);
export const isCursor = (value: unknown): value is string => typeof value === "string" && CURSOR_PATTERN.test(value);
export const isCount = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= MAX_COUNT;
export const isPid = (value: unknown): value is number => Number.isInteger(value) && (value as number) > 1 && (value as number) <= MAX_PID;
export const isLstart = (value: unknown): value is string => typeof value === "string" && LSTART_PATTERN.test(value);
const oneOf = <T extends string>(set: readonly T[], value: unknown): value is T => (set as readonly unknown[]).includes(value);
const cursorOrNull = (value: unknown) => value === null || isCursor(value);
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).length === keys.length && keys.every((key) => key in value);

function validCounters(value: Record<string, unknown>): boolean {
  return isCount(value.new) && isCount(value.addressed) && isCount(value.unverified) && (value.addressed as number) <= (value.new as number);
}

const BELL_KEYS = ["format", "room_id", "armed_at", "seq", "base_cursor", "head_cursor", "state", "reason", "new", "addressed", "unverified", "last_change", "at", "fetcher_pid"] as const;

export function parseBell(value: unknown, roomId?: string): Bell | null {
  const bell = record(value);
  if (bell === null || !exactKeys(bell, BELL_KEYS) || bell.format !== BELL_FORMAT || !isRoomId(bell.room_id)) return null;
  if (roomId !== undefined && bell.room_id !== roomId) return null;
  if (!isCanonicalTime(bell.armed_at) || !isCanonicalTime(bell.at) || !isCount(bell.seq) || !isPid(bell.fetcher_pid)) return null;
  if (!cursorOrNull(bell.base_cursor) || !cursorOrNull(bell.head_cursor) || !validCounters(bell)) return null;
  if (!oneOf(BELL_STATES, bell.state) || !(bell.reason === null || oneOf(BELL_REASONS, bell.reason))) return null;
  if (bell.last_change !== null) {
    const change = record(bell.last_change);
    if (change === null || !exactKeys(change, ["from_cursor", "to_cursor", "new", "addressed", "unverified"])) return null;
    if (!isCursor(change.from_cursor) || !isCursor(change.to_cursor) || !validCounters(change)) return null;
  }
  return bell as unknown as Bell;
}

const LISTENER_KEYS = ["format", "room_id", "seat_ref", "harness", "mode", "owner_pid", "owner_started", "watcher_pid", "watcher_started", "armed_at", "expires_at", "from_cursor"] as const;

export function parseListener(value: unknown, roomId?: string): Listener | null {
  const listener = record(value);
  if (listener === null || !exactKeys(listener, LISTENER_KEYS) || listener.format !== LISTENER_FORMAT || !isRoomId(listener.room_id)) return null;
  if (roomId !== undefined && listener.room_id !== roomId) return null;
  if (!isSeatRef(listener.seat_ref) || !oneOf(HARNESSES, listener.harness) || !oneOf(MODES, listener.mode)) return null;
  if (!isPid(listener.owner_pid) || !isLstart(listener.owner_started)) return null;
  const watcherOk = (listener.watcher_pid === null && listener.watcher_started === null)
    || (isPid(listener.watcher_pid) && isLstart(listener.watcher_started));
  if (!watcherOk || !isCanonicalTime(listener.armed_at) || !isCanonicalTime(listener.expires_at)) return null;
  if (Date.parse(listener.expires_at) <= Date.parse(listener.armed_at) || Date.parse(listener.expires_at) - Date.parse(listener.armed_at) > 12 * 3_600_000) return null;
  if (!cursorOrNull(listener.from_cursor)) return null;
  return listener as unknown as Listener;
}

const MARK_KEYS = ["format", "room_id", "armed_at", "seq", "cursor", "state", "reason", "new", "addressed", "unverified"] as const;

export function parseMark(value: unknown, roomId?: string): Mark | null {
  const mark = record(value);
  if (mark === null || !exactKeys(mark, MARK_KEYS) || mark.format !== MARK_FORMAT || !isRoomId(mark.room_id)) return null;
  if (roomId !== undefined && mark.room_id !== roomId) return null;
  if (!isCanonicalTime(mark.armed_at) || !isCount(mark.seq) || !cursorOrNull(mark.cursor) || !validCounters(mark)) return null;
  if (!oneOf(BELL_STATES, mark.state) || !(mark.reason === null || oneOf(BELL_REASONS, mark.reason))) return null;
  return mark as unknown as Mark;
}

export function parsePidfile(value: unknown): Pidfile | null {
  const pidfile = record(value);
  if (pidfile === null || !isPid(pidfile.pid) || !isLstart(pidfile.started) || !isCanonicalTime(pidfile.at)) return null;
  return { pid: pidfile.pid, started: pidfile.started, at: pidfile.at };
}

export function parseFetcherStatus(value: unknown): FetcherStatus | null {
  const status = record(value);
  if (status === null || status.format !== FETCHER_FORMAT || !isPid(status.pid) || !Array.isArray(status.rooms)) return null;
  if (!isCanonicalTime(status.started_at) || !isCanonicalTime(status.expires_at)) return null;
  if (!oneOf(["ssh", "terminal", "launchd", "unknown"] as const, status.launch_context)) return null;
  const rooms: FetcherRoomStatus[] = [];
  for (const item of status.rooms) {
    const room = record(item);
    if (room === null || !isRoomId(room.room_id) || !isCount(room.interval_ms) || !isCount(room.polls_last_hour)) return null;
    if (!(room.last_poll_at === null || isCanonicalTime(room.last_poll_at)) || !(room.last_ok_at === null || isCanonicalTime(room.last_ok_at))) return null;
    if (!(oneOf(BELL_STATES, room.state) || room.state === "catching-up") || !(room.reason === null || oneOf(BELL_REASONS, room.reason))) return null;
    rooms.push(room as unknown as FetcherRoomStatus);
  }
  return { ...(status as unknown as FetcherStatus), rooms };
}

/** Throws before a malformed record could reach a file. */
export function assertValid<T>(parse: (value: unknown) => T | null, value: T, what: string): T {
  if (parse(JSON.parse(JSON.stringify(value))) === null) throw new Error(`refusing to write an invalid ${what}`);
  return value;
}

export const ZERO: Counters = { new: 0, addressed: 0, unverified: 0 };

/** What happened between a reader's mark and the bell: null when the mark belongs to another arm or is ahead (a reset). */
export function delta(bell: Bell, mark: Mark | null): (Counters & { from_cursor: string | null }) | null {
  const base = mark !== null && mark.armed_at === bell.armed_at ? mark : null;
  const from = base ?? { ...ZERO, cursor: bell.base_cursor };
  const result = {
    new: bell.new - from.new,
    addressed: bell.addressed - from.addressed,
    unverified: bell.unverified - from.unverified,
    from_cursor: from.cursor,
  };
  return result.new < 0 || result.addressed < 0 || result.unverified < 0 ? null : result;
}

/** A mark at the bell's current position. */
export function markAt(bell: Bell): Mark {
  return {
    format: MARK_FORMAT, room_id: bell.room_id, armed_at: bell.armed_at, seq: bell.seq, cursor: bell.head_cursor,
    state: bell.state, reason: bell.reason, new: bell.new, addressed: bell.addressed, unverified: bell.unverified,
  };
}
