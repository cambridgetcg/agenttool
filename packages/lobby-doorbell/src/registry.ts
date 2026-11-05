/** The listener registry: one listener per room per device, claimed with an
 * exclusive create of listeners/<room>.json. A listener is stale, and a new
 * `listen` may claim it, when its owner is gone, its owner's pid was reused
 * (the `ps` start time differs), its watcher is gone, or it has expired.
 * Beside it, each reader keeps its own mark file so no two processes ever
 * write the same file: <room>.rung.json (the watcher) and <room>.noted.json
 * (the UserPromptSubmit hook). The fetcher only reads listeners.
 */
import { readdirSync } from "node:fs";
import { DoorbellError } from "./errors.js";
import {
  assertValid, MARK_FORMAT, parseBell, parseListener, parseMark, parsePidfile,
  type Bell, type Listener, type Mark, type Pidfile,
} from "./formats.js";
import {
  BELLS_DIRECTORY, createPrivateJson, doorbellPath, FETCHER_PIDFILE, LISTENERS_DIRECTORY, readPrivateJson,
  removePrivateFile, writePrivateJson,
} from "./home.js";
import { pidAlive, processStarted, type Spawner } from "./run.js";

/** A listener whose watcher has not been recorded yet is live for this long after its arm. */
export const ARM_GRACE_MS = 30_000;

export const listenerPath = (home: string, room: string) => doorbellPath(home, LISTENERS_DIRECTORY, `${room}.json`);
export const rungPath = (home: string, room: string) => doorbellPath(home, LISTENERS_DIRECTORY, `${room}.rung.json`);
export const notedPath = (home: string, room: string) => doorbellPath(home, LISTENERS_DIRECTORY, `${room}.noted.json`);
export const bellPath = (home: string, room: string) => doorbellPath(home, BELLS_DIRECTORY, `${room}.json`);
export const fetcherPidPath = (home: string) => doorbellPath(home, FETCHER_PIDFILE);

export type ListenerRead = { kind: "absent" } | { kind: "unreadable" } | { kind: "ok"; listener: Listener };

export function readListener(home: string, room: string): ListenerRead {
  const value = readPrivateJson(listenerPath(home, room));
  if (value === null) return { kind: "absent" };
  const listener = parseListener(value, room);
  return listener === null ? { kind: "unreadable" } : { kind: "ok", listener };
}

/** Room ids with a `<room>.json` file in a directory, sorted; none when it cannot be read. */
export function roomFiles(directory: string): string[] {
  try {
    return readdirSync(directory).filter((name) => /^room_[0-9a-f]{32}\.json$/.test(name)).map((name) => name.slice(0, -5)).sort();
  } catch {
    return [];
  }
}

/** Room ids with a listener file, sorted. */
export function listenerRooms(home: string): string[] {
  return roomFiles(doorbellPath(home, LISTENERS_DIRECTORY));
}

export function readBell(home: string, room: string): Bell | null {
  return parseBell(readPrivateJson(bellPath(home, room)), room);
}

export function readMark(path: string, room: string): Mark | null {
  return parseMark(readPrivateJson(path), room);
}

export function writeMark(path: string, mark: Mark): void {
  writePrivateJson(path, assertValid(parseMark, mark, "mark"));
}

export function readPidfile(path: string): Pidfile | null | "unreadable" {
  const value = readPrivateJson(path);
  if (value === null) return null;
  return parsePidfile(value) ?? "unreadable";
}

export type Staleness = "owner_gone" | "owner_reused" | "watcher_gone" | "watcher_reused" | "expired" | null;

export interface LivenessDeps {
  spawner: Spawner;
  now: () => number;
  alive?: (pid: number) => boolean;
}

/** Whether a process recorded with (pid, start time) is still that process. */
export async function sameProcess(deps: LivenessDeps, pid: number, started: string): Promise<"same" | "gone" | "reused"> {
  if (!(deps.alive ?? pidAlive)(pid)) return "gone";
  const now = await processStarted(deps.spawner, pid);
  if (now === null) return "gone";
  return now === started ? "same" : "reused";
}

/** Null when live. The checks are in the spec's order: expiry, owner, watcher. */
export async function staleness(listener: Listener, deps: LivenessDeps): Promise<Staleness> {
  const now = deps.now();
  if (Date.parse(listener.expires_at) <= now) return "expired";
  const owner = await sameProcess(deps, listener.owner_pid, listener.owner_started);
  if (owner !== "same") return owner === "gone" ? "owner_gone" : "owner_reused";
  if (listener.watcher_pid === null || listener.watcher_started === null) {
    return now - Date.parse(listener.armed_at) < ARM_GRACE_MS ? null : "watcher_gone";
  }
  const watcher = await sameProcess(deps, listener.watcher_pid, listener.watcher_started);
  return watcher === "same" ? null : watcher === "gone" ? "watcher_gone" : "watcher_reused";
}

export function writeListener(home: string, listener: Listener): void {
  writePrivateJson(listenerPath(home, listener.room_id), assertValid(parseListener, listener, "listener"));
}

/** Removes a room's listener and both marks. The bell stays (the fetcher owns it). */
export function releaseListener(home: string, room: string): void {
  removePrivateFile(listenerPath(home, room));
  removePrivateFile(rungPath(home, room));
  removePrivateFile(notedPath(home, room));
}

/** Whether two listener records are the same claim: the same arm by the same session and owner process. */
export function sameClaim(left: Listener, right: Listener): boolean {
  return left.room_id === right.room_id && left.armed_at === right.armed_at && left.seat_ref === right.seat_ref
    && left.owner_pid === right.owner_pid && left.owner_started === right.owner_started;
}

export type Claim = { claimed: true } | { claimed: false; holder: Listener };

/** Claims the room with an exclusive create. A stale holder is cleared and the claim retried once. */
export async function claimListener(home: string, listener: Listener, deps: LivenessDeps): Promise<Claim> {
  assertValid(parseListener, listener, "listener");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (createPrivateJson(listenerPath(home, listener.room_id), listener)) {
      removePrivateFile(rungPath(home, listener.room_id));
      removePrivateFile(notedPath(home, listener.room_id));
      return { claimed: true };
    }
    const current = readListener(home, listener.room_id);
    if (current.kind === "unreadable") {
      throw new DoorbellError("listener_unreadable", "the room's listener file is not a valid listener; run agenttool-lobby-doorbell status");
    }
    if (current.kind === "absent") continue;
    if ((await staleness(current.listener, deps)) === null) return { claimed: false, holder: current.listener };
    // Release only the stale claim just checked: if another process reclaimed the room meanwhile,
    // its fresh claim stays and this one's next create fails against it.
    const again = readListener(home, listener.room_id);
    if (again.kind === "ok" && JSON.stringify(again.listener) === JSON.stringify(current.listener)) releaseListener(home, listener.room_id);
  }
  throw new DoorbellError("listener_race", "another process claimed the room at the same moment; try again");
}

export function emptyMark(bell: Bell): Mark {
  return {
    format: MARK_FORMAT, room_id: bell.room_id, armed_at: bell.armed_at, seq: 0, cursor: bell.base_cursor,
    state: "ok", reason: null, new: 0, addressed: 0, unverified: 0,
  };
}
