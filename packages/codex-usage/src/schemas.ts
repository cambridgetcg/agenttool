import { z } from "zod";
import { USAGE_SCHEMA } from "./types.js";

const nonnegativeInteger = z.number().int().nonnegative();
const sessionReference = z.string().regex(/^s_[a-f0-9]{12}$/);

export const tokenBreakdownSchema = z.object({
  input_tokens: nonnegativeInteger,
  cached_input_tokens: nonnegativeInteger,
  cache_write_input_tokens: nonnegativeInteger,
  output_tokens: nonnegativeInteger,
  reasoning_output_tokens: nonnegativeInteger,
  total_tokens: nonnegativeInteger,
}).strict();

export const tokenEventSummarySchema = z.object({
  observed_at: z.string(),
  model_context_window: nonnegativeInteger.nullable(),
  total: tokenBreakdownSchema,
  last: tokenBreakdownSchema,
}).strict();

export const usageSessionSchema = z.object({
  session_ref: sessionReference,
  parent_session_ref: sessionReference.nullable(),
  is_self: z.boolean(),
  source_kind: z.enum(["cli", "subagent", "exec", "app_server", "ide", "other"]),
  archived: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
  activity_age_seconds: nonnegativeInteger,
  recently_active: z.boolean(),
  cumulative_tokens: nonnegativeInteger,
  token_event: tokenEventSummarySchema.nullable(),
}).strict();

export const usageTotalsSchema = z.object({
  sessions_observed: nonnegativeInteger,
  archived_sessions: nonnegativeInteger,
  cumulative_tokens: nonnegativeInteger,
  recently_active_sessions: nonnegativeInteger,
  recently_active_cumulative_tokens: nonnegativeInteger,
}).strict();

export const usageSourceSchema = z.object({
  kind: z.literal("codex_local_sqlite_and_rollout_token_events"),
  database_file: z.string(),
  update_mode: z.literal("poll_on_read"),
  push_guarantee: z.literal(false),
  network_calls: z.literal(false),
}).strict();

export const usageScopeSchema = z.object({
  active_window_seconds: nonnegativeInteger,
  returned_session_limit: nonnegativeInteger,
  identifiers: z.literal("sha256_truncated_session_refs"),
}).strict();

export const dataBoundarySchema = z.object({
  returns: z.array(z.string()),
  excludes: z.array(z.string()),
}).strict();

export const usageSnapshotSchema = z.object({
  schema: z.literal(USAGE_SCHEMA),
  observed_at: z.string(),
  source: usageSourceSchema,
  scope: usageScopeSchema,
  totals: usageTotalsSchema,
  sessions: z.array(usageSessionSchema),
  data_boundary: dataBoundarySchema,
  limitations: z.array(z.string()),
}).strict();

export const usageDeltaSchema = z.object({
  elapsed_ms: nonnegativeInteger,
  comparison: z.enum(["comparable", "counter_reset_or_source_changed"]),
  cumulative_tokens_delta: nonnegativeInteger.nullable(),
  session_deltas: z.array(z.object({
    session_ref: sessionReference,
    comparison: z.enum(["advanced", "counter_reset"]),
    cumulative_tokens_delta: nonnegativeInteger.nullable(),
  }).strict()),
}).strict();

export const usageSnapshotWithDeltaSchema = usageSnapshotSchema.extend({
  delta_since_previous_sample: usageDeltaSchema.nullable(),
});

export const usageSessionsOutputSchema = z.object({
  schema: z.literal(USAGE_SCHEMA),
  observed_at: z.string(),
  scope: usageScopeSchema,
  sessions: z.array(usageSessionSchema),
  data_boundary: dataBoundarySchema,
  limitations: z.array(z.string()),
}).strict();

export const usageSessionOutputSchema = z.object({
  session_ref: sessionReference,
  session: usageSessionSchema.nullable(),
}).strict();

export const usageSelfOutputSchema = z.object({
  session: usageSessionSchema.nullable(),
  identity_boundary: z.string(),
}).strict();

export const usageDoctorReportSchema = z.object({
  schema: z.literal(USAGE_SCHEMA),
  ok: z.boolean(),
  database_file: z.string().nullable(),
  required_columns: z.array(z.string()),
  missing_columns: z.array(z.string()),
  thread_rows: nonnegativeInteger.nullable(),
  current_session_detectable: z.boolean(),
  boundaries: z.object({
    read_only: z.literal(true),
    network_calls: z.literal(false),
    transcript_text_returned: z.literal(false),
    cost_or_quota_claims: z.literal(false),
  }).strict(),
  error: z.object({ code: z.string(), message: z.string() }).strict().nullable(),
}).strict();
