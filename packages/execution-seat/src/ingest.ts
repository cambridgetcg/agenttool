/** Fold native readings into the ledger. Re-ingesting the same files appends nothing new. */
import { CLAUDE_CODE, readClaudeSession, type ClaudeChild } from "./claude-code.js";
import { CODEX, readCodexRollout } from "./codex.js";
import { SeatError } from "./errors.js";
import type { SeatLedger } from "./ledger.js";
import type { SummaryRow } from "./types.js";

export interface IngestResult {
  seat_id: string;
  created: boolean;
  /** For a Codex child thread: the child ref recorded under `seat_id`. */
  child_ref: string | null;
  settings_appended: number;
  rows_recorded: number;
  group_ids: string[];
  rows_marked_gone: number;
  warnings: string[];
}

function claudeRow(child: ClaudeChild): SummaryRow {
  return {
    child_ref: child.agent_id,
    parent_ref: child.parent_agent_id,
    spawn_turn: null,
    relation: "child",
    depth: child.depth,
    agent_type: child.agent_type,
    started_at: child.started_at,
    ended_at: child.end_state === "unknown" ? null : child.last_at,
    end_state: child.end_state,
    settings: child.settings,
    seat_id: null,
    native_gone_at: null,
  };
}

function lineageWarning(error: unknown, what: string): string {
  const codes = ["lineage_conflict", "lineage_cycle", "group_lineage_conflict", "group_lineage_cycle"];
  if (error instanceof SeatError && codes.includes(error.code)) {
    return `${what}: ${error.code}`;
  }
  throw error;
}

export function ingestClaudeSession(ledger: SeatLedger, transcriptPath: string): IngestResult {
  const session = readClaudeSession(transcriptPath);
  const now = new Date().toISOString();
  return ledger.transaction(() => {
    const { seat, created } = ledger.openSeat({
      harness: CLAUDE_CODE,
      version: session.transcript.version,
      native_ref: { session_id: session.session_id },
      started_at: session.transcript.started_at,
    });
    const result: IngestResult = {
      seat_id: seat.seat_id, created, child_ref: null, settings_appended: 0, rows_recorded: 0,
      group_ids: [], rows_marked_gone: 0, warnings: [],
    };
    result.settings_appended = ledger.recordSettings(seat.seat_id, session.transcript.settings);
    ledger.observe(seat.seat_id, {
      started_at: session.transcript.started_at,
      last_seen_at: session.transcript.last_at,
      version: session.transcript.version,
    });
    if (session.transcript.continued_in) {
      const next = ledger.openSeat({
        harness: CLAUDE_CODE, native_ref: { session_id: session.transcript.continued_in },
      }).seat;
      try {
        ledger.linkParent(next.seat_id, seat.seat_id, "continuation");
      } catch (error) {
        result.warnings.push(lineageWarning(error, "continued-in"));
      }
    }

    const plain = session.children.filter((child) => child.workflow_run_id === null);
    for (const child of plain) if (ledger.recordChild(seat.seat_id, claudeRow(child))) result.rows_recorded += 1;
    const plainRefs = new Set(plain.map((child) => child.agent_id));
    for (const row of ledger.getSeat(seat.seat_id)?.children ?? []) {
      if (plainRefs.has(row.child_ref) || row.native_gone_at || row.seat_id) continue;
      if (ledger.recordChild(seat.seat_id, { ...row, native_gone_at: now })) result.rows_marked_gone += 1;
    }

    const runs = new Set(session.workflow_runs.map((run) => run.run_id));
    for (const run of session.workflow_runs) {
      const { group, created: opened } = ledger.openGroup({
        kind: "workflow",
        orchestrator_seat_id: seat.seat_id,
        native_ref: { session_id: session.session_id, workflow_run_id: run.run_id },
        phases: run.phases,
      });
      if (!opened) ledger.recordPhases(group.group_id, run.phases);
      result.group_ids.push(group.group_id);
    }
    for (const group of ledger.groupsFor(seat.seat_id)) {
      if (group.kind !== "workflow") continue;
      const run = group.native_ref.workflow_run_id ?? "";
      const members = runs.has(run) ? session.children.filter((child) => child.workflow_run_id === run) : [];
      for (const child of members) if (ledger.recordMember(group.group_id, claudeRow(child))) result.rows_recorded += 1;
      const refs = new Set(members.map((child) => child.agent_id));
      for (const row of ledger.getGroup(group.group_id)?.members ?? []) {
        if (refs.has(row.child_ref) || row.native_gone_at || row.seat_id) continue;
        if (ledger.recordMember(group.group_id, { ...row, native_gone_at: now })) result.rows_marked_gone += 1;
      }
    }
    return result;
  });
}

/**
 * Place a spawned thread's row. Two or more threads spawned by one parent thread under one root
 * turn form a `spawn` group, and every matching row moves there. A thread spawned alone stays a
 * row under the root seat.
 */
function recordSpawnedThread(
  ledger: SeatLedger,
  seatId: string,
  rootThread: string,
  row: SummaryRow,
): { recorded: boolean; group_id: string | null } {
  const parentThread = row.parent_ref ?? rootThread;
  const sibling = (other: SummaryRow) =>
    other.child_ref !== row.child_ref && other.spawn_turn === row.spawn_turn && (other.parent_ref ?? rootThread) === parentThread;
  const native = row.spawn_turn ? { thread_id: parentThread, turn_id: row.spawn_turn } : null;
  let group = native ? ledger.findGroup("spawn", native) : null;
  const rows = () => ledger.getSeat(seatId)?.children ?? [];
  if (native && !group && rows().some(sibling)) {
    group = ledger.openGroup({ kind: "spawn", orchestrator_seat_id: seatId, native_ref: native }).group;
  }
  if (!group) return { recorded: ledger.recordChild(seatId, row), group_id: null };
  for (const other of rows()) {
    if (other.child_ref === row.child_ref || sibling(other)) ledger.moveChildToGroup(seatId, group.group_id, other.child_ref);
  }
  return { recorded: ledger.recordMember(group.group_id, row), group_id: group.group_id };
}

/**
 * Decision 13: a spawn group whose parent thread is a member of another group names that group.
 * Rows arrive in any order, so every spawn group of the seat is checked after each placement.
 */
function linkNestedGroups(ledger: SeatLedger, seatId: string, rootThread: string): string[] {
  const warnings: string[] = [];
  for (const group of ledger.groupsFor(seatId)) {
    const parentThread = group.native_ref.thread_id;
    if (group.kind !== "spawn" || group.parent_group_id || !parentThread || parentThread === rootThread) continue;
    const parentGroup = ledger.findChild(seatId, parentThread)?.group_id;
    if (!parentGroup) continue;
    try {
      ledger.linkParentGroup(group.group_id, parentGroup);
    } catch (error) {
      warnings.push(lineageWarning(error, "parent_group_id"));
    }
  }
  return warnings;
}

export function ingestCodexRollout(ledger: SeatLedger, rolloutPath: string): IngestResult {
  const rollout = readCodexRollout(rolloutPath);
  return ledger.transaction(() => {
    const empty = { settings_appended: 0, rows_recorded: 0, group_ids: [], rows_marked_gone: 0, warnings: [] as string[] };
    if (rollout.parent_thread_id) {
      // A spawned thread is an ephemeral row under its root thread's seat.
      const root = rollout.session_id !== rollout.thread_id ? rollout.session_id : rollout.parent_thread_id;
      const { seat, created } = ledger.openSeat({
        harness: CODEX, native_ref: { thread_id: root, session_id: root },
      });
      const placed = recordSpawnedThread(ledger, seat.seat_id, root, {
        child_ref: rollout.thread_id,
        parent_ref: rollout.parent_thread_id !== root ? rollout.parent_thread_id : null,
        spawn_turn: rollout.spawn_turn,
        relation: "child",
        depth: rollout.depth,
        agent_type: rollout.agent_role,
        started_at: rollout.started_at,
        ended_at: null,
        end_state: "unknown",
        settings: rollout.settings,
        seat_id: null,
        native_gone_at: null,
      });
      return {
        ...empty,
        seat_id: seat.seat_id,
        created,
        child_ref: rollout.thread_id,
        rows_recorded: placed.recorded ? 1 : 0,
        group_ids: placed.group_id ? [placed.group_id] : [],
        warnings: linkNestedGroups(ledger, seat.seat_id, root),
      };
    }
    const { seat, created } = ledger.openSeat({
      harness: CODEX,
      version: rollout.version,
      native_ref: { thread_id: rollout.thread_id, session_id: rollout.session_id },
      started_at: rollout.started_at,
    });
    const result: IngestResult = { ...empty, seat_id: seat.seat_id, created, child_ref: null };
    result.settings_appended = ledger.recordSettings(seat.seat_id, rollout.settings);
    ledger.observe(seat.seat_id, { started_at: rollout.started_at, last_seen_at: rollout.last_at, version: rollout.version });
    if (rollout.forked_from_id) {
      const parent = ledger.openSeat({
        harness: CODEX, native_ref: { thread_id: rollout.forked_from_id, session_id: rollout.session_id },
      }).seat;
      try {
        ledger.linkParent(seat.seat_id, parent.seat_id, "fork");
      } catch (error) {
        result.warnings.push(lineageWarning(error, "forked_from_id"));
      }
    }
    return result;
  });
}
