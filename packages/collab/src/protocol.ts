export const COLLAB_PROTOCOL = "agenttool.collab/0.1" as const;
export const LEGACY_COLLAB_PROTOCOL = COLLAB_PROTOCOL;
export const COLLAB_COORDINATION_PROTOCOL = "agenttool.collab/0.2" as const;
export const COLLAB_SESSION_PROTOCOL = "agenttool.collab.session/0.1" as const;
export const SUPPORTED_COLLAB_PROTOCOLS = [
  LEGACY_COLLAB_PROTOCOL,
  COLLAB_COORDINATION_PROTOCOL,
] as const;

export type CollabProtocol = (typeof SUPPORTED_COLLAB_PROTOCOLS)[number];
export type TaskStatus = "open" | "claimed" | "blocked" | "completed";
export type SessionPresence = "live" | "stale" | "left";
export type TaskWorkMode = "coordination" | "read_only" | "edit";
export type CompletionPolicy = "reported" | "accepted";
export type ReviewStatus =
  | "legacy_unreviewed"
  | "not_required"
  | "pending"
  | "accepted"
  | "changes_requested";
export type EffectiveTaskStatus =
  | TaskStatus
  | "lease_expired"
  | "recovery_required"
  | "reported_complete"
  | "accepted"
  | "changes_requested";

export interface EventCursor {
  epoch_id: string;
  sequence: number;
  hash: string;
}

/**
 * Public v0.2 presence/routing record. These caller-supplied labels are not
 * credentials and never authenticate a person, provider, model, or account.
 */
export interface CollabSession {
  protocol: typeof COLLAB_SESSION_PROTOCOL;
  id: string;
  workspace_id: string;
  epoch_id: string;
  client_instance_id: string;
  actor_label: string;
  actor_key: string;
  runtime_kind: string;
  provider_label: string | null;
  model_label: string | null;
  declared_capabilities: string[];
  capability_basis: "self_declared";
  version: number;
  joined_at: string;
  last_seen_at: string;
  presence_expires_at: string;
  presence: SessionPresence;
  left_at: string | null;
}

export interface JoinSessionInput {
  workspace_id: string;
  client_instance_id: string;
  actor_label: string;
  runtime_kind: string;
  provider_label?: string;
  model_label?: string;
  declared_capabilities?: string[];
  ttl_seconds?: number;
}

export interface SessionMutationInput {
  session_id: string;
  idempotency_key: string;
  expected_version: number;
}

export interface HeartbeatSessionInput extends SessionMutationInput {
  ttl_seconds?: number;
}

export interface RepoCheckpoint {
  worktree_id: string;
  head_sha: string | null;
  branch: string | null;
  dirty: boolean | null;
  algorithm?: "git-state/v1";
  index_sha256?: string | null;
  state_sha256?: string | null;
  source?: "server_observed" | "caller_asserted";
  captured_at: string;
}

export interface Workspace {
  id: string;
  epoch_id: string;
  root_path: string;
  repository_key: string;
  name: string;
  created_at: string;
  event_head_sequence: number;
  event_head_hash: string;
}

export interface Worktree {
  id: string;
  workspace_id: string;
  root_path: string;
  repository_key: string;
  git_common_dir_hash: string | null;
  branch: string | null;
  head_sha: string | null;
  dirty: boolean | null;
  registered_at: string;
  last_seen_at: string;
}

export type SessionStatus = "active" | "ended";

export interface CoordinationSession {
  id: string;
  workspace_id: string;
  worktree_id: string;
  actor: string;
  role: string | null;
  parent_session_id: string | null;
  status: SessionStatus;
  generation: number;
  joined_at: string;
  last_seen_at: string;
  ended_at: string | null;
  cursor: EventCursor;
  cursor_version: number;
  reset_generation: number;
  cursor_recovery_required: boolean;
}

export interface SessionJoinResult {
  workspace: Workspace;
  worktree: Worktree;
  session: CoordinationSession;
  identity_boundary:
    "session_credentials_fence_cooperating_local_clients_but_do_not_authenticate_a_person_or_model";
}

/**
 * A host-side bearer used to resume one local session. Keep this value out of
 * prompts, tool results, events, logs, and source control.
 */
export interface SessionCredential {
  session_id: string;
  session_token: string;
  generation: number;
  last_cursor?: EventCursor;
}

export interface SessionCursorRecovery {
  required: true;
  cause:
    | "persisted_cursor_invalid"
    | "host_cursor_invalid"
    | "host_cursor_mismatch";
  persisted_cursor: EventCursor;
  host_cursor: EventCursor | null;
  expected_cursor_version: number;
}

export interface SessionHandle extends SessionJoinResult {
  credential: SessionCredential;
  cursor_recovery?: SessionCursorRecovery;
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
  attached_by_session_id: string | null;
  attached_at: string;
}

export interface Task {
  id: string;
  workspace_id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  effective_status: EffectiveTaskStatus;
  dependencies: string[];
  path_scopes: string[];
  work_mode: TaskWorkMode;
  completion_policy: CompletionPolicy;
  review_status: ReviewStatus;
  expected_base_sha: string | null;
  base_checkpoint: RepoCheckpoint | null;
  result_checkpoint: RepoCheckpoint | null;
  completion_report_id: string | null;
  assignee: string | null;
  assignee_session_id: string | null;
  claim_worktree_id: string | null;
  lease_id: string | null;
  lease_expires_at: string | null;
  blocker: string | null;
  latest_progress: string | null;
  reported_by: string | null;
  reported_by_session_id: string | null;
  reported_at: string | null;
  accepted_by: string | null;
  accepted_by_session_id: string | null;
  accepted_at: string | null;
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

export type ReportKind =
  | "observation"
  | "inference"
  | "proposal"
  | "decision";

export type ReportRelation =
  | "informs"
  | "supports"
  | "challenges"
  | "corrects"
  | "withdraws"
  | "supersedes"
  | "resolves";

export type ReportConfidence = "high" | "medium" | "low" | "unknown";

export interface CollabReport {
  id: string;
  workspace_id: string;
  task_id: string | null;
  from_session_id: string | null;
  from_actor: string;
  to_session_id: string | null;
  kind: ReportKind;
  body: string;
  evidence_refs: string[];
  confidence: ReportConfidence;
  confidence_basis: string | null;
  limits: string | null;
  relation: ReportRelation;
  target_report_id: string | null;
  authority_scope: string | null;
  authority_basis: string | null;
  created_at: string;
  event_sequence: number;
}

export interface TaskReview {
  id: string;
  workspace_id: string;
  task_id: string;
  review_generation: number;
  outcome: "accepted" | "changes_requested";
  summary: string;
  reviewer_actor: string;
  reviewer_session_id: string;
  created_at: string;
  event_sequence: number;
}

export type CollabEventType =
  | "workspace.opened"
  | "worktree.registered"
  | "session.joined"
  | "session.resumed"
  | "session.ended"
  | "session.cursor_reset"
  | "task.created"
  | "task.claimed"
  | "task.recovered"
  | "task.claim_expired"
  | "task.lease_renewed"
  | "task.progressed"
  | "task.released"
  | "task.blocked"
  | "task.unblocked"
  | "task.completed"
  | "task.reported_complete"
  | "task.accepted"
  | "task.changes_requested"
  | "artifact.attached"
  | "report.posted"
  | "decision.recorded"
  | "handoff.offered"
  | "handoff.accepted"
  | "handoff.declined"
  | "handoff.expired";

export interface CollabEvent {
  protocol: CollabProtocol;
  workspace_id: string;
  epoch_id: string;
  sequence: number;
  id: string;
  type: CollabEventType;
  entity_id: string;
  actor: string;
  session_id?: string | null;
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
  pending_reviews: Task[];
  active_sessions: CoordinationSession[];
  recent_decisions: Decision[];
  recent_reports: CollabReport[];
}

export interface MutationContext {
  actor: string;
  session_id?: string;
  idempotency_key: string;
}

export interface SessionMutationContext {
  session_id: string;
  session_token: string;
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
  checkpoint?: RepoCheckpoint;
  recovery_note?: string;
}

export interface LeaseTaskInput extends VersionedMutationContext {
  workspace_id: string;
  task_id: string;
  lease_id: string;
}

export interface TaskConflict {
  task: Task;
  conflicts: Array<{
    active_task_id: string;
    active_workspace_id: string;
    assignee: string | null;
    assignee_session_id: string | null;
    lease_expires_at: string | null;
    path_pairs: Array<[string, string]>;
  }>;
}

export interface JournalPage {
  events: CollabEvent[];
  next_cursor: number;
  cursor: EventCursor;
  next_anchor: EventCursor;
  head_sequence: number;
  head_hash: string;
  has_more: boolean;
  chain_valid: boolean;
  verification_scope: "returned_page";
}

export interface HandoffOffer {
  id: string;
  workspace_id: string;
  task_id: string;
  from_actor: string;
  from_session_id: string | null;
  to_actor: string;
  to_session_id: string | null;
  summary: string;
  status: "pending" | "accepted" | "declined" | "expired";
  offered_at: string;
  expires_at: string;
  resolved_at: string | null;
}

export interface NextCollabState {
  actor: string;
  session: CoordinationSession | null;
  own_claims: Task[];
  ready_tasks: Task[];
  claimable_tasks: Task[];
  conflicted_tasks: TaskConflict[];
  handoff_offers: Array<{ handoff: HandoffOffer; task: Task }>;
  reports: CollabReport[];
  events: JournalPage;
}
