export type RefusalReason =
  | 'malformed' | 'too_large' | 'expired' | 'clock' | 'replayed' | 'outside_allowlist'
  | 'target_logged_out' | 'runner_missing' | 'runtime_unavailable' | 'rate_limited' | 'busy'
  | 'tcc_protected_folder'
export type BlockedReason = 'usage' | 'auth' | 'permission'
export type JobStatus =
  | 'queued' | 'running' | 'completed' | 'failed' | 'blocked' | 'cancelled' | 'timed_out' | 'expired' | 'unknown'
export type TransportStatus = 'unreachable' | 'auth_refused' | 'host_key_mismatch'
export const TERMINAL: ReadonlySet<JobStatus> = new Set([
  'completed', 'failed', 'blocked', 'cancelled', 'timed_out', 'expired', 'unknown',
])

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
