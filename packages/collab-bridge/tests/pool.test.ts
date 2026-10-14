import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ChildPool } from '../src/air/pool.ts'
import type { LineageEntry } from '../src/air/lineages.ts'
import { COLLAB_DIST, temp } from './helpers.ts'
import { writeFakeCollab } from './fake-collab.ts'
import { tamperJournal } from './mcp-harness.ts'
import { activeSessions, childOf, cleanupPools, entry, events, fresh, pool, seedLive, world, type World } from './pool-world.ts'

afterEach(cleanupPools)

/** A child's environment as the kernel holds it (ps -E), so the test sees what the child really got. */
const envOf = (pid: number): string =>
  Bun.spawnSync(['/bin/ps', '-E', '-ww', '-o', 'command=', '-p', String(pid)], { env: { PATH: '/usr/bin:/bin' } }).stdout.toString()

/** A pool whose children run Task 37's fake Collab bin (fake_slow answers after 1.5 s), and a lineage already live on a
 *  credential file that exists. The fake ignores the session file, so a resume is just a start. */
function slowWorld(): { w: World; p: ChildPool; e: LineageEntry } {
  const w = world()
  const dist = writeFakeCollab(temp('cb-pool-fake-'), { tools: { fake_slow: { kind: 'delay', ms: 1500 } } })
  const p = pool(w, { spec: { bun: process.execPath, dist, journal: w.paths.sharedJournal, home: w.home } })
  const cred = join(w.home, 'fake-credential.json')
  writeFileSync(cred, '{}', { mode: 0o600 })
  const e = entry(w, { state: 'live', session_id: 'ses_fake', credential_path: cred, workspace_id: w.workspaceId })
  return { w, p, e }
}

describe('one child per lineage', () => {
  test('one child per lineage, reused', async () => {
    const w = world()
    const p = pool(w)
    const e = entry(w)
    await seedLive(w, e)
    const a = await childOf(p, e.lineage)
    expect((await childOf(p, e.lineage)).pid).toBe(a.pid)
    const starts = events(w, 'child_start').length
    // After a stop, two calls at once still share one new child.
    p.detached(e.lineage)
    w.clock.mono += 1_000
    await p.tick()
    expect(a.alive()).toBe(false)
    const [b, c] = await Promise.all([childOf(p, e.lineage), childOf(p, e.lineage)])
    expect(b.pid).toBe(c.pid)
    expect(events(w, 'child_start')).toHaveLength(starts + 1)
  }, 30_000)

  test('a detached child is drained and stopped after the window, and a reattach inside it keeps it', async () => {
    const w = world()
    const p = pool(w)
    const e = entry(w)
    await seedLive(w, e)
    const c = await childOf(p, e.lineage)
    p.attached(e.lineage)
    p.detached(e.lineage)
    expect(fresh(w).get(e.lineage)!.detached_since).toBe(new Date(w.clock.now).toISOString())
    w.clock.mono += 999
    await p.tick()
    expect(c.alive()).toBe(true)
    p.attached(e.lineage)
    expect(fresh(w).get(e.lineage)!.detached_since).toBeNull()
    w.clock.mono += 5_000
    await p.tick()
    expect(c.alive()).toBe(true)
    p.detached(e.lineage)
    w.clock.mono += 1_000
    await p.tick()
    expect(c.alive()).toBe(false)
    expect(await c.exited).toBe(0) // stdin EOF, not a signal
  }, 30_000)

  test('a 30-minute monotonic jump drains and stops a detached child at once', async () => {
    const w = world()
    const p = pool(w, { childWindowMs: undefined }) // the production 10-minute window
    const e = entry(w)
    await seedLive(w, e)
    const c = await childOf(p, e.lineage)
    p.detached(e.lineage)
    w.clock.mono += 30 * 60_000 // the Mac slept with the link up; CLOCK_MONOTONIC counted it
    await p.tick()
    expect(c.alive()).toBe(false)
  }, 30_000)

  test('a detached child past its window with a call in flight is drained, kept until the call ends, then stopped', async () => {
    const { w, p, e } = slowWorld()
    const c = await childOf(p, e.lineage)
    const call = c.call('fake_slow', {})
    await Bun.sleep(50)
    expect(c.inFlight()).toBe(1)
    p.detached(e.lineage)
    w.clock.mono += 1_000
    await p.tick() // marks it draining; never waits for the call
    expect(c.alive()).toBe(true)
    expect(c.inFlight()).toBe(1)
    expect((await call).outcome).toBe('ok')
    await p.tick() // zero in flight: the stop
    expect(c.alive()).toBe(false)
    expect(await c.exited).toBe(0) // stdin EOF, not a signal
  }, 30_000)

  test('a reattach while a detached child drains clears the mark and keeps the child', async () => {
    const { w, p, e } = slowWorld()
    const c = await childOf(p, e.lineage)
    const call = c.call('fake_slow', {})
    await Bun.sleep(50)
    p.detached(e.lineage)
    w.clock.mono += 1_000
    await p.tick() // draining, the call still in flight
    p.attached(e.lineage)
    expect((await childOf(p, e.lineage)).pid).toBe(c.pid) // a new forward goes to the same child, no respawn
    expect((await call).outcome).toBe('ok')
    w.clock.mono += 5_000
    await p.tick()
    expect(c.alive()).toBe(true)
    expect(events(w, 'child_start')).toHaveLength(1)
  }, 30_000)

  test('liveCount counts attached lineages and running children of that device only', async () => {
    const w = world()
    const p = pool(w)
    const a = entry(w)
    const b = entry(w)
    const z = entry(w, { device: 'zerone', user: 'yu' })
    p.attached(a.lineage)
    expect(p.liveCount('nuance')).toBe(1)
    await seedLive(w, b)
    await childOf(p, b.lineage)
    expect(p.liveCount('nuance')).toBe(2)
    await seedLive(w, z)
    await childOf(p, z.lineage)
    expect(p.liveCount('nuance')).toBe(2)
    expect(p.liveCount('zerone')).toBe(1)
  }, 30_000)

  test("stopDevice stops only that device's children, after their calls finish", async () => {
    const w = world()
    const p = pool(w)
    const n = entry(w)
    const z = entry(w, { device: 'zerone', user: 'yu' })
    await seedLive(w, n)
    await seedLive(w, z)
    const nc = await childOf(p, n.lineage)
    const zc = await childOf(p, z.lineage)
    // A bounded Collab wait gives the call a known length: first the head anchor, then 1.5 s with nothing new.
    const cursor = (await activeSessions(w)).find((s) => s.id === w.store.get(n.lineage)!.session_id) as unknown as { cursor: unknown }
    const head = await nc.call('collab_events_wait', { workspace_id: w.workspaceId, after_anchor: cursor.cursor, wait_ms: 1 })
    expect(head.outcome).toBe('ok')
    const anchor = head.outcome === 'ok' ? head.result.structuredContent!.next_anchor : null
    const order: string[] = []
    const waiting = nc.call('collab_events_wait', { workspace_id: w.workspaceId, after_anchor: anchor, wait_ms: 1500 }).then((o) => { order.push(`call ${o.outcome}`) })
    await Bun.sleep(100)
    await p.stopDevice('nuance').then(() => { order.push('stopped') })
    await waiting
    expect(order).toEqual(['call ok', 'stopped'])
    expect(nc.alive()).toBe(false)
    expect(zc.alive()).toBe(true)
  }, 30_000)
})

describe('sessions across stops and ends', () => {
  test('a later call resumes the same session with a new generation', async () => {
    const w = world()
    const p = pool(w)
    const e = entry(w)
    const sid = await seedLive(w, e)
    expect((await activeSessions(w)).map((s) => [s.id, s.generation])).toEqual([[sid, 1]])
    const c = await childOf(p, e.lineage)
    expect(events(w, 'child_start').at(-1)).toMatchObject({ outcome: 'ok', code: 'resume', session_id: sid })
    expect((await c.call('collab_next', { workspace_id: w.workspaceId })).outcome).toBe('ok')
    expect((await activeSessions(w)).map((s) => [s.id, s.generation])).toEqual([[sid, 2]])
    // After the window the child stops; the next call resumes the session once more.
    p.detached(e.lineage)
    w.clock.mono += 1_000
    await p.tick()
    expect(c.alive()).toBe(false)
    const again = await childOf(p, e.lineage)
    expect((await again.call('collab_next', { workspace_id: w.workspaceId })).outcome).toBe('ok')
    expect((await activeSessions(w)).map((s) => [s.id, s.generation])).toEqual([[sid, 3]])
  }, 30_000)

  test('a missing credential file is seat_session_ended without a spawn', async () => {
    const w = world()
    const p = pool(w)
    const e = entry(w)
    const sid = await seedLive(w, e)
    rmSync(w.paths.credentialFile(sid)) // a host end removes it (K23)
    expect(await p.childFor(e.lineage)).toMatchObject({ ok: false, code: 'seat_session_ended' })
    expect(events(w, 'child_start')).toEqual([])
    expect(fresh(w).get(e.lineage)).toMatchObject({ state: 'ended', session_id: null, credential_path: null, past_sessions: [sid] })
    expect(events(w, 'session_ended').at(-1)).toMatchObject({ session_id: sid, code: 'credential_missing' })
  }, 30_000)

  test('a missing credential on a session_start call ends the old session and starts a fresh child with no session file', async () => {
    const w = world()
    const p = pool(w)
    const e = entry(w)
    const sid = await seedLive(w, e)
    rmSync(w.paths.credentialFile(sid)) // a host end removes it (K23)
    const started = await childOf(p, e.lineage, true)
    expect(fresh(w).get(e.lineage)).toMatchObject({ state: 'ended', session_id: null, credential_path: null, past_sessions: [sid] })
    expect(events(w, 'session_ended').at(-1)).toMatchObject({ session_id: sid, code: 'credential_missing' })
    expect(events(w, 'child_start').map((l) => [l.outcome, l.code])).toEqual([['ok', 'fresh']])
    expect(envOf(started.pid)).toContain(`AGENTOOL_COLLAB_DB=${w.paths.sharedJournal}`)
    expect(envOf(started.pid)).not.toContain('AGENTOOL_COLLAB_SESSION_FILE') // unbound: it resumes nothing
  }, 30_000)

  test('a missing credential drains the child that was bound to it, and the call is seat_session_ended', async () => {
    const w = world()
    const p = pool(w)
    const e = entry(w)
    const sid = await seedLive(w, e)
    const c = await childOf(p, e.lineage)
    rmSync(w.paths.credentialFile(sid))
    expect(await p.childFor(e.lineage)).toMatchObject({ ok: false, code: 'seat_session_ended' })
    expect(await c.exited).toBe(0) // stdin EOF, not a signal
    expect(c.alive()).toBe(false)
    expect(events(w, 'child_start')).toHaveLength(1) // no respawn
    expect(events(w, 'session_ended').at(-1)).toMatchObject({ session_id: sid, code: 'credential_missing' })
    expect(fresh(w).get(e.lineage)).toMatchObject({ state: 'ended', session_id: null, credential_path: null, past_sessions: [sid] })
  }, 30_000)

  test('a session_start call after session_end gets a fresh child with no session file, after the old child has exited', async () => {
    const w = world()
    const p = pool(w)
    const e = entry(w)
    const sid = await seedLive(w, e)
    const c = await childOf(p, e.lineage)
    expect((await c.call('collab_session_end', { reason: 'done' })).outcome).toBe('ok')
    p.sessionEnded(e.lineage)
    expect(await p.childFor(e.lineage)).toMatchObject({ ok: false, code: 'seat_session_ended' }) // every other call
    const next = await childOf(p, e.lineage, true) // a new session_start may begin
    expect(next.pid).not.toBe(c.pid)
    expect(c.alive()).toBe(false) // a respawn only after the old child has exited
    expect(await c.exited).toBe(0)
    expect(events(w, 'child_start').at(-1)).toMatchObject({ outcome: 'ok', code: 'fresh' })
    expect(envOf(next.pid)).not.toContain('AGENTOOL_COLLAB_SESSION_FILE')
    expect(fresh(w).get(e.lineage)).toMatchObject({ state: 'ended', session_id: null, past_sessions: [sid] }) // the new session is not bound until session_start returns
  }, 30_000)

  test('after session_end, a call is seat_session_ended and the child is drained', async () => {
    const w = world()
    const p = pool(w)
    const e = entry(w)
    const sid = await seedLive(w, e)
    const c = await childOf(p, e.lineage)
    expect((await c.call('collab_session_end', { reason: 'done' })).outcome).toBe('ok')
    p.sessionEnded(e.lineage)
    expect(fresh(w).get(e.lineage)).toMatchObject({ state: 'ended', session_id: null, credential_path: null, past_sessions: [sid] })
    expect(await p.childFor(e.lineage)).toMatchObject({ ok: false, code: 'seat_session_ended' })
    expect(await c.exited).toBe(0)
  }, 30_000)

  test('cursor_reset_required from a live call parks the lineage and later calls get seat_recovery_required', async () => {
    const w = world()
    const p = pool(w)
    const e = entry(w)
    const sid = await seedLive(w, e)
    const c = await childOf(p, e.lineage)
    const out = await c.call('collab_next', { workspace_id: w.workspaceId, known_cursor: { epoch_id: 'epoch_x', sequence: 99, hash: 'a'.repeat(64) } })
    expect(out.outcome).toBe('error')
    if (out.outcome !== 'error') throw new Error('unreachable')
    expect(out.result.structuredContent?.error).toBe('cursor_reset_required')
    // The forwarder parks on exactly this code (Task 51); the details are Collab's, cursors and cause, never a secret.
    const { error: _e, message: _m, ...details } = out.result.structuredContent!
    p.park(e.lineage, 'cursor_reset_required', details)
    expect(w.statuses).toContainEqual([e.lineage, `needs Ai: seat_recovery ${sid}`])
    expect(await p.childFor(e.lineage)).toMatchObject({ ok: false, code: 'seat_recovery_required' })
    expect(fresh(w).get(e.lineage)!.parked).toEqual({ cause: 'cursor_reset_required', details })
    await c.exited
  }, 30_000)

  test('unpark is refused while a child of that lineage runs', async () => {
    const w = world()
    const p = pool(w)
    const e = entry(w)
    await seedLive(w, e)
    const c = await childOf(p, e.lineage)
    expect(p.unpark(e.lineage)).toBe('not_parked')
    p.park(e.lineage, 'cursor_reset_required', {})
    expect(c.alive()).toBe(true) // the stop has begun, the exit has not been seen yet
    expect(p.unpark(e.lineage)).toBe('child_alive')
    expect(fresh(w).get(e.lineage)!.parked).not.toBeNull()
    await c.exited
  }, 30_000)

  test('unpark clears parked and the next call resumes', async () => {
    const w = world()
    const p = pool(w)
    const e = entry(w)
    const sid = await seedLive(w, e)
    const c = await childOf(p, e.lineage)
    p.park(e.lineage, 'cursor_reset_required', {})
    await c.exited
    expect(p.unpark(e.lineage)).toBe('ok')
    expect(w.statuses.at(-1)).toEqual([e.lineage, null])
    expect(fresh(w).get(e.lineage)!.parked).toBeNull()
    const again = await childOf(p, e.lineage)
    expect(events(w, 'child_start').at(-1)).toMatchObject({ code: 'resume', session_id: sid })
    expect((await again.call('collab_next', { workspace_id: w.workspaceId })).outcome).toBe('ok')
  }, 30_000)
})

describe('start-up failures and the build check', () => {
  test('a classified start failure is not respawned on the next call', async () => {
    const w = world()
    mkdirSync(w.paths.sharedJournal, { recursive: true }) // the store refuses a journal that is a directory
    const p = pool(w)
    const e = entry(w)
    expect(await p.childFor(e.lineage, { forStart: true })).toMatchObject({ ok: false, code: 'hub_away' })
    expect(w.statuses).toContainEqual([e.lineage, 'child_start_failed'])
    expect(await p.childFor(e.lineage, { forStart: true })).toMatchObject({ ok: false, code: 'hub_away' })
    expect(events(w, 'child_start').map((l) => [l.outcome, l.code])).toEqual([['failed', 'child_start_failed']])
  }, 30_000)

  test('a resume the host refuses for its cursor parks the lineage as seat_recovery_required, and Ai\'s repair lets it resume', async () => {
    const w = world()
    const p = pool(w)
    const e = entry(w)
    const sid = await seedLive(w, e)
    const credentialPath = w.store.get(e.lineage)!.credential_path!
    const original = readFileSync(credentialPath, 'utf8')
    const credential = JSON.parse(original)
    credential.last_cursor = { ...credential.last_cursor, sequence: credential.last_cursor.sequence + 1000 }
    writeFileSync(credentialPath, JSON.stringify(credential)) // an existing file keeps its 0600
    expect(await p.childFor(e.lineage)).toMatchObject({ ok: false, code: 'seat_recovery_required' })
    expect(events(w, 'child_start').map((l) => [l.outcome, l.code])).toEqual([['failed', 'seat_recovery_required']])
    expect(events(w, 'park').at(-1)).toMatchObject({ lineage: e.lineage, session_id: sid, code: 'cursor_reset_required' })
    expect(w.statuses).toContainEqual([e.lineage, `needs Ai: seat_recovery ${sid}`])
    expect(fresh(w).get(e.lineage)).toMatchObject({ state: 'live', session_id: sid, parked: { cause: 'cursor_reset_required' } }) // the session itself is not ended
    // Parked: every later call is refused without another spawn, a session_start call included.
    expect(await p.childFor(e.lineage)).toMatchObject({ ok: false, code: 'seat_recovery_required' })
    expect(await p.childFor(e.lineage, { forStart: true })).toMatchObject({ ok: false, code: 'seat_recovery_required' })
    expect(events(w, 'child_start')).toHaveLength(1)
    // After the repair (here: the credential as it was) the lineage unparks and the next call resumes the session.
    writeFileSync(credentialPath, original)
    expect(p.unpark(e.lineage)).toBe('ok')
    const again = await childOf(p, e.lineage)
    expect(events(w, 'child_start').at(-1)).toMatchObject({ outcome: 'ok', code: 'resume', session_id: sid })
    expect((await again.call('collab_next', { workspace_id: w.workspaceId })).outcome).toBe('ok')
  }, 30_000)

  test('a credential the child refuses as invalid ends the lineage, which is not sticky: a session_start call may begin again', async () => {
    const w = world()
    const p = pool(w)
    const e = entry(w)
    const sid = await seedLive(w, e)
    writeFileSync(w.store.get(e.lineage)!.credential_path!, JSON.stringify({ format: 'agenttool.collab/session-file/0' }))
    expect(await p.childFor(e.lineage)).toMatchObject({ ok: false, code: 'seat_session_ended' })
    expect(events(w, 'child_start').map((l) => [l.outcome, l.code])).toEqual([['failed', 'seat_session_ended']])
    expect(events(w, 'session_ended').at(-1)).toMatchObject({ session_id: sid, code: 'credential_invalid' })
    expect(fresh(w).get(e.lineage)).toMatchObject({ state: 'ended', session_id: null, credential_path: null, past_sessions: [sid] })
    expect(await p.childFor(e.lineage)).toMatchObject({ ok: false, code: 'seat_session_ended' })
    expect(events(w, 'child_start')).toHaveLength(1) // no second spawn, and no child_start_failed mark
    const next = await childOf(p, e.lineage, true)
    expect(events(w, 'child_start').at(-1)).toMatchObject({ outcome: 'ok', code: 'fresh' })
    expect(envOf(next.pid)).not.toContain('AGENTOOL_COLLAB_SESSION_FILE')
  }, 30_000)

  test('after journal_invalid no lineage gets a new child until a new pool starts', async () => {
    const w = world()
    const p = pool(w)
    const e = entry(w)
    await seedLive(w, e)
    const other = entry(w)
    tamperJournal(w.paths.sharedJournal)
    expect(await p.childFor(e.lineage)).toMatchObject({ ok: false, code: 'hub_away' })
    expect(w.statuses).toContainEqual([e.lineage, 'journal_invalid'])
    const starts = events(w, 'child_start').length
    expect(await p.childFor(e.lineage)).toMatchObject({ ok: false, code: 'hub_away' })
    expect(await p.childFor(other.lineage, { forStart: true })).toMatchObject({ ok: false, code: 'hub_away' })
    expect(events(w, 'child_start')).toHaveLength(starts)
    // A new pool (the next hub start) tries once again.
    const p2 = pool(w)
    expect(await p2.childFor(other.lineage, { forStart: true })).toMatchObject({ ok: false, code: 'hub_away' })
    expect(events(w, 'child_start')).toHaveLength(starts + 1)
  }, 30_000)

  test('after a dist change a live child still answers, and a new lineage or a resume gets collab_build_changed', async () => {
    const w = world()
    const p = pool(w)
    const a = entry(w)
    await seedLive(w, a)
    const c = await childOf(p, a.lineage)
    w.build.changed = true
    expect((await childOf(p, a.lineage)).pid).toBe(c.pid)
    expect((await c.call('collab_next', { workspace_id: w.workspaceId })).outcome).toBe('ok')
    const b = entry(w)
    expect(await p.childFor(b.lineage, { forStart: true })).toMatchObject({ ok: false, code: 'collab_build_changed' })
    expect(w.statuses).toContainEqual([b.lineage, 'collab_build_changed'])
    p.detached(a.lineage)
    w.clock.mono += 1_000
    await p.tick()
    expect(await p.childFor(a.lineage)).toMatchObject({ ok: false, code: 'collab_build_changed' })
  }, 30_000)
})

describe('refusals that never spawn', () => {
  test('a lineage with no session is session_required for every call but the session_start one', async () => {
    const w = world()
    const p = pool(w)
    const e = entry(w) // pending: attached, no session yet
    expect(await p.childFor(e.lineage)).toMatchObject({ ok: false, code: 'session_required' })
    expect(events(w, 'child_start')).toEqual([])
    expect(fresh(w).get(e.lineage)!.state).toBe('pending')
    // The session_start call is the one that may start a child.
    expect((await childOf(p, e.lineage, true)).alive()).toBe(true)
  }, 30_000)

  test('a lineage the hub has no entry for is hub_away', async () => {
    const w = world()
    const p = pool(w)
    expect(await p.childFor('lin_unknown')).toMatchObject({ ok: false, code: 'hub_away' })
    expect(await p.childFor('lin_unknown', { forStart: true })).toMatchObject({ ok: false, code: 'hub_away' })
    expect(events(w, 'child_start')).toEqual([])
    expect(fresh(w).get('lin_unknown')).toBeUndefined()
  })

  test('a retired lineage is seat_session_ended, a session_start call included', async () => {
    const w = world()
    const p = pool(w)
    const e = entry(w, { state: 'retired', detached_since: new Date(w.clock.now).toISOString() })
    expect(await p.childFor(e.lineage)).toMatchObject({ ok: false, code: 'seat_session_ended' })
    expect(await p.childFor(e.lineage, { forStart: true })).toMatchObject({ ok: false, code: 'seat_session_ended' })
    expect(events(w, 'child_start')).toEqual([])
    expect(fresh(w).get(e.lineage)!.state).toBe('retired')
  })
})

describe('the hub way, always', () => {
  test('AGENTOOL_COLLAB_ALLOW_CURSOR_RECOVERY is never in a child\'s env', async () => {
    process.env.AGENTOOL_COLLAB_ALLOW_CURSOR_RECOVERY = '1' // even when the hub's own env carries it
    try {
      const w = world()
      const p = pool(w)
      const e = entry(w)
      const freshChild = await childOf(p, e.lineage, true)
      expect(envOf(freshChild.pid)).toContain(`AGENTOOL_COLLAB_DB=${w.paths.sharedJournal}`)
      expect(envOf(freshChild.pid)).not.toContain('AGENTOOL_COLLAB_ALLOW_CURSOR_RECOVERY')
      const r = entry(w)
      await seedLive(w, r)
      const resumed = await childOf(p, r.lineage)
      expect(envOf(resumed.pid)).toContain('AGENTOOL_COLLAB_SESSION_FILE=')
      expect(envOf(resumed.pid)).not.toContain('AGENTOOL_COLLAB_ALLOW_CURSOR_RECOVERY')
    } finally {
      delete process.env.AGENTOOL_COLLAB_ALLOW_CURSOR_RECOVERY
    }
  }, 30_000)

  test('unboundChild is a fresh child on the shared journal with no session file, and the build check never gates it', async () => {
    const w = world()
    const p = pool(w)
    w.build.changed = true
    const u = await p.unboundChild()
    if ('failed' in u) throw new Error('the unbound child did not start')
    try {
      expect(events(w, 'child_start').map((l) => [l.outcome, l.code, l.journal])).toEqual([['ok', 'unbound', w.paths.sharedJournal]])
      expect(envOf(u.pid)).toContain(`AGENTOOL_COLLAB_DB=${w.paths.sharedJournal}`)
      expect(envOf(u.pid)).not.toContain('AGENTOOL_COLLAB_SESSION_FILE')
    } finally {
      await u.stop()
    }
  }, 30_000)

  test('a pool refuses any journal but the shared one', () => {
    const w = world()
    expect(() => new ChildPool(w.deps({ spec: { bun: process.execPath, dist: COLLAB_DIST, journal: w.paths.privateJournal, home: w.home } })))
      .toThrow('shared journal')
  })
})
