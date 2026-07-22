export const COLLAB_PROTOCOL = "agenttool.collab/0.1" as const;

export type TaskStatus = "open" | "claimed" | "blocked" | "completed";

export interface Workspace {
  id: string;
  epoch_id: string;
  root_path: string;
  name: string;
  created_at: string;
  event_head_sequence: number;
  event_head_hash: string;
}

export interface ArtifactRef {
  id: string;
  task_id: string;
  kind: "file" | "commit" | "test" | "data" | "url" | "other";
  uri: string;
  sha256: string | null;
  media_type: string | null;
  label: string | null;
  attached_by: string;
  attached_at: string;
}

export interface Task {
  id: string;
  workspace_id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  effective_status: TaskStatus | "lease_expired";
  dependencies: string[];
  path_scopes: string[];
  assignee: string | null;
  lease_id: string | null;
  lease_expires_at: string | null;
  blocker: string | null;
  latest_progress: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  artifacts?: ArtifactRef[];
}

export interface Decision {
  id: string;
  workspace_id: string;
  topic: string;
  decision: string;
  rationale: string | null;
  recorded_by: string;
  recorded_at: string;
}

export type CollabEventType =
  | "workspace.opened"
  | "task.created"
  | "task.claimed"
  | "task.claim_expired"
  | "task.lease_renewed"
  | "task.progressed"
  | "task.released"
  | "task.blocked"
  | "task.unblocked"
  | "task.completed"
  | "artifact.attached"
  | "decision.recorded"
  | "handoff.offered"
  | "handoff.accepted"
  | "handoff.declined"
  | "handoff.expired";

export interface CollabEvent {
  protocol: typeof COLLAB_PROTOCOL;
  workspace_id: string;
  epoch_id: string;
  sequence: number;
  id: string;
  type: CollabEventType;
  entity_id: string;
  actor: string;
  occurred_at: string;
  payload: Record<string, unknown>;
  prev_hash: string;
  hash: string;
}

export interface WorkspaceStatus {
  workspace: Workspace;
  counts: Record<TaskStatus, number>;
  expired_claims: number;
  active_claims: Task[];
  blocked_tasks: Task[];
  recent_decisions: Decision[];
}

export interface MutationContext {
  actor: string;
  idempotency_key: string;
}

export interface VersionedMutationContext extends MutationContext {
  expected_version: number;
}

export interface CreateTaskInput extends MutationContext {
  workspace_id: string;
  id?: string;
  title: string;
  description?: string;
  dependencies?: string[];
  path_scopes?: string[];
}

export interface ClaimTaskInput extends VersionedMutationContext {
  workspace_id: string;
  task_id: string;
  ttl_seconds?: number;
}

export interface LeaseTaskInput extends VersionedMutationContext {
  workspace_id: string;
  task_id: string;
  lease_id: string;
}

export interface JournalPage {
  events: CollabEvent[];
  next_cursor: number;
  head_sequence: number;
  head_hash: string;
  chain_valid: boolean;
  verification_scope: "returned_page";
}

export interface HandoffOffer {
  id: string;
  workspace_id: string;
  task_id: string;
  from_actor: string;
  to_actor: string;
  summary: string;
  status: "pending" | "accepted" | "declined" | "expired";
  offered_at: string;
  expires_at: string;
  resolved_at: string | null;
}
