import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { LineageStore, type LineageEntry } from '../src/air/lineages.ts'
import { cleanupTmps, temp } from './helpers.ts'

afterEach(cleanupTmps)

const lin = (c: string) => `lin_${c.repeat(32)}`

function entry(over: Partial<LineageEntry> = {}): LineageEntry {
  return {
    lineage: lin('a'), device: 'nuance', user: 'macair', harness: 'claude', folder: '/Users/macair/Projects/collab-trial',
    state: 'pending', session_id: null, credential_path: null, past_sessions: [], mirror_id: '0123456789abcdef',
    workspace_id: null, pending_start: null, parked: null, detached_since: null, created_at: '2026-10-13T12:00:00.000Z',
    ...over,
  }
}

/** The store's file under a fresh state dir that does not exist yet (the store makes it 0700). */
function storePath(): string {
  return join(temp('cb-lineages-'), 'state', 'lineages.json')
}

describe('LineageStore', () => {
  test('entries survive a reload', () => {
    const p = storePath()
    const s = new LineageStore(p)
    s.load()
    expect(s.all()).toEqual([])
    const live = entry({ state: 'live', session_id: 'session_1', credential_path: '/x/collab-sessions/session_1.json', workspace_id: 'ws_1' })
    s.upsert(live)
    s.upsert(entry({ lineage: lin('b') }))
    const again = new LineageStore(p)
    again.load()
    expect(again.get(lin('a'))).toEqual(live)
    expect(again.all().map((e) => e.lineage)).toEqual([lin('a'), lin('b')])
    expect(again.get(lin('c'))).toBeUndefined()
  })

  test('upsert is atomic and 0600', () => {
    const p = storePath()
    const s = new LineageStore(p)
    s.load()
    s.upsert(entry())
    s.upsert(entry({ state: 'live', session_id: 'session_2', credential_path: '/c.json', workspace_id: 'ws_2' }))
    expect(statSync(p).mode & 0o777).toBe(0o600)
    expect(statSync(join(p, '..')).mode & 0o777).toBe(0o700)
    expect(readdirSync(join(p, '..'))).toEqual(['lineages.json']) // no temp file left behind
    const file = JSON.parse(readFileSync(p, 'utf8'))
    expect(file.format).toBe('agenttool.collab-bridge-lineages/1')
    expect(file.lineages).toHaveLength(1)
    expect(file.lineages[0].session_id).toBe('session_2')
    // a refused entry leaves the file as it was
    expect(() => s.upsert(entry({ state: 'bogus' as never }))).toThrow('lineages')
    expect(JSON.parse(readFileSync(p, 'utf8'))).toEqual(file)
  })

  test('retired entries stay and stay in the session index', () => {
    const p = storePath()
    const s = new LineageStore(p)
    s.load()
    s.upsert(entry({ state: 'retired', past_sessions: ['session_old'], detached_since: '2026-10-01T00:00:00.000Z' }))
    s.upsert(entry({ lineage: lin('b'), state: 'live', session_id: 'session_new', credential_path: '/n.json', workspace_id: 'ws_1' }))
    s.upsert(entry({ lineage: lin('c'), device: 'zerone', user: 'yu', state: 'live', session_id: 'session_z', credential_path: '/z.json', workspace_id: 'ws_1' }))
    const again = new LineageStore(p)
    again.load()
    expect(again.get(lin('a'))?.state).toBe('retired')
    expect(again.sessionIndex()).toEqual(new Map([
      ['session_old', { device: 'nuance', user: 'macair' }],
      ['session_new', { device: 'nuance', user: 'macair' }],
      ['session_z', { device: 'zerone', user: 'yu' }],
    ]))
  })

  test('an ended lineage keeps its past sessions in the session index and its seat', () => {
    const s = new LineageStore(storePath())
    s.load()
    s.upsert(entry({ state: 'ended', past_sessions: ['session_1', 'session_2'] }))
    s.upsert(entry({ lineage: lin('b'), state: 'live', session_id: 'session_3', credential_path: '/3.json', workspace_id: 'ws_1', past_sessions: ['session_0'] }))
    s.upsert(entry({ lineage: lin('c'), user: 'guest', state: 'live', session_id: 'session_g', credential_path: '/g.json', workspace_id: 'ws_1' }))
    expect([...s.sessionIndex().keys()].sort()).toEqual(['session_0', 'session_1', 'session_2', 'session_3', 'session_g'])
    expect(s.sameSeat('nuance', 'macair')).toEqual(new Set(['session_0', 'session_1', 'session_2', 'session_3']))
    expect(s.sameSeat('nuance', 'guest')).toEqual(new Set(['session_g']))
    expect(s.sameSeat('zerone', 'macair')).toEqual(new Set())
  })

  test('a pending_start without a workspace_id is refused on load', () => {
    const p = storePath()
    const s = new LineageStore(p)
    s.load()
    const marker = { nonce: '0123456789abcdef', call_ref: `${lin('a')}:0000abcd:1`, child_pid: 4242, child_lstart: null, workspace_id: 'ws_1', at: '2026-10-13T12:00:00.000Z' }
    s.upsert(entry({ pending_start: marker }))
    const file = JSON.parse(readFileSync(p, 'utf8'))
    delete file.lineages[0].pending_start.workspace_id
    writeFileSync(p, JSON.stringify(file))
    expect(() => new LineageStore(p).load()).toThrow('lineages.json')
    file.lineages[0].pending_start.workspace_id = ''
    writeFileSync(p, JSON.stringify(file))
    expect(() => new LineageStore(p).load()).toThrow('lineages.json')
    expect(() => s.upsert(entry({ pending_start: { ...marker, workspace_id: '' } }))).toThrow('lineages')
  })

  test('a damaged file throws on load', () => {
    const p = storePath()
    const s = new LineageStore(p)
    s.load()
    s.upsert(entry())
    for (const bad of ['{', '[]', '{"format":"other","lineages":[]}', '{"format":"agenttool.collab-bridge-lineages/1"}',
      JSON.stringify({ format: 'agenttool.collab-bridge-lineages/1', lineages: [{ ...entry(), lineage: 'lin_short' }] }),
      JSON.stringify({ format: 'agenttool.collab-bridge-lineages/1', lineages: [entry(), entry()] })]) {
      writeFileSync(p, bad)
      expect(() => new LineageStore(p).load()).toThrow('lineages.json')
    }
    expect(existsSync(p)).toBe(true)
  })
})
