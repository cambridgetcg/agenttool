import { afterEach, describe, expect, test } from 'bun:test'
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { LINEAGES_FORMAT, LineageStore, type LineageEntry } from '../src/air/lineages.ts'
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

  // The validator contract that Tasks 40a, 40b and 49-54 rely on (spec §6.2, §4.3): each row breaks exactly one rule of a
  // valid entry. `why` is the end of the message that rule gives, so a row cannot pass by failing some other rule.
  const marker = (over: Record<string, unknown> = {}) =>
    ({ nonce: '0123456789abcdef', call_ref: `${lin('a')}:0000abcd:1`, child_pid: 4242, child_lstart: null, workspace_id: 'ws_1', at: '2026-10-13T12:00:00.000Z', ...over })
  const LIVE = { state: 'live', session_id: 'session_1', credential_path: '/x/collab-sessions/session_1.json', workspace_id: 'ws_1' }
  /** A valid entry as a plain record, so a row can break it in ways LineageEntry forbids. */
  const rec = (over: Record<string, unknown> = {}): Record<string, unknown> => ({ ...entry(), ...over })

  function badRows(): { name: string; why: string; bad: unknown }[] {
    const rows: { name: string; why: string; bad: unknown }[] = []
    const add = (name: string, why: string, bad: unknown) => rows.push({ name, why, bad })
    const field = (key: string, why: string, ...values: unknown[]) => { for (const v of values) add(`${key} = ${JSON.stringify(v)}`, why, rec({ [key]: v })) }
    const KNOWN = 'exactly the known keys'
    add('null', KNOWN, null)
    add('an array', KNOWN, [])
    add('a 16th key', KNOWN, rec({ extra: 1 }))
    for (const k of Object.keys(entry())) { const e = rec(); delete e[k]; add(`key ${k} missing`, KNOWN, e) }
    { const e = rec(); delete e.mirror_id; e.mirror = '0123456789abcdef'; add('a key renamed (still 15 keys)', KNOWN, e) }
    field('lineage', 'a lineage id is malformed', 'lin_short', `lin_${'A'.repeat(32)}`, `lin_${'a'.repeat(33)}`, 7)
    field('device', ': device', 'Nuance', 'a/b', '', 'd'.repeat(33), 'a.b', 'a_b', 7)
    field('user', ': user', 'Macair', 'a/b', '', 'u'.repeat(33), 'a b', 7)
    field('harness', ': harness', '', 'a b', 'a/b', 'h'.repeat(33), 7)
    field('folder', ': folder', 'relative/dir', '', '~/x', '/' + 'a'.repeat(1019), '/' + 'é'.repeat(510), 7) // 1020 bytes; 1021 bytes in 511 characters
    field('state', ': state', 'bogus', 'LIVE', '', null)
    for (const [state, over, name] of [
      ['pending', { session_id: 'session_1' }, 'a pending entry with a session_id'],
      ['pending', { credential_path: '/c.json' }, 'a pending entry with a credential_path'],
      ['ended', { session_id: 'session_1', credential_path: '/c.json' }, 'an ended entry with a session'],
      ['retired', { session_id: 'session_1', credential_path: '/c.json' }, 'a retired entry with a session'],
      ['live', { ...LIVE, credential_path: null }, 'a live entry without a credential_path'],
      ['live', { ...LIVE, session_id: null }, 'a live entry without a session_id'],
    ] as const) add(name, 'exactly when live', rec({ state, ...over }))
    add('a live entry without a workspace_id', 'a live lineage has a workspace_id', rec({ ...LIVE, workspace_id: null }))
    for (const v of ['bad id', '', '/x', '-x', 'a'.repeat(201), 7]) add(`a live session_id = ${JSON.stringify(v)}`, ': session_id', rec({ ...LIVE, session_id: v }))
    for (const v of ['c.json', '', 7]) add(`a live credential_path = ${JSON.stringify(v)}`, ': credential_path', rec({ ...LIVE, credential_path: v }))
    field('past_sessions', ': past_sessions', 'session_1', null, ['bad id'], [''], [7], ['session_1', null])
    field('mirror_id', ': mirror_id', '0123456789abcde', '0123456789abcdef0', '0123456789ABCDEF', 'g'.repeat(16), '', 7)
    field('workspace_id', ': workspace_id', 'bad id', '', 7)
    field('pending_start', ': pending_start', 'x', 7, [])
    for (const k of ['nonce', 'call_ref', 'child_pid', 'child_lstart', 'workspace_id', 'at']) { const m = marker(); delete (m as Record<string, unknown>)[k]; add(`marker key ${k} missing`, ': pending_start', rec({ pending_start: m })) }
    add('a 7th marker key', ': pending_start', rec({ pending_start: marker({ extra: 1 }) }))
    { const m = marker(); delete (m as Record<string, unknown>).at; add('a marker key renamed (still 6 keys)', ': pending_start', rec({ pending_start: { ...m, when: '2026-10-13T12:00:00.000Z' } })) }
    const inMarker = (key: string, why: string, ...values: unknown[]) => { for (const v of values) add(`marker ${key} = ${JSON.stringify(v)}`, why, rec({ pending_start: marker({ [key]: v }) })) }
    inMarker('nonce', ': pending_start.nonce', '0123456789abcde', '0123456789abcdef0', '0123456789ABCDEF', '', 7)
    inMarker('call_ref', ': pending_start.call_ref', `${lin('b')}:0000abcd:1`, `${lin('a')}:0000abcd`, `${lin('a')}:0000ABCD:1`, '', 7)
    inMarker('child_pid', ': pending_start.child_pid', 0, -1, 1.5, '4242', null)
    inMarker('child_lstart', ': pending_start.child_lstart', 7, {})
    inMarker('workspace_id', ': pending_start.workspace_id', '', 'bad id', null, 7)
    inMarker('at', ': pending_start.at', 'not a date', '', null, 7)
    field('parked', ': parked', 'oops', 7, [], {}, { cause: 'x' }, { details: {} }, { cause: 7, details: {} }, { cause: 'x', details: [] }, { cause: 'x', details: null }, { cause: 'x', details: {}, extra: 1 })
    field('detached_since', ': detached_since', 'not a date', '', 7)
    field('created_at', ': created_at', 'not a date', '', null, 7)
    return rows
  }

  /** Entries the validator must accept, each at the edge of a rule the rows above break. */
  function goodRows(): [string, LineageEntry][] {
    const ok = (over: Record<string, unknown>) => rec(over) as unknown as LineageEntry
    return [
      ['a folder of 1019 bytes', ok({ folder: '/' + 'a'.repeat(1018) })],
      ['a folder of 1019 bytes in 510 characters', ok({ folder: '/' + 'é'.repeat(509) })],
      ['the longest device and user', ok({ device: 'd'.repeat(32), user: 'u.s_e-r'.repeat(4).slice(0, 32) })],
      ['a harness with dots and capitals', ok({ harness: 'Claude.Code_1-x' })],
      ['a live entry', ok(LIVE)],
      ['an ended entry with past sessions', ok({ state: 'ended', past_sessions: ['session_1', 'a:b.c-d_e'] })],
      ['a marker', ok({ pending_start: marker() })],
      ['a marker with a child_lstart', ok({ pending_start: marker({ child_lstart: 'Tue Oct 13 12:00:00 2026' }) })],
      ['a marker with the largest seq', ok({ pending_start: marker({ call_ref: `${lin('a')}:ffffffff:${'9'.repeat(16)}`, child_pid: 1 }) })],
      ['a parked entry', ok({ parked: { cause: 'start_failed', details: { n: 1, list: [1, 'a', null], nested: { ok: true } } } })],
      ['a detached entry', ok({ state: 'retired', detached_since: '2026-10-01T00:00:00.000Z' })],
    ]
  }

  test('every rule of the validator refuses an upsert and leaves the file and the memory as they were', () => {
    expect(Object.keys(entry())).toHaveLength(15)
    const p = storePath()
    const s = new LineageStore(p)
    s.load()
    s.upsert(entry())
    s.upsert(entry({ lineage: lin('b'), ...LIVE } as Partial<LineageEntry>))
    const ids = [lin('a'), lin('b'), lin('c')]
    const snapshot = () => ({ all: s.all(), each: ids.map((i) => s.get(i)), file: readFileSync(p, 'utf8'), dir: readdirSync(join(p, '..')) })
    const before = snapshot()
    expect(before.all).toHaveLength(2)

    const rows = badRows()
    expect(rows.length).toBeGreaterThan(100)
    const failures: string[] = []
    for (const { name, why, bad } of rows) {
      let message = '(accepted)'
      try { s.upsert(bad as LineageEntry) } catch (e) { message = (e as Error).message }
      if (!message.startsWith('lineages: refused entry: ') || !message.endsWith(why)) failures.push(`${name}: ${message}`)
      if (JSON.stringify(snapshot()) !== JSON.stringify(before)) failures.push(`${name}: the store changed`)
    }
    expect(failures).toEqual([])
    expect(snapshot()).toEqual(before)

    // and the neighbours of every rule are accepted, written and read back
    for (const [name, good] of goodRows()) {
      expect([name, (() => { try { s.upsert(good); return 'accepted' } catch (err) { return (err as Error).message } })()]).toEqual([name, 'accepted'])
      expect([name, s.get(good.lineage)]).toEqual([name, good])
      const again = new LineageStore(p)
      again.load()
      expect([name, again.get(good.lineage)]).toEqual([name, good])
    }
  })

  test('the same entries written raw are rejected on load, and the good ones are read', () => {
    const p = storePath()
    mkdirSync(join(p, '..'), { recursive: true })
    const write = (entries: unknown[]) => writeFileSync(p, JSON.stringify({ format: LINEAGES_FORMAT, lineages: entries }))
    const failures: string[] = []
    for (const { name, why, bad } of badRows()) {
      write([bad])
      let message = '(accepted)'
      try { new LineageStore(p).load() } catch (e) { message = (e as Error).message }
      if (!message.startsWith('lineages.json is damaged: ') || !message.endsWith(why)) failures.push(`${name}: ${message}`)
    }
    expect(failures).toEqual([])
    // one bad entry among good ones refuses the whole file: the store never keeps half of it
    write([entry(), entry({ lineage: lin('b'), state: 'bogus' as never })])
    expect(() => new LineageStore(p).load()).toThrow(/^lineages\.json is damaged: .*: state$/)
    for (const [name, good] of goodRows()) {
      write([good])
      const again = new LineageStore(p)
      again.load()
      expect({ name, all: again.all() }).toEqual({ name, all: [good] })
    }
  })

  test('load reads only a missing file or a missing dir as an empty store', () => {
    const root = temp('cb-lineages-')
    const loadError = (path: string): Error | undefined => {
      try { new LineageStore(path).load() } catch (e) { return e as Error }
      return undefined
    }
    const code = (e: Error | undefined) => (e?.cause as NodeJS.ErrnoException | undefined)?.code

    // missing: an empty store, and nothing is created by looking
    const nowhere = join(root, 'nowhere', 'lineages.json')
    const none = new LineageStore(nowhere)
    none.load()
    expect(none.all()).toEqual([])
    mkdirSync(join(root, 'bare'))
    expect(loadError(join(root, 'bare', 'lineages.json'))).toBeUndefined()
    expect(existsSync(join(root, 'nowhere'))).toBe(false)

    // a directory where the file should be: EISDIR is a read error, not a parse error
    mkdirSync(join(root, 'isdir', 'lineages.json'), { recursive: true })
    const isDir = loadError(join(root, 'isdir', 'lineages.json'))
    expect(isDir?.message).toBe('lineages.json is damaged: cannot be read (EISDIR)')
    expect(code(isDir)).toBe('EISDIR')

    // a file where the state dir should be
    writeFileSync(join(root, 'afile'), 'x')
    const notDir = loadError(join(root, 'afile', 'lineages.json'))
    expect(notDir?.message).toBe('lineages.json is damaged: cannot be read (ENOTDIR)')
    expect(code(notDir)).toBe('ENOTDIR')

    // a dangling symlink reads as ENOENT too, but the file is there: it is not an empty store
    mkdirSync(join(root, 'dangling'))
    const link = join(root, 'dangling', 'lineages.json')
    const target = join(root, 'dangling', 'gone.json')
    symlinkSync(target, link)
    const dangling = loadError(link)
    expect(dangling?.message).toBe('lineages.json is damaged: cannot be read (dangling symlink)')
    expect(lstatSync(link).isSymbolicLink()).toBe(true)
    expect(existsSync(target)).toBe(false)

    // a state dir that lost its search permission: the store is there, so it is not empty
    if (process.getuid?.() !== 0) {
      const p = join(root, 'locked', 'lineages.json')
      const s = new LineageStore(p)
      s.load()
      s.upsert(entry({ ...LIVE } as Partial<LineageEntry>))
      const bytes = readFileSync(p, 'utf8')
      chmodSync(join(root, 'locked'), 0o000)
      let locked: Error | undefined
      try { locked = loadError(p) } finally { chmodSync(join(root, 'locked'), 0o700) } // so cleanupTmps can remove it
      expect(locked?.message).toBe('lineages.json is damaged: cannot be read (EACCES)')
      expect(code(locked)).toBe('EACCES')
      expect(readFileSync(p, 'utf8')).toBe(bytes)
    }

    // and a file that reads but does not parse is still a parse error
    writeFileSync(join(root, 'bare', 'lineages.json'), '{')
    expect(loadError(join(root, 'bare', 'lineages.json'))?.message).toBe('lineages.json is damaged: it does not parse')
  })
})
