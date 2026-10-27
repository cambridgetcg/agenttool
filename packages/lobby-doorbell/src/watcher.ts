/** The Claude Code ringer: one watcher per listener, started by `listen` (or
 * the SessionStart hook) from inside the session to be rung, so it inherits
 * that session's inbox variables.
 *
 * It reads only the room's bell and its own mark. It rings forward only: an
 * `addressed` listener when messages addressed to this desk arrived since the
 * last ring, an `all` listener when any message from another desk did; and
 * once per transition into grant-lapsed or a stopped fetcher. Rings within
 * 60 s coalesce into one. It rings nothing for hosted-unreachable, and
 * nothing at all while STOP exists.
 *
 * It exits when the owning Claude Code process or its socket is gone, on STOP,
 * on SIGTERM, when its listener file is removed or names another watcher, and
 * at the listener's expiry (after one ring asking for a re-arm).
 */
import { appendLogLine, stopPresent } from "./home.js";
import { delta, markAt, type Listener, type Mark } from "./formats.js";
import { emptyMark, readBell, readListener, readMark, releaseListener, rungPath, writeMark, ARM_GRACE_MS } from "./registry.js";
import { expiredRing, lapsedRing, messageRing, stoppedRing } from "./ring.js";
import type { Ring } from "./claude-inbox.js";

export const WATCH_TICK_MS = 2_000;
export const MIN_RING_GAP_MS = 60_000;

export type WatcherExit = "stopped" | "owner_gone" | "listener_removed" | "listener_unreadable" | "superseded" | "expired" | "sigterm";

export interface WatcherDeps {
  doorbellHome: string;
  lobbyHome: string;
  roomId: string;
  pid: number;
  ring: Ring;
  ownerGone: () => boolean;
  now: () => number;
}

export class Watcher {
  private lastRing = 0;
  private terminating = false;
  private readonly startedAt: number;

  constructor(private readonly deps: WatcherDeps) {
    this.startedAt = deps.now();
  }

  terminate(): void {
    this.terminating = true;
  }

  private log(record: Record<string, unknown>): void {
    appendLogLine(this.deps.doorbellHome, { at: new Date(this.deps.now()).toISOString(), act: "watch", pid: this.deps.pid, room_id: this.deps.roomId, ...record });
  }

  /** Rings unless STOP appeared meanwhile; a failed ring is logged, never retried in a loop. */
  private async ring(text: string, what: string): Promise<boolean> {
    if (stopPresent(this.deps.lobbyHome)) return false;
    const result = await this.deps.ring(text);
    this.log({ event: result.ok ? "rang" : "ring_failed", what, ...(result.code === null ? {} : { code: result.code }) });
    return result.ok;
  }

  /** One tick. Returns why the watcher must exit, or null. */
  async tick(): Promise<WatcherExit | null> {
    const { doorbellHome: home, roomId: room } = this.deps;
    if (this.terminating) return "sigterm";
    if (stopPresent(this.deps.lobbyHome)) return "stopped";
    if (this.deps.ownerGone()) return "owner_gone";
    const read = readListener(home, room);
    if (read.kind === "absent") return "listener_removed";
    if (read.kind === "unreadable") return "listener_unreadable";
    const listener = read.listener;
    const now = this.deps.now();
    // Whoever started this watcher records its pid in the listener just after the start; until then, wait.
    if (listener.watcher_pid !== this.deps.pid) return now - this.startedAt < ARM_GRACE_MS ? null : "superseded";
    if (Date.parse(listener.expires_at) <= now) {
      const hours = Math.round((Date.parse(listener.expires_at) - Date.parse(listener.armed_at)) / 3_600_000);
      await this.ring(expiredRing({ room_id: room, hours }), "expired");
      const again = readListener(home, room);
      if (again.kind === "ok" && again.listener.watcher_pid === this.deps.pid && again.listener.armed_at === listener.armed_at) releaseListener(home, room);
      return "expired";
    }
    await this.observe(listener, now);
    return null;
  }

  private async observe(listener: Listener, now: number): Promise<void> {
    const { doorbellHome: home, roomId: room } = this.deps;
    const bell = readBell(home, room);
    // A bell of another arm is not this listener's. A bell whose head is not known yet (the first
    // catch-up, or a grant that lapsed before it) has no counts, but its state still rings.
    if (bell === null || bell.armed_at !== listener.armed_at) return;
    const stored = readMark(rungPath(home, room), room);
    const mark: Mark = stored !== null && stored.armed_at === bell.armed_at ? stored : emptyMark(bell);
    if (bell.seq === mark.seq && stored !== null) return;
    let next: Mark = { ...mark, seq: bell.seq, state: bell.state, reason: bell.reason };

    if (bell.state !== mark.state || bell.reason !== mark.reason) {
      if (bell.state === "grant-lapsed" && mark.state !== "grant-lapsed") {
        await this.ring(lapsedRing({ room_id: room, reason: bell.reason, watcher_pid: this.deps.pid }), "grant-lapsed");
      } else if (bell.state === "stopped" && mark.state !== "stopped" && bell.reason !== "stopped") {
        await this.ring(stoppedRing({ room_id: room, reason: bell.reason, watcher_pid: this.deps.pid }), "stopped");
      }
    }

    const change = delta(bell, mark);
    if (change === null) {
      // The counts went backwards (a damaged or replaced bell): re-base without ringing.
      next = markAt(bell);
    } else if (bell.head_cursor !== null && (listener.mode === "addressed" ? change.addressed > 0 : change.new > 0)) {
      if (now - this.lastRing < MIN_RING_GAP_MS) {
        // Coalesce: keep the counters where they were, so the later ring covers this burst too.
        if (next.state !== mark.state || next.reason !== mark.reason) writeMark(rungPath(home, room), { ...next, seq: mark.seq });
        return;
      }
      const from = change.from_cursor ?? bell.base_cursor ?? "0";
      await this.ring(messageRing({ room_id: room, from_cursor: from, head_cursor: bell.head_cursor, counts: change, watcher_pid: this.deps.pid }), "messages");
      this.lastRing = now;
      next = markAt(bell);
    }
    writeMark(rungPath(home, room), next);
  }
}

export async function runWatcherLoop(watcher: Watcher, sleep: (ms: number) => Promise<void>): Promise<WatcherExit> {
  for (;;) {
    const exit = await watcher.tick();
    if (exit !== null) return exit;
    await sleep(WATCH_TICK_MS);
  }
}
