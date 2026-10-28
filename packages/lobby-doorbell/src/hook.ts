/** `hook claude-code`: SessionStart, UserPromptSubmit and SessionEnd.
 *
 * Follows #491's hook conventions (packages/execution-seat/src/claude-hook.ts
 * on execution-seat/s2-hooks): it reads only the allowlisted fields
 * `hook_event_name`, `session_id`, `source` and `reason` (never the prompt,
 * the transcript or tool data), takes the owning process from CLAUDE_PID,
 * tells a reused pid apart with `ps -o lstart=`, and the CLI always exits 0.
 *
 * It does nothing at all for a session that is not a listener: listening is
 * always an explicit `listen`. For a listener's session:
 * - SessionStart (resume, clear) re-owns the listener for the new process or
 *   session (a /clear is a continuation), makes sure the fetcher runs, and
 *   re-arms the watcher when the hook can see the inbox socket; otherwise it
 *   prints one line telling the agent how to re-arm.
 * - UserPromptSubmit prints one content-free line per room with news since
 *   the last ring or note, and one line per state transition. Forward only.
 * - SessionEnd, when the process is exiting, releases this process's
 *   listeners and stops their watchers; the fetcher exits on its own once it
 *   has had no listener for 120 s.
 */
import { delta, markAt, type Bell, type Listener, type Mark } from "./formats.js";
import { appendLogLine, type Environment } from "./home.js";
import {
  emptyMark, listenerRooms, notedPath, readBell, readListener, readMark, releaseListener, rungPath, sameProcess, writeListener, writeMark,
} from "./registry.js";
import { newMessagesNote, rearmNote, stateNote } from "./ring.js";
import { ownerPidOf, startFetcherIfNeeded, startWatcher, type DoorbellContext } from "./control.js";
import { processStarted, terminateIfSame } from "./run.js";
import { defaultSeatRef } from "./seat-ref.js";

/** SessionEnd reasons after which the process keeps running (#491). */
export const IN_PROCESS_REASONS = new Set(["clear", "resume"]);
/** SessionEnd reasons the hooks documentation gives for a process that is exiting (#491). */
export const EXIT_REASONS = new Set(["prompt_input_exit", "logout", "other"]);
export const HOOK_EVENTS = ["SessionStart", "UserPromptSubmit", "SessionEnd"] as const;

export interface HookInput {
  event: typeof HOOK_EVENTS[number] | null;
  session_id: string | null;
  source: string | null;
  reason: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const token = (value: unknown) => typeof value === "string" && /^[a-z_]{1,32}$/.test(value) ? value : null;

/** The allowlisted fields; everything else in the hook input is ignored unread. */
export function readHookInput(raw: unknown): HookInput {
  const input = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const name = input.hook_event_name;
  const session = input.session_id;
  return {
    event: (HOOK_EVENTS as readonly unknown[]).includes(name) ? name as HookInput["event"] : null,
    session_id: typeof session === "string" && UUID.test(session) ? session.toLowerCase() : null,
    source: token(input.source),
    reason: token(input.reason),
  };
}

interface Owner {
  pid: number;
  started: string | null;
}

async function ownerOf(ctx: DoorbellContext, env: Environment): Promise<Owner | null> {
  const claude = env.CLAUDE_PID;
  const pid = claude !== undefined && /^[1-9][0-9]{0,9}$/.test(claude) ? Number(claude) : null;
  if (pid === null) return null;
  return { pid, started: await processStarted(ctx.spawner, pid) };
}

const ownedBy = (listener: Listener, owner: Owner | null) =>
  owner !== null && owner.started !== null && listener.owner_pid === owner.pid && listener.owner_started === owner.started;

/** The listeners this session or process holds. */
function candidates(ctx: DoorbellContext, seatRef: string | null, owner: Owner | null): Listener[] {
  const found: Listener[] = [];
  for (const room of listenerRooms(ctx.doorbellHome)) {
    const read = readListener(ctx.doorbellHome, room);
    if (read.kind === "ok" && (read.listener.seat_ref === seatRef || ownedBy(read.listener, owner))) found.push(read.listener);
  }
  return found;
}

/** Lines to print. The caller prints them to stdout (added to the session's context) and always exits 0. */
export async function handleClaudeHook(ctx: DoorbellContext, raw: unknown): Promise<string[]> {
  const input = readHookInput(raw);
  if (input.event === null || input.session_id === null) return [];
  const seatRef = defaultSeatRef({ CLAUDE_CODE_SESSION_ID: input.session_id });
  const owner = await ownerOf(ctx, ctx.env);
  const mine = candidates(ctx, seatRef, owner);
  if (mine.length === 0) return [];
  if (input.event === "SessionStart") return sessionStart(ctx, input, seatRef!, owner, mine);
  if (input.event === "UserPromptSubmit") return promptNotes(ctx, mine);
  return sessionEnd(ctx, input, owner, mine);
}

async function sessionStart(ctx: DoorbellContext, input: HookInput, seatRef: string, owner: Owner | null, mine: Listener[]): Promise<string[]> {
  const lines: string[] = [];
  const now = ctx.now();
  let anyLive = false;
  for (const found of mine) {
    if (Date.parse(found.expires_at) <= now) continue;
    let listener = found;
    if (input.source === "clear" && ownedBy(listener, owner) && listener.seat_ref !== seatRef) {
      // /clear starts a new session in the same process: a continuation keeps the listener.
      listener = { ...listener, seat_ref: seatRef };
    }
    if (listener.seat_ref === seatRef && owner !== null && owner.started !== null && !ownedBy(listener, owner)) {
      // A resume in a new process: re-own, unless the recorded owner still runs.
      if ((await sameProcess(ctx.liveness, listener.owner_pid, listener.owner_started)) === "same") continue;
      listener = { ...listener, owner_pid: owner.pid, owner_started: owner.started, watcher_pid: null, watcher_started: null };
    }
    if (listener !== found) writeListener(ctx.doorbellHome, listener);
    const watcherLive = listener.watcher_pid !== null && listener.watcher_started !== null
      && (await sameProcess(ctx.liveness, listener.watcher_pid, listener.watcher_started)) === "same";
    if (!watcherLive) {
      const socketOwner = ctx.env.CLAUDE_CODE_MESSAGING_SOCKET ? ownerPidOf(ctx.env) : null;
      const rearmed = socketOwner !== null && socketOwner === listener.owner_pid ? await startWatcher(ctx, listener) : null;
      if (rearmed === null) {
        lines.push(rearmNote(listener.room_id));
        continue;
      }
    }
    anyLive = true;
    appendLogLine(ctx.doorbellHome, { at: new Date(now).toISOString(), act: "hook", event: "SessionStart", room_id: listener.room_id, rearmed: !watcherLive });
  }
  if (anyLive) await startFetcherIfNeeded(ctx);
  return lines;
}

/** The base to report from. Counts: whichever of the watcher's last ring and the hook's last note
 * told the agent more, so a note never repeats a ring and never repeats an earlier note (a failed
 * ring leaves the rung mark behind). Each mark's counts and cursor are one snapshot of the arm's bell,
 * and within an arm both only grow, so the mark with the later cursor told more; comparing `new`
 * alone misses events that only moved `unverified`. State and seq: the hook's own last note. */
function baseMark(bell: Bell, noted: Mark | null, rung: Mark | null): Mark {
  const sameArm = (mark: Mark | null) => mark !== null && mark.armed_at === bell.armed_at ? mark : null;
  const told = (mark: Mark) => mark.cursor === null ? -1n : BigInt(mark.cursor);
  const own = sameArm(noted) ?? emptyMark(bell);
  const ringer = sameArm(rung);
  const counts = ringer !== null && told(ringer) > told(own) ? ringer : own;
  return { ...counts, seq: own.seq, state: own.state, reason: own.reason };
}

function promptNotes(ctx: DoorbellContext, mine: Listener[]): string[] {
  const lines: string[] = [];
  for (const listener of mine) {
    const room = listener.room_id;
    const bell = readBell(ctx.doorbellHome, room);
    if (bell === null || bell.armed_at !== listener.armed_at) continue;
    const noted = readMark(notedPath(ctx.doorbellHome, room), room);
    if (noted !== null && noted.armed_at === bell.armed_at && noted.seq === bell.seq) continue;
    const base = baseMark(bell, noted, readMark(rungPath(ctx.doorbellHome, room), room));
    let next: Mark = { ...base, seq: bell.seq, state: bell.state, reason: bell.reason };
    if ((bell.state !== base.state || bell.reason !== base.reason) && bell.state !== "ok") lines.push(stateNote({ room_id: room, state: bell.state, reason: bell.reason }));
    const change = delta(bell, base);
    if (change === null) next = markAt(bell);
    else if (bell.head_cursor !== null && (listener.mode === "addressed" ? change.addressed > 0 : change.new > 0)) {
      lines.push(newMessagesNote({ room_id: room, from_cursor: change.from_cursor ?? bell.base_cursor ?? "0", counts: change }));
      next = markAt(bell);
    }
    writeMark(notedPath(ctx.doorbellHome, room), next);
  }
  return lines;
}

async function sessionEnd(ctx: DoorbellContext, input: HookInput, owner: Owner | null, mine: Listener[]): Promise<string[]> {
  if (input.reason === null || !EXIT_REASONS.has(input.reason)) return [];
  for (const listener of mine) {
    if (!ownedBy(listener, owner)) continue;
    releaseListener(ctx.doorbellHome, listener.room_id);
    if (listener.watcher_pid !== null && listener.watcher_started !== null) {
      await terminateIfSame(ctx.spawner, listener.watcher_pid, listener.watcher_started);
    }
    appendLogLine(ctx.doorbellHome, { at: new Date(ctx.now()).toISOString(), act: "hook", event: "SessionEnd", room_id: listener.room_id, reason: input.reason });
  }
  return [];
}

/** The settings.json snippet `install-hooks --print` prints. Installing it is a person's choice, per device. */
export function hooksSnippet(command: string): string {
  const entry = (timeout: number) => [{ hooks: [{ type: "command", command: `${command} hook claude-code`, timeout }] }];
  return `${JSON.stringify({ hooks: { SessionStart: entry(10), UserPromptSubmit: entry(5), SessionEnd: entry(10) } }, null, 2)}\n`;
}
