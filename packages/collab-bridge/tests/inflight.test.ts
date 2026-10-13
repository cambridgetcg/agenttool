import { afterEach, describe, expect, test } from 'bun:test'
import { cleanupTmps, temp } from './helpers.ts'
import { nuancePaths, type NuancePaths } from '../src/paths.ts'
import { openLineage, type HostInfo } from '../src/nuance/lineage.ts'
import { addInflight, argsHash, clearByIdempotencyKey, clearByTool, clearInflight, isStale, MAX_INFLIGHT, priorConflict, unresolved, type InflightRecord } from '../src/nuance/inflight.ts'
import { readLineageFile, writeLineageFile } from '../src/nuance/lineage.ts'

afterEach(cleanupTmps)

const NOW = () => new Date('2026-10-13T12:00:00.000Z')
const HOST: HostInfo = { pid: 4100, lstart: 'Wed Oct 7 16:22:59 2026', comm: 'claude' }

function fresh(): { paths: NuancePaths; key: string; lineage: string } {
  const paths = nuancePaths(temp('cb-inf-'))
  const { key, file } = openLineage(paths, HOST, NOW)
  return { paths, key, lineage: file.lineage }
}

function rec(lineage: string, n: number, o: Partial<InflightRecord> = {}): InflightRecord {
  return { call_ref: `${lineage}:0000000a:${n}`, tool: 'collab_report_append', idempotency_key: `k${n}`,
    args_hash: argsHash({ workspace_id: 'ws_x', kind: 'observation', body: `note ${n}` }), at: '2026-10-13T12:00:00.000Z', session_id: 'ses_1', ...o }
}

describe('in-flight records', () => {
  test('records survive a new pipe instance', () => {
    const { paths, key, lineage } = fresh()
    expect(addInflight(paths, key, rec(lineage, 1))).toBe(true)
    expect(addInflight(paths, key, rec(lineage, 2))).toBe(true)
    // The next pipe of the same Claude reopens the lineage and finds both, oldest first.
    const again = openLineage(paths, HOST, NOW)
    expect(again.key).toBe(key)
    expect(again.file.lineage).toBe(lineage)
    expect(again.file.inflight).toEqual([rec(lineage, 1), rec(lineage, 2)])
    expect(unresolved(paths, key)).toEqual([rec(lineage, 1), rec(lineage, 2)])
  })

  test('a same-key result clears the record', () => {
    const { paths, key, lineage } = fresh()
    addInflight(paths, key, rec(lineage, 1))
    addInflight(paths, key, rec(lineage, 2))
    addInflight(paths, key, rec(lineage, 3, { idempotency_key: 'k1' })) // a replay of call 1 under its own key
    clearInflight(paths, key, rec(lineage, 2).call_ref)
    expect(unresolved(paths, key).map((r) => r.call_ref)).toEqual([rec(lineage, 1).call_ref, rec(lineage, 3).call_ref])
    clearInflight(paths, key, `${lineage}:0000000a:99`) // unknown: nothing changes
    expect(unresolved(paths, key)).toHaveLength(2)
    clearByIdempotencyKey(paths, key, 'k1', 'ses_1')
    expect(unresolved(paths, key)).toEqual([])
  })

  test("a same-key answer clears only its own session's records (P66)", () => {
    const { paths, key, lineage } = fresh()
    addInflight(paths, key, rec(lineage, 1))                             // k1 under ses_1
    addInflight(paths, key, rec(lineage, 2, { idempotency_key: 'k1', session_id: 'ses_2' }))
    addInflight(paths, key, rec(lineage, 3, { idempotency_key: 'k1', session_id: null }))
    clearByIdempotencyKey(paths, key, 'k1', null)                        // no session known: nothing is settled
    expect(unresolved(paths, key)).toHaveLength(3)
    clearByIdempotencyKey(paths, key, 'k1', 'ses_2')
    expect(unresolved(paths, key).map((r) => r.call_ref)).toEqual([rec(lineage, 1).call_ref, rec(lineage, 3).call_ref])
  })

  test("clearByTool clears only that tool's records (P65)", () => {
    const { paths, key, lineage } = fresh()
    addInflight(paths, key, rec(lineage, 1, { tool: 'collab_session_start', idempotency_key: null }))
    addInflight(paths, key, rec(lineage, 2))
    addInflight(paths, key, rec(lineage, 3, { tool: 'collab_session_start', idempotency_key: null }))
    clearByTool(paths, key, 'collab_session_start')
    expect(unresolved(paths, key)).toEqual([rec(lineage, 2)])
    clearByTool(paths, key, 'collab_cursor_ack')                          // none: nothing changes
    expect(unresolved(paths, key)).toEqual([rec(lineage, 2)])
  })

  test('session_id survives the file, and a record with a malformed one is dropped', () => {
    const { paths, key, lineage } = fresh()
    addInflight(paths, key, rec(lineage, 1))
    addInflight(paths, key, rec(lineage, 2, { session_id: null }))
    expect(unresolved(paths, key).map((r) => r.session_id)).toEqual(['ses_1', null])
    const file = readLineageFile(paths, key)!
    writeLineageFile(paths, key, { ...file, inflight: [...file.inflight, { ...rec(lineage, 3), session_id: 'ses 3' }, { ...rec(lineage, 4), session_id: undefined as unknown as null }] })
    expect(unresolved(paths, key).map((r) => r.call_ref)).toEqual([rec(lineage, 1).call_ref, rec(lineage, 2).call_ref])
  })

  test('argsHash ignores the idempotency key and key order', () => {
    const a = argsHash({ workspace_id: 'ws_x', idempotency_key: 'k-old', kind: 'proposal', body: 'ship the notes' })
    expect(argsHash({ body: 'ship the notes', kind: 'proposal', workspace_id: 'ws_x', idempotency_key: 'k-new' })).toBe(a)
    expect(argsHash({ workspace_id: 'ws_x', kind: 'proposal', body: 'ship the notes' })).toBe(a)
    expect(argsHash({ workspace_id: 'ws_x', kind: 'proposal', body: 'ship the notes now' })).not.toBe(a)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })

  test('a reworded body is not a conflict, a key change alone is', () => {
    const { lineage } = fresh()
    const args = { workspace_id: 'ws_x', idempotency_key: 'k-old', kind: 'proposal', body: 'ship the notes' }
    const r: InflightRecord = { call_ref: `${lineage}:0000000a:7`, tool: 'collab_report_append', idempotency_key: 'k-old',
      args_hash: argsHash(args), at: '2026-10-13T12:00:00.000Z', session_id: 'ses_1' }
    expect(priorConflict([r], 'collab_report_append', { ...args, idempotency_key: 'k-new' }, 'ses_1')).toEqual(r)
    expect(priorConflict([r], 'collab_report_append', { body: 'ship the notes', kind: 'proposal', idempotency_key: 'k-new', workspace_id: 'ws_x' }, 'ses_1')).toEqual(r)
    expect(priorConflict([r], 'collab_report_append', args, 'ses_1')).toBeNull() // the same key is a replay, which Collab settles
    expect(priorConflict([r], 'collab_report_append', { ...args, idempotency_key: 'k-new', body: 'ship the notes now' }, 'ses_1')).toBeNull()
    expect(priorConflict([r], 'collab_task_progress', { ...args, idempotency_key: 'k-new' }, 'ses_1')).toBeNull() // CAS-guarded tools are never checked
  })

  test("a record of another session conflicts even under the same key: that session's receipt is gone (P66)", () => {
    const { lineage } = fresh()
    const args = { workspace_id: 'ws_x', idempotency_key: 'k-old', kind: 'proposal', body: 'ship the notes' }
    const r: InflightRecord = { call_ref: `${lineage}:0000000a:8`, tool: 'collab_report_append', idempotency_key: 'k-old',
      args_hash: argsHash(args), at: '2026-10-13T12:00:00.000Z', session_id: 'ses_1' }
    expect(priorConflict([r], 'collab_report_append', args, 'ses_2')).toEqual(r)
    expect(priorConflict([r], 'collab_report_append', args, null)).toEqual(r)
    expect(priorConflict([{ ...r, session_id: null }], 'collab_report_append', args, 'ses_1')).toEqual({ ...r, session_id: null })
    expect(priorConflict([r], 'collab_report_append', { ...args, body: 'reworded' }, 'ses_2')).toBeNull()
    expect(priorConflict([r], 'collab_task_progress', args, 'ses_2')).toBeNull()
    expect([isStale(r, 'ses_1'), isStale(r, 'ses_2'), isStale(r, null), isStale({ ...r, session_id: null }, 'ses_1')]).toEqual([false, true, true, true])
  })

  test('task_create with its own task_id is never a conflict', () => {
    const { lineage } = fresh()
    const create = { workspace_id: 'ws_x', idempotency_key: 'c-old', title: 'notes' }
    const keyless: InflightRecord = { call_ref: `${lineage}:0000000a:1`, tool: 'collab_task_create', idempotency_key: 'c-old',
      args_hash: argsHash(create), at: '2026-10-13T12:00:00.000Z', session_id: 'ses_1' }
    expect(priorConflict([keyless], 'collab_task_create', { ...create, idempotency_key: 'c-new' }, 'ses_1')).toEqual(keyless)
    const own = { ...create, task_id: 't-notes-1' }
    const withId: InflightRecord = { ...keyless, args_hash: argsHash(own) }
    expect(priorConflict([withId], 'collab_task_create', { ...own, idempotency_key: 'c-new' }, 'ses_1')).toBeNull()
    expect(priorConflict([withId], 'collab_task_create', { ...own, idempotency_key: 'c-old' }, 'ses_2')).toBeNull() // task_exists guards it
  })

  test('the 65th unresolved call is refused', () => {
    const { paths, key, lineage } = fresh()
    expect(MAX_INFLIGHT).toBe(64)
    for (let i = 0; i < 64; i++) expect(addInflight(paths, key, rec(lineage, i))).toBe(true)
    expect(addInflight(paths, key, rec(lineage, 64))).toBe(false)
    expect(unresolved(paths, key)).toHaveLength(64)
    clearInflight(paths, key, rec(lineage, 0).call_ref)
    expect(addInflight(paths, key, rec(lineage, 64))).toBe(true)
  })

  test('a lineage file that is gone is refused, never recreated', () => {
    const paths = nuancePaths(temp('cb-inf-'))
    expect(unresolved(paths, 'a'.repeat(32))).toEqual([])
    expect(() => addInflight(paths, 'a'.repeat(32), rec('lin_' + '0'.repeat(32), 1))).toThrow('missing or damaged')
  })
})
