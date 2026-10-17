/** execution-seat/v1 and execution-seat-group/v1. See docs/EXECUTION-SEAT.md. */

export const SEAT_TYPE = "execution-seat/v1";
export const GROUP_TYPE = "execution-seat-group/v1";

export type Relation = "fork" | "continuation" | "child";
export type Persistence = "ephemeral" | "recorded" | "durable";
export type Basis = "transcript" | "hook" | "rollout" | "declared";
export type EndState = "result" | "failed" | "unknown";
export type GroupKind = "workflow" | "spawn" | "declared";
export type GroupOutcome = "completed" | "failed" | "stopped" | "unknown";
export type DeliverableKind = "commit" | "pr" | "collab_event" | "artifact";

export const PERSISTENCE_ORDER: readonly Persistence[] = ["ephemeral", "recorded", "durable"];

/** The harness's own handle, e.g. `{session_id}` for Claude Code or `{thread_id, session_id}` for Codex. */
export type NativeRef = Readonly<Record<string, string>>;

export interface SettingsEntry {
  at: string;
  model: string | null;
  effort: string | null;
  provider: string | null;
  basis: Basis;
  /** Native evidence that hidden reasoning was dropped. Never a claim that it continued. */
  evidence: { thinking_drop: string } | null;
}

/** An L1 summary row: lineage and settings, no labels, no content. */
export interface SummaryRow {
  child_ref: string;
  parent_ref: string | null;
  relation: "child";
  depth: number | null;
  agent_type: string | null;
  started_at: string | null;
  ended_at: string | null;
  end_state: EndState;
  settings: SettingsEntry[];
  /** Set once the child is promoted to its own seat record. */
  seat_id: string | null;
  /** Set when a later scan finds the native transcript gone. The row stays (R2). */
  native_gone_at: string | null;
}

export interface ExecutionSeat {
  type: typeof SEAT_TYPE;
  seat_id: string;
  identity_id: string | null;
  signing_key_id: string | null;
  device_id: string;
  harness: { name: string; version: string | null };
  native_ref: NativeRef;
  parent_seat_id: string | null;
  relation: Relation | null;
  group_id: string | null;
  persistence: Persistence;
  settings: SettingsEntry[];
  children: SummaryRow[];
  started_at: string | null;
  last_seen_at: string | null;
  ended_at: string | null;
  end_reason: string | null;
}

export interface Deliverable {
  kind: DeliverableKind;
  ref: string;
}

export interface ExecutionSeatGroup {
  type: typeof GROUP_TYPE;
  group_id: string;
  kind: GroupKind;
  orchestrator_seat_id: string;
  parent_group_id: string | null;
  identity_id: string | null;
  native_ref: NativeRef;
  /** Left null and empty by the native readers until decided whether a run's name counts as content. */
  name: string | null;
  phases: string[];
  members: SummaryRow[];
  deliverables: Deliverable[];
  started_at: string | null;
  ended_at: string | null;
  outcome: GroupOutcome | null;
}
