export const USAGE_SCHEMA = "agenttool.codex-token-usage/0.1" as const;

export interface TokenBreakdown {
  input_tokens: number;
  cached_input_tokens: number;
  cache_write_input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens: number;
  total_tokens: number;
}

export interface TokenEventSummary {
  observed_at: string;
  model_context_window: number | null;
  total: TokenBreakdown;
  last: TokenBreakdown;
}

export interface UsageSession {
  session_ref: string;
  parent_session_ref: string | null;
  is_self: boolean;
  source_kind: "cli" | "subagent" | "exec" | "app_server" | "ide" | "other";
  archived: boolean;
  created_at: string;
  updated_at: string;
  activity_age_seconds: number;
  recently_active: boolean;
  cumulative_tokens: number;
  token_event: TokenEventSummary | null;
}

export interface UsageTotals {
  sessions_observed: number;
  archived_sessions: number;
  cumulative_tokens: number;
  recently_active_sessions: number;
  recently_active_cumulative_tokens: number;
}

export interface UsageSnapshot {
  schema: typeof USAGE_SCHEMA;
  observed_at: string;
  source: {
    kind: "codex_local_sqlite_and_rollout_token_events";
    database_file: string;
    update_mode: "poll_on_read";
    push_guarantee: false;
    network_calls: false;
  };
  scope: {
    active_window_seconds: number;
    returned_session_limit: number;
    identifiers: "sha256_truncated_session_refs";
  };
  totals: UsageTotals;
  sessions: UsageSession[];
  data_boundary: {
    returns: string[];
    excludes: string[];
  };
  limitations: string[];
}

export interface UsageDelta {
  elapsed_ms: number;
  comparison: "comparable" | "counter_reset_or_source_changed";
  cumulative_tokens_delta: number | null;
  session_deltas: Array<{
    session_ref: string;
    comparison: "advanced" | "counter_reset";
    cumulative_tokens_delta: number | null;
  }>;
}

export interface UsageSnapshotWithDelta extends UsageSnapshot {
  delta_since_previous_sample: UsageDelta | null;
}

export interface UsageDoctorReport {
  schema: typeof USAGE_SCHEMA;
  ok: boolean;
  database_file: string | null;
  required_columns: string[];
  missing_columns: string[];
  thread_rows: number | null;
  current_session_detectable: boolean;
  boundaries: {
    read_only: true;
    network_calls: false;
    transcript_text_returned: false;
    cost_or_quota_claims: false;
  };
  error: { code: string; message: string } | null;
}
