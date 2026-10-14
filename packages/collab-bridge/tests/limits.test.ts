import { describe, expect, test } from 'bun:test'
import type { ToolDef } from '../src/link/messages.ts'
import { ADVERTISED, checkLengths, MinInterval, RATES, reduceToolSchema, roleLimit, TokenBucket } from '../src/air/limits.ts'
import { AUTHORITY_PREFIX, rolePrefix, STAMP_RESERVE } from '../src/air/stamp.ts'

// The four schemas the hub reduces, as Collab 0.5.0 lists them (plan-facts tools.md), trimmed to the fields used here.
const str = (maxLength?: number): Record<string, unknown> => (maxLength === undefined ? { type: 'string', minLength: 1 } : { type: 'string', minLength: 1, maxLength })
const tool = (name: string, properties: Record<string, unknown>): ToolDef => ({ name, description: name, inputSchema: { type: 'object', properties } })
const START = tool('collab_session_start', { root_path: str(), actor: str(200), role: { type: 'string', maxLength: 200 }, parent_session_id: str(), repository_key: str(1000) })
const REPORT = tool('collab_report_append', {
  workspace_id: str(), body: str(8000), authority_scope: { type: 'string', maxLength: 1000 }, authority_basis: { type: 'string', maxLength: 2000 },
  evidence_refs: { type: 'array', maxItems: 128, items: str(2000) },
})
const COMPLETE = tool('collab_task_complete', { workspace_id: str(), summary: str(4000), limits: { type: 'string', maxLength: 2000 } })
const RECOVER = tool('collab_task_recover', { workspace_id: str(), recovery_note: str(4000), blocker: str(2000) })
const NEXT = tool('collab_next', { workspace_id: str(), known_cursor: { type: 'object', properties: { epoch_id: str(), hash: { type: 'string', minLength: 64, maxLength: 64 } } } })

const maxOf = (t: ToolDef, field: string): unknown => ((t.inputSchema.properties as Record<string, Record<string, unknown>>)[field]!).maxLength

describe('advertised limits', () => {
  test('each advertised limit is Collab\'s less what the hub adds', () => {
    expect(ADVERTISED.label).toBe(64)
    expect(1000 - AUTHORITY_PREFIX.length).toBe(ADVERTISED.authority_scope)
    expect(2000 - AUTHORITY_PREFIX.length).toBe(ADVERTISED.authority_basis)
    expect(2000 - STAMP_RESERVE).toBe(ADVERTISED.complete_limits)
    expect(4000 - STAMP_RESERVE).toBe(ADVERTISED.recovery_note)
  })

  test('role limit for nuance/macair with a 32-char harness', () => {
    expect(rolePrefix('nuance', 'macair', '0'.repeat(16), 'x'.repeat(32)).length).toBe(103)
    expect(roleLimit('nuance', 'macair')).toBe(97)
  })

  test('the reduced schemas advertise the limits and leave the input unchanged', () => {
    const s = reduceToolSchema(START, 'nuance', 'macair')
    expect(maxOf(s, 'actor')).toBe(64)
    expect(maxOf(s, 'role')).toBe(97)
    expect(maxOf(START, 'actor')).toBe(200)
    expect(maxOf(reduceToolSchema(REPORT, 'nuance', 'macair'), 'authority_scope')).toBe(978)
    expect(maxOf(reduceToolSchema(REPORT, 'nuance', 'macair'), 'authority_basis')).toBe(1978)
    expect(maxOf(reduceToolSchema(COMPLETE, 'nuance', 'macair'), 'limits')).toBe(1744)
    expect(maxOf(reduceToolSchema(RECOVER, 'nuance', 'macair'), 'recovery_note')).toBe(3744)
    expect(maxOf(reduceToolSchema(RECOVER, 'nuance', 'macair'), 'blocker')).toBe(2000)
    expect(reduceToolSchema(NEXT, 'nuance', 'macair')).toEqual(NEXT)
  })

  test('a reduced field missing from the schema throws', () => {
    expect(() => reduceToolSchema(tool('collab_task_complete', { summary: str(4000) }), 'nuance', 'macair')).toThrow('has no limits property')
  })
})

describe('checkLengths', () => {
  const start = reduceToolSchema(START, 'nuance', 'macair')
  const report = reduceToolSchema(REPORT, 'nuance', 'macair')

  test('label 63, 64 pass and 65 fails, also when the 64th unit is half of an astral character', () => {
    expect(checkLengths(start, { actor: 'a'.repeat(63) })).toEqual({ ok: true })
    expect(checkLengths(start, { actor: 'a'.repeat(64) })).toEqual({ ok: true })
    expect(checkLengths(start, { actor: 'a'.repeat(65) })).toEqual({ ok: false, field: 'actor', max: 64, length: 65 })
    expect(checkLengths(start, { actor: 'a'.repeat(62) + '\u{1F600}' })).toEqual({ ok: true })
    expect(checkLengths(start, { actor: 'a'.repeat(63) + '\u{1F600}' })).toEqual({ ok: false, field: 'actor', max: 64, length: 65 })
    expect(checkLengths(start, { role: 'r'.repeat(97) })).toEqual({ ok: true })
    expect(checkLengths(start, { role: 'r'.repeat(98) })).toEqual({ ok: false, field: 'role', max: 97, length: 98 })
  })

  test('authority_scope and authority_basis at 977/978/979 and 1977/1978/1979', () => {
    for (const [field, max] of [['authority_scope', 978], ['authority_basis', 1978]] as const) {
      expect(checkLengths(report, { [field]: 'a'.repeat(max - 1) })).toEqual({ ok: true })
      expect(checkLengths(report, { [field]: 'a'.repeat(max) })).toEqual({ ok: true })
      expect(checkLengths(report, { [field]: 'a'.repeat(max + 1) })).toEqual({ ok: false, field, max, length: max + 1 })
    }
  })

  test('complete limits 1744 and recovery_note 3744 at the boundary', () => {
    const complete = reduceToolSchema(COMPLETE, 'nuance', 'macair')
    const recover = reduceToolSchema(RECOVER, 'nuance', 'macair')
    expect(checkLengths(complete, { limits: 'l'.repeat(1744) })).toEqual({ ok: true })
    expect(checkLengths(complete, { limits: 'l'.repeat(1743) + '\u{1F600}' })).toEqual({ ok: false, field: 'limits', max: 1744, length: 1745 })
    expect(checkLengths(recover, { recovery_note: 'n'.repeat(3744) })).toEqual({ ok: true })
    expect(checkLengths(recover, { recovery_note: 'n'.repeat(3745) })).toEqual({ ok: false, field: 'recovery_note', max: 3744, length: 3745 })
  })

  test('string-array items are checked', () => {
    expect(checkLengths(report, { evidence_refs: ['report:a', 'e'.repeat(2000)] })).toEqual({ ok: true })
    expect(checkLengths(report, { evidence_refs: ['report:a', 'e'.repeat(2001)] })).toEqual({ ok: false, field: 'evidence_refs[1]', max: 2000, length: 2001 })
  })

  test('nested schema fields are checked, and values the schema does not describe are not walked', () => {
    expect(checkLengths(NEXT, { known_cursor: { epoch_id: 'e', hash: 'h'.repeat(65) } })).toEqual({ ok: false, field: 'known_cursor.hash', max: 64, length: 65 })
    let deep: unknown = 'x'.repeat(100_000)
    for (let i = 0; i < 100_000; i++) deep = [deep]
    expect(checkLengths(NEXT, { workspace_id: 'ws_1', unknown_field: deep })).toEqual({ ok: true })
  })
})

describe('rates', () => {
  test('the rate constants are spec §6.6', () => {
    expect(RATES).toEqual({ mutationsPerS: 5, mutationBurst: 20, inflightPerLineage: 4, nextMinMs: 1000, journalVerifyMinMs: 60_000, lineagesPerDevice: 8, knocksMinMs: 1_000 })
  })

  test('20 mutations pass at once, the 21st is refused, one more after 200 ms', () => {
    let t = 1_000
    const bucket = new TokenBucket(RATES.mutationsPerS, RATES.mutationBurst, () => t)
    for (let i = 0; i < 20; i++) expect(bucket.take()).toBe(true)
    expect(bucket.take()).toBe(false)
    t += 199
    expect(bucket.take()).toBe(false)
    t += 1
    expect(bucket.take()).toBe(true)
    expect(bucket.take()).toBe(false)
    t += 60_000
    for (let i = 0; i < 20; i++) expect(bucket.take()).toBe(true)
    expect(bucket.take()).toBe(false)
  })

  test('collab_next is allowed once per second per lineage', () => {
    let t = 5_000
    const next = new MinInterval(RATES.nextMinMs, () => t)
    expect(next.allow('lin_a')).toBe(true)
    expect(next.allow('lin_b')).toBe(true)
    t += 999
    expect(next.allow('lin_a')).toBe(false)
    t += 1
    expect(next.allow('lin_a')).toBe(true)
    t += 500
    // The refusal at +999 did not move lin_a's window: 1500 ms after its first call, 500 after its second.
    expect(next.allow('lin_a')).toBe(false)
    expect(next.allow('lin_b')).toBe(true)
  })

  test('journal_verify once a minute per lineage', () => {
    let t = 0
    const verify = new MinInterval(RATES.journalVerifyMinMs, () => t)
    expect(verify.allow('lin_a')).toBe(true)
    t = 59_999
    expect(verify.allow('lin_a')).toBe(false)
    t = 60_000
    expect(verify.allow('lin_a')).toBe(true)
  })
})
