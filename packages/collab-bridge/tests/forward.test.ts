import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CallRegistry } from '../src/air/calls.ts'
import { readDevice, updateDevice, writeDevice, type DeviceFile } from '../src/air/devices.ts'
import { DEFAULT_CAPS } from '../src/air/diff-check.ts'
import { Forwarder, type ForwardDeps } from '../src/air/forward.ts'
import { airGit } from '../src/air/git.ts'
import { knockReportFor } from '../src/air/knocks.ts'
import { LineageStore, type LineageEntry } from '../src/air/lineages.ts'
import { createMirror, MirrorLock, mirrorIdOf, mirrorWorkspaceId, type MirrorDeps, type MirrorSpec } from '../src/air/mirror.ts'
import { seatTools } from '../src/air/policy-table.ts'
import { ChildPool, liveProcAlive, makeHostCli, type HostCli } from '../src/air/pool.ts'
import { roleNonce } from '../src/air/stamp.ts'
import type { SeatRef } from '../src/air/streams.ts'
import { MirrorRegistry } from '../src/air/sync-points.ts'
import { AIR_LEDGER_KEYS, appendLedger, readLedger, type LedgerEntry } from '../src/ledger.ts'
import { newLineage, type CallMsg, type Declared, type HubKnockReportMsg, type ResultMsg, type ToolDef } from '../src/link/messages.ts'
import { hasLazyFetchGuard, parseGitVersion, sha256File, type ResolvedGit } from '../src/nuance/git-resolve.ts'
import { renderInstalled, writeShares } from '../src/nuance/installed.ts'
import { airPaths, nuancePaths, type AirPaths } from '../src/paths.ts'
import { TIMING } from '../src/timing.ts'
import { fakeLog, writeFakeCollab, type FakeScript } from './fake-collab.ts'
import { gateFromSource, makeFakeSsh } from './fake-ssh.ts'
import { cleanupTmps, COLLAB_DIST, makeRepo, PKG, REAL_GIT, repoGit, temp, testEnv } from './helpers.ts'
import { collabHarness, type StdioHarness } from './mcp-harness.ts'

const pools: ChildPool[] = []
const harnesses: StdioHarness[] = []
afterEach(async () => {
  for (const h of harnesses.splice(0)) await h.close()
  for (const p of pools.splice(0)) await p.stopAll()
  cleanupTmps()
})

const T = 60_000 // real Collab children, git and the fake ssh with the source gate

async function until(cond: () => boolean, what: string, ms = 10_000): Promise<void> {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
    await Bun.sleep(10)
  }
}

/** Collab 0.5.0's tool list, as the hub's start probe reads it (Task 35's committed fixture). */
const COLLAB_TOOLS: ToolDef[] = JSON.parse(readFileSync(join(PKG, 'tests', 'fixtures', 'collab-tools-0.5.0.json'), 'utf8')).tools
const SEAT_TOOLS = seatTools(COLLAB_TOOLS, 'nuance', 'macair')

/** The Air's git as "Nuance's recorded git": its Cellar realpath, as `install check` records it (Task 20). */
const NUANCE_GIT: ResolvedGit = (() => {
  const path = realpathSync(REAL_GIT)
  const v = parseGitVersion(Bun.spawnSync([path, '--version'], { env: { PATH: '/usr/bin:/bin' } }).stdout.toString())!
  return { path, version: v.version, sha256: sha256File(path), guard: hasLazyFetchGuard(path), apple: v.apple }
})()

interface Clock { mono: number; now: number }
interface Seat { ref: SeatRef; seq: number }
interface World {
  air: string; paths: AirPaths; airClone: string; base: string; nuance: string; share: string
  spec: MirrorSpec; mirrorDeps: MirrorDeps; device: DeviceFile; workspaceId: string
  store: LineageStore; pool: ChildPool; mirrors: MirrorRegistry; fwd: Forwarder; deps: ForwardDeps; hostCli: HostCli
  clock: Clock; statuses: Array<[string, string | null]>; build: { changed: boolean }
  seat(): Seat
}

/**
 * The hub's half of one paired Nuance, in one process: an Air home with the trial clone and the shared journal; a
 * "Nuance" home whose ~/Projects/collab-trial is an edit share holding a clone of it, reached through the fake ssh and
 * the real gate from source; the mirror made as pin-device makes it (or left missing or unborn); the device file
 * paired; a real ChildPool on the tracked Collab dist; and the Forwarder wired as the hub wires it (Task 52).
 */
async function world(o: { mirror?: 'created' | 'missing' | 'unborn' } = {}): Promise<World> {
  const air = temp('cb-fwd-air-')
  const paths = airPaths(air)
  const airClone = join(air, 'Projects', 'collab-trial')
  const base = makeRepo(airClone)
  const nuance = temp('cb-fwd-nuance-')
  const share = join(nuance, 'Projects', 'collab-trial')
  mkdirSync(join(nuance, 'Projects'), { recursive: true })
  repoGit(join(nuance, 'Projects'), ['clone', '-q', airClone, 'collab-trial'])
  const np = nuancePaths(nuance)
  mkdirSync(np.share, { recursive: true, mode: 0o700 })
  writeFileSync(np.installed, renderInstalled({
    device: 'nuance', build: 'abcdef01', prepared: '20261013120000', expiry: '20270111', binary_sha256: 'a'.repeat(64),
    tools_seed: 'b'.repeat(64), git: NUANCE_GIT, summon_key_sha256: 'c'.repeat(64), summon_dropin_stat: '1 2 3 0 600',
    claude_version: '2.1.296 (Claude Code)', installed_at: '2026-10-13T12:00:00.000Z',
  }), { mode: 0o600 })
  writeShares(np, [{ realpath: share, gitdir: join(share, '.git') }])
  mkdirSync(join(nuance, '.config', 'summon'), { recursive: true })
  writeFileSync(np.summonAllowlist, [
    'version: 1', 'device: nuance', 'peers: [air]', 'runtimes:', '  - id: claude', '    models:', '      - model: sonnet',
    'folders:', '  - path: ~/Projects', '    access: review', '  - path: ~/Projects/collab-trial', '    access: edit',
    'limits:', '  max_concurrent: 1', '  starts_per_hour: 6', '  job_timeout_max: 30m', '',
  ].join('\n'))
  const fake = makeFakeSsh({ nuanceHome: nuance, target: gateFromSource(), env: testEnv(nuance) })
  const mirrorId = mirrorIdOf(share)
  const spec: MirrorSpec = {
    device: 'nuance', user: 'macair', mirrorId, mirrorPath: paths.mirrorDir('nuance', 'macair', mirrorId), airClone,
    remoteGitdir: join(share, '.git'), caps: DEFAULT_CAPS,
  }
  const ledger = (f: Parameters<typeof appendLedger>[2]) => { appendLedger(paths.ledger, AIR_LEDGER_KEYS, f) }
  const mirrorDeps: MirrorDeps = {
    git: airGit({ git: REAL_GIT, home: air }), sshBin: fake.bin, sshConfig: paths.sshConfig, alias: 'collab-nuance',
    freeBytes: () => 1e15, fetchedToday: () => 0, ledger,
  }
  const mode = o.mirror ?? 'created'
  if (mode === 'created') {
    const r = await createMirror(spec, mirrorDeps)
    if (!r.ok) throw new Error(`createMirror: ${r.code}: ${r.message}`)
  } else if (mode === 'unborn') {
    mkdirSync(spec.mirrorPath, { recursive: true })
    repoGit(spec.mirrorPath, ['init', '-q', '-b', 'main']) // a git dir with no commit: HEAD cannot be read (K17)
  }
  // P55: pin-device derives the workspace id by Collab's own rule; for a missing mirror any well-formed id will do.
  const workspaceId = (await mirrorWorkspaceId(spec, mirrorDeps)) ?? `ws_${'0'.repeat(24)}`
  const device: DeviceFile = {
    v: 1, device: 'nuance', user: 'macair', state: 'paired', host_alias: 'collab-nuance', seat_public: 'ab'.repeat(32),
    bundle_build: 'abcdef01', key_expiry: '20270111', trailer: 'Co-Authored-By: The Fable of the Eternal Universe <Yu@Ai-love.cc>',
    git: NUANCE_GIT, summon: { key_sha256: 'c'.repeat(64), dropin_stat: '1 2 3 0 600' },
    shares: [{ remote_realpath: share, remote_gitdir: join(share, '.git'), air_clone: airClone, mirror_id: mirrorId,
      mirror_worktree_id: null, workspace_id: workspaceId, caps: DEFAULT_CAPS }],
    prepared_at: '2026-10-13T12:00:00.000Z', paired_at: '2026-10-13T12:30:00.000Z',
  }
  writeDevice(paths.deviceFile('nuance'), device)
  const store = new LineageStore(paths.lineages)
  store.load()
  const clock: Clock = { mono: 1_000_000, now: Date.parse('2026-10-13T13:00:00.000Z') }
  const statuses: Array<[string, string | null]> = []
  const build = { changed: false }
  const hostCli = makeHostCli({ bun: process.execPath, dist: COLLAB_DIST, journal: paths.sharedJournal, home: air })
  const pool = new ChildPool({
    spec: { bun: process.execPath, dist: COLLAB_DIST, journal: paths.sharedJournal, home: air },
    store, paths, hostCli, mono: () => clock.mono, now: () => new Date(clock.now), ledger,
    procAlive: liveProcAlive('/bin/ps'), status: (l, n) => { statuses.push([l, n]) }, buildChanged: () => build.changed,
    childWindowMs: 1_000,
  })
  pools.push(pool)
  const mirrors = new MirrorRegistry()
  mirrors.set({ spec, lock: new MirrorLock(), worktreeId: null })
  const devices = new Map([['nuance', device]]) // the hub's in-memory view, reloaded on its own tick (Task 52)
  const deps: ForwardDeps = {
    pool, store, calls: new CallRegistry(), mirrors, mirrorDeps, devices: () => devices, devicePath: (d) => paths.deviceFile(d),
    seatTools: () => SEAT_TOOLS, journal: paths.sharedJournal, ledger, mono: () => clock.mono, now: () => new Date(clock.now),
    knock: (sid, ms) => knockReportFor(sid, ms, { hostCli, journal: paths.sharedJournal, index: () => store.sessionIndex() }),
  }
  const fwd = new Forwarder(deps)
  const w: World = {
    air, paths, airClone, base, nuance, share, spec, mirrorDeps, device, workspaceId, store, pool, mirrors, fwd, deps, hostCli,
    clock, statuses, build,
    seat() {
      // What a seat stream records at its first proven attach (Task 50).
      const lineage = newLineage()
      const e: LineageEntry = {
        lineage, device: 'nuance', user: 'macair', harness: 'claude', folder: share, state: 'pending', session_id: null,
        credential_path: null, past_sessions: [], mirror_id: mirrorId, workspace_id: null, pending_start: null, parked: null,
        detached_since: null, created_at: new Date(clock.now).toISOString(),
      }
      store.upsert(e)
      return { ref: { device: 'nuance', user: 'macair', lineage, harness: 'claude', entrypoint: 'cli', folder: share, stream: 1 }, seq: 0 }
    },
  }
  return w
}

interface CallOpts { declared?: Declared; callRef?: string; timeoutMs?: number }
const ref = (s: Seat) => `${s.ref.lineage}:0000abcd:${s.seq++}`
const msg = (s: Seat, name: string, args: Record<string, unknown>, o: CallOpts = {}): CallMsg =>
  ({ t: 'call', call_ref: o.callRef ?? ref(s), name, arguments: args, timeout_ms: o.timeoutMs ?? 60_000, ...(o.declared ? { declared: o.declared } : {}) })
async function call(w: World, s: Seat, name: string, args: Record<string, unknown> = {}, o: CallOpts = {}): Promise<ResultMsg> {
  const r = await w.fwd.call(s.ref, msg(s, name, args, o))
  if (r === 'close') throw new Error(`${name}: the stream was closed`)
  return r
}
const sc = (r: ResultMsg): Record<string, any> => (r.result?.structuredContent ?? {}) as Record<string, any>
const codeOf = (r: ResultMsg) => sc(r).error
async function start(w: World, s: Seat, args: Record<string, unknown> = { actor: 'claude (Nuance account)', role: 'implementer' }): Promise<ResultMsg> {
  const r = await call(w, s, 'collab_session_start', args)
  w.clock.mono += 1_000 // the next collab_next is never inside its 1 s window by accident
  return r
}
const lines = (w: World, event: string): LedgerEntry[] => readLedger(w.paths.ledger).filter((l) => l.event === event)

/** An Air Claude session in the trial clone on the shared journal, run the hub's way (§10.2 step 4). */
async function airSession(w: World): Promise<{ h: StdioHarness; sessionId: string }> {
  const h = collabHarness({ journal: w.paths.sharedJournal, home: w.air })
  harnesses.push(h)
  await h.initialize()
  const r = await h.callTool('collab_session_start', { root_path: w.airClone, actor: 'air reviewer' })
  if (r.isError) throw new Error(`air session_start: ${r.content[0].text}`)
  return { h, sessionId: r.structuredContent.session.id }
}

async function activeSessions(w: World): Promise<Array<{ id: string; role: string | null }>> {
  const h = collabHarness({ journal: w.paths.sharedJournal, home: w.air })
  try {
    await h.initialize()
    const r = await h.callTool('collab_workspace_status', { workspace_id: w.workspaceId })
    return r.isError ? [] : r.structuredContent.active_sessions
  } finally {
    await h.close()
  }
}

describe('session_start', () => {
  test('a call before session_start is session_required', async () => {
    const w = await world()
    const s = w.seat()
    const r = await call(w, s, 'collab_next', {})
    expect(r.outcome).toBe('error')
    expect(sc(r)).toMatchObject({ error: 'session_required', delivered: false, retry: 'never automatic' })
    expect(lines(w, 'child_start')).toEqual([])
    expect(lines(w, 'forward')).toEqual([])
  }, T)

  test('session_start binds to the mirror, stamps actor and role, and records the mirror worktree id', async () => {
    const w = await world()
    const s = w.seat()
    const r = await start(w, s, { actor: 'claude (Nuance account)', role: 'implementer', root_path: '/etc', repository_key: 'explicit:x' })
    expect(r.outcome).toBe('ok')
    const out = sc(r)
    expect(out.session.actor).toBe('nuance/macair · self-declared: claude (Nuance account)')
    expect(out.session.role).toMatch(/^remote\(nuance\/macair; start=[0-9a-f]{16}\) self-declared: harness=claude; implementer$/)
    expect(out.worktree.root_path).toBe(w.spec.mirrorPath) // root_path injected, the seat's own dropped (§6.3)
    expect(out.worktree.repository_key).toStartWith('local-git:') // no explicit repository_key reached Collab
    expect(out.workspace.id).toBe(w.workspaceId) // P55: pin-device's derived id is Collab's own
    expect(readDevice(w.paths.deviceFile('nuance'))!.shares[0]!.mirror_worktree_id).toBe(out.worktree.id)
    expect(w.mirrors.get('nuance', 'macair', w.spec.mirrorId)!.worktreeId).toBe(out.worktree.id)
    expect(w.store.get(s.ref.lineage)).toMatchObject({ state: 'live', session_id: out.session.id, workspace_id: w.workspaceId, pending_start: null })
  }, T)

  test('the pending_start nonce equals roleNonce of the stamped role', async () => {
    const w = await world()
    const s = w.seat()
    const seen: string[] = []
    const real = w.pool.startSession.bind(w.pool)
    w.pool.startSession = (lineage, args, callRef, nonce, workspaceId, notAfterMono) => {
      seen.push(nonce)
      return real(lineage, args, callRef, nonce, workspaceId, notAfterMono)
    }
    const r = await start(w, s)
    expect(r.outcome).toBe('ok')
    expect(seen.length).toBe(1)
    expect(roleNonce(sc(r).session.role, 'nuance', 'macair')).toBe(seen[0]!)
    const [only] = await activeSessions(w)
    expect(roleNonce(only!.role!, 'nuance', 'macair')).toBe(seen[0]!)
  }, T)

  test('the first claim after the first session_start is not mirror_busy', async () => {
    const w = await world()
    const s = w.seat()
    expect((await start(w, s)).outcome).toBe('ok')
    const created = await call(w, s, 'collab_task_create', { idempotency_key: 'c1', task_id: 't-notes-1', title: 'a note',
      path_scopes: ['notes'], work_mode: 'edit', completion_policy: 'accepted', expected_base_sha: w.base })
    expect(created.outcome).toBe('ok')
    const claimed = await call(w, s, 'collab_task_claim', { task_id: 't-notes-1', idempotency_key: 'k1', expected_version: sc(created).task.version },
      { declared: { head: w.base, branch: 'main', dirty: false } })
    expect(codeOf(claimed)).toBeUndefined()
    expect(claimed.outcome).toBe('ok')
    expect(sc(claimed).task.status).toBe('claimed')
  }, T)

  test('the recorded worktree id never overwrites an unpair written meanwhile', async () => {
    const w = await world()
    const s = w.seat()
    // `collab-bridge unpair` (another process) writes the file; the hub's in-memory view still says paired.
    updateDevice(w.paths.deviceFile('nuance'), (d) => ({ ...d, state: 'unpaired', seat_public: null }))
    const r = await start(w, s)
    expect(r.outcome).toBe('ok')
    const onDisk = readDevice(w.paths.deviceFile('nuance'))!
    expect(onDisk.state).toBe('unpaired')
    expect(onDisk.seat_public).toBeNull()
    expect(onDisk.shares[0]!.mirror_worktree_id).toBeNull()
    expect(lines(w, 'workspace_id')).toEqual([])
  }, T)

  test('a second session_start on a bound lineage, live and after the 10-minute window, answers session_already_bound and leaves exactly one session', async () => {
    const w = await world()
    const s = w.seat()
    const first = await start(w, s)
    expect(first.outcome).toBe('ok')
    const live = await start(w, s)
    expect(live.outcome).toBe('error')
    expect(codeOf(live)).toBe('session_already_bound')
    w.pool.detached(s.ref.lineage)
    w.clock.mono += 1_001 // past the (injected) child window
    await w.pool.tick()
    const resumed = await start(w, s)
    expect(codeOf(resumed)).toBe('session_already_bound')
    expect(lines(w, 'child_start').map((l) => l.code)).toEqual(['fresh', 'resume'])
    const active = (await activeSessions(w)).filter((x) => roleNonce(x.role ?? '', 'nuance', 'macair') !== null)
    expect(active.map((x) => x.id)).toEqual([sc(first).session.id])
  }, T)

  test('after session_end, a call is seat_session_ended and a new session_start starts a new session with a new nonce', async () => {
    const w = await world()
    const s = w.seat()
    const first = await start(w, s)
    const ended = await call(w, s, 'collab_session_end', { reason: 'done' })
    expect(ended.outcome).toBe('ok')
    expect(w.store.get(s.ref.lineage)!.state).toBe('ended')
    const after = await call(w, s, 'collab_next', {})
    expect(sc(after)).toMatchObject({ error: 'seat_session_ended', delivered: false })
    const second = await start(w, s)
    expect(second.outcome).toBe('ok')
    expect(sc(second).session.id).not.toBe(sc(first).session.id)
    expect(roleNonce(sc(second).session.role, 'nuance', 'macair')).not.toBe(roleNonce(sc(first).session.role, 'nuance', 'macair'))
    expect(w.store.get(s.ref.lineage)!.past_sessions).toEqual([sc(first).session.id])
  }, T)

  test('a session_start on a missing or unborn mirror is refused mirror_tampered and never reaches Collab', async () => {
    for (const mode of ['missing', 'unborn'] as const) {
      const w = await world({ mirror: mode })
      const s = w.seat()
      const r = await start(w, s)
      expect([mode, sc(r).error, sc(r).delivered]).toEqual([mode, 'mirror_tampered', false])
      expect(existsSync(w.paths.sharedJournal)).toBe(false) // no child ever opened the shared journal
      expect(lines(w, 'child_start')).toEqual([])
      expect(lines(w, 'forward')).toEqual([])
      expect(w.store.get(s.ref.lineage)!.state).toBe('pending')
    }
  }, T)
})

describe('at most once', () => {
  test('the child sees exactly one call per call_ref; a duplicate is duplicate_call_ref', async () => {
    const w = await world()
    const s = w.seat()
    await start(w, s)
    const callRef = ref(s)
    const args = { idempotency_key: 'k-once', kind: 'observation', body: 'sent once' }
    expect((await call(w, s, 'collab_report_append', args, { callRef })).outcome).toBe('ok')
    const again = await call(w, s, 'collab_report_append', args, { callRef })
    expect(again.outcome).toBe('error')
    expect(sc(again)).toMatchObject({ error: 'duplicate_call_ref', delivered: false, call_ref: callRef })
    const listed = await call(w, s, 'collab_report_list', {})
    expect(sc(listed).reports.filter((x: { body: string }) => x.body === 'sent once').length).toBe(1)
    expect(lines(w, 'forward').filter((l) => l.call_ref === callRef).length).toBe(1)
  }, T)

  test('another lineage\'s call_ref closes the stream', async () => {
    const w = await world()
    const s = w.seat()
    const r = await w.fwd.call(s.ref, { t: 'call', call_ref: `${newLineage()}:0000abcd:0`, name: 'collab_next', arguments: {}, timeout_ms: 60_000 })
    expect(r).toBe('close')
    expect(lines(w, 'forward')).toEqual([])
  }, T)

  test('a cancel is ledgered and never forwarded', async () => {
    const w = await world()
    const s = w.seat()
    await start(w, s)
    const m = msg(s, 'collab_report_append', { idempotency_key: 'k-cancel', kind: 'observation', body: 'not cancelled' })
    const pending = w.fwd.call(s.ref, m)
    w.fwd.cancel(s.ref, m.call_ref)
    const r = await pending
    expect(r !== 'close' && r.outcome).toBe('ok')
    expect(lines(w, 'cancel').map((l) => l.call_ref)).toEqual([m.call_ref])
    const listed = await call(w, s, 'collab_report_list', {})
    expect(sc(listed).reports.some((x: { body: string }) => x.body === 'not cancelled')).toBe(true)
  }, T)
})

describe('deadlines', () => {
  /**
   * A coordination task's claim (an edit flow with nothing to sync, Task 44's planClaim) sent with the 150 s claim timeout
   * while the test holds the mirror lock, as another lineage's capture would; the clock moves `waitedMs` before the lock frees.
   */
  async function heldClaim(w: World, s: Seat, waitedMs: number): Promise<{ r: ResultMsg; callRef: string }> {
    const created = await call(w, s, 'collab_task_create', { idempotency_key: 'c-held', task_id: 't-held', title: 'held', work_mode: 'coordination' })
    expect(created.outcome).toBe('ok')
    let release: (() => void) | undefined
    const held = w.mirrors.get('nuance', 'macair', w.spec.mirrorId)!.lock.run(() => new Promise<void>((r) => { release = r }))
    await until(() => release !== undefined, 'the test to hold the mirror lock')
    const m = msg(s, 'collab_task_claim', { task_id: 't-held', idempotency_key: 'k-held', expected_version: sc(created).task.version }, { timeoutMs: 150_000 })
    const pending = w.fwd.call(s.ref, m)
    w.clock.mono += waitedMs
    release!()
    await held
    const r = await pending
    if (r === 'close') throw new Error('collab_task_claim: the stream was closed')
    return { r, callRef: m.call_ref }
  }

  test('a claim held on the mirror lock until less than a second of its timeout remains is refused hub_away and never forwarded', async () => {
    const w = await world()
    const s = w.seat()
    await start(w, s)
    const { r, callRef } = await heldClaim(w, s, 149_500)
    expect(r.outcome).toBe('error')
    expect(sc(r)).toMatchObject({ error: 'hub_away', delivered: false, reason: 'deadline_passed' })
    expect(lines(w, 'forward').filter((l) => l.call_ref === callRef)).toEqual([])
    expect(lines(w, 'result').filter((l) => l.call_ref === callRef).map((l) => [l.outcome, l.code])).toEqual([['refused', 'deadline_passed']])
    // What the agent's own read then shows agrees: the claim was not applied (§9.3 item 5).
    expect(sc(await call(w, s, 'collab_task_get', { task_id: 't-held' })).task.status).toBe('open')
  }, T)

  test('a claim held on the mirror lock with more than a second left is forwarded and applies', async () => {
    const w = await world()
    const s = w.seat()
    await start(w, s)
    const { r, callRef } = await heldClaim(w, s, 148_000)
    expect(r.outcome).toBe('ok')
    expect(sc(r).task.status).toBe('claimed')
    expect(lines(w, 'forward').filter((l) => l.call_ref === callRef).length).toBe(1)
  }, T)
})

describe('rest and replays', () => {
  test('rest resting then ready succeeds and the addressee hint goes from held to tap', async () => {
    const w = await world()
    const s = w.seat()
    const remote = sc(await start(w, s)).session.id
    const { h } = await airSession(w)
    const note = async (key: string) => (await h.callTool('collab_report_append', { workspace_id: w.workspaceId, idempotency_key: key,
      kind: 'observation', body: 'for nuance', to_session_id: remote })).structuredContent.addressee.delivery
    expect((await call(w, s, 'collab_session_rest', { idempotency_key: 'r1', mode: 'resting' })).outcome).toBe('ok')
    expect(await note('a1')).toBe('held')
    expect((await call(w, s, 'collab_session_rest', { idempotency_key: 'r2', mode: 'ready' })).outcome).toBe('ok')
    expect(await note('a2')).toBe('tap')
  }, T)

  test('wake_on [] on ready still gets Collab\'s invalid_wake_on', async () => {
    const w = await world()
    const s = w.seat()
    await start(w, s)
    const r = await call(w, s, 'collab_session_rest', { idempotency_key: 'r1', mode: 'ready', wake_on: [] })
    expect(r.outcome).toBe('error')
    expect(codeOf(r)).toBe('invalid_wake_on')
    expect(sc(r).retry).toBeUndefined() // Collab's own failure, passed through unchanged
  }, T)

  test('a same-key replay of a rewritten rest returns its receipt', async () => {
    const w = await world()
    const s = w.seat()
    await start(w, s)
    const first = await call(w, s, 'collab_session_rest', { idempotency_key: 'r1', mode: 'resting', wake_on: [] })
    const replay = await call(w, s, 'collab_session_rest', { idempotency_key: 'r1', mode: 'resting' })
    expect(first.outcome).toBe('ok')
    expect(replay.outcome).toBe('ok')
    expect(sc(replay)).toEqual(sc(first))
  }, T)

  test('a remote path_scope_conflict names the bound workspace', async () => {
    const w = await world()
    const s = w.seat()
    await start(w, s)
    const { h } = await airSession(w)
    const a = await h.callTool('collab_task_create', { workspace_id: w.workspaceId, idempotency_key: 'ca', task_id: 'air-notes', title: 'air',
      path_scopes: ['notes'], work_mode: 'edit', completion_policy: 'accepted' })
    expect((await h.callTool('collab_task_claim', { workspace_id: w.workspaceId, task_id: 'air-notes', idempotency_key: 'ka',
      expected_version: a.structuredContent.task.version })).isError).toBeUndefined()
    const b = await call(w, s, 'collab_task_create', { idempotency_key: 'cb', task_id: 'nuance-notes', title: 'nuance',
      path_scopes: ['notes'], work_mode: 'edit', completion_policy: 'accepted', expected_base_sha: w.base })
    const r = await call(w, s, 'collab_task_claim', { task_id: 'nuance-notes', idempotency_key: 'kb', expected_version: sc(b).task.version },
      { declared: { head: w.base, branch: 'main', dirty: false } })
    expect(codeOf(r)).toBe('path_scope_conflict')
    expect(sc(r).conflicting_workspace_id).toBe(w.workspaceId)
    expect(sc(r).conflicting_task_id).toBe('air-notes')
  }, T)
})

describe('child faults and the build', () => {
  test('cursor_reset_required parks the lineage', async () => {
    const w = await world()
    const s = w.seat()
    const sid = sc(await start(w, s)).session.id
    const r = await call(w, s, 'collab_next', { known_cursor: { epoch_id: 'epoch_x', sequence: 99, hash: 'a'.repeat(64) } })
    expect(codeOf(r)).toBe('cursor_reset_required')
    expect(w.store.get(s.ref.lineage)!.parked?.cause).toBe('cursor_reset_required')
    expect(w.statuses).toContainEqual([s.ref.lineage, `needs Ai: seat_recovery ${sid}`])
    w.clock.mono += 1_000
    const later = await call(w, s, 'collab_next', {})
    expect(sc(later)).toMatchObject({ error: 'seat_recovery_required', delivered: false })
  }, T)

  test('after a dist change a call on a live child still answers, and a new lineage gets collab_build_changed', async () => {
    const w = await world()
    const s = w.seat()
    await start(w, s)
    w.build.changed = true
    expect((await call(w, s, 'collab_report_append', { idempotency_key: 'k1', kind: 'observation', body: 'still here' })).outcome).toBe('ok')
    const other = w.seat()
    const r = await start(w, other)
    expect(sc(r)).toMatchObject({ error: 'collab_build_changed', delivered: false })
  }, T)

  test('the ledger has one forward line per call_ref naming the shared journal, and no argument text', async () => {
    const w = await world()
    const s = w.seat()
    await start(w, s, { actor: 'ACTOR-SECRET-1', role: 'ROLE-SECRET-2' })
    await call(w, s, 'collab_report_append', { idempotency_key: 'k1', kind: 'observation', body: 'BODY-SECRET-3' })
    await call(w, s, 'collab_task_create', { idempotency_key: 'c1', task_id: 't1', title: 'TITLE-SECRET-4', work_mode: 'coordination' })
    await call(w, s, 'collab_next', {})
    const forwards = lines(w, 'forward')
    expect(forwards.length).toBe(4)
    expect(new Set(forwards.map((l) => l.call_ref)).size).toBe(4)
    for (const l of forwards) expect(l.journal).toBe(w.paths.sharedJournal)
    const text = readFileSync(w.paths.ledger, 'utf8')
    for (const secret of ['ACTOR-SECRET-1', 'ROLE-SECRET-2', 'BODY-SECRET-3', 'TITLE-SECRET-4']) expect(text).not.toContain(secret)
  }, T)
})

describe('knocks', () => {
  test('knocks before session_start are count 0, and a note from an Air session shows origin air', async () => {
    const w = await world()
    const s = w.seat()
    expect(await w.fwd.knocks(s.ref, { t: 'knocks', timeout_ms: 2_000 })).toEqual({ t: 'knock_report', count: 0, origins: [], seqs: [] })
    const remote = sc(await start(w, s)).session.id
    const { h } = await airSession(w)
    await h.callTool('collab_report_append', { workspace_id: w.workspaceId, idempotency_key: 'a1', kind: 'observation', body: 'hello', to_session_id: remote })
    expect(await w.fwd.knocks(s.ref, { t: 'knocks', timeout_ms: 2_000 })).toMatchObject({ t: 'knock_report', count: 1, origins: ['air'] })
  }, T)
})

// ---- Task 37's fake Collab bin, for the limits that need a slow or huge answer, and a scripted knock read ----

interface FakeWorld {
  paths: AirPaths; dist: string; fwd: Forwarder; pool: ChildPool; store: LineageStore; seat: Seat; clock: Clock
  release(): void; calls(): string[]
}

/**
 * A lineage that is already live (its credential file present), so the pool resumes it on Task 37's fake Collab dist,
 * which reads its script once at spawn: each test passes its script here. `knock` stands in for the host CLI's knock read.
 */
function fakeWorld(script: FakeScript = {}, o: { knock?: ForwardDeps['knock'] } = {}): FakeWorld {
  const air = temp('cb-fwd-fake-')
  const paths = airPaths(air)
  const dist = writeFakeCollab(temp('cb-fwd-fakedist-'), script)
  const sessionId = 'session_fake'
  mkdirSync(paths.collabSessions, { recursive: true, mode: 0o700 })
  writeFileSync(paths.credentialFile(sessionId), '{}\n', { mode: 0o600 })
  const store = new LineageStore(paths.lineages)
  store.load()
  const lineage = newLineage()
  const folder = '/Users/macair/Projects/collab-trial'
  const mirrorId = mirrorIdOf(folder)
  const workspaceId = `ws_${'1'.repeat(24)}`
  store.upsert({ lineage, device: 'nuance', user: 'macair', harness: 'claude', folder, state: 'live', session_id: sessionId,
    credential_path: paths.credentialFile(sessionId), past_sessions: [], mirror_id: mirrorId, workspace_id: workspaceId, pending_start: null,
    parked: null, detached_since: null, created_at: '2026-10-13T13:00:00.000Z' })
  const clock: Clock = { mono: 5_000_000, now: Date.parse('2026-10-13T13:00:00.000Z') }
  const ledger = (f: Parameters<typeof appendLedger>[2]) => { appendLedger(paths.ledger, AIR_LEDGER_KEYS, f) }
  const pool = new ChildPool({
    spec: { bun: process.execPath, dist, journal: paths.sharedJournal, home: air }, store, paths,
    hostCli: makeHostCli({ bun: process.execPath, dist, journal: paths.sharedJournal, home: air }), mono: () => clock.mono,
    now: () => new Date(clock.now), ledger, procAlive: liveProcAlive('/bin/ps'), status: () => {}, buildChanged: () => false,
  })
  pools.push(pool)
  const device: DeviceFile = {
    v: 1, device: 'nuance', user: 'macair', state: 'paired', host_alias: 'collab-nuance', seat_public: 'ab'.repeat(32),
    bundle_build: 'abcdef01', key_expiry: '20270111', trailer: 'Co-Authored-By: The Fable of the Eternal Universe <Yu@Ai-love.cc>',
    git: NUANCE_GIT, summon: { key_sha256: 'c'.repeat(64), dropin_stat: '1 2 3 0 600' },
    shares: [{ remote_realpath: folder, remote_gitdir: `${folder}/.git`, air_clone: join(air, 'Projects', 'collab-trial'), mirror_id: mirrorId,
      mirror_worktree_id: null, workspace_id: workspaceId, caps: DEFAULT_CAPS }],
    prepared_at: '2026-10-13T12:00:00.000Z', paired_at: '2026-10-13T12:30:00.000Z',
  }
  const fwd = new Forwarder({
    pool, store, calls: new CallRegistry(), mirrors: new MirrorRegistry(),
    mirrorDeps: { git: airGit({ git: REAL_GIT, home: air }), sshBin: '/nonexistent/ssh', sshConfig: paths.sshConfig, alias: 'collab-nuance',
      freeBytes: () => 1e15, fetchedToday: () => 0, ledger },
    devices: () => new Map([['nuance', device]]), devicePath: (d) => paths.deviceFile(d), seatTools: () => SEAT_TOOLS,
    knock: o.knock ?? (async () => ({ t: 'knock_report', count: 0, origins: [], seqs: [] })), journal: paths.sharedJournal, ledger,
    mono: () => clock.mono, now: () => new Date(clock.now),
  })
  return {
    paths, dist, fwd, pool, store, clock,
    seat: { ref: { device: 'nuance', user: 'macair', lineage, harness: 'claude', entrypoint: 'cli', folder, stream: 1 }, seq: 0 },
    release: () => writeFileSync(join(dist, 'release'), ''),
    calls: () => fakeLog(dist).filter((l) => l.method === 'tools/call').map((l) => l.name!),
  }
}
const fcall = async (f: FakeWorld, name: string, args: Record<string, unknown> = {}) => {
  const r = await f.fwd.call(f.seat.ref, msg(f.seat, name, args))
  if (r === 'close') throw new Error('closed')
  return r
}
/** The script that holds every collab_task_get inside the child until the test calls release(). */
const HOLD_GETS: FakeScript = { tools: { collab_task_get: { kind: 'wait_file', file: 'release' } } }

describe('front-door limits', () => {
  test('a fifth call in flight is rate_limited', async () => {
    const f = fakeWorld(HOLD_GETS)
    const four = [0, 1, 2, 3].map((i) => fcall(f, 'collab_task_get', { task_id: `t${i}` }))
    await until(() => f.calls().length === 4, 'all four calls to be inside the child')
    const fifth = await fcall(f, 'collab_task_get', { task_id: 't4' })
    expect(sc(fifth)).toMatchObject({ error: 'rate_limited', delivered: false })
    f.release()
    for (const r of await Promise.all(four)) expect(r.outcome).toBe('ok')
    expect(f.calls()).toEqual(['collab_task_get', 'collab_task_get', 'collab_task_get', 'collab_task_get'])
  }, T)

  test('the 21st mutation in a burst is rate_limited', async () => {
    const f = fakeWorld()
    for (let i = 0; i < 20; i++) {
      expect((await fcall(f, 'collab_report_append', { idempotency_key: `k${i}`, kind: 'observation', body: `n${i}` })).outcome).toBe('ok')
    }
    const r21 = await fcall(f, 'collab_report_append', { idempotency_key: 'k20', kind: 'observation', body: 'n20' })
    expect(sc(r21)).toMatchObject({ error: 'rate_limited', delivered: false })
    expect(f.calls().length).toBe(20)
    f.clock.mono += 200 // one more token at 5 a second
    expect((await fcall(f, 'collab_report_append', { idempotency_key: 'k21', kind: 'observation', body: 'n21' })).outcome).toBe('ok')
  }, T)

  test('collab_next twice within a second is rate_limited', async () => {
    const f = fakeWorld()
    expect((await fcall(f, 'collab_next')).outcome).toBe('ok')
    f.clock.mono += 999
    expect(sc(await fcall(f, 'collab_next'))).toMatchObject({ error: 'rate_limited' })
    f.clock.mono += 1
    expect((await fcall(f, 'collab_next')).outcome).toBe('ok')
  }, T)

  test('journal_verify twice within a minute is rate_limited', async () => {
    const f = fakeWorld()
    expect((await fcall(f, 'collab_journal_verify')).outcome).toBe('ok')
    f.clock.mono += 59_999
    expect(sc(await fcall(f, 'collab_journal_verify'))).toMatchObject({ error: 'rate_limited' })
    f.clock.mono += 1
    expect((await fcall(f, 'collab_journal_verify')).outcome).toBe('ok')
  }, T)

  test('a result too large for one frame is hub_outcome_unknown', async () => {
    const f = fakeWorld({ tools: { collab_report_list: { kind: 'big', bytes: 5 * 1024 * 1024 } } })
    const r = await fcall(f, 'collab_report_list')
    expect(r.outcome).toBe('unknown')
    expect(sc(r)).toMatchObject({ error: 'hub_outcome_unknown', delivered: 'unknown', retry: 'never automatic' })
    expect(readLedger(f.paths.ledger).filter((l) => l.event === 'result').map((l) => [l.outcome, l.code])).toEqual([['unknown', 'oversized']])
  }, T)
})

describe('not sent after a wait inside the hub', () => {
  test('a call that waited past its deadline for a draining child to stop is not sent to the respawned child', async () => {
    const f = fakeWorld(HOLD_GETS)
    const first = fcall(f, 'collab_task_get', { task_id: 't0' })
    await until(() => f.calls().length === 1, 'the first call to be inside the child')
    f.pool.detached(f.seat.ref.lineage)
    f.clock.mono += TIMING.childDetachedMs
    await f.pool.tick() // the child is now draining; one call is in flight, so it is not stopped yet
    const later = fcall(f, 'collab_task_list', {}) // childFor respawns, behind the old child's stop (rt.starting)
    f.clock.mono += 60_000 // the list's whole timeout_ms passes while it waits
    f.release()
    expect((await first).outcome).toBe('ok') // written before its deadline, so never cut short
    const r = await later
    expect(sc(r)).toMatchObject({ error: 'hub_away', delivered: false, reason: 'deadline_passed' })
    expect(fakeLog(f.dist).filter((l) => l.start).length).toBe(2) // the respawned child started, and was sent nothing
    expect(f.calls()).toEqual(['collab_task_get'])
    expect(readLedger(f.paths.ledger).filter((l) => l.event === 'forward').map((l) => l.tool)).toEqual(['collab_task_get'])
  }, T)

  test('a child that began stopping after childFor handed it out is not sent to', async () => {
    const f = fakeWorld()
    const handOut = f.pool.childFor.bind(f.pool)
    // A park, an end or a drain in the gap between childFor's answer and the forward (Task 37's accepting()).
    f.pool.childFor = async (lineage, opts) => {
      const got = await handOut(lineage, opts)
      if (got.ok) await got.child.stop(2000)
      return got
    }
    const r = await fcall(f, 'collab_task_get', { task_id: 't0' })
    expect(r.outcome).toBe('error')
    expect(sc(r)).toMatchObject({ error: 'hub_away', delivered: false })
    expect(f.calls()).toEqual([])
    expect(readLedger(f.paths.ledger).filter((l) => l.event === 'forward')).toEqual([])
  }, T)
})

describe('knock reads (T9)', () => {
  const QUIET: HubKnockReportMsg = { t: 'knock_report', count: 0, origins: [], seqs: [] }
  const ONE: HubKnockReportMsg = { t: 'knock_report', count: 1, origins: ['air'], seqs: [7] }

  /** A knock read that waits until the test answers it, counting how many the Forwarder started. */
  function scriptedKnock(): { knock: ForwardDeps['knock']; started(): number; answer(): void } {
    let started = 0
    let answer: (() => void) | null = null
    return {
      knock: async () => {
        started += 1
        await new Promise<void>((r) => { answer = r })
        return ONE
      },
      started: () => started,
      answer: () => { const a = answer; answer = null; a?.() },
    }
  }

  test('one host-CLI read at a time per lineage, at least 1 s apart; an overlap does not move the window', async () => {
    const k = scriptedKnock()
    const f = fakeWorld({}, { knock: k.knock })
    const knocks = () => f.fwd.knocks(f.seat.ref, { t: 'knocks', timeout_ms: 2_000 })
    const first = knocks()
    const rest = await Promise.all(Array.from({ length: 49 }, () => knocks()))
    expect(k.started()).toBe(1)
    expect(rest).toEqual(Array.from({ length: 49 }, () => QUIET))
    k.answer()
    expect(await first).toEqual(ONE)
    expect(await knocks()).toEqual(QUIET) // the same mono: inside the 1 s window
    expect(k.started()).toBe(1)
    f.clock.mono += 1_000
    const second = knocks()
    expect(k.started()).toBe(2)
    f.clock.mono += 1_000 // the window has passed, but the second read is still running
    const overlap = knocks()
    expect(k.started()).toBe(2)
    expect(await overlap).toEqual(QUIET)
    k.answer()
    expect(await second).toEqual(ONE)
    const third = knocks() // the overlap just refused did not move the window: 1 s since the second read
    expect(k.started()).toBe(3)
    k.answer()
    expect(await third).toEqual(ONE)
  }, T)

  test('knocks on a lineage with no live session run nothing and do not move the window', async () => {
    const k = scriptedKnock()
    const f = fakeWorld({}, { knock: k.knock })
    const live = f.store.get(f.seat.ref.lineage)!
    f.store.upsert({ ...live, state: 'pending', session_id: null, credential_path: null })
    expect(await f.fwd.knocks(f.seat.ref, { t: 'knocks', timeout_ms: 2_000 })).toEqual(QUIET)
    expect(k.started()).toBe(0)
    f.store.upsert(live) // live again at the same mono: the earlier knocks took no slot
    const r = f.fwd.knocks(f.seat.ref, { t: 'knocks', timeout_ms: 2_000 })
    expect(k.started()).toBe(1)
    k.answer()
    expect(await r).toEqual(ONE)
  }, T)
})
