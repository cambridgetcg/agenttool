export const REFUSAL_REASONS = [
  'malformed', 'too_large', 'expired', 'clock', 'replayed', 'outside_allowlist',
  'target_logged_out', 'runner_missing', 'runtime_unavailable', 'rate_limited', 'busy',
  'tcc_protected_folder',
] as const
export type RefusalReason = (typeof REFUSAL_REASONS)[number]
export type BlockedReason = 'usage' | 'auth' | 'permission'
export type JobStatus =
  | 'queued' | 'running' | 'completed' | 'failed' | 'blocked' | 'cancelled' | 'timed_out' | 'expired' | 'unknown'
  /** Phase 0.5: the runner re-ran admission when the job started, and the allowlist (or the folder) no longer allows it. Final. */
  | 'refused'
export type TransportStatus = 'unreachable' | 'auth_refused' | 'host_key_mismatch'
export const TERMINAL: ReadonlySet<JobStatus> = new Set([
  'completed', 'failed', 'blocked', 'cancelled', 'timed_out', 'expired', 'unknown', 'refused',
])
/**
 * The statuses an answer carries the heartbeat age for: a job still queued or running (a stale age shows a stalled one),
 * and an `unknown` one, whose last beat says when the runner was last seen with it (Review Focus 4). For a job that
 * ended, the age says nothing, so it is neither sent nor printed.
 */
export const HEARTBEAT_STATUSES: ReadonlySet<string> = new Set(['queued', 'running', 'unknown'])

/** What the gatekeeper prints: one JSON object per call. */
export interface GateResponse {
  status: 'admitted' | 'refused' | JobStatus | TransportStatus
  handle?: string
  reason?: string
  detail?: string
  hint?: string
  heartbeat_age_s?: number | null
  [extra: string]: unknown
}
