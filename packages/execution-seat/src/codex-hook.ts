/**
 * Codex SessionStart, SessionEnd and PostToolUse hooks. Reads allowlisted hook
 * fields only: the event name, `session_id`, `source`, `reason`, the tool name
 * and `agent_id`. Prompts, tool input and output, and messages are never read
 * or copied. A `transcript_path` is used only when it names the rollout of the
 * thread the hook is about, to read it with the same structural reader as
 * ingest; it is never stored.
 *
 * Observed on codex-cli 0.162.1 (2026-10-18): a spawned thread's hooks carry
 * `agent_id` (its thread id), `session_id` is the parent session, and
 * `transcript_path` is the spawned thread's own rollout, which already exists.
 * Neither hooks nor MCP servers get a thread id in their environment.
 */
import { existsSync, readdirSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import { CODEX } from "./codex.js";
import { collabWrite } from "./collab-writes.js";
import { SeatError } from "./errors.js";
import { token, uuid } from "./fields.js";
import { ingestCodexRollout } from "./ingest.js";
import type { SeatLedger } from "./ledger.js";

const ROLLOUT_FILE = /^rollout-[0-9T:-]{1,40}-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/;
const MAX_CHAIN = 16;
/** Child refs a promotion cannot place; the hook reports the code and changes nothing. */
const UNPLACED = new Set(["child_unknown", "parent_row_unknown", "lineage_cycle"]);

export interface CodexHookInput {
  event: "SessionStart" | "SessionEnd" | "PostToolUse" | null;
  session_id: string | null;
  source: string | null;
  reason: string | null;
  /** PostToolUse: the collab write that was called, e.g. `collab_task_claim`. Null for any other tool. */
  collab_write: string | null;
  /** Set in a spawned thread: its thread id. */
  agent_id: string | null;
  /** The rollout of the thread the hook is about (`agent_id`, else `session_id`), only when its file name says so. */
  transcript_path: string | null;
}

function rolloutId(path: unknown): string | null {
  if (typeof path !== "string" || !isAbsolute(path)) return null;
  return ROLLOUT_FILE.exec(basename(path))?.[1] ?? null;
}

/** Pick the allowlisted fields; anything else in the hook input is ignored. */
export function readCodexHookInput(raw: unknown): CodexHookInput {
  const input = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const name = input.hook_event_name;
  const sessionId = uuid(input.session_id);
  const agentId = uuid(input.agent_id);
  const thread = agentId ?? sessionId;
  return {
    event: name === "SessionStart" || name === "SessionEnd" || name === "PostToolUse" ? name : null,
    session_id: sessionId,
    source: token(input.source),
    reason: token(input.reason),
    collab_write: collabWrite(input.tool_name),
    agent_id: agentId,
    transcript_path: thread !== null && rolloutId(input.transcript_path) === thread ? (input.transcript_path as string) : null,
  };
}

export interface CodexHookResult {
  event: CodexHookInput["event"];
  seat_id: string | null;
  /** PostToolUse: the spawned thread's own record, once it has one. */
  child_seat_id: string | null;
  /** What the hook did, in order: ingested, opened, resumed, ended, promoted, … */
  actions: string[];
}

/** The rollout of `threadId` beside `near`, where Codex writes a run's threads on the same day. */
function siblingRollout(near: string, threadId: string): string | null {
  const directory = dirname(near);
  try {
    const name = readdirSync(directory).find((file) => rolloutId(join(directory, file)) === threadId);
    return name ? join(directory, name) : null;
  } catch {
    return null;
  }
}

/** Handle one Codex hook input. Throws only SeatError and I/O errors; the CLI reports them and still exits 0. */
export function handleCodexHook(ledger: SeatLedger, raw: unknown, options: { now?: () => string } = {}): CodexHookResult {
  const input = readCodexHookInput(raw);
  const result: CodexHookResult = { event: input.event, seat_id: null, child_seat_id: null, actions: [] };
  if (!input.event) return result;
  if (!input.session_id) throw new SeatError("invalid_hook_input", "a Codex hook names a session_id");
  const at = (options.now ?? (() => new Date().toISOString()))();
  if (input.event === "PostToolUse") return promoteCollabWriter(ledger, input, result);
  // Session hooks fire for the top-level thread; a spawned thread has SubagentStart and SubagentStop instead.
  if (input.agent_id) return result;

  let seatId: string;
  if (input.transcript_path && existsSync(input.transcript_path)) {
    const ingested = ingestCodexRollout(ledger, input.transcript_path);
    result.actions.push("ingested");
    if (ingested.created) result.actions.push("opened");
    seatId = ingested.seat_id;
  } else {
    const { seat, created } = ledger.openSeat({
      harness: CODEX,
      native_ref: { thread_id: input.session_id, session_id: input.session_id },
      started_at: input.event === "SessionStart" ? at : null,
    });
    if (created) result.actions.push("opened");
    seatId = seat.seat_id;
  }
  result.seat_id = seatId;
  ledger.observe(seatId, { last_seen_at: at });
  if (input.event === "SessionStart") {
    if (ledger.resumeSeat(seatId, at)) result.actions.push("resumed");
  } else if (ledger.endSeat(seatId, at, input.reason)) {
    result.actions.push("ended");
  }
  return result;
}

/**
 * A spawned thread's collab write gives it its own `recorded` record (trigger `collab_write`),
 * ancestors first. Its rollout places its row; a nested thread's ancestors are read from rollouts
 * beside it, and a chain that cannot be placed is reported, not guessed.
 */
function promoteCollabWriter(ledger: SeatLedger, input: CodexHookInput, result: CodexHookResult): CodexHookResult {
  if (!input.agent_id || !input.collab_write) return result;
  if (!input.transcript_path) {
    result.actions.push("rollout_unknown");
    return result;
  }
  const placed = ingestCodexRollout(ledger, input.transcript_path);
  result.actions.push("ingested");
  if (placed.child_ref !== input.agent_id) {
    result.actions.push("not_a_spawned_thread");
    return result;
  }
  result.seat_id = placed.seat_id;
  const existing = ledger.findChild(placed.seat_id, input.agent_id);
  if (existing?.row.seat_id) {
    result.child_seat_id = existing.row.seat_id;
    result.actions.push("already_recorded");
    return result;
  }
  // Place ancestors' rows, so the chain can be promoted from the direct parent up.
  let parent = existing?.row.parent_ref ?? null;
  for (let hops = 0; parent && hops < MAX_CHAIN; hops += 1) {
    let row = ledger.findChild(placed.seat_id, parent)?.row;
    if (!row) {
      const rollout = siblingRollout(input.transcript_path, parent);
      if (!rollout) break;
      ingestCodexRollout(ledger, rollout);
      result.actions.push("ingested_parent");
      row = ledger.findChild(placed.seat_id, parent)?.row;
      if (!row) break;
    }
    // A promoted ancestor already has its own chain.
    if (row.seat_id) break;
    parent = row.parent_ref;
  }
  try {
    result.child_seat_id = ledger.promote(placed.seat_id, input.agent_id, "collab_write").seat_id;
    result.actions.push("promoted");
  } catch (error) {
    if (!(error instanceof SeatError) || !UNPLACED.has(error.code)) throw error;
    result.actions.push(error.code);
  }
  return result;
}
