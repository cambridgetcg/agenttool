// The remote tool policy's table (spec §6.3, R7): every tool of the installed Collab build (34, K1) has exactly one
// class. It fails closed: a name the table does not classify is refused and hidden, and the hub refuses to start when
// the Collab dist it runs lists one (`policy_unclassified_tool`, Task 52 through `unclassified`).
import type { ToolDef } from '../link/messages.ts'
import { canonicalToolList } from '../tools-digest.ts'
import { reduceToolSchema } from './limits.ts'

export type ToolClass = 'hidden' | 'rewritten' | 'pinned_read' | 'restricted' | 'pass_bound'

export const POLICY_TABLE: Readonly<Record<string, ToolClass>> = Object.freeze({
  // Hidden and refused `tool_not_available_remote` (R7, R28, R37): presence is unauthenticated (K7), workspace_open runs
  // git in any directory (K8), cursor_reset is Ai's repair (§9.6), decisions, waits and handoffs are out of Phase 1.
  collab_session_join: 'hidden',
  collab_session_list: 'hidden',
  collab_session_heartbeat: 'hidden',
  collab_session_leave: 'hidden',
  collab_workspace_open: 'hidden',
  collab_cursor_reset: 'hidden',
  collab_decision_record: 'hidden',
  collab_events_wait: 'hidden',
  collab_handoff_offer: 'hidden',
  collab_handoff_respond: 'hidden',
  // Rewritten: root_path is the lineage's mirror, actor and role are stamped (§6.4).
  collab_session_start: 'rewritten',
  // Pinned reads: the bound workspace only. Collab checks no binding on these seven (K4; the eighth, session_list, is hidden).
  collab_workspace_status: 'pinned_read',
  collab_task_list: 'pinned_read',
  collab_task_get: 'pinned_read',
  collab_report_list: 'pinned_read',
  collab_events_since: 'pinned_read',
  collab_anchor_status: 'pinned_read',
  collab_journal_verify: 'pinned_read',
  // Restricted: per-tool rules in src/air/policy.ts.
  collab_session_rest: 'restricted',
  collab_report_append: 'restricted',
  collab_task_review: 'restricted',
  collab_task_create: 'restricted',
  collab_task_claim: 'restricted',
  collab_task_complete: 'restricted',
  collab_task_recover: 'restricted',
  collab_artifact_attach: 'restricted',
  // Pass, bound only.
  collab_session_end: 'pass_bound',
  collab_next: 'pass_bound',
  collab_cursor_ack: 'pass_bound',
  collab_task_renew: 'pass_bound',
  collab_task_progress: 'pass_bound',
  collab_task_release: 'pass_bound',
  collab_task_block: 'pass_bound',
  collab_task_unblock: 'pass_bound',
})

/** The class of a tool name, or null: own keys only, so `constructor` or `__proto__` is never a tool. */
export function classify(name: string): ToolClass | null {
  return Object.hasOwn(POLICY_TABLE, name) ? POLICY_TABLE[name]! : null
}

export function unclassified(names: readonly string[]): string[] {
  return names.filter((n) => classify(n) === null)
}

function dropProps(tool: ToolDef, names: readonly string[]): void {
  const schema = tool.inputSchema
  const props = schema.properties
  if (typeof props === 'object' && props !== null) for (const n of names) delete (props as Record<string, unknown>)[n]
  if (Array.isArray(schema.required)) schema.required = schema.required.filter((r) => !names.includes(r as string))
}

/**
 * The tool list a remote seat sees (§6.2): no hidden or unclassified tool; session_start without root_path and
 * repository_key, which the hub sets; no `actor` anywhere else, because a bound Collab ignores it and it would only
 * carry unstamped text (P26); the hub's reduced limits (§6.6); four fields per tool, sorted by name (P27). The input
 * list is never changed. Collab 0.5.0 gives 24 tools.
 */
export function seatTools(collabList: ToolDef[], device: string, user: string): ToolDef[] {
  const out: ToolDef[] = []
  for (const t of collabList) {
    const cls = classify(t.name)
    if (cls === null || cls === 'hidden') continue
    const tool = structuredClone(t)
    dropProps(tool, t.name === 'collab_session_start' ? ['root_path', 'repository_key'] : ['actor'])
    out.push(reduceToolSchema(tool, device, user))
  }
  return canonicalToolList(out)
}
