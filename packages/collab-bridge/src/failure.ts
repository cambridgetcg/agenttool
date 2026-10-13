// The one failure form for everything the pipe or the hub refuses or cannot settle (spec §9.1, R17): an MCP tool
// result in Collab's own two-channel shape, never a JSON-RPC error, because a harness such as Hermes raises a
// JSON-RPC error's text as an exception and may resend on it (K56). Collab's own results pass through untouched.
import type { ToolResult } from './link/messages.ts'

// Spec §9.2, in the table's order. Every code but hub_outcome_unknown means "not sent".
export const AGENT_CODES = [
  'hub_away', 'hub_outcome_unknown', 'prior_outcome_unknown', 'duplicate_call_ref', 'hub_version_mismatch', 'seat_session_ended',
  'seat_recovery_required', 'session_required', 'workspace_not_shared', 'tool_not_available_remote', 'parent_not_same_seat',
  'remote_review_blind', 'remote_review_required', 'reserved_prefix', 'field_too_long', 'folder_not_shared', 'harness_not_interactive',
  'rate_limited', 'frame_too_large', 'lineage_cap', 'lease_too_short', 'expected_base_mismatch', 'remote_uncommitted',
  'remote_out_of_scope', 'remote_control_path', 'remote_non_regular_path', 'remote_base_not_ancestor', 'remote_base_unknown',
  'remote_too_large', 'mirror_busy', 'mirror_tampered', 'mirror_filters_present', 'repo_mismatch', 'mirror_low_disk', 'fetch_failed',
  'checkout_failed', 'remote_head_moved', 'collab_build_changed',
] as const
export type AgentCode = (typeof AGENT_CODES)[number]
export const CHECK_WITH = ['collab_task_get', 'collab_task_list', 'collab_next', 'collab_report_list'] as const

const RETRY = 'never automatic'
const CORE_KEYS: ReadonlySet<string> = new Set(['error', 'message', 'delivered', 'call_ref', 'retry', 'check_with'])

export function bridgeFailure(code: AgentCode, message: string, callRef: string, extra?: Record<string, unknown>): ToolResult {
  const structured: Record<string, unknown> = {
    error: code,
    message,
    delivered: code === 'hub_outcome_unknown' ? 'unknown' : false,
    call_ref: callRef,
    retry: RETRY,
    check_with: [...CHECK_WITH],
  }
  // Details (a holder's task id, a field name) follow the core fields and can never replace one of them.
  for (const [k, v] of Object.entries(extra ?? {})) if (!CORE_KEYS.has(k)) structured[k] = v
  return { content: [{ type: 'text', text: JSON.stringify(structured, null, 2) }], structuredContent: structured, isError: true }
}

/** false or 'unknown' for a bridge failure; null for anything else, Collab's own results included. */
export function deliveredOf(r: ToolResult): false | 'unknown' | null {
  const s = r.structuredContent
  if (r.isError !== true || !s || s.retry !== RETRY) return null
  return s.delivered === false || s.delivered === 'unknown' ? s.delivered : null
}

/** session_ended: the call was made under a Collab session that is no longer this lineage's, or under none known, so its
 *  receipt is gone (K24) and a same-key replay would run it again (§9.6 item 5(b), P66). */
export interface PriorUnknown { call_ref: string; tool: string; idempotency_key: string | null; session_ended: boolean }

/** Tells the agent, on its next result, which earlier calls of this lineage still have no known outcome (§9.3 item 6). */
export function withPriorUnknown(r: ToolResult, prior: PriorUnknown[]): ToolResult {
  if (prior.length === 0) return r
  const named = (ps: PriorUnknown[]) => ps.map((p) => `${p.tool} (call_ref ${p.call_ref}, ${p.idempotency_key === null ? 'no idempotency_key' : `idempotency_key ${p.idempotency_key}`})`).join('; ')
  const live = prior.filter((p) => !p.session_ended)
  const ended = prior.filter((p) => p.session_ended)
  const notes: string[] = []
  if (live.length > 0) {
    notes.push(`Earlier Collab calls from this session have no known outcome and may have taken effect: ${named(live)}. ` +
      'Never re-send one under a new idempotency_key: check with collab_task_get, collab_task_list, collab_next or collab_report_list, ' +
      'or replay it with the same key.')
  }
  if (ended.length > 0) {
    notes.push(`Earlier Collab calls have no known outcome and may have taken effect: ${named(ended)}. ` +
      'Their Collab session has since ended, so a same-key replay would run them again in the new session: ' +
      'check with collab_task_list or collab_report_list; never replay or re-send them.')
  }
  return {
    ...r,
    content: [...r.content, { type: 'text', text: notes.join(' ') }],
    structuredContent: { ...(r.structuredContent ?? {}), prior_unknown: prior.map((p) => ({ ...p })) },
  }
}
