import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { CollabChild } from '../src/air/children.ts'
import { readDevice, writeDevice, type DeviceFile } from '../src/air/devices.ts'
import { DEFAULT_CAPS } from '../src/air/diff-check.ts'
import { LineageStore, type LineageEntry } from '../src/air/lineages.ts'
import { makeHostCli } from '../src/air/pool.ts'
import { rolePrefix } from '../src/air/stamp.ts'
import { archiveName, displayText, unpairDevice, withoutHostBlock, type UnpairDeps } from '../src/air/unpair.ts'
import { AIR_LEDGER_KEYS, appendLedger, readLedger, verifyLedger } from '../src/ledger.ts'
import { airPaths, type AirPaths } from '../src/paths.ts'
import { cleanupTmps, COLLAB_DIST, commitFiles, makeRepo, modeOf, PKG, repoGit, temp } from './helpers.ts'
import { collabHarness, startCollabSession } from './mcp-harness.ts'

afterEach(cleanupTmps)

const NOW = new Date('2026-10-13T12:00:00.000Z')
const MIRROR_ID = '0123456789abcdef'
const Z_MIRROR_ID = 'fedcba9876543210'
const WS = 'ws_' + 'a'.repeat(24)
const NUANCE_BLOCK = 'Host collab-nuance\n  HostName nuance.local\n  User macair\n  IdentityFile /Users/yuai/.ssh/collab-bridge/collab_nuance_ed25519\n\n'
const ZERONE_BLOCK = 'Host collab-zerone\n  HostName zerone.local\n  User macair\n  IdentityFile /Users/yuai/.ssh/collab-bridge/collab_zerone_ed25519\n'

type Session = Awaited<ReturnType<typeof startCollabSession>>

function device(paths: AirPaths, o: { device: string; airClone: string; mirrorId: string; worktreeId: string | null; workspaceId: string | null }): DeviceFile {
  return {
    v: 1, device: o.device, user: 'macair', state: 'paired', host_alias: `collab-${o.device}`, seat_public: 'a1'.repeat(32),
    bundle_build: 'abcdef01', key_expiry: '20270111', trailer: 'Co-Authored-By: The Fable of the Eternal Universe <Yu@Ai-love.cc>',
    git: { path: '/Library/Developer/CommandLineTools/usr/bin/git', version: '2.39.5', sha256: 'c'.repeat(64), guard: true, apple: true },
    summon: { key_sha256: 'd'.repeat(64), dropin_stat: '1234567 287 1760000000000 0 600' },
    shares: [{ remote_realpath: '/Users/macair/Projects/collab-trial', remote_gitdir: '/Users/macair/Projects/collab-trial/.git',
      air_clone: o.airClone, mirror_id: o.mirrorId, mirror_worktree_id: o.worktreeId, workspace_id: o.workspaceId, caps: DEFAULT_CAPS }],
    prepared_at: '2026-10-13T10:00:00.000Z', paired_at: '2026-10-13T11:00:00.000Z',
  }
}

function lineage(over: Partial<LineageEntry>): LineageEntry {
  return { lineage: 'lin_' + '1'.repeat(32), device: 'nuance', user: 'macair', harness: 'claude', folder: '/Users/macair/Projects/collab-trial',
    state: 'pending', session_id: null, credential_path: null, past_sessions: [], mirror_id: MIRROR_ID, workspace_id: null,
    pending_start: null, parked: null, detached_since: null, created_at: '2026-10-13T11:00:00.000Z', ...over }
}

/** The shared journal's current view of one workspace, through a fresh unbound child the hub's way. */
async function status(paths: AirPaths, home: string, ws: string): Promise<any> {
  const c = await CollabChild.start({ bun: process.execPath, dist: COLLAB_DIST, journal: paths.sharedJournal, home })
  if ('failed' in c) throw new Error(`Collab did not start: ${c.lastErrLine}`)
  try {
    const r = await c.call('collab_workspace_status', { workspace_id: ws })
    if (r.outcome !== 'ok') throw new Error('workspace_status failed')
    return r.result.structuredContent
  } finally {
    await c.stop()
  }
}

/** One call as a session, through the hub-way harness resumed from that session's own credential. */
async function asSession(home: string, journal: string, s: Session, calls: (call: (name: string, args: Record<string, unknown>) => Promise<any>) => Promise<void>): Promise<void> {
  const h = collabHarness({ journal, home, sessionFile: s.credentialFile })
  try {
    await h.initialize()
    await calls(async (name, args) => {
      const r = await h.callTool(name, args)
      if (r.isError) throw new Error(`${name} failed: ${r.content[0].text}`)
      return r.structuredContent
    })
  } finally {
    await h.close()
  }
}

/**
 * A shared journal as a Phase 1 Air would hold it: nuance's mirror (a linked worktree of the Air clone) with three remote
 * sessions (A holds a lineage and has a completed edit task pending review; B holds a lineage whose credential is gone; C
 * holds a live lease and is in no lineage, as after a lost session_start marker), an Air reviewer, an Air session that
 * wrote itself a remote-looking role, and zerone's own remote session; the device files, ssh config, keys and ledger of
 * both devices. Then `unpair nuance`, once.
 */
describe('unpair nuance against a real shared journal', () => {
  let root = ''
  let home = ''
  let paths: AirPaths
  let ws = ''
  let s: Record<'a' | 'b' | 'c' | 'air' | 'forger' | 'z', Session>
  let before: DeviceFile
  let code = -1
  const out: string[] = []
  const hostCalls: string[][] = []
  let tripwire = ''
  let makeDeps: (sink: string[], calls: string[][]) => UnpairDeps

  beforeAll(async () => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'cb-unpair-')))
    home = join(root, 'home')
    mkdirSync(home)
    paths = airPaths(home)
    mkdirSync(paths.sharedDir, { recursive: true, mode: 0o700 })
    const airClone = join(home, 'Projects', 'collab-trial')
    makeRepo(airClone)
    const mirror = paths.mirrorDir('nuance', 'macair', MIRROR_ID)
    const zMirror = paths.mirrorDir('zerone', 'macair', Z_MIRROR_ID)
    repoGit(airClone, ['worktree', 'add', '-q', '--detach', mirror, 'HEAD'])
    repoGit(airClone, ['worktree', 'add', '-q', '--detach', zMirror, 'HEAD'])
    const journal = paths.sharedJournal
    const start = (at: string, actor: string, role: string) => startCollabSession({ journal, home, root: at, actor, role })
    const remote = (dev: string, nonce: string, rest: string) => rolePrefix(dev, 'macair', nonce, 'claude') + rest
    s = {
      a: await start(mirror, 'nuance/macair · self-declared: claude A', remote('nuance', 'a'.repeat(16), 'worker')),
      b: await start(mirror, 'nuance/macair · self-declared: claude B', remote('nuance', 'b'.repeat(16), 'worker')),
      c: await start(mirror, 'nuance/macair · self-declared: claude C', remote('nuance', 'c'.repeat(16), 'worker')),
      air: await start(airClone, 'air reviewer', 'reviewer'),
      forger: await start(airClone, 'air session with a borrowed role', remote('nuance', 'f'.repeat(16), 'not remote at all')),
      z: await start(zMirror, 'zerone/macair · self-declared: claude Z', remote('zerone', 'e'.repeat(16), 'worker')),
    }
    ws = s.a.workspaceId
    // A completes an edit task in the mirror: its review is pending, and stays so.
    await asSession(home, journal, s.a, async (call) => {
      const created = await call('collab_task_create', { workspace_id: ws, idempotency_key: 'create-review', task_id: 't-review',
        title: 'Add notes/a.md \u202e', work_mode: 'edit', path_scopes: ['notes'], completion_policy: 'accepted' })
      const claimed = await call('collab_task_claim', { workspace_id: ws, task_id: 't-review', idempotency_key: 'claim-review', expected_version: created.task.version })
      commitFiles(mirror, { 'notes/a.md': 'a\n' }, 'notes: a')
      await call('collab_task_complete', { workspace_id: ws, task_id: 't-review', lease_id: claimed.task.lease_id, idempotency_key: 'complete-review',
        expected_version: claimed.task.version, summary: 'added notes/a.md' })
    })
    // C holds a live lease: --release-leases frees it.
    await asSession(home, journal, s.c, async (call) => {
      const created = await call('collab_task_create', { workspace_id: ws, idempotency_key: 'create-lease', task_id: 't-lease', title: 'Coordinate', work_mode: 'coordination' })
      await call('collab_task_claim', { workspace_id: ws, task_id: 't-lease', idempotency_key: 'claim-lease', expected_version: created.task.version })
    })
    before = device(paths, { device: 'nuance', airClone, mirrorId: MIRROR_ID, worktreeId: s.a.worktreeId, workspaceId: ws })
    writeDevice(paths.deviceFile('nuance'), before)
    writeDevice(paths.deviceFile('zerone'), device(paths, { device: 'zerone', airClone, mirrorId: Z_MIRROR_ID, worktreeId: s.z.worktreeId, workspaceId: ws }))
    const store = new LineageStore(paths.lineages)
    store.load()
    store.upsert(lineage({ lineage: 'lin_' + 'a'.repeat(32), state: 'live', session_id: s.a.sessionId, credential_path: s.a.credentialFile, workspace_id: ws }))
    store.upsert(lineage({ lineage: 'lin_' + 'b'.repeat(32), state: 'live', session_id: s.b.sessionId, credential_path: s.b.credentialFile, workspace_id: ws }))
    store.upsert(lineage({ lineage: 'lin_' + '9'.repeat(32), device: 'zerone', mirror_id: Z_MIRROR_ID, state: 'live', session_id: s.z.sessionId,
      credential_path: s.z.credentialFile, workspace_id: ws }))
    rmSync(s.b.credentialFile)
    mkdirSync(paths.sshDir, { recursive: true, mode: 0o700 })
    writeFileSync(paths.sshConfig, NUANCE_BLOCK + ZERONE_BLOCK, { mode: 0o600 })
    for (const dev of ['nuance', 'zerone']) {
      writeFileSync(paths.sshKey(dev), `private key of ${dev}\n`, { mode: 0o600 })
      writeFileSync(`${paths.sshKey(dev)}.pub`, `ssh-ed25519 AAAA ${dev} collab-air\n`, { mode: 0o600 })
    }
    appendLedger(paths.ledger, AIR_LEDGER_KEYS, { event: 'dial', device: 'nuance', outcome: 'ok' }, Date.parse('2026-10-13T11:00:00.000Z'))
    // A tripwire for ssh: the knob and the first PATH entry both name a stub that records any call in a fixed file.
    const trip = join(root, 'tripwire')
    mkdirSync(trip)
    tripwire = join(trip, 'calls')
    writeFileSync(join(trip, 'ssh'), `#!/bin/bash\nprintf '%s\\n' "$*" >> '${tripwire}'\nexit 255\n`)
    chmodSync(join(trip, 'ssh'), 0o755)
    const saved = { knob: process.env.COLLAB_BRIDGE_BIN_SSH, path: process.env.PATH }
    process.env.COLLAB_BRIDGE_BIN_SSH = join(trip, 'ssh')
    process.env.PATH = `${trip}:${saved.path}`
    const real = makeHostCli({ bun: process.execPath, dist: COLLAB_DIST, journal, home })
    makeDeps = (sink, calls) => ({
      paths, store: new LineageStore(paths.lineages),
      hostCli: async (args, timeoutMs) => { calls.push(args); return real(args, timeoutMs) },
      unboundChild: () => CollabChild.start({ bun: process.execPath, dist: COLLAB_DIST, journal, home }),
      out: (l) => { sink.push(l) }, now: () => NOW,
    })
    try {
      code = await unpairDevice('nuance', makeDeps(out, hostCalls))
    } finally {
      process.env.COLLAB_BRIDGE_BIN_SSH = saved.knob
      process.env.PATH = saved.path
    }
  }, 60_000)

  afterAll(() => { rmSync(root, { recursive: true, force: true }) })

  test('marks the device unpaired and drops its seat key', () => {
    expect(readDevice(paths.deviceFile('nuance'))).toEqual({ ...before, state: 'unpaired', seat_public: null })
    expect(readDevice(paths.deviceFile('zerone'))!.state).toBe('paired')
    expect(out[0]).toBe('1. nuance is marked unpaired on the Air and its seat key is dropped; a running hub closes its link and stops its children at its next reload.')
  })

  test('lists pending reviews without deciding them', async () => {
    expect(out).toContain('2. Pending reviews from nuance, left for an Air session (accept only while the mirror is still at the completed commit, else request_changes; unpair decides none):')
    expect(out).toContain(`   - t-review in ${ws}: Add notes/a.md ? (reported by ${s.a.sessionId})`)
    const after = await status(paths, home, ws)
    const review = after.pending_reviews.find((t: any) => t.id === 't-review')
    expect([review?.status, review?.review_status, review?.accepted_by_session_id]).toEqual(['completed', 'pending', null])
  }, 20_000)

  test('ends every remote session with --release-leases', async () => {
    const end = (cred: string) => ['end', '--session-file', cred, '--reason', 'device unpaired', '--release-leases', '--db', paths.sharedJournal]
    expect([...hostCalls].sort()).toEqual([end(s.a.credentialFile), end(s.c.credentialFile)].sort())
    expect(out).toContain('3. Ending nuance\'s remote sessions with --release-leases:')
    expect(out).toContain(`   - ended ${s.a.sessionId} (0 lease(s) released)`)
    expect(out).toContain(`   - ended ${s.c.sessionId} (1 lease(s) released)`)
    const after = await status(paths, home, ws)
    const active = after.active_sessions.map((x: any) => x.id)
    expect(active).not.toContain(s.a.sessionId)
    expect(active).not.toContain(s.c.sessionId)
    for (const kept of [s.air, s.forger, s.z]) expect(active).toContain(kept.sessionId)
    expect(after.active_claims.map((t: any) => t.id)).not.toContain('t-lease')
    // the Collab credential files of the ended sessions are gone, as Collab's end removes them (K23)
    expect(existsSync(s.a.credentialFile)).toBe(false)
    expect(existsSync(s.c.credentialFile)).toBe(false)
    // lineages.json is the running hub's to write: unpair leaves it exactly as it was
    const entries = new LineageStore(paths.lineages)
    entries.load()
    expect(entries.get('lin_' + 'a'.repeat(32))!.state).toBe('live')
  }, 20_000)

  test('reports a session with no credential file', async () => {
    expect(out).toContain(`   - ${s.b.sessionId}: no credential file (${s.b.credentialFile}); it cannot be ended from the Air, and its expired claims wait for recovery from an Air session`)
    expect(hostCalls.some((a) => a.includes(s.b.credentialFile))).toBe(false)
    expect((await status(paths, home, ws)).active_sessions.map((x: any) => x.id)).toContain(s.b.sessionId)
    expect(code).toBe(1)
    expect(out.at(-1)).toBe('✗ nuance is unpaired on the Air, with 1 item(s) above for Ai.')
  }, 20_000)

  test('leaves alone an Air session whose role only looks remote', () => {
    expect(out).toContain(`   - ${s.forger.sessionId} has a remote-looking role but is not in nuance's mirror; left alone`)
    expect(hostCalls.some((a) => a.some((x) => x.includes(s.forger.sessionId)))).toBe(false)
  })

  test('removes the Host block and the key, archives the ledger', () => {
    expect(readFileSync(paths.sshConfig, 'utf8')).toBe(ZERONE_BLOCK)
    expect(modeOf(paths.sshConfig)).toBe(0o600)
    expect(existsSync(paths.sshKey('nuance'))).toBe(false)
    expect(existsSync(`${paths.sshKey('nuance')}.pub`)).toBe(false)
    expect(existsSync(paths.sshKey('zerone'))).toBe(true)
    const archive = join(paths.stateDir, 'ledger.20261013T120000Z.jsonl')
    expect(out).toContain(`   - the hub ledger is archived as ${archive}`)
    expect(modeOf(archive)).toBe(0o600)
    expect(verifyLedger(archive).ok).toBe(true)
    const archived = readLedger(archive)
    expect(archived.map((e) => e.event)).toEqual(['dial', 'unpair_end', 'unpair_end', 'unpair_end', 'unpair'])
    expect(archived.at(-1)).toMatchObject({ event: 'unpair', device: 'nuance', user: 'macair', outcome: 'incomplete' })
    const fresh = readLedger(paths.ledger)
    expect(fresh.map((e) => [e.event, e.code])).toEqual([['ledger_archived', 'ledger.20261013T120000Z.jsonl']])
    expect(verifyLedger(paths.ledger).ok).toBe(true)
    // content-free: no title, path or credential reached either ledger
    for (const text of [readFileSync(archive, 'utf8'), readFileSync(paths.ledger, 'utf8')]) {
      expect(text).not.toContain('notes/a.md')
      expect(text).not.toContain('collab-sessions')
    }
  })

  test('never runs ssh', () => {
    expect(existsSync(tripwire)).toBe(false)
    expect(readFileSync(join(PKG, 'src', 'air', 'unpair.ts'), 'utf8')).not.toMatch(/systemBin|\/usr\/bin\/ssh|'ssh'/)
  })

  test('prints the incomplete-revocation line', () => {
    expect(out).toContain('5. Revocation is incomplete until the " collab-air" line is removed from ~/.ssh/authorized_keys on nuance '
      + "(there: sed -i '' '/ collab-air$/d' ~/.ssh/authorized_keys) or the key expires on 2027-01-11.")
    expect(out.indexOf(out.find((l) => l.startsWith('5. '))!)).toBeGreaterThan(out.indexOf(out.find((l) => l.startsWith('4. '))!))
  })

  test('a second run lists the ended session as already ended, calls no host end and keeps the one real item', async () => {
    const again: string[] = []
    const calls: string[][] = []
    expect(await unpairDevice('nuance', makeDeps(again, calls))).toBe(1)
    expect(calls).toEqual([])
    expect(again).toContain(`   - ${s.a.sessionId} had already ended (not active in ${ws}; its credential file is gone)`)
    expect(again.filter((l) => l.includes('no credential file'))).toEqual([
      `   - ${s.b.sessionId}: no credential file (${s.b.credentialFile}); it cannot be ended from the Air, and its expired claims wait for recovery from an Air session`])
    expect(again.at(-1)).toBe('✗ nuance is unpaired on the Air, with 1 item(s) above for Ai.')
    const ended = readLedger(join(paths.stateDir, 'ledger.20261013T120000Z-2.jsonl')).filter((e) => e.event === 'unpair_end')
    expect(Object.fromEntries(ended.map((e) => [e.session_id, e.outcome]))).toEqual({ [s.a.sessionId]: 'already_ended', [s.b.sessionId]: 'no_credential' })
  }, 30_000)
})

describe('unpair twice, the first run having ended every remote session', () => {
  test('the second run lists them as already ended, calls no host end and exits 0', async () => {
    const home = temp('cb-unpair-twice-')
    const paths = airPaths(home)
    mkdirSync(paths.sharedDir, { recursive: true, mode: 0o700 })
    const airClone = join(home, 'Projects', 'collab-trial')
    makeRepo(airClone)
    const mirror = paths.mirrorDir('nuance', 'macair', MIRROR_ID)
    repoGit(airClone, ['worktree', 'add', '-q', '--detach', mirror, 'HEAD'])
    const journal = paths.sharedJournal
    const start = (nonce: string) => startCollabSession({ journal, home, root: mirror, actor: `nuance/macair · self-declared: claude ${nonce[0]}`,
      role: rolePrefix('nuance', 'macair', nonce, 'claude') + 'worker' })
    const a = await start('a'.repeat(16))
    const c = await start('c'.repeat(16))
    writeDevice(paths.deviceFile('nuance'), device(paths, { device: 'nuance', airClone, mirrorId: MIRROR_ID, worktreeId: a.worktreeId, workspaceId: a.workspaceId }))
    const store = new LineageStore(paths.lineages)
    store.load()
    store.upsert(lineage({ lineage: 'lin_' + 'a'.repeat(32), state: 'live', session_id: a.sessionId, credential_path: a.credentialFile, workspace_id: a.workspaceId }))
    store.upsert(lineage({ lineage: 'lin_' + 'c'.repeat(32), state: 'live', session_id: c.sessionId, credential_path: c.credentialFile, workspace_id: a.workspaceId }))
    const real = makeHostCli({ bun: process.execPath, dist: COLLAB_DIST, journal, home })
    const run = async (out: string[], calls: string[][]) => unpairDevice('nuance', {
      paths, store: new LineageStore(paths.lineages), hostCli: async (args, t) => { calls.push(args); return real(args, t) },
      unboundChild: () => CollabChild.start({ bun: process.execPath, dist: COLLAB_DIST, journal, home }), out: (l) => { out.push(l) }, now: () => NOW,
    })
    const first: string[] = []
    const firstCalls: string[][] = []
    expect(await run(first, firstCalls)).toBe(0)
    expect(firstCalls).toHaveLength(2)
    const second: string[] = []
    const secondCalls: string[][] = []
    expect(await run(second, secondCalls)).toBe(0)
    expect(secondCalls).toEqual([])
    for (const x of [a, c]) expect(second).toContain(`   - ${x.sessionId} had already ended (not active in ${a.workspaceId}; its credential file is gone)`)
    expect(second.at(-1)).toBe('✓ nuance is unpaired on the Air.')
    const ended = readLedger(join(paths.stateDir, 'ledger.20261013T120000Z-2.jsonl')).filter((e) => e.event === 'unpair_end')
    expect(ended.map((e) => e.outcome)).toEqual(['already_ended', 'already_ended'])
    expect(readLedger(join(paths.stateDir, 'ledger.20261013T120000Z-2.jsonl')).at(-1)).toMatchObject({ event: 'unpair', outcome: 'ok' })
  }, 60_000)
})

/** A lineage session with a credential file, the shared journal replaced by a stub child, and a host CLI that records calls. */
function scene(sessions: string[]) {
  const home = temp('cb-unpair-fault-')
  const paths = airPaths(home)
  writeDevice(paths.deviceFile('nuance'), device(paths, { device: 'nuance', airClone: join(home, 'Projects', 'collab-trial'), mirrorId: MIRROR_ID, worktreeId: null, workspaceId: WS }))
  const store = new LineageStore(paths.lineages)
  store.load()
  sessions.forEach((id, i) => {
    mkdirSync(dirname(paths.credentialFile(id)), { recursive: true, mode: 0o700 })
    writeFileSync(paths.credentialFile(id), '{}\n', { mode: 0o600 })
    store.upsert(lineage({ lineage: 'lin_' + String(i + 1).repeat(32), state: 'live', session_id: id, credential_path: paths.credentialFile(id), workspace_id: WS }))
  })
  mkdirSync(paths.sshDir, { recursive: true, mode: 0o700 })
  writeFileSync(paths.sshConfig, NUANCE_BLOCK, { mode: 0o600 })
  writeFileSync(paths.sshKey('nuance'), 'private\n', { mode: 0o600 })
  writeFileSync(`${paths.sshKey('nuance')}.pub`, 'public\n', { mode: 0o600 })
  const out: string[] = []
  const calls: string[][] = []
  const deps = (over: Partial<UnpairDeps> = {}): UnpairDeps => ({
    paths, store: new LineageStore(paths.lineages), hostCli: async (args) => { calls.push(args); return hostReceipt(0, { status: 'ended', released: [] }) },
    unboundChild: async () => stubChild(view()), out: (l) => { out.push(l) }, now: () => NOW, ...over,
  })
  const archive = (n = 1) => join(paths.stateDir, n === 1 ? 'ledger.20261013T120000Z.jsonl' : `ledger.20261013T120000Z-${n}.jsonl`)
  return { paths, out, calls, deps, archive }
}

const hostReceipt = (code: number | null, body: unknown) => ({ code, stdout: body === null ? '' : JSON.stringify(body) + '\n', stderr: '' })
const view = (o: { expired_claims?: number; active?: string[] } = {}) => ({ pending_reviews: [], expired_claims: o.expired_claims ?? 0,
  active_sessions: (o.active ?? []).map((id) => ({ id, worktree_id: 'wt-other', role: 'reviewer' })) })
/** A stand-in for the unbound child: one workspace_status answer, or a throw; stop may throw too. */
const stubChild = (answer: Record<string, unknown> | 'error' | Error, stop?: Error): CollabChild => ({
  call: async () => {
    if (answer instanceof Error) throw answer
    if (answer === 'error') return { outcome: 'error', result: { content: [], structuredContent: { error: 'workspace_not_found' }, isError: true }, ms: 0, bytes: 0 }
    return { outcome: 'ok', result: { content: [], structuredContent: answer }, ms: 0, bytes: 0 }
  },
  stop: async () => { if (stop) throw stop },
}) as unknown as CollabChild
const unpairEnds = (path: string): unknown[][] => readLedger(path).filter((e) => e.event === 'unpair_end').map((e) => [e.session_id, e.outcome, e.code])

describe('unpair already-ended sessions (one lineage session, its credential file gone)', () => {
  test('not active in a workspace that was read and holds no expired claim: already ended, no item, exit 0', async () => {
    const f = scene(['sess-a'])
    rmSync(f.paths.credentialFile('sess-a'))
    expect(await unpairDevice('nuance', f.deps())).toBe(0)
    expect(f.calls).toEqual([])
    expect(f.out).toContain(`   - sess-a had already ended (not active in ${WS}; its credential file is gone)`)
    expect(f.out.some((l) => l.includes('no credential file'))).toBe(false)
    expect(f.out.at(-1)).toBe('✓ nuance is unpaired on the Air.')
    expect(unpairEnds(f.archive())).toEqual([['sess-a', 'already_ended', undefined]])
  }, 20_000)

  test('an expired claim in the workspace keeps the item', async () => {
    const f = scene(['sess-a'])
    rmSync(f.paths.credentialFile('sess-a'))
    expect(await unpairDevice('nuance', f.deps({ unboundChild: async () => stubChild(view({ expired_claims: 1 })) }))).toBe(1)
    expect(f.out.some((l) => l.startsWith('   - sess-a: no credential file'))).toBe(true)
    expect(unpairEnds(f.archive())).toEqual([['sess-a', 'no_credential', undefined]])
  })

  test('a workspace that could not be read keeps the item', async () => {
    const f = scene(['sess-a'])
    rmSync(f.paths.credentialFile('sess-a'))
    expect(await unpairDevice('nuance', f.deps({ unboundChild: async () => stubChild('error') }))).toBe(1)
    expect(f.out).toContain(`   workspace ${WS} could not be read (workspace_not_found)`)
    expect(unpairEnds(f.archive())).toEqual([['sess-a', 'no_credential', undefined]])
  })

  test('still active in the journal keeps the item', async () => {
    const f = scene(['sess-a'])
    rmSync(f.paths.credentialFile('sess-a'))
    expect(await unpairDevice('nuance', f.deps({ unboundChild: async () => stubChild(view({ active: ['sess-a'] })) }))).toBe(1)
    expect(unpairEnds(f.archive())).toEqual([['sess-a', 'no_credential', undefined]])
  })

  test('a credential file that is still there gets its host end, whatever the journal says', async () => {
    const f = scene(['sess-a'])
    expect(await unpairDevice('nuance', f.deps())).toBe(0)
    expect(f.calls).toHaveLength(1)
    expect(unpairEnds(f.archive())).toEqual([['sess-a', 'ended', undefined]])
  })
})

describe('unpair ledgers what it printed', () => {
  const cases: Array<{ name: string; reply: Awaited<ReturnType<UnpairDeps['hostCli']>>; line: string; outcome: string; code?: string; exit: number }> = [
    { name: 'exit 0 with status ended', reply: hostReceipt(0, { status: 'ended', released: ['t1'] }), line: '   - ended sess-a (1 lease(s) released)', outcome: 'ended', exit: 0 },
    { name: 'exit 0 with status already_ended', reply: hostReceipt(0, { status: 'already_ended' }), line: '   - sess-a had already ended', outcome: 'already_ended', exit: 0 },
    { name: 'a non-zero exit with status ended', reply: hostReceipt(1, { status: 'ended', released: [] }), line: '   - sess-a: the host end failed (exit 1); the session may still be active', outcome: 'failed', exit: 1 },
    { name: 'a non-zero exit with status already_ended', reply: hostReceipt(2, { status: 'already_ended' }), line: '   - sess-a: the host end failed (exit 2); the session may still be active', outcome: 'failed', exit: 1 },
    { name: 'a timeout', reply: { code: null, stdout: '', stderr: '', cause: 'timeout' }, line: '   - sess-a: the host end failed (timeout); the session may still be active', outcome: 'failed', exit: 1 },
    { name: 'an unknown status string', reply: hostReceipt(0, { status: 'sort_of_ended' }), line: '   - sess-a: the host end failed (exit 0); the session may still be active', outcome: 'failed', exit: 1 },
    { name: "the receipt's error string", reply: hostReceipt(1, { status: 'failed', error: 'session_not_found' }), line: '   - sess-a: the host end failed (session_not_found); the session may still be active', outcome: 'failed', code: 'session_not_found', exit: 1 },
  ]
  for (const c of cases) {
    test(`${c.name}: the printed line and the ledger outcome agree`, async () => {
      const f = scene(['sess-a'])
      expect(await unpairDevice('nuance', f.deps({ hostCli: async () => c.reply }))).toBe(c.exit)
      expect(f.out).toContain(c.line)
      expect(unpairEnds(f.archive())).toEqual([['sess-a', c.outcome, c.code]])
    }, 20_000)
  }
})

describe('unpair when a step throws', () => {
  const reach5 = (out: string[]) => expect(out.find((l) => l.startsWith('5. Revocation is incomplete'))).toBeDefined()

  test('a host end that throws becomes an item, is ledgered failed, and the later session is still ended', async () => {
    const f = scene(['sess-a', 'sess-b'])
    const hostCli: UnpairDeps['hostCli'] = async (args) => {
      f.calls.push(args)
      if (args.includes(f.paths.credentialFile('sess-a'))) throw new Error('boom\nsecond line')
      return hostReceipt(0, { status: 'ended', released: [] })
    }
    expect(await unpairDevice('nuance', f.deps({ hostCli }))).toBe(1)
    expect(f.out).toContain('   - sess-a: the host end failed (boom); the session may still be active')
    expect(f.out).toContain('   - ended sess-b (0 lease(s) released)')
    expect(f.out.some((l) => l.includes('second line'))).toBe(false)
    expect(unpairEnds(f.archive())).toEqual([['sess-a', 'failed', undefined], ['sess-b', 'ended', undefined]])
    expect(existsSync(f.paths.sshKey('nuance'))).toBe(false)
    expect(existsSync(f.paths.sshConfig)).toBe(false)
    reach5(f.out)
    expect(f.out.at(-1)).toBe('✗ nuance is unpaired on the Air, with 1 item(s) above for Ai.')
  }, 20_000)

  test('a journal child that cannot start, a status call that throws and a stop that throws are items, and the run goes on', async () => {
    const start = scene(['sess-a'])
    expect(await unpairDevice('nuance', start.deps({ unboundChild: async () => { throw new Error('spawn boom') } }))).toBe(1)
    expect(start.out).toContain('   Collab did not start on the shared journal (spawn boom): pending reviews and journal sessions were not read')
    expect(start.calls).toHaveLength(1)
    reach5(start.out)
    const call = scene(['sess-a'])
    expect(await unpairDevice('nuance', call.deps({ unboundChild: async () => stubChild(new Error('call boom'), new Error('stop boom')) }))).toBe(1)
    expect(call.out).toContain(`   workspace ${WS} could not be read (call boom)`)
    expect(call.out).toContain("   Collab's workspace reader could not be stopped (stop boom)")
    expect(call.calls).toHaveLength(1)
    expect(existsSync(call.paths.sshKey('nuance'))).toBe(false)
    reach5(call.out)
  }, 20_000)

  test('an ssh config and a key path that cannot be changed are items, the other files are still removed, step 5 is printed', async () => {
    const f = scene(['sess-a'])
    rmSync(f.paths.sshConfig)
    mkdirSync(f.paths.sshConfig)
    rmSync(f.paths.sshKey('nuance'))
    mkdirSync(f.paths.sshKey('nuance'))
    expect(await unpairDevice('nuance', f.deps())).toBe(1)
    expect(f.out.some((l) => l.startsWith(`   - ${f.paths.sshConfig} could not be read (`))).toBe(true)
    expect(f.out.some((l) => l.startsWith(`   - ${f.paths.sshKey('nuance')} could not be removed (`))).toBe(true)
    expect(existsSync(`${f.paths.sshKey('nuance')}.pub`)).toBe(false)
    expect(existsSync(f.archive())).toBe(true)
    reach5(f.out)
    expect(f.out.at(-1)).toBe('✗ nuance is unpaired on the Air, with 2 item(s) above for Ai.')
  }, 20_000)

  test('a state directory that cannot be written: each ledger write and the archive are items, the files are still removed, step 5 is printed', async () => {
    const f = scene(['sess-a'])
    chmodSync(f.paths.stateDir, 0o500)
    try {
      expect(await unpairDevice('nuance', f.deps())).toBe(1)
    } finally {
      chmodSync(f.paths.stateDir, 0o700)
    }
    expect(f.out.some((l) => l.startsWith('   - the unpair_end ledger entry could not be written ('))).toBe(true)
    expect(f.out.some((l) => l.startsWith('   - the unpair ledger entry could not be written ('))).toBe(true)
    expect(f.out.some((l) => l.startsWith('   - the hub ledger could not be archived ('))).toBe(true)
    expect(existsSync(f.paths.sshKey('nuance'))).toBe(false)
    expect(existsSync(f.paths.sshConfig)).toBe(false)
    reach5(f.out)
    expect(f.out.at(-1)).toMatch(/^✗ nuance is unpaired on the Air, with \d+ item\(s\) above for Ai\.$/)
  }, 20_000)
})

describe('unpair with nothing but the device file', () => {
  const lone = (home: string, out: string[]): UnpairDeps => ({
    paths: airPaths(home), store: new LineageStore(airPaths(home).lineages),
    hostCli: async () => { throw new Error('no session is known, so no host end may run') },
    unboundChild: async () => { throw new Error('no workspace is known, so no child may start') },
    out: (l) => { out.push(l) }, now: () => NOW,
  })

  test('with the hub never run and Nuance away, it still unpairs, ends nothing and exits 0', async () => {
    const home = temp('cb-unpair-lone-')
    const paths = airPaths(home)
    writeDevice(paths.deviceFile('nuance'), device(paths, { device: 'nuance', airClone: join(home, 'Projects', 'collab-trial'), mirrorId: MIRROR_ID, worktreeId: null, workspaceId: null }))
    const out: string[] = []
    expect(await unpairDevice('nuance', lone(home, out))).toBe(0)
    expect(readDevice(paths.deviceFile('nuance'))!.state).toBe('unpaired')
    expect(out).toContain('2. No workspace is recorded for nuance, so there is no pending review to list.')
    expect(out).toContain('3. No remote session of nuance is active.')
    expect(out.at(-1)).toBe('✓ nuance is unpaired on the Air.')
    expect(readdirSync(paths.stateDir).filter((n) => n.startsWith('ledger.2'))).toEqual(['ledger.20261013T120000Z.jsonl'])
  })

  test('a missing device file changes nothing and exits 1', async () => {
    const home = temp('cb-unpair-none-')
    const out: string[] = []
    expect(await unpairDevice('nuance', lone(home, out))).toBe(1)
    expect(out).toEqual([`✗ nuance: no device file at ${airPaths(home).deviceFile('nuance')}; nothing was changed`])
    expect(existsSync(airPaths(home).stateDir)).toBe(false)
    expect(await unpairDevice('../nuance', lone(home, out))).toBe(1)
  })

  test('the helpers: Host blocks, archive names, terminal-safe titles', () => {
    expect(withoutHostBlock(NUANCE_BLOCK + ZERONE_BLOCK, 'collab-nuance')).toEqual({ text: ZERONE_BLOCK, removed: true })
    expect(withoutHostBlock(ZERONE_BLOCK, 'collab-nuance')).toEqual({ text: ZERONE_BLOCK, removed: false })
    expect(withoutHostBlock('Host collab-nuance collab-other\n  User x\n', 'collab-nuance').removed).toBe(false)
    const taken = new Set(['/s/ledger.20261013T120000Z.jsonl'])
    expect(archiveName('/s', NOW, (p) => taken.has(p))).toBe('/s/ledger.20261013T120000Z-2.jsonl')
    expect(displayText('ok \u001b[31mred\u202e\u2028')).toBe('ok ?[31mred??')
    expect(displayText('x'.repeat(130))).toBe('x'.repeat(120) + '…')
  })
})
