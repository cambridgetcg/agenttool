import { describe, expect, test } from 'bun:test'
import { AGENT_CODES, bridgeFailure, CHECK_WITH, deliveredOf, withPriorUnknown } from '../src/failure.ts'
import type { ToolResult } from '../src/link/messages.ts'

const REF = `lin_${'a'.repeat(32)}:0123abcd:4`

// Spec §9.2, row by row, in the table's order (the Global Constraints list the same 38).
const SPEC_9_2 = [
  'hub_away', 'hub_outcome_unknown', 'prior_outcome_unknown', 'duplicate_call_ref', 'hub_version_mismatch', 'seat_session_ended',
  'seat_recovery_required', 'session_required', 'workspace_not_shared', 'tool_not_available_remote', 'parent_not_same_seat',
  'remote_review_blind', 'remote_review_required', 'reserved_prefix', 'field_too_long', 'folder_not_shared', 'harness_not_interactive',
  'rate_limited', 'frame_too_large', 'lineage_cap', 'lease_too_short', 'expected_base_mismatch', 'remote_uncommitted',
  'remote_out_of_scope', 'remote_control_path', 'remote_non_regular_path', 'remote_base_not_ancestor', 'remote_base_unknown',
  'remote_too_large', 'mirror_busy', 'mirror_tampered', 'mirror_filters_present', 'repo_mismatch', 'mirror_low_disk', 'fetch_failed',
  'checkout_failed', 'remote_head_moved', 'collab_build_changed',
]

// What Collab itself returns (spec §2.1: content[0].text is the pretty JSON of structuredContent), for the pass-through checks.
const COLLAB_ERROR: ToolResult = {
  content: [{ type: 'text', text: '{\n  "error": "workspace_not_found",\n  "message": "Workspace \'ws_x\' was not found"\n}' }],
  structuredContent: { error: 'workspace_not_found', message: "Workspace 'ws_x' was not found" },
  isError: true,
}
const COLLAB_OK: ToolResult = {
  content: [{ type: 'text', text: '{\n  "task": {\n    "id": "t1"\n  }\n}' }],
  structuredContent: { task: { id: 't1' } },
}

describe('codes', () => {
  test('no code string is outside §9.2', () => {
    expect([...AGENT_CODES] as string[]).toEqual(SPEC_9_2)
    expect(AGENT_CODES.length).toBe(38)
    expect(new Set(AGENT_CODES).size).toBe(38)
  })

  test('every code but hub_outcome_unknown is delivered:false', () => {
    for (const code of AGENT_CODES) {
      const r = bridgeFailure(code, 'one sentence.', REF)
      expect([code, r.structuredContent?.delivered]).toEqual([code, code === 'hub_outcome_unknown' ? 'unknown' : false])
      expect(deliveredOf(r)).toBe(code === 'hub_outcome_unknown' ? 'unknown' : false)
    }
  })
})

describe('the failure form', () => {
  test('the failure has Collab\'s two-channel shape', () => {
    const r = bridgeFailure('hub_away', 'The Air hub is not reachable; nothing was sent.', REF)
    expect(Object.keys(r)).toEqual(['content', 'structuredContent', 'isError'])
    expect(r.isError).toBe(true)
    expect(r.content).toEqual([{ type: 'text', text: JSON.stringify(r.structuredContent, null, 2) }])
    expect(r.structuredContent).toEqual({
      error: 'hub_away', message: 'The Air hub is not reachable; nothing was sent.', delivered: false, call_ref: REF,
      retry: 'never automatic', check_with: ['collab_task_get', 'collab_task_list', 'collab_next', 'collab_report_list'],
    })
    expect(Object.keys(r.structuredContent!)).toEqual(['error', 'message', 'delivered', 'call_ref', 'retry', 'check_with'])
    expect([...CHECK_WITH]).toEqual(['collab_task_get', 'collab_task_list', 'collab_next', 'collab_report_list'])
  })

  test('extra details follow the core fields and can never replace them', () => {
    const r = bridgeFailure('mirror_busy', 'Another edit task holds this mirror.', REF,
      { holder: 't-9', delivered: true, error: 'nothing', retry: 'now', check_with: [] })
    expect(r.structuredContent).toMatchObject({ error: 'mirror_busy', delivered: false, retry: 'never automatic', holder: 't-9' })
    expect((r.structuredContent!.check_with as string[]).length).toBe(4)
    expect(Object.keys(r.structuredContent!).at(-1)).toBe('holder')
    expect(JSON.parse(r.content[0]!.text)).toEqual(r.structuredContent!)
  })

  test('the check list is a copy, so a caller cannot change the constant', () => {
    const list = bridgeFailure('hub_away', 'x.', REF).structuredContent!.check_with as string[]
    list.push('collab_anything')
    expect(CHECK_WITH.length).toBe(4)
    expect((bridgeFailure('hub_away', 'x.', REF).structuredContent!.check_with as string[]).length).toBe(4)
  })

  test('deliveredOf is null for Collab\'s own results', () => {
    expect(deliveredOf(COLLAB_ERROR)).toBeNull()
    expect(deliveredOf(COLLAB_OK)).toBeNull()
    expect(deliveredOf({ content: [], structuredContent: { delivered: false } })).toBeNull()
  })
})

describe('prior_unknown', () => {
  const prior = [
    { call_ref: REF, tool: 'collab_report_append', idempotency_key: 'k-report-1', session_ended: false },
    { call_ref: `lin_${'a'.repeat(32)}:0123abcd:5`, tool: 'collab_next', idempotency_key: null, session_ended: false },
  ]

  test('prior_unknown adds one text block and keeps the Collab payload', () => {
    const r = withPriorUnknown(COLLAB_OK, prior)
    expect(r.content.length).toBe(2)
    expect(r.content[0]).toEqual(COLLAB_OK.content[0]!)
    expect(r.structuredContent).toEqual({ task: { id: 't1' }, prior_unknown: prior })
    expect(r.isError).toBeUndefined()
    const note = r.content[1]!.text
    for (const s of ['collab_report_append', REF, 'k-report-1', 'collab_next', 'no idempotency_key', 'Never re-send', 'same key']) expect(note).toContain(s)
    expect(note).not.toContain('session has since ended')
    // the input is not changed
    expect(COLLAB_OK.content.length).toBe(1)
    expect(COLLAB_OK.structuredContent).toEqual({ task: { id: 't1' } })
  })

  test('prior_unknown keeps an error result an error, and creates structuredContent when absent', () => {
    expect(withPriorUnknown(COLLAB_ERROR, prior).isError).toBe(true)
    const bare: ToolResult = { content: [{ type: 'text', text: 'plain' }] }
    expect(withPriorUnknown(bare, prior).structuredContent).toEqual({ prior_unknown: prior })
  })

  test('no unresolved call leaves the result as it was', () => {
    expect(withPriorUnknown(COLLAB_OK, [])).toBe(COLLAB_OK)
  })

  test('a call whose session has ended is never advised for a replay', () => {
    const ended = { call_ref: `lin_${'a'.repeat(32)}:0123abcd:6`, tool: 'collab_report_append', idempotency_key: 'k-old', session_ended: true }
    const only = withPriorUnknown(COLLAB_OK, [ended])
    expect(only.structuredContent!.prior_unknown).toEqual([ended])
    const note = only.content[1]!.text
    for (const s of ['k-old', 'session has since ended', 'never replay or re-send']) expect(note).toContain(s)
    expect(note).not.toContain('replay it with the same key')
    // Both kinds in one result: one text block, each call under its own advice.
    const both = withPriorUnknown(COLLAB_OK, [prior[0]!, ended])
    expect(both.content.length).toBe(2)
    const text = both.content[1]!.text
    expect(text.indexOf('k-report-1')).toBeLessThan(text.indexOf('replay it with the same key'))
    expect(text.indexOf('replay it with the same key')).toBeLessThan(text.indexOf('k-old'))
  })

  test('a bridge failure keeps its own fields under prior_unknown', () => {
    const f = withPriorUnknown(bridgeFailure('hub_away', 'x.', REF), prior)
    expect(deliveredOf(f)).toBe(false)
    expect(f.structuredContent).toMatchObject({ error: 'hub_away', prior_unknown: prior })
  })
})
