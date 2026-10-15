import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TIMING } from '../src/timing.ts'
import { CollabChild, type CallOutcome } from '../src/air/children.ts'
import { LineageStore, type LineageEntry } from '../src/air/lineages.ts'
import { liveLstartOf, liveProcAlive, makeHostCli, type ChildPool, type HostCli, type HostCliOptions } from '../src/air/pool.ts'
import { rolePrefix } from '../src/air/stamp.ts'
import { newStartNonce } from '../src/link/messages.ts'
import { COLLAB_DIST, temp, writeStub } from './helpers.ts'
import { startCollabSession, tamperJournal } from './mcp-harness.ts'
import { activeSessions, childOf, cleanupPools, deferred, entry, events, fresh, pool, world, type World } from './pool-world.ts'

const DAY = 86_400_000
const frozen: number[] = []
afterEach(async () => {
  // A failed assertion must never leave a SIGSTOPped child behind: thaw first, then stop every pool's children.
  for (const pid of frozen.splice(0)) try { process.kill(pid, 'SIGCONT') } catch { /* already gone */ }
  await cleanupPools()
})

/** SIGSTOPs a child so a request waits in its stdin pipe; afterEach thaws it whatever happens. */
function freeze(c: CollabChild): void {
  frozen.push(c.pid)
  process.kill(c.pid, 'SIGSTOP')
}

const ref = (e: LineageEntry, n: number) => `${e.lineage}:0000abcd:${n}`
/** What the forwarder sends Collab for a remote start: root_path injected, actor and role stamped with the start nonce. */
const startArgs = (w: World, nonce: string, device = 'nuance', user = 'macair') =>
  ({ root_path: w.mirror, actor: `${device}/${user} · self-declared: claude`, role: `${rolePrefix(device, user, nonce, 'claude')}tester` })

/** Starts a session for `e` through the pool and returns its id. */
async function live(w: World, p: ChildPool, e: LineageEntry, n = 1): Promise<string> {
  const nonce = newStartNonce()
  const out = await p.startSession(e.lineage, startArgs(w, nonce, e.device, e.user), ref(e, n), nonce, w.workspaceId)
  if (!('outcome' in out) || out.outcome !== 'ok') throw new Error(`session_start: ${JSON.stringify(out)}`)
  return w.store.get(e.lineage)!.session_id!
}

const outcome = (o: CallOutcome | { refuse: string }) => ('outcome' in o ? o.outcome : `refuse:${o.refuse}`)
async function deadPid(): Promise<number> {
  const p = Bun.spawn(['/usr/bin/true'], { stdio: ['ignore', 'ignore', 'ignore'] })
  await p.exited
  return p.pid
}
async function until(cond: () => boolean, ms = 5000): Promise<void> {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out waiting')
    await Bun.sleep(10)
  }
}

describe('session_start at most once', () => {
  test('the pending_start marker, with its workspace_id, is on disk before the forward and gone before the result', async () => {
    const w = world()
    const p = pool(w)
    const e = entry(w)
    const c = await childOf(p, e.lineage, true)
    freeze(c) // the request waits in the pipe until the marker has been checked
    const nonce = newStartNonce()
    let seenAtResult: unknown = 'unset'
    const run = p.startSession(e.lineage, startArgs(w, nonce), ref(e, 1), nonce, w.workspaceId)
      .then((out) => { seenAtResult = fresh(w).get(e.lineage)!.pending_start; return out })
    await until(() => fresh(w).get(e.lineage)!.pending_start !== null)
    expect(fresh(w).get(e.lineage)!.pending_start).toMatchObject({ nonce, call_ref: ref(e, 1), child_pid: c.pid, workspace_id: w.workspaceId })
    expect(fresh(w).get(e.lineage)!.pending_start!.child_lstart).toMatch(/^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{1,2} \d{2}:\d{2}:\d{2} \d{4}$/)
    expect(await activeSessions(w)).toEqual([]) // not forwarded yet
    process.kill(c.pid, 'SIGCONT')
    expect(outcome(await run)).toBe('ok')
    expect(seenAtResult).toBeNull()
    expect(fresh(w).get(e.lineage)).toMatchObject({ state: 'live', workspace_id: w.workspaceId })
  }, 30_000)

  test('a start whose child stopped after the pool handed it out is hub_away, with no marker and nothing sent', async () => {
    const w = world()
    const p = pool(w)
    const e = entry(w)
    const handOut = p.childFor.bind(p)
    // The child stops in the gap between childFor's answer and the forward (a park, an end or a drain in that gap).
    p.childFor = async (lineage, o) => {
      const got = await handOut(lineage, o)
      if (got.ok) await got.child.stop(2000)
      return got
    }
    const nonce = newStartNonce()
    const out = await p.startSession(e.lineage, startArgs(w, nonce), ref(e, 1), nonce, w.workspaceId)
    expect(out).toMatchObject({ refuse: 'hub_away' })
    expect(fresh(w).get(e.lineage)).toMatchObject({ state: 'pending', pending_start: null })
    expect(events(w, 'session_start')).toEqual([])
    expect(await activeSessions(w)).toEqual([])
  }, 30_000)

  test('a start whose deadline passed while it waited in the pool writes no marker and sends nothing', async () => {
    const w = world()
    const p = pool(w)
    const e = entry(w)
    const nonce = newStartNonce()
    const out = await p.startSession(e.lineage, startArgs(w, nonce), ref(e, 1), nonce, w.workspaceId, w.clock.mono)
    expect(out).toMatchObject({ refuse: 'hub_away' })
    expect(fresh(w).get(e.lineage)).toMatchObject({ state: 'pending', pending_start: null })
    expect(events(w, 'session_start')).toEqual([])
    expect(await activeSessions(w)).toEqual([])
  }, 30_000)

  test('a session_start Collab refuses after it committed (its credential directory is unsafe) keeps the marker and stops the child; the next start settles it from the journal (Task 63 pipe-2-2)', async () => {
    const w = world()
    const p = pool(w)
    const e = entry(w)
    mkdirSync(w.paths.collabSessions, { recursive: true })
    chmodSync(w.paths.collabSessions, 0o755) // Collab commits the session, then refuses to write its credential here
    const c = await childOf(p, e.lineage, true)
    const n1 = newStartNonce()
    const first = await p.startSession(e.lineage, startArgs(w, n1), ref(e, 1), n1, w.workspaceId)
    expect(outcome(first)).toBe('error')
    if (!('outcome' in first) || first.outcome !== 'error') throw new Error('unreachable')
    expect(first.result.structuredContent).toMatchObject({ error: 'session_directory_not_private', operation: 'validate_session_credential_directory' })
    // The refusal came after the commit, so "nothing was created" is not known: the marker stays, as for an unknown outcome.
    expect(fresh(w).get(e.lineage)).toMatchObject({ state: 'pending', pending_start: { nonce: n1 } })
    await until(() => !c.alive()) // the child that may hold the session is stopped, not kept for the next start
    chmodSync(w.paths.collabSessions, 0o700)
    const n2 = newStartNonce()
    expect(outcome(await p.startSession(e.lineage, startArgs(w, n2), ref(e, 2), n2, w.workspaceId))).toBe('ok')
    expect(events(w, 'reconcile').map((l) => l.outcome)).toEqual(['cleared']) // Collab ended the first session itself
    expect(fresh(w).get(e.lineage)).toMatchObject({ state: 'live', pending_start: null })
    expect(await activeSessions(w)).toHaveLength(1)
  }, 60_000)

  test('a session_start Collab refuses before it committed anything clears the marker and keeps the unbound child', async () => {
    const w = world()
    const p = pool(w)
    const e = entry(w)
    const c = await childOf(p, e.lineage, true)
    const n1 = newStartNonce()
    const out = await p.startSession(e.lineage, { ...startArgs(w, n1), root_path: join(w.home, 'no-such-dir') }, ref(e, 1), n1, w.workspaceId)
    expect(outcome(out)).toBe('error')
    if (!('outcome' in out) || out.outcome !== 'error') throw new Error('unreachable')
    expect(out.result.structuredContent).not.toHaveProperty('operation')
    expect(fresh(w).get(e.lineage)).toMatchObject({ state: 'pending', pending_start: null })
    expect(c.alive()).toBe(true)
    expect(await activeSessions(w)).toEqual([])
  }, 30_000)

  test('reconcile: no session clears the marker', async () => {
    const w = world()
    // A session exists in the workspace, but its role carries another nonce; and a marker for a workspace that never existed.
    await startCollabSession({ journal: w.paths.sharedJournal, home: w.home, root: w.mirror, actor: 'other', role: `${rolePrefix('nuance', 'macair', newStartNonce(), 'claude')}x` })
    const marker = async (e: LineageEntry, ws: string) => ({ nonce: newStartNonce(), call_ref: ref(e, 1), child_pid: await deadPid(), child_lstart: null, workspace_id: ws, at: new Date(w.clock.now).toISOString() })
    const a = entry(w)
    w.store.upsert({ ...a, pending_start: await marker(a, w.workspaceId) })
    const b = entry(w)
    w.store.upsert({ ...b, pending_start: await marker(b, 'ws_000000000000000000000000') })
    const p = pool(w)
    await p.reconcile()
    expect(fresh(w).get(a.lineage)).toMatchObject({ state: 'pending', pending_start: null })
    expect(fresh(w).get(b.lineage)).toMatchObject({ state: 'pending', pending_start: null })
    expect(events(w, 'reconcile').map((l) => l.outcome)).toEqual(['cleared', 'cleared'])
  }, 30_000)

  test('reconcile: a session with its credential is recorded, and the next session_start answers session_already_bound', async () => {
    const w = world()
    const nonce = newStartNonce()
    const s = await startCollabSession({ journal: w.paths.sharedJournal, home: w.home, root: w.mirror, actor: 'nuance/macair · self-declared: claude', role: `${rolePrefix('nuance', 'macair', nonce, 'claude')}tester` })
    const e = entry(w)
    w.store.upsert({ ...e, pending_start: { nonce, call_ref: ref(e, 1), child_pid: await deadPid(), child_lstart: null, workspace_id: w.workspaceId, at: new Date(w.clock.now).toISOString() } })
    const p = pool(w)
    await p.reconcile()
    expect(fresh(w).get(e.lineage)).toMatchObject({ state: 'live', session_id: s.sessionId, credential_path: s.credentialFile, workspace_id: s.workspaceId, pending_start: null })
    const n2 = newStartNonce()
    const out = await p.startSession(e.lineage, startArgs(w, n2), ref(e, 2), n2, w.workspaceId)
    expect(outcome(out)).toBe('error')
    if (!('outcome' in out) || out.outcome !== 'error') throw new Error('unreachable')
    expect(out.result.structuredContent?.error).toBe('session_already_bound')
    expect((await activeSessions(w)).map((x) => x.id)).toEqual([s.sessionId])
  }, 30_000)

  test('reconcile: a session without its credential becomes orphan_session and a new start is allowed', async () => {
    const w = world()
    const nonce = newStartNonce()
    const s = await startCollabSession({ journal: w.paths.sharedJournal, home: w.home, root: w.mirror, actor: 'nuance/macair · self-declared: claude', role: `${rolePrefix('nuance', 'macair', nonce, 'claude')}tester` })
    rmSync(s.credentialFile) // killed between Collab's commit and its credential write (K23)
    const e = entry(w)
    w.store.upsert({ ...e, pending_start: { nonce, call_ref: ref(e, 1), child_pid: await deadPid(), child_lstart: null, workspace_id: w.workspaceId, at: new Date(w.clock.now).toISOString() } })
    const p = pool(w)
    await p.reconcile()
    expect(w.statuses).toContainEqual([e.lineage, `orphan_session ${s.sessionId}`])
    expect(fresh(w).get(e.lineage)).toMatchObject({ state: 'pending', pending_start: null })
    const n2 = newStartNonce()
    expect(outcome(await p.startSession(e.lineage, startArgs(w, n2), ref(e, 2), n2, w.workspaceId))).toBe('ok')
    expect(await activeSessions(w)).toHaveLength(2)
  }, 30_000)

  test('reconcile keeps a marker whose recorded child still runs', async () => {
    const w = world()
    const e = entry(w)
    const self = liveLstartOf('/bin/ps')(process.pid) // a pid that is certainly alive, with its real lstart
    w.store.upsert({ ...e, pending_start: { nonce: newStartNonce(), call_ref: ref(e, 1), child_pid: process.pid, child_lstart: self, workspace_id: w.workspaceId, at: new Date(w.clock.now).toISOString() } })
    const p = pool(w)
    await p.reconcile()
    expect(fresh(w).get(e.lineage)!.pending_start).not.toBeNull()
    expect(events(w, 'reconcile').map((l) => [l.outcome, l.code])).toEqual([['kept', 'child_alive']])
    expect(events(w, 'child_start')).toEqual([]) // nothing read the journal while the old child might still write
    const nonce = newStartNonce()
    expect(outcome(await p.startSession(e.lineage, startArgs(w, nonce), ref(e, 2), nonce, w.workspaceId))).toBe('refuse:hub_away')
  }, 30_000)

  test("a child SIGKILLed mid-session_start leaves exactly one active session after the agent's next start", async () => {
    const w = world()
    const p = pool(w)
    const e = entry(w) // a brand-new lineage on a fresh shared journal
    const c = await childOf(p, e.lineage, true)
    freeze(c)
    const n1 = newStartNonce()
    const first = p.startSession(e.lineage, startArgs(w, n1), ref(e, 1), n1, w.workspaceId)
    await until(() => fresh(w).get(e.lineage)!.pending_start !== null)
    process.kill(c.pid, 'SIGKILL')
    expect(await first).toMatchObject({ outcome: 'unknown', reason: 'exit' })
    expect(fresh(w).get(e.lineage)!.pending_start?.nonce).toBe(n1) // the marker stays: the outcome is unknown
    const n2 = newStartNonce()
    expect(outcome(await p.startSession(e.lineage, startArgs(w, n2), ref(e, 2), n2, w.workspaceId))).toBe('ok')
    expect(events(w, 'reconcile').map((l) => l.outcome)).toEqual(['cleared'])
    expect(await activeSessions(w)).toHaveLength(1)
  }, 30_000)

  test('a pool stopped during the lineage\'s first session_start, after the child committed and before the marker cleared, reconciles on restart: the session is recorded and the next start answers session_already_bound', async () => {
    const w = world()
    // The hub dies right where it would record the new session: Collab has committed it and written its credential.
    class DyingStore extends LineageStore {
      override upsert(e: LineageEntry): void {
        if (e.pending_start === null && e.session_id !== null) throw new Error('the hub died here')
        super.upsert(e)
      }
    }
    w.store = new DyingStore(w.paths.lineages)
    w.store.load()
    const p1 = pool(w)
    const e = entry(w)
    const n1 = newStartNonce()
    await expect(p1.startSession(e.lineage, startArgs(w, n1), ref(e, 1), n1, w.workspaceId)).rejects.toThrow('the hub died here')
    await p1.stopAll()
    expect(fresh(w).get(e.lineage)!.pending_start?.nonce).toBe(n1)
    const [only] = await activeSessions(w)
    expect(only).toBeDefined()
    w.store = fresh(w)
    const p2 = pool(w)
    await p2.reconcile()
    expect(fresh(w).get(e.lineage)).toMatchObject({ state: 'live', session_id: only!.id, pending_start: null })
    const n2 = newStartNonce()
    const out = await p2.startSession(e.lineage, startArgs(w, n2), ref(e, 2), n2, w.workspaceId)
    expect('outcome' in out && out.outcome === 'error' && out.result.structuredContent?.error).toBe('session_already_bound')
    expect((await activeSessions(w)).map((s) => s.id)).toEqual([only!.id])
  }, 30_000)

  test('with a pending_start and a tampered journal, reconcile keeps running, writes journal_invalid, keeps the marker and spawns no further child', async () => {
    const w = world()
    await startCollabSession({ journal: w.paths.sharedJournal, home: w.home, root: w.mirror, actor: 'air' })
    tamperJournal(w.paths.sharedJournal)
    const a = entry(w)
    const b = entry(w)
    for (const x of [a, b]) {
      w.store.upsert({ ...x, pending_start: { nonce: newStartNonce(), call_ref: ref(x, 1), child_pid: await deadPid(), child_lstart: null, workspace_id: w.workspaceId, at: new Date(w.clock.now).toISOString() } })
    }
    const p = pool(w)
    await p.reconcile() // resolves: never throws
    expect(w.statuses).toContainEqual([a.lineage, 'journal_invalid'])
    expect(fresh(w).get(a.lineage)!.pending_start).not.toBeNull()
    expect(fresh(w).get(b.lineage)!.pending_start).not.toBeNull()
    expect(events(w, 'child_start').map((l) => [l.outcome, l.code])).toEqual([['failed', 'journal_invalid']])
    await p.reconcile() // once per hub start
    expect(events(w, 'child_start')).toHaveLength(1)
  }, 30_000)
})

describe('sessions across ends', () => {
  test('after a host end, a session_start on the same lineage starts a new session', async () => {
    const w = world()
    const p = pool(w)
    const e = entry(w)
    const old = await live(w, p, e)
    const oldChild = await childOf(p, e.lineage)
    // Ai ends the session from the Air while its child still runs (T8).
    const ended = await makeHostCli({ bun: process.execPath, dist: COLLAB_DIST, journal: w.paths.sharedJournal, home: w.home })(
      ['end', '--session-file', w.paths.credentialFile(old), '--reason', 'operator end', '--db', w.paths.sharedJournal], 30_000)
    expect(ended.code).toBe(0)
    const nonce = newStartNonce()
    const out = await p.startSession(e.lineage, startArgs(w, nonce), ref(e, 2), nonce, w.workspaceId)
    expect(outcome(out)).toBe('ok')
    expect(oldChild.alive()).toBe(false)
    const now = fresh(w).get(e.lineage)!
    expect(now.state).toBe('live')
    expect(now.session_id).not.toBe(old)
    expect(now.past_sessions).toEqual([old])
    expect((await activeSessions(w)).map((s) => s.id)).toEqual([now.session_id!])
  }, 30_000)

  test('after session_end, a new session_start starts a new session', async () => {
    const w = world()
    const p = pool(w)
    const e = entry(w)
    const old = await live(w, p, e)
    const c = await childOf(p, e.lineage)
    expect((await c.call('collab_session_end', { reason: 'done' })).outcome).toBe('ok')
    p.sessionEnded(e.lineage)
    const nonce = newStartNonce()
    expect(outcome(await p.startSession(e.lineage, startArgs(w, nonce), ref(e, 2), nonce, w.workspaceId))).toBe('ok')
    const now = fresh(w).get(e.lineage)!
    expect(now.session_id).not.toBe(old)
    expect(now.past_sessions).toEqual([old])
    expect(c.alive()).toBe(false)
    expect((await activeSessions(w)).map((s) => s.id)).toEqual([now.session_id!])
  }, 30_000)

  test('startSession refuses a lineage whose child failed to start, and a parked one, with no marker and nothing sent', async () => {
    const w = world()
    mkdirSync(w.paths.sharedJournal, { recursive: true }) // the store refuses a journal that is a directory
    const p = pool(w)
    const failed = entry(w)
    const parked = entry(w, { parked: { cause: 'cursor_reset_required', details: {} } })
    const tries: Array<[LineageEntry, string]> = [[failed, 'refuse:hub_away'], [failed, 'refuse:hub_away'], [parked, 'refuse:seat_recovery_required']]
    for (const [i, [e, want]] of tries.entries()) {
      const nonce = newStartNonce()
      expect(outcome(await p.startSession(e.lineage, startArgs(w, nonce), ref(e, i + 1), nonce, w.workspaceId))).toBe(want)
      expect(fresh(w).get(e.lineage)!.pending_start).toBeNull()
    }
    expect(w.statuses).toContainEqual([failed.lineage, 'child_start_failed'])
    expect(events(w, 'child_start').map((l) => [l.outcome, l.code])).toEqual([['failed', 'child_start_failed']]) // once, never respawned
  }, 30_000)
})

describe('retirement', () => {
  test('a lineage detached 6 days before a pool restart retires 1 day after it, read from detached_since', async () => {
    const w = world()
    const p1 = pool(w)
    const e = entry(w)
    const sid = await live(w, p1, e)
    await p1.stopAll()
    w.store.upsert({ ...w.store.get(e.lineage)!, detached_since: new Date(w.clock.now - 6 * DAY).toISOString() })
    w.store = fresh(w)
    w.clock.mono = 5 // a new boot: the monotonic clock knows nothing of the old run
    const p2 = pool(w, { retireAfterMs: TIMING.lineageRetireMs })
    await p2.reconcile()
    expect(fresh(w).get(e.lineage)!.detached_since).toBe(new Date(w.clock.now - 6 * DAY).toISOString())
    await p2.tick()
    expect(fresh(w).get(e.lineage)!.state).toBe('live')
    w.clock.now += DAY
    await p2.tick()
    expect(fresh(w).get(e.lineage)).toMatchObject({ state: 'retired', session_id: null, past_sessions: [sid] })
    expect(w.hostCalls).toEqual([['end', '--session-file', w.paths.credentialFile(sid), '--reason', 'lineage retired', '--db', w.paths.sharedJournal]])
  }, 30_000)

  test('a lineage still attached when the hub stopped counts as detached from the next hub start', async () => {
    const w = world()
    const p1 = pool(w)
    const e = entry(w)
    await live(w, p1, e)
    p1.attached(e.lineage)
    await p1.stopAll() // the hub stops with the pipe attached: detached_since stays null on disk
    expect(fresh(w).get(e.lineage)!.detached_since).toBeNull()
    w.store = fresh(w)
    const p2 = pool(w)
    await p2.reconcile()
    expect(fresh(w).get(e.lineage)!.detached_since).toBe(new Date(w.clock.now).toISOString())
    w.clock.now += 7 * DAY
    await p2.tick()
    expect(fresh(w).get(e.lineage)!.state).toBe('retired')
  }, 30_000)

  test('after 7 days detached the lineage is ended without --release-leases and retired, and a late reattach gets seat_session_ended', async () => {
    const w = world()
    const p = pool(w)
    const e = entry(w)
    const sid = await live(w, p, e)
    const c = await childOf(p, e.lineage)
    p.detached(e.lineage)
    w.clock.now += 7 * DAY
    w.clock.mono += 7 * DAY
    await p.tick()
    expect(c.alive()).toBe(false)
    expect(w.hostCalls).toHaveLength(1)
    expect(w.hostCalls[0]).not.toContain('--release-leases')
    expect(events(w, 'retire_end').at(-1)).toMatchObject({ outcome: 'ok', session_id: sid })
    expect(await activeSessions(w)).toEqual([])
    expect(fresh(w).get(e.lineage)).toMatchObject({ state: 'retired', past_sessions: [sid] })
    expect(fresh(w).sessionIndex().get(sid)).toEqual({ device: 'nuance', user: 'macair' })
    p.attached(e.lineage)
    expect(await p.childFor(e.lineage)).toMatchObject({ ok: false, code: 'seat_session_ended' })
    const nonce = newStartNonce()
    expect(outcome(await p.startSession(e.lineage, startArgs(w, nonce), ref(e, 2), nonce, w.workspaceId))).toBe('refuse:seat_session_ended')
  }, 30_000)
})

describe('the hub way, always', () => {
  test('liveProcAlive fails closed when ps fails', async () => {
    const dir = temp('cb-ps-')
    const broken = writeStub(dir, 'ps', 'exit 1')
    expect(liveProcAlive(broken)(await deadPid(), null)).toBe(true)
    const real = liveProcAlive('/bin/ps')
    expect(real(process.pid, null)).toBe(true)
    expect(real(await deadPid(), null)).toBe(false)
    const own = liveLstartOf('/bin/ps')(process.pid)
    expect(own).not.toBeNull()
    expect(real(process.pid, own)).toBe(true)
    expect(real(process.pid, 'Thu Jan 1 00:00:00 1970')).toBe(false)
  })

  test("the host CLI runs the children's way: the three-key env naming the shared journal, cwd /", async () => {
    const dist = temp('cb-hostcli-')
    const home = temp('cb-hostcli-home-')
    writeFileSync(join(dist, 'agenttool-collab-host.js'),
      'console.log(JSON.stringify({ env: Object.keys(process.env).sort(), db: process.env.AGENTOOL_COLLAB_DB, cwd: process.cwd(), args: process.argv.slice(2) }))\n')
    const r = await makeHostCli({ bun: process.execPath, dist, journal: '/j/collab.sqlite', home })(['knocks', '--session', 'ses_1'], 5_000)
    expect(r.code).toBe(0)
    expect(JSON.parse(r.stdout)).toEqual({ env: ['AGENTOOL_COLLAB_DB', 'HOME', 'PATH'], db: '/j/collab.sqlite', cwd: '/', args: ['knocks', '--session', 'ses_1'] })
  })

  test('a host CLI call that leaves out --db still reads the shared journal, never the private one', async () => {
    const w = world()
    const p = pool(w)
    const e = entry(w)
    const sid = await live(w, p, e)
    // Collab's default journal is the private one's place, which does not exist under the temp home: a CLI that fell back
    // to it would answer nothing at all.
    expect(existsSync(w.paths.privateJournal)).toBe(false)
    const r = await makeHostCli({ bun: process.execPath, dist: COLLAB_DIST, journal: w.paths.sharedJournal, home: w.home })(['knocks', '--session', sid], 5_000)
    expect(r.code).toBe(0)
    expect(JSON.parse(r.stdout.trim())).toMatchObject({ protocol: 'agenttool.collab-knock/1', session_id: sid, waiting: 0 })
  }, 30_000)
})

describe('after journal_invalid or a failed child start, a marker is kept for the next hub start (Task 40b review)', () => {
  const marker = async (w: World, x: LineageEntry) =>
    ({ nonce: newStartNonce(), call_ref: ref(x, 1), child_pid: await deadPid(), child_lstart: null, workspace_id: w.workspaceId, at: new Date(w.clock.now).toISOString() })

  test('after a failed reconcile, every session_start on a lineage with a marker is refused with the journal message and spawns no child', async () => {
    const w = world()
    await startCollabSession({ journal: w.paths.sharedJournal, home: w.home, root: w.mirror, actor: 'air' })
    tamperJournal(w.paths.sharedJournal)
    const a = entry(w)
    const b = entry(w)
    for (const x of [a, b]) w.store.upsert({ ...x, pending_start: await marker(w, x) })
    const p = pool(w)
    await p.reconcile()
    expect(events(w, 'child_start').map((l) => [l.outcome, l.code])).toEqual([['failed', 'journal_invalid']])
    for (const [i, x] of [a, b, a].entries()) {
      const nonce = newStartNonce()
      const out = await p.startSession(x.lineage, startArgs(w, nonce), ref(x, i + 2), nonce, w.workspaceId)
      expect(out).toMatchObject({ refuse: 'hub_away', message: expect.stringContaining('failed verification') })
    }
    expect(events(w, 'child_start')).toHaveLength(1) // the broken journal is never re-verified per start (P64, §9.6 item 4)
    expect(fresh(w).get(a.lineage)!.pending_start).not.toBeNull()
    expect(fresh(w).get(b.lineage)!.pending_start).not.toBeNull()
  }, 30_000)

  test('a journal_invalid found by the start itself while it settles the marker is not re-verified by the next start', async () => {
    const w = world()
    await startCollabSession({ journal: w.paths.sharedJournal, home: w.home, root: w.mirror, actor: 'air' })
    tamperJournal(w.paths.sharedJournal)
    const a = entry(w)
    const b = entry(w)
    for (const x of [a, b]) w.store.upsert({ ...x, pending_start: await marker(w, x) })
    const p = pool(w) // no reconcile: the first session_start is what meets the broken journal
    const tries: LineageEntry[] = [a, a, b]
    for (const [i, x] of tries.entries()) {
      const nonce = newStartNonce()
      const out = await p.startSession(x.lineage, startArgs(w, nonce), ref(x, i + 2), nonce, w.workspaceId)
      expect(out).toMatchObject({ refuse: 'hub_away', message: expect.stringContaining('failed verification') })
    }
    expect(w.statuses).toContainEqual([a.lineage, 'journal_invalid'])
    expect(events(w, 'child_start').map((l) => [l.outcome, l.code])).toEqual([['failed', 'journal_invalid']])
    expect(fresh(w).get(a.lineage)!.pending_start).not.toBeNull()
    expect(fresh(w).get(b.lineage)!.pending_start).not.toBeNull()
  }, 30_000)

  test('only a marker whose recorded child still runs asks the agent to call again shortly', async () => {
    const w = world()
    const a = entry(w)
    w.store.upsert({ ...a, pending_start: { ...(await marker(w, a)), child_pid: process.pid, child_lstart: liveLstartOf('/bin/ps')(process.pid) } })
    const p = pool(w)
    const nonce = newStartNonce()
    const out = await p.startSession(a.lineage, startArgs(w, nonce), ref(a, 2), nonce, w.workspaceId)
    expect(out).toMatchObject({ refuse: 'hub_away', message: expect.stringContaining('again shortly') })
    expect(events(w, 'child_start')).toEqual([])
  }, 30_000)

  test('a child that could not start while settling a marker is not respawned by the next start of that lineage', async () => {
    const w = world()
    mkdirSync(w.paths.sharedJournal, { recursive: true }) // the store refuses a journal that is a directory: child_start_failed
    const a = entry(w)
    w.store.upsert({ ...a, pending_start: await marker(w, a) })
    const p = pool(w)
    await p.reconcile()
    expect(events(w, 'child_start').map((l) => [l.outcome, l.code])).toEqual([['failed', 'child_start_failed']])
    for (const i of [2, 3]) {
      const nonce = newStartNonce()
      const out = await p.startSession(a.lineage, startArgs(w, nonce), ref(a, i), nonce, w.workspaceId)
      expect(out).toMatchObject({ refuse: 'hub_away', message: expect.stringContaining('could not start') })
    }
    expect(events(w, 'child_start')).toHaveLength(1)
    expect(fresh(w).get(a.lineage)!.pending_start).not.toBeNull()
  }, 30_000)
})

describe('a hub-start reconcile never undoes a start that is newer (Task 40b review)', () => {
  /** Holds the first collab_workspace_status call (the hub-start reconcile's) until the test releases it. */
  function holdFirstStatusCall() {
    const real = CollabChild.prototype.call
    const gate = deferred()
    let held = false
    const spy = spyOn(CollabChild.prototype, 'call').mockImplementation(function (this: CollabChild, name: string, args: Record<string, unknown>) {
      if (name === 'collab_workspace_status' && !held) {
        held = true
        return gate.promise.then(() => real.call(this, name, args))
      }
      return real.call(this, name, args)
    })
    return { release: () => gate.resolve(), isHeld: () => held, restore: () => spy.mockRestore() }
  }
  const pend = async (w: World, e: LineageEntry, n: number) =>
    ({ nonce: newStartNonce(), call_ref: ref(e, n), child_pid: await deadPid(), child_lstart: null, workspace_id: w.workspaceId, at: new Date(w.clock.now).toISOString() })

  test("a marker replaced while the reconcile waited on the journal is left alone: neither cleared nor recorded", async () => {
    const w = world()
    const e = entry(w)
    const m1 = await pend(w, e, 1)
    w.store.upsert({ ...e, pending_start: m1 })
    const hold = holdFirstStatusCall()
    try {
      const p = pool(w)
      const rec = p.reconcile()
      await until(hold.isHeld)
      const m2 = await pend(w, e, 2) // a newer start wrote its own marker meanwhile
      w.store.upsert({ ...w.store.get(e.lineage)!, pending_start: m2 })
      hold.release()
      await rec
      expect(fresh(w).get(e.lineage)!.pending_start?.nonce).toBe(m2.nonce)
      expect(events(w, 'reconcile').map((l) => [l.outcome, l.code])).toEqual([['kept', 'marker_changed']])
    } finally {
      hold.restore()
    }
  }, 30_000)

  test('a session_start waits behind the hub-start reconcile of its lineage, then settles nothing twice', async () => {
    const w = world()
    const e = entry(w)
    const m1 = await pend(w, e, 1)
    w.store.upsert({ ...e, pending_start: m1 })
    const hold = holdFirstStatusCall()
    try {
      const p = pool(w)
      const rec = p.reconcile()
      await until(hold.isHeld)
      const nonce = newStartNonce()
      let done = false
      const run = p.startSession(e.lineage, startArgs(w, nonce), ref(e, 2), nonce, w.workspaceId).then((o) => { done = true; return o })
      await Bun.sleep(1500) // long enough for an unchained start to settle the marker and finish
      expect(done).toBe(false)
      expect(fresh(w).get(e.lineage)!.pending_start?.nonce).toBe(m1.nonce)
      expect(events(w, 'reconcile')).toEqual([])
      hold.release()
      await rec
      expect(outcome(await run)).toBe('ok')
      expect(events(w, 'reconcile').map((l) => l.outcome)).toEqual(['cleared'])
      expect(await activeSessions(w)).toHaveLength(1)
    } finally {
      hold.restore()
    }
  }, 30_000)
})

describe('a retirement whose end fails (Task 40b review)', () => {
  const failing = (r: Awaited<ReturnType<HostCli>>): HostCli => async () => r
  async function retireWith(hostCli: HostCli): Promise<{ w: World; e: LineageEntry; sid: string }> {
    const w = world()
    const p = pool(w, { hostCli })
    const e = entry(w)
    const sid = await live(w, p, e)
    p.detached(e.lineage)
    w.clock.now += 7 * DAY
    w.clock.mono += 7 * DAY
    await p.tick()
    return { w, e, sid }
  }

  test('a non-zero exit raises orphan_session for the session, labels the exit code, and the lineage still retires', async () => {
    const { w, e, sid } = await retireWith(failing({ code: 1, stdout: '', stderr: 'refused' }))
    expect(w.statuses).toContainEqual([e.lineage, `orphan_session ${sid}`])
    expect(events(w, 'retire_end').at(-1)).toMatchObject({ outcome: 'error', code: '1', session_id: sid })
    expect(fresh(w).get(e.lineage)).toMatchObject({ state: 'retired', session_id: null, past_sessions: [sid] })
    expect(existsSync(w.paths.credentialFile(sid))).toBe(true) // the credential is left for Ai's host end
  }, 30_000)

  for (const cause of ['timeout', 'signal', 'spawn_failed'] as const) {
    test(`a host CLI that never exited (${cause}) is labelled ${cause}, never a bare timeout`, async () => {
      const { w, e, sid } = await retireWith(failing({ code: null, stdout: '', stderr: '', cause }))
      expect(events(w, 'retire_end').at(-1)).toMatchObject({ outcome: 'error', code: cause })
      expect(w.statuses).toContainEqual([e.lineage, `orphan_session ${sid}`])
    }, 30_000)
  }

  test('a successful end raises no status', async () => {
    const { w } = await retireWith(failing({ code: 0, stdout: '', stderr: '' }))
    expect(events(w, 'retire_end').at(-1)).toMatchObject({ outcome: 'ok', code: '0' })
    expect(w.statuses).toEqual([])
  }, 30_000)
})

describe('retirement guards its lineage while it ends the session (Task 40b review)', () => {
  test('while the host end runs, a reattach and a call get seat_session_ended and no child is resumed', async () => {
    const w = world()
    const entered = deferred()
    const release = deferred()
    const hostCli: HostCli = async () => { entered.resolve(); await release.promise; return { code: 0, stdout: '', stderr: '' } }
    const p = pool(w, { hostCli })
    const e = entry(w)
    await live(w, p, e)
    const c = await childOf(p, e.lineage)
    p.detached(e.lineage)
    w.clock.now += 7 * DAY
    w.clock.mono += 7 * DAY
    const ticking = p.tick()
    await entered.promise
    p.attached(e.lineage) // the pipe comes back in the window
    const starts = events(w, 'child_start').length
    expect(await p.childFor(e.lineage)).toMatchObject({ ok: false, code: 'seat_session_ended' })
    const nonce = newStartNonce()
    expect(outcome(await p.startSession(e.lineage, startArgs(w, nonce), ref(e, 2), nonce, w.workspaceId))).toBe('refuse:seat_session_ended')
    release.resolve()
    await ticking
    expect(events(w, 'child_start')).toHaveLength(starts)
    expect(c.alive()).toBe(false)
    expect(fresh(w).get(e.lineage)!.state).toBe('retired')
  }, 30_000)

  test('a child that is still starting when retirement begins is stopped, not left attached to a retired lineage', async () => {
    const w = world()
    const p = pool(w)
    const e = entry(w)
    const sid = await live(w, p, e)
    p.detached(e.lineage)
    w.clock.mono += 1_000
    await p.tick() // the detached child is drained and stopped; the next call must spawn a resume
    const real = CollabChild.start
    const gate = deferred()
    const created: CollabChild[] = []
    let entered = false
    const spy = spyOn(CollabChild, 'start').mockImplementation(async (...args: Parameters<typeof CollabChild.start>) => {
      entered = true
      await gate.promise
      const c = await real.apply(CollabChild, args)
      if (!('failed' in c)) created.push(c)
      return c
    })
    try {
      const got = p.childFor(e.lineage)
      await until(() => entered)
      w.clock.now += 7 * DAY
      const ticking = p.tick() // retirement begins while the spawn is still starting
      await Bun.sleep(50)
      gate.resolve()
      expect(await got).toMatchObject({ ok: false, code: 'seat_session_ended' })
      await ticking
      expect(created).toHaveLength(1)
      expect(created[0]!.alive()).toBe(false)
      expect(fresh(w).get(e.lineage)).toMatchObject({ state: 'retired', past_sessions: [sid] })
      expect(await activeSessions(w)).toEqual([])
    } finally {
      spy.mockRestore()
    }
  }, 30_000)
})

describe('makeHostCli says why it has no exit code (Task 40b review)', () => {
  const hostWith = (script: string, bun = process.execPath, o?: HostCliOptions) => {
    const dist = temp('cb-hostcli-')
    writeFileSync(join(dist, 'agenttool-collab-host.js'), script)
    return makeHostCli({ bun, dist, journal: '/j/collab.sqlite', home: temp('cb-hostcli-home-') }, o)
  }

  test('an exit code has no cause', async () => {
    const r = await hostWith('process.exit(3)\n')(['x'], 5_000)
    expect(r.code).toBe(3)
    expect(r.cause).toBeUndefined()
  })

  test('a timeout is a timeout', async () => {
    const r = await hostWith('setTimeout(() => {}, 60000)\n')(['x'], 300)
    expect(r).toMatchObject({ code: null, cause: 'timeout' })
  }, 30_000)

  test('death by a signal is a signal', async () => {
    const r = await hostWith("process.kill(process.pid, 'SIGKILL')\n")(['x'], 5_000)
    expect(r).toMatchObject({ code: null, cause: 'signal' })
  })

  test('a host CLI that could not be started is spawn_failed', async () => {
    const r = await hostWith('', '/nonexistent/bun')(['x'], 5_000)
    expect(r).toMatchObject({ code: null, cause: 'spawn_failed' })
  })

  // Task 63 conformance-4-10: the timeout is a deadline, not a request. Both stubs end by themselves after 8 s, so a build that
  // waits for them leaves no process behind, and fails the elapsed-time check instead of hanging the suite.
  test('a host CLI that ignores SIGTERM is killed after the grace and answered as a timeout', async () => {
    const t0 = Date.now()
    const r = await hostWith("process.on('SIGTERM', () => {})\nsetTimeout(() => process.exit(0), 8000)\n", process.execPath, { killGraceMs: 200, reapGraceMs: 200 })(['x'], 300)
    expect(r).toMatchObject({ code: null, cause: 'timeout' })
    expect(Date.now() - t0).toBeLessThan(4_000)
  }, 30_000)

  test('a grandchild that keeps the output pipes open cannot hold the answer past the deadline', async () => {
    const t0 = Date.now()
    // The CLI itself exits 0 at once; a sleeping grandchild inherits its stdout and stderr and holds both open for 8 s.
    const script = "Bun.spawn(['/bin/sleep', '8'], { stdin: 'ignore', stdout: 'inherit', stderr: 'inherit' })\nprocess.exit(0)\n"
    const r = await hostWith(script, process.execPath, { killGraceMs: 200, reapGraceMs: 200 })(['x'], 300)
    expect(r.code).toBe(0) // the exit status it really had stands; only the unread rest of its output is given up
    expect(Date.now() - t0).toBeLessThan(4_000)
  }, 30_000)
})

describe('a hub-start reconcile that cannot write lineages.json uses a §9.2 status word (Task 63 conformance-4-8)', () => {
  test('a detached_since that cannot be written is needs Yu: config, never a word §9.2 does not define', async () => {
    const w = world()
    const e = entry(w) // detached_since null: the first step of reconcile writes it
    const p = pool(w)
    const up = spyOn(w.store, 'upsert').mockImplementation(() => { throw new Error('ENOSPC: no space left on device') })
    try {
      await p.reconcile() // resolves: never throws
    } finally {
      up.mockRestore()
    }
    expect(w.statuses).toEqual([[e.lineage, 'needs Yu: config']])
    expect(fresh(w).get(e.lineage)!.detached_since).toBeNull()
  }, 30_000)

  test('a pending_start that cannot be settled because the store cannot be written keeps the marker and reports needs Yu: config', async () => {
    const w = world()
    await startCollabSession({ journal: w.paths.sharedJournal, home: w.home, root: w.mirror, actor: 'other', role: `${rolePrefix('nuance', 'macair', newStartNonce(), 'claude')}x` })
    const e = entry(w, { detached_since: new Date(w.clock.now).toISOString() }) // the first step has nothing to write
    const marker = { nonce: newStartNonce(), call_ref: ref(e, 1), child_pid: await deadPid(), child_lstart: null, workspace_id: w.workspaceId, at: new Date(w.clock.now).toISOString() }
    w.store.upsert({ ...e, pending_start: marker })
    const p = pool(w)
    const up = spyOn(w.store, 'upsert').mockImplementation(() => { throw new Error('ENOSPC: no space left on device') })
    try {
      await p.reconcile() // no session carries the nonce, so the marker is to be cleared, and that write fails
    } finally {
      up.mockRestore()
    }
    expect(w.statuses).toEqual([[e.lineage, 'needs Yu: config']])
    expect(fresh(w).get(e.lineage)!.pending_start).toMatchObject({ nonce: marker.nonce })
  }, 30_000)
})
