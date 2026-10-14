import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gateStart } from '../src/gate.ts'
import { describeCommand, requestCancel, resultOf as gateResult, statusOf } from '../src/gatekeeper.ts'
import { countActive, jobDir, readJson, readState, settleNeverReached, writeJsonAtomic, writeState, type JobState } from '../src/jobs.ts'
import { verifyLedger } from '../src/ledger.ts'
import { summonPaths } from '../src/paths.ts'
import { CLOCK_SKEW_MS, newRequestId } from '../src/request.ts'
import { markOrphans, processStartTime, runOnce, sweepJobs, type RunnerDeps } from '../src/runner.ts'
import { BUILD_ALLOWLIST, cleanupTmps, DEFAULT_ALLOWLIST, EDIT_ALLOWLIST, FLAGGED_ALLOWLIST, fakeGitRoot, makeFakeClaude, repoHome, runGatekeeper, sampleRequest, targetHome } from './helpers.ts'

afterEach(cleanupTmps)

let fake: ReturnType<typeof makeFakeClaude>
beforeEach(() => { fake = makeFakeClaude() })

const RUNNER_MAIN = join(import.meta.dir, '..', 'src', 'runner-main.ts')
const iso = (ms: number) => new Date(ms).toISOString()
const rdeps = (home: string, over: Partial<RunnerDeps> = {}): RunnerDeps => ({
  paths: summonPaths(home), home, user: 'yu', nowMs: () => Date.now(), claudeBin: () => fake.bin,
  collectInventory: async () => ({ macos: 'test' }), heartbeatMs: 50, pollMs: 25, killGraceMs: 200,
  processStartTime: (pid) => `fake-lstart-${pid}`, ...over,
})
/** Admits through the real gate, as the gatekeeper would. */
function admit(home: string, over = {}) {
  const req = sampleRequest(over)
  const r = gateStart(JSON.stringify(req), { nowMs: () => Date.now(), home, paths: summonPaths(home), guiSessionIsMine: () => true, runnerLoaded: () => true, claudeAvailable: () => true })
  expect(r.status).toBe('admitted')
  return req
}
/** Queues a job directly, for states the gate would never produce (unsafe folder, folder that is a file, ...). */
function enqueue(home: string, over: Partial<JobState> = {}) {
  const paths = summonPaths(home); const req = sampleRequest(); const now = Date.now()
  mkdirSync(jobDir(paths, req.id), { recursive: true, mode: 0o700 })
  writeJsonAtomic(join(jobDir(paths, req.id), 'request.json'), req)
  writeState(paths, { id: req.id, status: 'queued', runtime: 'claude', model: 'sonnet', access: 'review', cwd_real: join(home, 'Projects/x'),
    admitted_at: iso(now), expires_at: iso(now + 15 * 60_000), timeout_s: 900, ...over })
  mkdirSync(paths.spool, { recursive: true, mode: 0o700 })
  writeFileSync(join(paths.spool, req.id), '')
  return req
}
const resultOf = (home: string, id: string) => readJson<any>(join(home, '.local/state/summon/jobs', id, 'result.json'))
const ledgerOf = (home: string): any[] => {
  try { return readFileSync(summonPaths(home).ledger, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) } catch { return [] }
}
const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }
async function waitFor(fn: () => boolean, ms = 8000) {
  const end = Date.now() + ms
  while (!fn()) { if (Date.now() > end) throw new Error('timed out waiting'); await Bun.sleep(20) }
}

describe('runOnce', () => {
  test('runs a queued job to completed with the prompt delivered on stdin', async () => {
    const h = targetHome(); const req = admit(h); const paths = summonPaths(h)
    fake.setMode('ok')
    expect(await runOnce(rdeps(h))).toBe(1)
    const res = resultOf(h, req.id)
    expect(res).toMatchObject({ status: 'completed', result_text: `echo: ${req.prompt}`, exit_code: 0 })
    expect(readdirSync(paths.spool)).toEqual([])
    expect(readState(paths, req.id)).toMatchObject({ status: 'completed' })
    expect(statSync(join(paths.jobs, req.id, 'result.json')).mode & 0o777).toBe(0o600)
    // The prompt rides stdin: it is not in argv. The result text (which echoes it) never reaches the hash-chained ledger.
    expect(readFileSync(fake.argvOut, 'utf8')).not.toContain(req.prompt)
    expect(readFileSync(paths.ledger, 'utf8')).not.toContain('echo:')
    expect(readFileSync(paths.ledger, 'utf8')).not.toContain(req.prompt)
    expect(ledgerOf(h)).toContainEqual(expect.objectContaining({ event: 'job_end', id: req.id, status: 'completed' }))
    expect(verifyLedger(paths.ledger).ok).toBe(true)
  })
  test('a usage warning ends the job as blocked(usage) and stops claude', async () => {
    const h = targetHome(); const req = admit(h)
    fake.setMode('warn')
    await runOnce(rdeps(h))
    expect(readState(summonPaths(h), req.id)).toMatchObject({ status: 'blocked', reason: 'usage', detail: 'usage allowed_warning' })
    expect(resultOf(h, req.id)).toMatchObject({ status: 'blocked', reason: 'usage' })
    expect(typeof resultOf(h, req.id).resets_at).toBe('string')
  }, 15_000)
  test('F15: the move to running is ledgered job_start (id, status running) between admitted and job_end', async () => {
    const h = targetHome(); const req = admit(h); const paths = summonPaths(h)
    fake.setMode('ok')
    await runOnce(rdeps(h))
    const mine = ledgerOf(h).filter((e) => e.id === req.id)
    expect(mine.map((e) => [e.event, e.status])).toEqual([['admitted', undefined], ['job_start', 'running'], ['job_end', 'completed']])
    expect(Object.keys(mine[1]).sort()).toEqual(['event', 'hash', 'id', 'prev', 'status', 'ts'])
    expect(verifyLedger(paths.ledger)).toEqual({ ok: true, entries: 3 })
  })
  test('F15: a job whose start cannot be ledgered is stopped and ends failed, never run unrecorded', async () => {
    const h = targetHome(); const req = admit(h); const paths = summonPaths(h)
    fake.setMode('ok')
    unlinkSync(paths.ledger); mkdirSync(paths.ledger) // from here every append fails (EISDIR)
    await runOnce(rdeps(h))
    expect(readState(paths, req.id)).toMatchObject({ status: 'failed', detail: 'runner error: EISDIR' })
  })
  test('F17: a usage stop keeps its reset time in state.json, and status and result both return it', async () => {
    const h = targetHome(); const req = admit(h); const paths = summonPaths(h)
    fake.setMode('warn')
    await runOnce(rdeps(h))
    const resets = resultOf(h, req.id).resets_at
    expect(typeof resets).toBe('string')
    expect(readState(paths, req.id)?.resets_at).toBe(resets)
    expect(statusOf(paths, 'nuance', req.id, Date.now())).toMatchObject({ status: 'blocked', reason: 'usage', resets_at: resets })
    expect(gateResult(paths, 'nuance', req.id, Date.now())).toMatchObject({ status: 'blocked', reason: 'usage', resets_at: resets })
  }, 15_000)
  test('cancel marker stops the job; while it runs, status shows a pid and a fresh heartbeat', async () => {
    const h = targetHome(); const req = admit(h); const paths = summonPaths(h)
    fake.setMode('slow')
    const p = runOnce(rdeps(h))
    await Bun.sleep(400)
    const running = readState(paths, req.id)!
    expect(running.status).toBe('running')
    expect(running.pid).toBeGreaterThan(0)
    const st = statusOf(paths, 'nuance', req.id, Date.now())
    expect(st).toMatchObject({ status: 'running' })
    expect(typeof st.heartbeat_age_s).toBe('number')
    const beat = join(paths.jobs, req.id, 'heartbeat')
    const first = readFileSync(beat, 'utf8')
    await Bun.sleep(200)
    expect(readFileSync(beat, 'utf8')).not.toBe(first) // still beating
    expect(requestCancel(paths, 'nuance', req.id, Date.now())).toMatchObject({ detail: 'cancel requested' })
    await p
    expect(readState(paths, req.id)?.status).toBe('cancelled')
    expect(resultOf(h, req.id)).toMatchObject({ status: 'cancelled' })
    expect(alive(running.pid!)).toBe(false)
  }, 15_000)
  test('F27: the runner records the child\'s start time, from the injected lookup, next to its pid', async () => {
    const h = targetHome(); const req = admit(h); const paths = summonPaths(h)
    fake.setMode('slow')
    const p = runOnce(rdeps(h))
    await waitFor(() => readState(paths, req.id)?.status === 'running')
    const running = readState(paths, req.id)!
    expect(running.pid_lstart).toBe(`fake-lstart-${running.pid}`)
    requestCancel(paths, 'nuance', req.id, Date.now())
    await p
    expect(readState(paths, req.id)?.pid_lstart).toBeUndefined() // a finished job keeps neither
  }, 15_000)
  test('timeout stops the job', async () => {
    const h = targetHome(); const req = admit(h, { timeout_s: 1 })
    fake.setMode('slow')
    await runOnce(rdeps(h))
    expect(readState(summonPaths(h), req.id)?.status).toBe('timed_out')
    expect(resultOf(h, req.id)).toMatchObject({ status: 'timed_out', detail: 'ran past 1s' })
  }, 15_000)
  describe('F08: the timeout and heartbeat intervals use a monotonic clock', () => {
    const beatsWhile = async (beat: string, until: () => boolean, ms: number, keep: (v: number) => boolean = () => true) => {
      const seen = new Set<string>()
      const end = Date.now() + ms
      while (!until() && Date.now() < end) {
        try { const v = readFileSync(beat, 'utf8'); if (keep(Number(v))) seen.add(v) } catch { /* not yet */ }
        await Bun.sleep(10)
      }
      return seen
    }
    test('a wall clock stepped back an hour after the first beat pauses neither the heartbeat nor the timeout', async () => {
      const h = targetHome(); const req = admit(h, { timeout_s: 1 }); const paths = summonPaths(h)
      const beat = join(jobDir(paths, req.id), 'heartbeat')
      fake.setMode('slow')
      let offset = 0
      const p = runOnce(rdeps(h, { nowMs: () => Date.now() + offset }))
      try {
        await waitFor(() => existsSync(beat))
        offset = -3_600_000 // an NTP correction
        const steppedBack = await beatsWhile(beat, () => readState(paths, req.id)?.status === 'timed_out', 4_000, (v) => v < Date.now() - 1_800_000)
        expect(steppedBack.size).toBeGreaterThanOrEqual(3) // beats kept coming, stamped with the stepped wall clock
        expect(readState(paths, req.id)).toMatchObject({ status: 'timed_out', detail: 'ran past 1s' })
      } finally { writeFileSync(join(jobDir(paths, req.id), 'cancel'), ''); await p }
    }, 15_000)
    test('a monotonic delta that is somehow negative beats at once', async () => {
      const h = targetHome(); const req = admit(h); const paths = summonPaths(h)
      const beat = join(jobDir(paths, req.id), 'heartbeat')
      fake.setMode('slow')
      let t = 1e9
      const p = runOnce(rdeps(h, { heartbeatMs: 1e9, monoMs: () => (t -= 1_000) }))
      try {
        await waitFor(() => existsSync(beat))
        expect((await beatsWhile(beat, () => false, 400)).size).toBeGreaterThanOrEqual(3)
      } finally { requestCancel(paths, 'nuance', req.id, Date.now()); await p }
      expect(readState(paths, req.id)?.status).toBe('cancelled')
    }, 15_000)
  })
  test('output over 8 MiB stops the job as failed', async () => {
    const h = targetHome(); const req = admit(h)
    fake.setMode('flood')
    await runOnce(rdeps(h))
    expect(readState(summonPaths(h), req.id)).toMatchObject({ status: 'failed', detail: 'output over 8 MiB' })
  }, 15_000)
  test('an expired queued job is not run', async () => {
    const h = targetHome(); const req = admit(h)
    await runOnce(rdeps(h, { nowMs: () => Date.now() + 2 * 86_400_000 }))
    expect(readState(summonPaths(h), req.id)?.status).toBe('expired')
    expect(existsSync(fake.argvOut)).toBe(false)
  })
  test('F18: a request past its expiry but inside the skew grace the gate admitted it under is run, not expired', async () => {
    const h = targetHome(); const now = Date.now()
    // The Air's clock is 2 min behind: issued "2 min ago" with --expires 90s, so by this Mac's clock it expired 30 s ago.
    const req = admit(h, { issued_at: iso(now - 120_000), expires_at: iso(now - 30_000) })
    fake.setMode('ok')
    await runOnce(rdeps(h))
    expect(existsSync(fake.argvOut)).toBe(true) // claude was launched
    expect(readState(summonPaths(h), req.id)?.status).toBe('completed')
  })
  test('F18: the runner keeps the same grace as the gate, and no more', async () => {
    const h = targetHome(); const late = admit(h)
    const expiresMs = Date.parse(readState(summonPaths(h), late.id)!.expires_at)
    await runOnce(rdeps(h, { nowMs: () => expiresMs + CLOCK_SKEW_MS + 1_000 }))
    expect(readState(summonPaths(h), late.id)).toMatchObject({ status: 'expired', detail: 'never reached the runner' })
    expect(existsSync(fake.argvOut)).toBe(false)
    const h2 = targetHome(); const inGrace = admit(h2)
    const expires2 = Date.parse(readState(summonPaths(h2), inGrace.id)!.expires_at)
    await runOnce(rdeps(h2, { nowMs: () => expires2 + CLOCK_SKEW_MS - 60_000 }))
    expect(readState(summonPaths(h2), inGrace.id)?.status).toBe('completed')
  })
  test('F02: a run with denied tool calls ends blocked(permission), and the ledger job_end carries the reason', async () => {
    const h = targetHome(); const req = admit(h); const paths = summonPaths(h)
    fake.setMode('denied')
    await runOnce(rdeps(h))
    expect(readState(paths, req.id)).toMatchObject({ status: 'blocked', reason: 'permission', detail: '1 tool call(s) denied' })
    expect(resultOf(h, req.id)).toMatchObject({ status: 'blocked', reason: 'permission', detail: '1 tool call(s) denied',
      result_text: 'I was not allowed to read /Users/yu/.zshrc', exit_code: 0 })
    expect(ledgerOf(h).find((e) => e.event === 'job_end' && e.id === req.id)).toMatchObject({ status: 'blocked', reason: 'permission', detail: '1 tool call(s) denied' })
    expect(readFileSync(paths.ledger, 'utf8')).not.toContain('zshrc')
    expect(verifyLedger(paths.ledger).ok).toBe(true)
  })
  test('F33: a command line claude rejects ends failed with a fixed detail, and no stderr text is kept anywhere', async () => {
    const h = targetHome(); const req = admit(h); const paths = summonPaths(h)
    fake.setMode('badflag')
    await runOnce(rdeps(h))
    const DRIFT = 'claude rejected its command line (version drift?)'
    expect(readState(paths, req.id)).toMatchObject({ status: 'failed', detail: DRIFT })
    expect(resultOf(h, req.id)).toMatchObject({ status: 'failed', detail: DRIFT, result_text: '', exit_code: 1 })
    expect(ledgerOf(h).find((e) => e.event === 'job_end' && e.id === req.id)).toMatchObject({ status: 'failed', detail: DRIFT })
    for (const f of [paths.ledger, join(paths.jobs, req.id, 'result.json'), join(paths.jobs, req.id, 'state.json')]) {
      const text = readFileSync(f, 'utf8')
      expect(text).not.toContain('--x')
      expect(text).not.toContain('unknown option')
    }
  })
  test('F24: an admitted effort reaches claude as --effort', async () => {
    const h = targetHome(DEFAULT_ALLOWLIST.replace('{ model: sonnet }', '{ model: sonnet, effort: [low] }'))
    const req = admit(h, { effort: 'low' })
    fake.setMode('ok')
    await runOnce(rdeps(h))
    expect(JSON.parse(readFileSync(fake.argvOut, 'utf8')).argv).toContain('--effort=low')
    expect(readState(summonPaths(h), req.id)?.status).toBe('completed')
  })
  test('auth failure is blocked(auth)', async () => {
    const h = targetHome(); const req = admit(h)
    fake.setMode('auth')
    await runOnce(rdeps(h))
    expect(readState(summonPaths(h), req.id)).toMatchObject({ status: 'blocked', reason: 'auth' })
  })
  test('a finished job whose marker comes back is not run again', async () => {
    const h = targetHome(); const paths = summonPaths(h)
    const req = enqueue(h, { status: 'completed', ended_at: iso(Date.now()) })
    expect(await runOnce(rdeps(h))).toBe(1)
    expect(readState(paths, req.id)?.status).toBe('completed')
    expect(existsSync(fake.argvOut)).toBe(false)
    expect(readdirSync(paths.spool)).toEqual([])
  })

  describe('cancel before spawn (ruling 4)', () => {
    test('a queued job with a cancel marker ends cancelled without launching claude', async () => {
      const h = targetHome(); const req = admit(h); const paths = summonPaths(h)
      expect(requestCancel(paths, 'nuance', req.id, Date.now())).toMatchObject({ detail: 'cancel requested' })
      fake.setMode('ok')
      let asked = 0
      await runOnce(rdeps(h, { claudeBin: () => { asked++; return fake.bin } }))
      // A job cancelled after it started would also end `cancelled` (the poll tick would catch the marker), so prove it never started:
      expect(asked).toBe(0) // the runner never even looked for claude
      expect(readState(paths, req.id)).toMatchObject({ status: 'cancelled', detail: 'cancelled before it started' })
      expect(readState(paths, req.id)?.started_at).toBeUndefined()
      expect(resultOf(h, req.id)).toMatchObject({ status: 'cancelled', detail: 'cancelled before it started' })
      expect(existsSync(fake.argvOut)).toBe(false)
      expect(readdirSync(paths.spool)).toEqual([])
    })
  })

  describe('inventory requests', () => {
    test('are answered', async () => {
      const h = targetHome(); const paths = summonPaths(h)
      mkdirSync(paths.spool, { recursive: true })
      writeFileSync(join(paths.spool, 'inventory-1.req'), '')
      await runOnce(rdeps(h))
      expect(readJson<any>(paths.inventory)).toEqual({ macos: 'test' })
      expect(readdirSync(paths.spool)).toEqual([])
    })
    test('piled-up requests (callers that gave up) are answered by one collection', async () => {
      const h = targetHome(); const paths = summonPaths(h)
      mkdirSync(paths.spool, { recursive: true })
      for (const n of [1, 2, 3]) writeFileSync(join(paths.spool, `inventory-${n}.req`), '')
      let calls = 0
      await runOnce(rdeps(h, { collectInventory: async () => ({ call: ++calls }) }))
      expect(calls).toBe(1)
      expect(readJson<any>(paths.inventory)).toEqual({ call: 1 })
      expect(readdirSync(paths.spool)).toEqual([])
    })
    test('a failing collection is ledgered and still consumes the request', async () => {
      const h = targetHome(); const paths = summonPaths(h)
      mkdirSync(paths.spool, { recursive: true })
      writeFileSync(join(paths.spool, 'inventory-1.req'), '')
      await runOnce(rdeps(h, { collectInventory: async () => { throw Object.assign(new Error('secret detail'), { code: 'EBOOM' }) } }))
      expect(readdirSync(paths.spool)).toEqual([])
      expect(existsSync(paths.inventory)).toBe(false)
      const e = ledgerOf(h).find((x) => x.event === 'inventory_failed')
      expect(e).toMatchObject({ detail: 'could not collect inventory: EBOOM' })
      expect(JSON.stringify(ledgerOf(h))).not.toContain('secret detail')
    })
  })

  describe('every spool entry is consumed (ruling 1)', () => {
    test('strays and an orphan id marker are removed and ledgered, so launchd is not relaunched forever', async () => {
      const h = targetHome(); const paths = summonPaths(h)
      mkdirSync(paths.spool, { recursive: true })
      const orphan = newRequestId()
      const strays = ['x.tmp', `${newRequestId()}.tmp`, '.DS_Store', 'inventory-12.req.bak', 'inventory-abc.req', 'smn_ZZ']
      for (const n of strays) writeFileSync(join(paths.spool, n), '')
      mkdirSync(join(paths.spool, 'stray-dir'))
      writeFileSync(join(paths.spool, 'stray-dir', 'f'), '')
      writeFileSync(join(paths.spool, orphan), '') // its job dir does not exist, so the claim rename fails
      expect(await runOnce(rdeps(h))).toBe(0)
      expect(readdirSync(paths.spool)).toEqual([])
      const discards = ledgerOf(h).filter((e) => e.event === 'spool_discard')
      expect(discards).toHaveLength(strays.length + 1 + 1)
      expect(discards.filter((e) => e.id === undefined).every((e) => e.detail === 'unrecognised name')).toBe(true)
      expect(discards.find((e) => e.id === orphan)).toMatchObject({ detail: 'no job to claim' })
      expect(JSON.stringify(ledgerOf(h))).not.toMatch(/stray-dir|DS_Store|x\.tmp|inventory-/) // names stay out of the ledger
      expect(verifyLedger(paths.ledger).ok).toBe(true)
      expect(existsSync(join(paths.state, 'admission.lock'))).toBe(false)
    })
    test('a .tmp is left alone until the gate has released the admission lock', async () => {
      const h = targetHome(); const paths = summonPaths(h)
      mkdirSync(paths.spool, { recursive: true })
      writeFileSync(join(paths.spool, `${newRequestId()}.tmp`), '') // what the gate is mid-way through writing
      const lock = join(paths.state, 'admission.lock')
      writeFileSync(lock, '')
      const t0 = Date.now()
      Bun.spawn(['/bin/sh', '-c', `sleep 0.3; rm -f '${lock}'`], { stdout: 'ignore', stderr: 'ignore' })
      await runOnce(rdeps(h))
      expect(Date.now() - t0).toBeGreaterThanOrEqual(250) // it waited for the gate instead of racing it
      expect(readdirSync(paths.spool)).toEqual([])
    })
    test('a state file that cannot be read still consumes the claim', async () => {
      const h = targetHome(); const paths = summonPaths(h)
      const req = enqueue(h)
      unlinkSync(join(jobDir(paths, req.id), 'state.json'))
      expect(await runOnce(rdeps(h))).toBe(1)
      expect(readdirSync(paths.spool)).toEqual([])
      expect(ledgerOf(h).find((e) => e.event === 'spool_discard' && e.id === req.id)).toMatchObject({ detail: 'job state unreadable' })
      expect(existsSync(fake.argvOut)).toBe(false)
    })
  })

  describe('F25: a claim that fails on a real job never discards its marker', () => {
    test('the marker stays, nothing says "no job to claim", runOnce fails (so launchd retries), and the next run completes the job', async () => {
      const h = targetHome(); const req = admit(h); const paths = summonPaths(h)
      fake.setMode('ok')
      chmodSync(jobDir(paths, req.id), 0o500) // the claim rename is refused (EACCES), as it is on a full disk (ENOSPC)
      let err: unknown
      try { await runOnce(rdeps(h)) } catch (e) { err = e } finally { chmodSync(jobDir(paths, req.id), 0o700) }
      expect((err as { code?: string } | undefined)?.code).toBe('EACCES')
      expect(existsSync(join(paths.spool, req.id))).toBe(true)
      expect(readState(paths, req.id)?.status).toBe('queued')
      expect(ledgerOf(h).filter((e) => e.event === 'spool_discard')).toEqual([])
      expect(ledgerOf(h).find((e) => e.event === 'claim_failed')).toMatchObject({ id: req.id, detail: 'could not claim the job: EACCES' })
      expect(existsSync(fake.argvOut)).toBe(false)
      expect(await runOnce(rdeps(h))).toBe(1)
      expect(readState(paths, req.id)?.status).toBe('completed')
      expect(verifyLedger(paths.ledger).ok).toBe(true)
    })
    test('review #1: claim_failed is ledgered once per job, however many passes fail; a later claim clears the note', async () => {
      const h = targetHome(); const req = admit(h); const paths = summonPaths(h)
      fake.setMode('ok')
      chmodSync(jobDir(paths, req.id), 0o500)
      try {
        for (let i = 0; i < 3; i++) {
          let err: unknown
          try { await runOnce(rdeps(h)) } catch (e) { err = e }
          expect((err as { code?: string } | undefined)?.code).toBe('EACCES')
        }
      } finally { chmodSync(jobDir(paths, req.id), 0o700) }
      expect(ledgerOf(h).filter((e) => e.event === 'claim_failed')).toHaveLength(1)
      const note = join(paths.state, 'claim-failed', req.id)
      expect(existsSync(note)).toBe(true) // kept under state/, never in the spool
      expect(readdirSync(paths.spool)).toEqual([req.id])
      expect(await runOnce(rdeps(h))).toBe(1)
      expect(existsSync(note)).toBe(false)
      expect(readState(paths, req.id)?.status).toBe('completed')
    })
    test('other spool work still runs before the failure is reported', async () => {
      const h = targetHome(); const paths = summonPaths(h)
      const stuck = enqueue(h); const next = enqueue(h)
      fake.setMode('ok')
      const [first] = [stuck.id, next.id].sort()
      const other = first === stuck.id ? next.id : stuck.id
      chmodSync(jobDir(paths, first!), 0o500)
      let err: unknown
      try { await runOnce(rdeps(h)) } catch (e) { err = e } finally { chmodSync(jobDir(paths, first!), 0o700) }
      expect(err).toBeDefined()
      expect(readState(paths, other)?.status).toBe('completed')
      expect(existsSync(join(paths.spool, first!))).toBe(true)
    })
    test('carried (A2): a discarded marker takes its claim-failed note with it (no state, or no job dir)', async () => {
      const h = targetHome(); const paths = summonPaths(h)
      const noState = enqueue(h); const noDir = enqueue(h)
      unlinkSync(join(jobDir(paths, noState.id), 'state.json'))
      rmSync(jobDir(paths, noDir.id), { recursive: true, force: true }) // the claim's rename then fails ENOENT
      for (const id of [noState.id, noDir.id]) { mkdirSync(join(paths.state, 'claim-failed'), { recursive: true }); writeFileSync(join(paths.state, 'claim-failed', id), '') }
      chmodSync(jobDir(paths, noState.id), 0o500)
      try { expect(await runOnce(rdeps(h))).toBe(0) } finally { chmodSync(jobDir(paths, noState.id), 0o700) }
      expect(readdirSync(paths.spool)).toEqual([])
      expect(readdirSync(join(paths.state, 'claim-failed'))).toEqual([])
    })
    test('a marker whose job has no state is still discarded, whatever the rename error', async () => {
      const h = targetHome(); const paths = summonPaths(h)
      const req = enqueue(h)
      unlinkSync(join(jobDir(paths, req.id), 'state.json'))
      chmodSync(jobDir(paths, req.id), 0o500)
      try { expect(await runOnce(rdeps(h))).toBe(0) } finally { chmodSync(jobDir(paths, req.id), 0o700) }
      expect(readdirSync(paths.spool)).toEqual([])
      expect(ledgerOf(h).find((e) => e.event === 'spool_discard' && e.id === req.id)).toMatchObject({ detail: 'no job to claim' })
    })
  })

  describe('what the runner hands the harness (Phase 0.5)', () => {
    const argvOf = () => JSON.parse(readFileSync(fake.argvOut, 'utf8')) as { argv: string[]; env: Record<string, string> }
    const flagOf = (argv: string[], name: string) => argv.filter((a) => a.startsWith(`--${name}=`)).map((a) => a.slice(name.length + 3))
    test('a review job: the review cap, no settings, and the env it always had', async () => {
      const h = targetHome(); const req = admit(h)
      fake.setMode('ok')
      await runOnce(rdeps(h))
      const { argv, env } = argvOf()
      expect(flagOf(argv, 'max-turns')).toEqual(['40'])
      expect(flagOf(argv, 'settings')).toEqual([])
      expect(env.GIT_CONFIG_COUNT).toBe('2')
      expect(env.GIT_CEILING_DIRECTORIES).toBeUndefined()
      expect(env.TMPDIR).not.toContain('.summon-tmp')
      expect(readState(summonPaths(h), req.id)?.status).toBe('completed')
    })
    test('an edit job: the edit cap, the sandbox settings, its own TMPDIR named by the job id, and the git env', async () => {
      const h = repoHome()
      const req = enqueue(h, { access: 'edit' })
      fake.setMode('ok')
      await runOnce(rdeps(h))
      const { argv, env } = argvOf()
      const cwd = join(h, 'Projects/x')
      expect(flagOf(argv, 'max-turns')).toEqual(['60'])
      expect(flagOf(argv, 'allowedTools')).toEqual(['Bash(git add:*),Bash(git commit:*)'])
      expect(JSON.parse(flagOf(argv, 'settings')[0]!).sandbox).toMatchObject({ enabled: true, failIfUnavailable: true, filesystem: { allowWrite: [] } })
      expect(env.TMPDIR).toBe(`${cwd}/.summon-tmp/${req.id}`)
      expect(env.GIT_CEILING_DIRECTORIES).toBe(join(h, 'Projects'))
      expect(env.GIT_CONFIG_COUNT).toBe('6')
      expect(readState(summonPaths(h), req.id)?.status).toBe('completed')
    })
    test('a build job runs with the commands of its folder entry, taken from the admission at start, and nothing it was not given', async () => {
      const h = repoHome(BUILD_ALLOWLIST)
      const req = admit(h, { access: 'build' })
      fake.setMode('ok')
      await runOnce(rdeps(h))
      const { argv } = argvOf()
      expect(flagOf(argv, 'max-turns')).toEqual(['60'])
      const allowed = flagOf(argv, 'allowedTools')[0]!.split(',')
      expect(allowed).toEqual(['Bash(git add:*)', 'Bash(git commit:*)', 'Bash(bun test)', 'Bash(bun test:*)', 'Bash(bun run typecheck)',
        'Bash(git status:*)', 'Bash(git diff:*)', 'Bash(git log:*)', 'Bash(git show:*)', 'Bash(git rev-parse:*)'])
      expect(readState(summonPaths(h), req.id)?.status).toBe('completed')
    })
    test('an edit job in a build folder gets the edit rules only: the entry\'s commands are for build jobs', async () => {
      const h = repoHome(BUILD_ALLOWLIST)
      admit(h, { access: 'edit' })
      fake.setMode('ok')
      await runOnce(rdeps(h))
      expect(flagOf(argvOf().argv, 'allowedTools')).toEqual(['Bash(git add:*),Bash(git commit:*)'])
    })
    test('an access the harness does not know ends failed without running claude (a damaged state file never gains edit powers)', async () => {
      const h = targetHome()
      const req = enqueue(h, { access: 'admin' as never })
      await runOnce(rdeps(h))
      expect(existsSync(fake.argvOut)).toBe(false)
      expect(readState(summonPaths(h), req.id)).toMatchObject({ status: 'failed', detail: 'could not start claude: the command could not be built for this folder' })
    })
    test('the turn cap detail is the cap of the job\'s own access: 40 for review, 60 for edit and for build', async () => {
      for (const [access, cap, al] of [['review', 40, DEFAULT_ALLOWLIST], ['edit', 60, EDIT_ALLOWLIST], ['build', 60, BUILD_ALLOWLIST]] as const) {
        const h = repoHome(al)
        const req = enqueue(h, { access })
        fake.setMode('maxturns')
        await runOnce(rdeps(h))
        expect(readState(summonPaths(h), req.id)).toMatchObject({ status: 'failed', detail: `turn cap (${cap}) reached before a final answer` })
        expect(resultOf(h, req.id)).toMatchObject({ status: 'failed', detail: `turn cap (${cap}) reached before a final answer` })
        rmSync(fake.argvOut, { force: true })
      }
    })
  })

  describe('no job is stranded by a runner error (ruling 2)', () => {
    const failedWith = (h: string, id: string, detail: string | RegExp) => {
      const s = readState(summonPaths(h), id)!
      expect(s.status).toBe('failed')
      if (typeof detail === 'string') expect(s.detail).toBe(detail); else expect(s.detail).toMatch(detail)
      expect(resultOf(h, id)).toMatchObject({ status: 'failed', detail: s.detail })
      expect(s.pid).toBeUndefined()
      expect(readdirSync(summonPaths(h).spool)).toEqual([])
      expect(existsSync(fake.argvOut)).toBe(false) // claude never ran
      return s
    }
    test('an edit job whose folder has a comma ends failed (claudeInvocation throws), before anything is made in the folder', async () => {
      const h = targetHome(FLAGGED_ALLOWLIST.replace('  - path: ~/Projects\n    access: review', '  - path: ~/Projects/a,b\n    access: edit'))
      const folder = fakeGitRoot(join(h, 'Projects/a,b')) // makes the directory too
      const req = enqueue(h, { access: 'edit', cwd_real: folder })
      await runOnce(rdeps(h))
      const s = failedWith(h, req.id, 'could not start claude: the command could not be built for this folder')
      expect(JSON.stringify(s)).not.toContain(req.prompt)
      expect(JSON.stringify(ledgerOf(h))).not.toContain(req.prompt)
      expect(readdirSync(folder)).toEqual(['.git'])
      expect(existsSync(join(folder, '.git/info'))).toBe(false)
    })
    test('a job whose folder is a regular file ends failed (spawn throws)', async () => {
      const h = targetHome(); writeFileSync(join(h, 'Projects/afile'), '')
      const req = enqueue(h, { cwd_real: join(h, 'Projects/afile') })
      await runOnce(rdeps(h))
      failedWith(h, req.id, /^could not start claude: E[A-Z]+$/)
    })
    test('a claude that cannot be started ends failed (spawn reports the error later), and the folder is left as it was', async () => {
      const h = targetHome()
      const req = enqueue(h)
      await runOnce(rdeps(h, { claudeBin: () => join(h, 'no-such-claude') }))
      failedWith(h, req.id, 'could not start claude: ENOENT')
    })
    test('a job whose folder no longer exists is refused at start, with the admission\'s reason (it cannot run there)', async () => {
      const h = targetHome()
      const req = enqueue(h, { cwd_real: join(h, 'Projects/gone') })
      await runOnce(rdeps(h))
      expect(readState(summonPaths(h), req.id)).toMatchObject({ status: 'refused', reason: 'outside_allowlist', detail: expect.stringContaining('does not exist') })
      expect(existsSync(fake.argvOut)).toBe(false)
    })
    test('a missing request.json ends failed', async () => {
      const h = targetHome()
      const req = enqueue(h)
      unlinkSync(join(jobDir(summonPaths(h), req.id), 'request.json'))
      await runOnce(rdeps(h))
      failedWith(h, req.id, 'request file is missing or unreadable')
    })
    test('claude missing from the Mac ends failed', async () => {
      const h = targetHome(); const req = enqueue(h)
      await runOnce(rdeps(h, { claudeBin: () => null }))
      failedWith(h, req.id, 'claude is not installed on this Mac')
    })
    test('any other throw is caught: the job ends failed and runOnce returns normally', async () => {
      const h = targetHome(); const req = enqueue(h); const next = enqueue(h)
      let n = 0
      const r = await runOnce(rdeps(h, { claudeBin: () => { if (n++ === 0) throw new Error('prompt text must not leak'); return fake.bin } }))
      expect(r).toBe(2)
      const ids = [req.id, next.id].sort()
      expect(readState(summonPaths(h), ids[0]!)).toMatchObject({ status: 'failed', detail: 'runner error: error' })
      expect(readState(summonPaths(h), ids[1]!)?.status).toBe('completed') // the next job still runs
      expect(JSON.stringify(ledgerOf(h))).not.toContain('must not leak')
    })
  })
})


// ── Phase 0.5, Task 3: re-admission at start, the job's temp directory, the fingerprint and the process sweep. ──

const argvOf = () => JSON.parse(readFileSync(fake.argvOut, 'utf8')) as { argv: string[]; env: Record<string, string>; cwd: string; tmpdir: { directory: boolean; mode: number } | null;
  exclude: string | null; pid: number; pgid: number }
const setAllowlist = (h: string, text: string) => writeFileSync(join(h, '.config/summon/allowlist.yaml'), text)
const SUMMON_TMP = '.summon-tmp'

describe('re-admission at start (design section 2, "Admission result")', () => {
  /** The job ended refused: with the admission's reason, never started, no claude, nothing left in the spool; the ledger says job_end refused. */
  const refusedAtStart = (h: string, id: string, reason: string, detail: string | RegExp) => {
    const st = readState(summonPaths(h), id)!
    expect(st).toMatchObject({ status: 'refused', reason })
    expect(st.detail).toMatch(detail instanceof RegExp ? detail : new RegExp(detail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    expect(resultOf(h, id)).toMatchObject({ status: 'refused', reason, detail: st.detail })
    expect([st.started_at, st.pid, st.pid_lstart]).toEqual([undefined, undefined, undefined])
    expect(existsSync(fake.argvOut)).toBe(false) // claude never ran
    expect(readdirSync(summonPaths(h).spool)).toEqual([])
    const mine = ledgerOf(h).filter((e) => e.id === id)
    expect(mine.map((e) => e.event)).not.toContain('job_start')
    expect(mine.find((e) => e.event === 'job_end')).toMatchObject({ status: 'refused', reason })
    expect(verifyLedger(summonPaths(h).ledger).ok).toBe(true)
    return st
  }
  test('a build entry removed while the job was queued revokes it: refused, not failed, and claude never runs', async () => {
    const h = repoHome(BUILD_ALLOWLIST); const req = admit(h, { access: 'build' })
    setAllowlist(h, FLAGGED_ALLOWLIST) // Yu edited the allowlist on Nuance: ~/Projects is a review folder again
    await runOnce(rdeps(h))
    refusedAtStart(h, req.id, 'outside_allowlist', 'build is not allowed in ~/Projects (review)')
  })
  test('a build job whose entry is not there at all ends refused, where it used to end failed (the interim state is gone)', async () => {
    const h = repoHome(DEFAULT_ALLOWLIST); const req = enqueue(h, { access: 'build' })
    await runOnce(rdeps(h))
    refusedAtStart(h, req.id, 'outside_allowlist', 'build is not allowed in ~/Projects (review)')
  })
  test('the refusal carries the admission\'s hint in the result text (a build refusal: a complete entry with commands)', async () => {
    const h = repoHome(DEFAULT_ALLOWLIST); const req = enqueue(h, { access: 'build' })
    await runOnce(rdeps(h))
    expect(resultOf(h, req.id).result_text).toContain('commands:')
    expect(statusOf(summonPaths(h), 'nuance', req.id, Date.now())).toMatchObject({ status: 'refused', reason: 'outside_allowlist', handle: `nuance/${req.id}` })
  })
  test('a folder that has stopped being a repository root revokes a queued edit job', async () => {
    const h = repoHome(); const req = admit(h, { access: 'edit' })
    rmSync(join(h, 'Projects/x/.git'), { recursive: true })
    await runOnce(rdeps(h))
    refusedAtStart(h, req.id, 'outside_allowlist', '.git')
  })
  test('a folder that has become nested (by a symlink the parser cannot see) revokes a queued build job', async () => {
    const h = repoHome(BUILD_ALLOWLIST); const req = admit(h, { access: 'build' })
    symlinkSync(join(h, 'Projects'), join(h, 'Outer'))
    setAllowlist(h, BUILD_ALLOWLIST.replace('  - path: ~/Projects/x\n', '  - path: ~/Outer\n    access: edit\n  - path: ~/Projects/x\n'))
    await runOnce(rdeps(h))
    refusedAtStart(h, req.id, 'outside_allowlist', 'overlaps another edit or build folder entry')
  })
  test('an allowlist that is gone or no longer parses refuses the queued job, as it refuses every request', async () => {
    const h = repoHome(); const gone = admit(h, { access: 'edit' })
    rmSync(join(h, '.config/summon/allowlist.yaml'))
    await runOnce(rdeps(h))
    refusedAtStart(h, gone.id, 'outside_allowlist', 'allowlist: missing')
    const h2 = repoHome(); const bad = admit(h2, { access: 'edit' })
    setAllowlist(h2, 'version: 2\n')
    await runOnce(rdeps(h2))
    refusedAtStart(h2, bad.id, 'outside_allowlist', 'allowlist: version must be 1')
  })
  test('the claude runtime losing reads_anywhere revokes a queued edit job', async () => {
    const h = repoHome(); const req = admit(h, { access: 'edit' })
    setAllowlist(h, EDIT_ALLOWLIST.replace('    reads_anywhere: true\n', ''))
    await runOnce(rdeps(h))
    refusedAtStart(h, req.id, 'outside_allowlist', 'edit jobs run git, which can read any file on this Mac')
  })
  test('every job is re-admitted, a review job too: its folder gone from the allowlist, it is refused (and one still allowed runs)', async () => {
    const h = targetHome(); const req = admit(h)
    setAllowlist(h, DEFAULT_ALLOWLIST.replace('~/Projects', '~/Elsewhere'))
    await runOnce(rdeps(h))
    refusedAtStart(h, req.id, 'outside_allowlist', 'is not allowed')
    const h2 = targetHome(); const ok = admit(h2)
    await runOnce(rdeps(h2))
    expect(readState(summonPaths(h2), ok.id)?.status).toBe('completed')
  })
  test('a folder that now resolves somewhere else than where it was admitted is refused (a swapped symlink never moves a job)', async () => {
    const h = repoHome(); const req = admit(h, { access: 'edit' })
    renameSync(join(h, 'Projects/x'), join(h, 'Projects/x-moved'))
    symlinkSync(join(h, 'Projects/x-moved'), join(h, 'Projects/x'))
    await runOnce(rdeps(h))
    refusedAtStart(h, req.id, 'outside_allowlist', 'resolves somewhere else than when the job was admitted')
  })
  test('a refused job is final: it is terminal, not active, and swept with the other finished jobs after 30 days', async () => {
    const h = repoHome(DEFAULT_ALLOWLIST); const paths = summonPaths(h); const req = enqueue(h, { access: 'build' })
    await runOnce(rdeps(h))
    expect(countActive(paths, Date.now())).toBe(0)
    expect(await runOnce(rdeps(h))).toBe(0)
    expect(markOrphans(paths, Date.now(), () => false)).toBe(0)
    expect(sweepJobs(paths, Date.now() + 31 * 86_400_000)).toBe(1)
    expect(existsSync(jobDir(paths, req.id))).toBe(false)
  })
  test('nothing is ledgered for a job that passes: the review job\'s ledger is the three lines it always was', async () => {
    const h = targetHome(); const req = admit(h)
    await runOnce(rdeps(h))
    expect(ledgerOf(h).filter((e) => e.id === req.id).map((e) => e.event)).toEqual(['admitted', 'job_start', 'job_end'])
  })
})

describe('the job\'s temp directory (design section 3, "Temp files")', () => {
  const dirOf = (h: string) => join(h, 'Projects/x', SUMMON_TMP)
  test('an edit job: <folder>/.summon-tmp/<job id> is a 0700 directory by the time claude starts, and TMPDIR names it', async () => {
    const h = repoHome(); const req = admit(h, { access: 'edit' })
    await runOnce(rdeps(h))
    const seen = argvOf()
    expect(seen.env.TMPDIR).toBe(join(dirOf(h), req.id))
    expect(seen.tmpdir).toEqual({ directory: true, mode: 0o700 })
    expect(seen.cwd).toBe(join(h, 'Projects/x'))
  })
  test('a build job gets the same', async () => {
    const h = repoHome(BUILD_ALLOWLIST); const req = admit(h, { access: 'build' })
    await runOnce(rdeps(h))
    expect(argvOf().env.TMPDIR).toBe(join(dirOf(h), req.id))
    expect(argvOf().tmpdir).toEqual({ directory: true, mode: 0o700 })
  })
  test('a review job gets none: no directory, no exclude line, and the repository is not touched', async () => {
    const h = targetHome(); fakeGitRoot(join(h, 'Projects/x')); admit(h)
    await runOnce(rdeps(h))
    expect(argvOf().env.TMPDIR).not.toContain(SUMMON_TMP) // the runner's own TMPDIR, as in Phase 0
    expect(argvOf().exclude).toBeNull()
    expect(existsSync(dirOf(h))).toBe(false)
    expect(existsSync(join(h, 'Projects/x/.git/info'))).toBe(false)
  })
  test('the directory is gone after a normal end, and so is .summon-tmp, which held nothing else', async () => {
    const h = repoHome(); const req = admit(h, { access: 'edit' })
    await runOnce(rdeps(h))
    expect(readState(summonPaths(h), req.id)?.status).toBe('completed')
    expect(existsSync(dirOf(h))).toBe(false)
  })
  test('the directory is gone after a failure, after a timeout, after a cancel, and after claude could not even be started', async () => {
    const cases: Array<[string, Parameters<typeof admit>[1], () => void, Partial<RunnerDeps>, string]> = [
      ['a failure', {}, () => fake.setMode('maxturns'), {}, 'failed'],
      ['a timeout', { timeout_s: 1 }, () => fake.setMode('slow'), {}, 'timed_out'],
      ['claude that cannot start', {}, () => fake.setMode('ok'), { claudeBin: () => '/no/such/claude' }, 'failed'],
    ]
    for (const [label, over, mode, deps, status] of cases) {
      const h = repoHome(); const req = admit(h, { access: 'edit', ...over })
      mode()
      await runOnce(rdeps(h, deps))
      expect([label, readState(summonPaths(h), req.id)?.status]).toEqual([label, status])
      expect([label, existsSync(dirOf(h))]).toEqual([label, false])
    }
    const h = repoHome(); const paths = summonPaths(h); const req = admit(h, { access: 'edit' })
    fake.setMode('slow')
    const p = runOnce(rdeps(h))
    await waitFor(() => existsSync(join(dirOf(h), req.id)))
    requestCancel(paths, 'nuance', req.id, Date.now())
    await p
    expect(readState(paths, req.id)?.status).toBe('cancelled')
    expect(existsSync(dirOf(h))).toBe(false)
  }, 30_000)
  test('.summon-tmp stays when something else is in it, and only this job\'s directory goes', async () => {
    const h = repoHome(); const req = admit(h, { access: 'edit' })
    mkdirSync(join(dirOf(h), 'someone-else'), { recursive: true })
    await runOnce(rdeps(h))
    expect(readdirSync(dirOf(h))).toEqual(['someone-else'])
    expect(readState(summonPaths(h), req.id)?.status).toBe('completed')
  })
  test('a .summon-tmp that an earlier job left as a symlink is replaced, never written through', async () => {
    const h = repoHome(); const outside = join(h, 'outside'); mkdirSync(outside)
    symlinkSync(outside, dirOf(h))
    admit(h, { access: 'edit' })
    await runOnce(rdeps(h))
    expect(argvOf().tmpdir).toEqual({ directory: true, mode: 0o700 })
    expect(readdirSync(outside)).toEqual([])
    expect(existsSync(dirOf(h))).toBe(false)
  })
  test('the exclude line /.summon-tmp/ is in .git/info/exclude before claude starts, is kept after the job, and is not repeated by the next', async () => {
    const h = repoHome(); const exclude = join(h, 'Projects/x/.git/info/exclude')
    mkdirSync(join(h, 'Projects/x/.git/info')); writeFileSync(exclude, '# mine\n*.log\n')
    admit(h, { access: 'edit' })
    await runOnce(rdeps(h))
    expect(argvOf().exclude).toBe('# mine\n*.log\n/.summon-tmp/\n')
    expect(readFileSync(exclude, 'utf8')).toBe('# mine\n*.log\n/.summon-tmp/\n')
    admit(h, { access: 'edit' })
    await Bun.sleep(5)
    expect(await runOnce(rdeps(h))).toBe(1)
    expect(readFileSync(exclude, 'utf8')).toBe('# mine\n*.log\n/.summon-tmp/\n')
  })
  test('a watched git file too large to keep cannot be fingerprinted: the job ends failed, claude never starts, and the temp directory is gone', async () => {
    const h = repoHome(); const root = join(h, 'Projects/x')
    mkdirSync(join(root, '.git/hooks')); writeFileSync(join(root, '.git/hooks/huge'), Buffer.alloc(9 * 1024 * 1024))
    const req = admit(h, { access: 'edit' })
    await runOnce(rdeps(h))
    expect(readState(summonPaths(h), req.id)).toMatchObject({ status: 'failed', detail: 'could not start claude: the job folder could not be prepared' })
    expect(existsSync(fake.argvOut)).toBe(false)
    expect(existsSync(dirOf(h))).toBe(false)
  })
  test('an edit job whose start cannot be ledgered is stopped, ends failed, and leaves no temp directory (the guard is closed on that path too)', async () => {
    const h = repoHome(); const paths = summonPaths(h); const req = admit(h, { access: 'edit' })
    unlinkSync(paths.ledger); mkdirSync(paths.ledger) // from here every append fails (EISDIR)
    await runOnce(rdeps(h))
    expect(readState(paths, req.id)).toMatchObject({ status: 'failed', detail: 'runner error: EISDIR' })
    expect(existsSync(dirOf(h))).toBe(false)
  })
  test('a folder whose .git/info is a symlink cannot be prepared: the job ends failed and nothing is written through the link', async () => {
    const h = repoHome(); const outside = join(h, 'outside'); mkdirSync(outside)
    symlinkSync(outside, join(h, 'Projects/x/.git/info'))
    const req = admit(h, { access: 'edit' })
    await runOnce(rdeps(h))
    expect(readState(summonPaths(h), req.id)).toMatchObject({ status: 'failed', detail: 'could not start claude: the job folder could not be prepared' })
    expect(existsSync(fake.argvOut)).toBe(false)
    expect(readdirSync(outside)).toEqual([])
    expect(existsSync(dirOf(h))).toBe(false)
  })
})

describe('the fingerprint of the git files that can run code (design section 3, "Fingerprint")', () => {
  /** An edit-folder repository with every watched file present (the attributes file only if asked), admitted as an edit job. */
  function watched(opts: { al?: string; attributes?: boolean; access?: 'edit' | 'build'; timeout_s?: number } = {}) {
    const access = opts.access ?? 'edit'
    const h = repoHome(opts.al ?? (access === 'edit' ? EDIT_ALLOWLIST : BUILD_ALLOWLIST)); const root = join(h, 'Projects/x')
    writeFileSync(join(root, '.git/config'), '[core]\n\tbare = false\n')
    mkdirSync(join(root, '.git/hooks'), { recursive: true }); writeFileSync(join(root, '.git/hooks/pre-commit.sample'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
    chmodSync(join(root, '.git/hooks/pre-commit.sample'), 0o755)
    writeFileSync(join(root, '.gitmodules'), '[submodule "a"]\n\tpath = a\n')
    if (opts.attributes !== false) writeFileSync(join(root, '.gitattributes'), '*.png binary\n')
    const req = admit(h, { access, ...(opts.timeout_s ? { timeout_s: opts.timeout_s } : {}) })
    return { h, root, id: req.id, before: listing(root) }
  }
  /** What the watched files hold, by the name they are stored under: mode and contents. */
  function listing(root: string) {
    const out: Record<string, string> = {}
    const walk = (rel: string) => {
      for (const n of readdirSync(join(root, rel))) {
        const r = rel ? `${rel}/${n}` : n
        const lower = r.toLowerCase(); const st = lstatSync(join(root, r))
        const inGit = lower === '.git' || lower.startsWith('.git/')
        if (st.isDirectory()) { if (lower === '.git' || lower === '.git/hooks' || lower === '.git/info' || /^\.git\/(hooks|info)\//.test(lower)) walk(r); continue }
        if (inGit && !(lower === '.git/config' || lower.startsWith('.git/hooks/') || lower.startsWith('.git/info/'))) continue
        if (!inGit && lower !== '.gitattributes' && lower !== '.gitmodules') continue
        out[r] = `${(st.mode & 0o777).toString(8)} ${st.isSymbolicLink() ? 'link' : readFileSync(join(root, r), 'utf8')}`
      }
    }
    walk('')
    return out
  }
  /** The runner writes the exclude line (and the file, if there was none) before it takes the baseline, so the baseline holds it. */
  const withExclude = (before: Record<string, string>) => ({ '.git/info/exclude': '644 /.summon-tmp/\n', ...before })
  const result = (h: string, id: string) => resultOf(h, id)
  const firstLine = (h: string, id: string) => String(result(h, id).result_text).split('\n')[0]
  const tamperLines = (h: string, id: string) => ledgerOf(h).filter((e) => e.id === id && e.event === 'job_tampered')
  const PROMPT = 'echo: Read the README and summarise it.'

  for (const [what, tampered, attributes] of [
    ['config', '.git/config', true], ['hook', '.git/hooks/pre-commit', true], ['gitmodules', '.gitmodules', true], ['exclude', '.git/info/exclude', true],
    ['chmod', '.git/hooks/pre-commit.sample', true], ['gitattributes', '.GitAttributes', false],
  ] as const) {
    test(`a job that changes ${what} is put back: the watched files are as they were, the result starts "tampered: ${tampered}", the ledger counts it`, async () => {
      const { h, root, id, before } = watched({ attributes })
      fake.setMode(`tamper:${what}`)
      await runOnce(rdeps(h))
      expect(listing(root)).toEqual(withExclude(before))
      expect(readState(summonPaths(h), id)?.status).toBe('completed') // the restore does not change the job's status
      expect(result(h, id)).toMatchObject({ status: 'completed', result_text: `tampered: ${tampered}\n${PROMPT}` })
      expect(tamperLines(h, id)).toEqual([expect.objectContaining({ event: 'job_tampered', detail: 'tampered: 1 path(s)' })])
      expect(JSON.stringify(ledgerOf(h))).not.toMatch(/\.git\/|gitattributes|gitmodules/i) // the paths stay in the 0600 result file
      expect(ledgerOf(h).filter((e) => e.id === id).map((e) => e.event)).toEqual(['admitted', 'job_start', 'job_tampered', 'job_end'])
      expect(verifyLedger(summonPaths(h).ledger).ok).toBe(true)
    })
  }
  test('the exclude line was in the baseline: a deleted .git/info/exclude comes back WITH the line', async () => {
    const { h, root } = watched()
    fake.setMode('tamper:exclude')
    await runOnce(rdeps(h))
    expect(readFileSync(join(root, '.git/info/exclude'), 'utf8')).toBe('/.summon-tmp/\n')
  })
  test('a .git/info swapped for a symlink to the job\'s temp directory is replaced by the real directory, with its file', async () => {
    const { h, root, id, before } = watched()
    fake.setMode('tamper:info-link')
    await runOnce(rdeps(h))
    expect(lstatSync(join(root, '.git/info')).isSymbolicLink()).toBe(false)
    expect(listing(root)).toEqual(withExclude(before))
    expect(firstLine(h, id)).toBe('tampered: .git/info, .git/info/exclude')
  })
  test('everything at once: five paths, one line, sorted, and the ledger counts five', async () => {
    const { h, root, id, before } = watched({ attributes: false })
    fake.setMode('tamper:all')
    await runOnce(rdeps(h))
    expect(listing(root)).toEqual(withExclude(before))
    expect(firstLine(h, id)).toBe('tampered: .GitAttributes, .git/config, .git/hooks/pre-commit, .git/info/exclude, .gitmodules')
    expect(tamperLines(h, id)).toEqual([expect.objectContaining({ detail: 'tampered: 5 path(s)' })])
  })
  test('an untouched job reports nothing: its result is the harness\'s text alone, and there is no tampered line in the ledger', async () => {
    const { h, root, id, before } = watched()
    fake.setMode('ok')
    await runOnce(rdeps(h))
    expect(listing(root)).toEqual(withExclude(before))
    expect(result(h, id)).toMatchObject({ status: 'completed', result_text: PROMPT })
    expect(tamperLines(h, id)).toEqual([])
    expect(ledgerOf(h).filter((e) => e.id === id).map((e) => e.event)).toEqual(['admitted', 'job_start', 'job_end'])
  })
  test('a job that ends by timeout is put right too, and still ends timed_out', async () => {
    const { h, root, id, before } = watched({ timeout_s: 1 })
    fake.setMode('tamper:config:slow')
    await runOnce(rdeps(h))
    expect(readState(summonPaths(h), id)).toMatchObject({ status: 'timed_out', detail: 'ran past 1s' })
    expect(listing(root)).toEqual(withExclude(before))
    expect(firstLine(h, id)).toBe('tampered: .git/config')
    expect(result(h, id)).toMatchObject({ status: 'timed_out' })
  }, 15_000)
  test('a build job is put right too', async () => {
    const { h, root, id, before } = watched({ access: 'build' })
    fake.setMode('tamper:hook')
    await runOnce(rdeps(h))
    expect(listing(root)).toEqual(withExclude(before))
    expect(firstLine(h, id)).toBe('tampered: .git/hooks/pre-commit')
  })
  test('a path with a newline in its name cannot make a second line: it is escaped', async () => {
    const { h, id } = watched()
    fake.setMode('tamper:newline-name')
    await runOnce(rdeps(h))
    expect(result(h, id).result_text.split('\n')).toEqual(['tampered: .git/hooks/a\\x0ab', PROMPT])
  })
  test('a restore that cannot be done is said so on the second line, and counted in the ledger', async () => {
    const { h, root, id } = watched()
    fake.setMode('tamper:immutable')
    try {
      await runOnce(rdeps(h))
      expect(result(h, id).result_text.split('\n')).toEqual(['tampered: .git/config', 'not restored: .git/config', PROMPT])
      expect(tamperLines(h, id)).toEqual([expect.objectContaining({ detail: 'tampered: 1 path(s), 1 not restored' })])
      expect(readState(summonPaths(h), id)?.status).toBe('completed')
    } finally { Bun.spawnSync(['/usr/bin/chflags', 'nouchg', join(root, '.git/config')]) }
  })
  test('the listing is injected: the runner asks it for the folder, .git, hooks and info before and after the job, and for nothing else', async () => {
    const { h, root } = watched(); const asked: string[] = []
    fake.setMode('ok')
    await runOnce(rdeps(h, { listDir: (d) => { asked.push(d.slice(root.length) || '/'); return readdirSync(d) } }))
    expect(asked.sort()).toEqual(['/', '/', '/.git', '/.git', '/.git/hooks', '/.git/hooks', '/.git/info', '/.git/info'])
  })
  test('on a volume that ignores case, a repository stored as .Git/Config is still watched (the real listing, no injection)', async () => {
    const { h, root, id } = watched()
    if (!existsSync(join(root, '.GIT'))) return // a case-sensitive volume has no such spelling to follow
    renameSync(join(root, '.git'), join(root, '.Git')); renameSync(join(root, '.Git/config'), join(root, '.Git/Config')); renameSync(join(root, '.Git/hooks'), join(root, '.Git/HOOKS'))
    const before = listing(root)
    fake.setMode('tamper:config')
    await runOnce(rdeps(h))
    expect(firstLine(h, id)).toBe('tampered: .Git/Config')
    expect(Object.keys(listing(root)).sort()).toEqual(Object.keys({ ...before, '.Git/info/exclude': '' }).sort())
    expect(readFileSync(join(root, '.Git/Config'), 'utf8')).toBe('[core]\n\tbare = false\n')
  })
  test('a review job is not fingerprinted: it has no Bash tool, and its folder is not touched', async () => {
    const h = targetHome(); fakeGitRoot(join(h, 'Projects/x')); const root = join(h, 'Projects/x')
    writeFileSync(join(root, '.git/config'), 'a'); admit(h)
    fake.setMode('tamper:config')
    await runOnce(rdeps(h))
    expect(readFileSync(join(root, '.git/config'), 'utf8')).toBe('a[core]\n\tpager = evil\n') // nothing put back: review jobs are Phase 0's, byte for byte
  })
})

describe('the process sweep (design section 3, "Process sweep", Ruling S3)', () => {
  const SNAP: Partial<RunnerDeps> = { snapshotMs: 50 }
  const noted = (): Record<string, number> => Object.fromEntries(readFileSync(fake.pidsOut, 'utf8').split('\n').filter(Boolean).map((l) => { const [k, p] = l.split(' '); return [k!, Number(p)] }))
  const reap = () => { try { for (const p of Object.values(noted())) { try { process.kill(p, 'SIGKILL') } catch { /* gone */ } } } catch { /* nothing noted */ } }
  afterEach(reap)
  const ALL = 'group,setsid,reparent,cleared-env'
  const goneIn = async (kids: Record<string, number>, want: string[]) => {
    expect(Object.keys(kids).sort()).toEqual([...want].sort()) // the fake did leave them
    for (const p of Object.values(kids)) expect(p).toBeGreaterThan(1)
    await waitFor(() => Object.values(kids).every((p) => !alive(p)), 5000)
  }

  test('claude of an edit or build job runs in a process group of its own; a review job\'s does not (Phase 0, unchanged)', async () => {
    const h = repoHome(BUILD_ALLOWLIST); admit(h, { access: 'edit' })
    await runOnce(rdeps(h))
    expect(argvOf().pgid).toBe(argvOf().pid)
    const h2 = repoHome(BUILD_ALLOWLIST); admit(h2, { access: 'build' })
    await runOnce(rdeps(h2))
    expect(argvOf().pgid).toBe(argvOf().pid)
    const h3 = targetHome(); admit(h3)
    await runOnce(rdeps(h3))
    expect(argvOf().pgid).not.toBe(argvOf().pid)
  })
  test('after a normal end, a child in the group, a setsid child, a reparented child and one with a cleared environment are all gone', async () => {
    const h = repoHome(); const req = admit(h, { access: 'edit' })
    fake.setMode(`kids:${ALL}`)
    await runOnce(rdeps(h, SNAP))
    expect(readState(summonPaths(h), req.id)?.status).toBe('completed')
    await goneIn(noted(), ['group', 'setsid', 'reparent', 'cleared-env'])
  }, 20_000)
  test('after a timeout, the same four are gone', async () => {
    const h = repoHome(); const req = admit(h, { access: 'edit', timeout_s: 1 })
    fake.setMode(`kids:${ALL}:slow`)
    await runOnce(rdeps(h, SNAP))
    expect(readState(summonPaths(h), req.id)?.status).toBe('timed_out')
    await goneIn(noted(), ['group', 'setsid', 'reparent', 'cleared-env'])
  }, 20_000)
  test('a build job\'s leftovers go too', async () => {
    const h = repoHome(BUILD_ALLOWLIST); admit(h, { access: 'build' })
    fake.setMode(`kids:${ALL}`)
    await runOnce(rdeps(h, SNAP))
    await goneIn(noted(), ['group', 'setsid', 'reparent', 'cleared-env'])
  }, 20_000)
  test('the sweep comes before the fingerprint: a leftover that keeps rewriting .git/config is dead before the files are compared', async () => {
    const h = repoHome(); const req = admit(h, { access: 'edit' }); const config = join(h, 'Projects/x/.git/config')
    writeFileSync(config, '[core]\n\tbare = false\n')
    fake.setMode('kids:writer')
    await runOnce(rdeps(h, SNAP))
    await Bun.sleep(300) // a writer still alive would have rewritten the restored file by now (and one alive during the comparison, before it)
    expect(readFileSync(config, 'utf8')).toBe('[core]\n\tbare = false\n')
    expect(String(resultOf(h, req.id).result_text).split('\n')[0]).toBe('tampered: .git/config')
    await goneIn(noted(), ['writer'])
  }, 20_000)
  test('a process that is not the job\'s is left alone', async () => {
    const bystander = Bun.spawn(['/bin/sleep', '600'], { stdout: 'ignore', stderr: 'ignore' })
    try {
      const h = repoHome(); admit(h, { access: 'edit' })
      fake.setMode(`kids:${ALL}`)
      await runOnce(rdeps(h, SNAP))
      expect(alive(bystander.pid)).toBe(true)
    } finally { bystander.kill('SIGKILL') }
  }, 20_000)
  test('RESIDUAL (accepted): a child that leaves its group and is reparented before any snapshot has seen it is not found; it stays sandboxed', async () => {
    const h = repoHome(); admit(h, { access: 'edit' })
    fake.setMode('kids:orphan')
    await runOnce(rdeps(h, { snapshotMs: 60_000 })) // only the look at spawn and the last one before the sweep; the child lives between them
    const orphan = noted().orphan!
    try { expect(alive(orphan)).toBe(true) } finally { try { process.kill(orphan, 'SIGKILL') } catch { /* gone */ } }
  }, 20_000)
  test('with no process table to read (ps gives nothing) the group is still killed, and a child of its own session is not found', async () => {
    const h = repoHome(); admit(h, { access: 'edit' })
    fake.setMode('kids:group,setsid')
    await runOnce(rdeps(h, { ...SNAP, ps: () => null }))
    const kids = noted()
    await waitFor(() => !alive(kids.group!), 5000)
    expect(alive(kids.setsid!)).toBe(true) // the documented cost of a blind ps; the sandbox still confines it
  }, 20_000)
  test('review jobs are not swept: their leftovers are Phase 0\'s business (they have no Bash tool to leave any)', async () => {
    const h = targetHome(); admit(h)
    fake.setMode('kids:group')
    await runOnce(rdeps(h, SNAP))
    expect(alive(noted().group!)).toBe(true)
  }, 20_000)
})

describe('every place that switches on Access (design section 6, runner): status, ledger and describeCommand', () => {
  test('a build job through the real gate and runner: both ends\' ledger lines carry access build, and status and result answer for it', async () => {
    const h = repoHome(BUILD_ALLOWLIST); const paths = summonPaths(h); const req = admit(h, { access: 'build' })
    expect(ledgerOf(h).find((e) => e.event === 'admitted' && e.id === req.id)).toMatchObject({ access: 'build', cwd: '~/Projects/x' })
    expect(statusOf(paths, 'nuance', req.id, Date.now())).toMatchObject({ status: 'queued', handle: `nuance/${req.id}` })
    await runOnce(rdeps(h))
    expect(statusOf(paths, 'nuance', req.id, Date.now())).toEqual({ status: 'completed', handle: `nuance/${req.id}` })
    expect(gateResult(paths, 'nuance', req.id, Date.now())).toMatchObject({ status: 'completed', handle: `nuance/${req.id}`, result_text: `echo: ${req.prompt}` })
    expect(readState(paths, req.id)?.access).toBe('build')
  })
  test('a refused build job answers refused with its reason, through status and through result, and the Air\'s own words come from the same answer', async () => {
    const h = repoHome(DEFAULT_ALLOWLIST); const paths = summonPaths(h); const req = enqueue(h, { access: 'build' })
    await runOnce(rdeps(h))
    const said = { status: 'refused', reason: 'outside_allowlist', handle: `nuance/${req.id}`, detail: expect.stringContaining('build is not allowed') }
    expect(statusOf(paths, 'nuance', req.id, Date.now())).toMatchObject(said)
    expect(gateResult(paths, 'nuance', req.id, Date.now())).toMatchObject(said)
    expect(ledgerOf(h).find((e) => e.event === 'job_end' && e.id === req.id)).toMatchObject({ status: 'refused', reason: 'outside_allowlist' })
  })
  test('describeCommand names nothing of an access: a command that says --build, --edit or build shows its length and, for a word, only the word', () => {
    expect(describeCommand('start --build')).toBe('len 13, first token "start"')
    expect(describeCommand('--build --cwd ~/x')).toBe('len 17, first token not shown')
    expect(describeCommand('build')).toBe('len 5, first token "build"')
  })
})

describe('recovery', () => {
  const running = (paths = summonPaths(targetHome()), over: Partial<JobState> = {}) => {
    const id = newRequestId()
    writeState(paths, { id, status: 'running', pid: 999_999, runtime: 'claude', model: 'sonnet', access: 'review', cwd_real: '/x',
      admitted_at: iso(Date.now()), expires_at: iso(Date.now()), timeout_s: 9, ...over })
    return id
  }
  test('a running job whose pid is dead becomes unknown', () => {
    const paths = summonPaths(targetHome()); const id = running(paths)
    expect(markOrphans(paths, Date.now(), () => false)).toBe(1)
    expect(readState(paths, id)).toMatchObject({ status: 'unknown', detail: 'runner stopped mid-job' })
    expect(readState(paths, id)?.pid).toBeUndefined()
    expect(ledgerOf(paths.home)).toContainEqual(expect.objectContaining({ event: 'job_end', id, status: 'unknown' }))
  })
  test('a running job whose pid is still alive with the start time it was recorded with is left alone', () => {
    const paths = summonPaths(targetHome()); const id = running(paths, { pid_lstart: 'Sun Oct 11 00:38:43 2026' })
    expect(markOrphans(paths, Date.now(), () => true, () => 'Sun Oct 11 00:38:43 2026')).toBe(0)
    expect(readState(paths, id)?.status).toBe('running')
  })
  describe('F27: a reused pid does not keep a dead job running', () => {
    test('a live pid with another start time is orphaned, and the next request is admitted', () => {
      const h = targetHome(); const paths = summonPaths(h)
      const other = Bun.spawn(['/bin/sleep', '60'], { stdout: 'ignore', stderr: 'ignore' }) // an unrelated live process that got the old pid
      try {
        const id = running(paths, { pid: other.pid, pid_lstart: 'Fri Oct  9 10:00:00 2026', started_at: iso(Date.now() - 2 * 86_400_000) })
        expect(alive(other.pid)).toBe(true)
        expect(markOrphans(paths, Date.now(), undefined, () => 'Sun Oct 11 00:38:43 2026')).toBe(1) // the default liveness check
        expect(readState(paths, id)).toMatchObject({ status: 'unknown', detail: 'runner stopped mid-job' })
        expect(countActive(paths, Date.now())).toBe(0)
        admit(h)
        expect(alive(other.pid)).toBe(true) // never signalled
      } finally { other.kill('SIGKILL') }
    })
    test('a running state with no recorded start time is orphaned even when its pid is alive', () => {
      const paths = summonPaths(targetHome()); const id = running(paths)
      expect(markOrphans(paths, Date.now(), () => true, () => 'Sun Oct 11 00:38:43 2026')).toBe(1)
      expect(readState(paths, id)?.status).toBe('unknown')
    })
    test('a pid whose start time does not match is never probed or signalled', () => {
      const paths = summonPaths(targetHome()); running(paths, { pid_lstart: 'then' })
      let probed = 0
      expect(markOrphans(paths, Date.now(), () => { probed++; return true }, () => 'now')).toBe(1)
      expect(probed).toBe(0)
    })
    test('processStartTime reads the kernel start time with ps: stable for a live pid, null once it is gone', async () => {
      const p = Bun.spawn(['/bin/sleep', '60'], { stdout: 'ignore', stderr: 'ignore' })
      const first = processStartTime(p.pid)
      expect(first).toMatch(/^[A-Z][a-z]{2} [A-Z][a-z]{2} [ \d]\d \d{2}:\d{2}:\d{2} \d{4}$/) // C locale: `Sun Oct 11 00:38:43 2026`
      expect(processStartTime(p.pid)).toBe(first)
      p.kill('SIGKILL'); await p.exited
      expect(processStartTime(p.pid)).toBeNull()
    })
  })
  describe('F28: an orphan whose result.json landed finishes from it', () => {
    test('a running job with a dead pid and a completed result ends completed: status and result agree', () => {
      const paths = summonPaths(targetHome()); const id = running(paths); const now = Date.now()
      writeJsonAtomic(join(jobDir(paths, id), 'result.json'), { status: 'completed', result_text: 'the answer', exit_code: 0, num_turns: 3, cost_usd: 0.05 })
      expect(markOrphans(paths, now, () => false)).toBe(1)
      const s = readState(paths, id)!
      expect(s).toMatchObject({ status: 'completed', ended_at: iso(now) })
      expect(s.detail).toBeUndefined()
      expect(s.pid).toBeUndefined()
      expect(statusOf(paths, 'nuance', id, now)).toMatchObject({ status: 'completed' })
      expect(gateResult(paths, 'nuance', id, now)).toMatchObject({ status: 'completed', result_text: 'the answer' })
      const ends = ledgerOf(paths.home).filter((e) => e.event === 'job_end' && e.id === id)
      expect(ends).toEqual([expect.objectContaining({ status: 'completed' })])
      expect(JSON.stringify(ends)).not.toContain('the answer')
      expect(markOrphans(paths, now, () => false)).toBe(0)
    })
    test('its reason and detail come along (blocked permission)', () => {
      const paths = summonPaths(targetHome()); const id = running(paths)
      writeJsonAtomic(join(jobDir(paths, id), 'result.json'), { status: 'blocked', reason: 'permission', detail: '1 tool call(s) denied', exit_code: 0 })
      markOrphans(paths, Date.now(), () => false)
      expect(readState(paths, id)).toMatchObject({ status: 'blocked', reason: 'permission', detail: '1 tool call(s) denied' })
      expect(ledgerOf(paths.home).find((e) => e.event === 'job_end')).toMatchObject({ status: 'blocked', reason: 'permission', detail: '1 tool call(s) denied' })
    })
    test('F17: a usage result keeps its reset time in state.json', () => {
      const paths = summonPaths(targetHome()); const id = running(paths)
      writeJsonAtomic(join(jobDir(paths, id), 'result.json'), { status: 'blocked', reason: 'usage', detail: 'usage allowed_warning', resets_at: '2026-10-11T03:00:00.000Z', exit_code: null })
      markOrphans(paths, Date.now(), () => false)
      expect(readState(paths, id)).toMatchObject({ status: 'blocked', reason: 'usage', resets_at: '2026-10-11T03:00:00.000Z' })
    })
    test('a claimed queued job whose result landed (cancelled before it started) ends cancelled', () => {
      const h = targetHome(); const paths = summonPaths(h); const req = enqueue(h)
      unlinkSync(join(paths.spool, req.id)); writeFileSync(join(jobDir(paths, req.id), 'claimed'), '')
      writeJsonAtomic(join(jobDir(paths, req.id), 'result.json'), { status: 'cancelled', detail: 'cancelled before it started', exit_code: null })
      expect(markOrphans(paths, Date.now(), () => false)).toBe(1)
      expect(readState(paths, req.id)).toMatchObject({ status: 'cancelled', detail: 'cancelled before it started' })
    })
    test('a result.json that does not parse, or names no final status, still ends unknown', () => {
      const paths = summonPaths(targetHome()); const torn = running(paths); const odd = running(paths)
      writeFileSync(join(jobDir(paths, torn), 'result.json'), '{"status":"compl')
      writeJsonAtomic(join(jobDir(paths, odd), 'result.json'), { status: 'running' })
      expect(markOrphans(paths, Date.now(), () => false)).toBe(2)
      for (const id of [torn, odd]) expect(readState(paths, id)).toMatchObject({ status: 'unknown', detail: 'runner stopped mid-job' })
    })
  })
  test('a running job with no pid at all becomes unknown', () => {
    const paths = summonPaths(targetHome()); const id = running(paths, { pid: undefined })
    expect(markOrphans(paths, Date.now(), () => true)).toBe(1)
    expect(readState(paths, id)?.status).toBe('unknown')
  })
  test('carried (A2): a claimed job the dead runner never started, with a cancel asked for, ends cancelled like every never-started job', () => {
    const h = targetHome(); const paths = summonPaths(h); const now = Date.now()
    const req = enqueue(h)
    unlinkSync(join(paths.spool, req.id)); writeFileSync(join(jobDir(paths, req.id), 'claimed'), ''); writeFileSync(join(jobDir(paths, req.id), 'cancel'), '')
    expect(markOrphans(paths, now, () => false)).toBe(1)
    expect(readState(paths, req.id)).toMatchObject({ status: 'cancelled', detail: 'cancelled before it started', ended_at: iso(now) })
    expect(resultOf(h, req.id)).toMatchObject({ status: 'cancelled', detail: 'cancelled before it started' })
    expect(statusOf(paths, 'nuance', req.id, now)).toMatchObject({ status: 'cancelled', detail: 'cancelled before it started' })
    expect(ledgerOf(h).filter((e) => e.event === 'job_end')).toEqual([expect.objectContaining({ id: req.id, status: 'cancelled' })])
  })
  test('a queued job the dead runner had already claimed becomes unknown; one still in the spool does not', () => {
    const h = targetHome(); const paths = summonPaths(h)
    const claimed = enqueue(h); const waiting = enqueue(h)
    unlinkSync(join(paths.spool, claimed.id))
    writeFileSync(join(jobDir(paths, claimed.id), 'claimed'), '')
    expect(markOrphans(paths, Date.now(), () => false)).toBe(1)
    expect(readState(paths, claimed.id)).toMatchObject({ status: 'unknown', detail: 'runner stopped before the job started' })
    expect(readState(paths, waiting.id)?.status).toBe('queued')
  })
  test('Review Focus 4: a running job with a dead pid and a heartbeat shows unknown with a heartbeat age', () => {
    const paths = summonPaths(targetHome()); const id = running(paths, { started_at: iso(Date.now() - 60_000) })
    const beat = join(jobDir(paths, id), 'heartbeat')
    writeFileSync(beat, String(Date.now() - 40_000))
    utimesSync(beat, new Date(Date.now() - 40_000), new Date(Date.now() - 40_000))
    markOrphans(paths, Date.now(), () => false)
    const st = statusOf(paths, 'nuance', id, Date.now())
    expect(st).toMatchObject({ status: 'unknown', detail: 'runner stopped mid-job', handle: `nuance/${id}` })
    expect(typeof st.heartbeat_age_s).toBe('number')
    expect(st.heartbeat_age_s as number).toBeGreaterThanOrEqual(40)
    expect(st.heartbeat_age_s as number).toBeLessThan(45)
  })

  describe('settleNeverReached (ruling 3, F38; replaced reapStranded)', () => {
    const past = { expires_at: iso(Date.now() - CLOCK_SKEW_MS - 60_000) } // past the gate's skew grace too
    test('a queued job past expiry with no spool marker and no claim becomes expired and stops counting as active', () => {
      const h = targetHome(); const paths = summonPaths(h)
      const req = enqueue(h, past)
      unlinkSync(join(paths.spool, req.id)) // the gate died between state.json and the marker
      expect(countActive(paths, Date.parse(past.expires_at))).toBe(1) // while it could still run, it counts
      expect(settleNeverReached(paths, Date.now())).toBe(1)
      expect(readState(paths, req.id)).toMatchObject({ status: 'expired' })
      expect(resultOf(h, req.id)).toMatchObject({ status: 'expired' })
      expect(ledgerOf(h)).toContainEqual(expect.objectContaining({ event: 'job_end', id: req.id, status: 'expired' }))
      expect(countActive(paths, Date.now())).toBe(0)
      expect(settleNeverReached(paths, Date.now())).toBe(0) // idempotent
    })
    test('F18: a stranded job past its expiry but still inside the skew grace is left alone', () => {
      const h = targetHome(); const paths = summonPaths(h)
      const req = enqueue(h, { expires_at: iso(Date.now() - 60_000) })
      unlinkSync(join(paths.spool, req.id))
      expect(settleNeverReached(paths, Date.now())).toBe(0)
      expect(readState(paths, req.id)?.status).toBe('queued')
      expect(settleNeverReached(paths, Date.now() + CLOCK_SKEW_MS)).toBe(1)
    })
    test('a never-reached job still in the spool loses its marker and is settled too; fresh, claimed and finished ones are left alone', () => {
      const h = targetHome(); const paths = summonPaths(h)
      const fresh = enqueue(h); unlinkSync(join(paths.spool, fresh.id))
      const inSpool = enqueue(h, past)
      const claimed = enqueue(h, past); unlinkSync(join(paths.spool, claimed.id)); writeFileSync(join(jobDir(paths, claimed.id), 'claimed'), '')
      const done = enqueue(h, { ...past, status: 'completed' }); unlinkSync(join(paths.spool, done.id))
      expect(settleNeverReached(paths, Date.now())).toBe(1)
      expect(readState(paths, inSpool.id)).toMatchObject({ status: 'expired', detail: 'never reached the runner' })
      expect(existsSync(join(paths.spool, inSpool.id))).toBe(false)
      expect(readState(paths, fresh.id)?.status).toBe('queued')
      expect(readState(paths, claimed.id)?.status).toBe('queued')
      expect(readState(paths, done.id)?.status).toBe('completed')
    })
    test('review #5: a queued state with no request.json and no marker (a crash between the two writes) is never run and settles expired', async () => {
      const h = targetHome(); const paths = summonPaths(h)
      const req = enqueue(h, past)
      unlinkSync(join(jobDir(paths, req.id), 'request.json')); unlinkSync(join(paths.spool, req.id))
      expect(await runOnce(rdeps(h))).toBe(0) // nothing to claim: it can never start
      expect(existsSync(fake.argvOut)).toBe(false)
      expect(countActive(paths, Date.now())).toBe(0)
      expect(settleNeverReached(paths, Date.now())).toBe(1)
      expect(readState(paths, req.id)).toMatchObject({ status: 'expired', detail: 'never reached the runner' })
      expect(sweepJobs(paths, Date.now() + 31 * 86_400_000)).toBe(1) // terminal now, so the 30-day sweep removes it
    })
  })

  describe('sweepJobs', () => {
    const state = (over: Partial<JobState>): JobState => ({ id: newRequestId(), status: 'completed', runtime: 'claude', model: 'sonnet', access: 'review',
      cwd_real: '/x', admitted_at: iso(Date.now()), expires_at: iso(Date.now()), timeout_s: 9, ...over })
    test('old finished jobs are swept after 30 days; young, running and unfinished ones stay', () => {
      const paths = summonPaths(targetHome())
      const old = iso(Date.now() - 31 * 86_400_000)
      const oldDone = state({ ended_at: old, admitted_at: old })
      const young = state({ ended_at: iso(Date.now() - 86_400_000) })
      const oldRunning = state({ status: 'running', admitted_at: old })
      const oldNoEnd = state({ admitted_at: old }) // finished but never stamped: ages from admission
      for (const s of [oldDone, young, oldRunning, oldNoEnd]) writeState(paths, s)
      expect(sweepJobs(paths, Date.now())).toBe(2)
      expect(existsSync(join(paths.jobs, oldDone.id))).toBe(false)
      expect(existsSync(join(paths.jobs, oldNoEnd.id))).toBe(false)
      expect(existsSync(join(paths.jobs, young.id))).toBe(true)
      expect(existsSync(join(paths.jobs, oldRunning.id))).toBe(true)
    })
  })
})

describe('F38: a queued job the runner never reached', () => {
  const gate = (home: string, nowMs: number) => ({ nowMs: () => nowMs, home, paths: summonPaths(home),
    guiSessionIsMine: () => true, runnerLoaded: () => true, claudeAvailable: () => true })
  test('past its expiry and the skew grace, with no claim: not busy, status says expired, and the next start settles it once', async () => {
    const h = targetHome(); const paths = summonPaths(h); const t0 = Date.now()
    const stuck = sampleRequest({ expires_at: iso(t0 + 60_000) })
    expect(gateStart(JSON.stringify(stuck), gate(h, t0)).status).toBe('admitted')
    const later = t0 + 60_000 + CLOCK_SKEW_MS + 1_000 // the runner never ran in between
    expect(countActive(paths, later)).toBe(0)
    expect(statusOf(paths, 'nuance', stuck.id, later)).toMatchObject({ status: 'expired', handle: `nuance/${stuck.id}`, detail: 'never reached the runner' })
    expect(requestCancel(paths, 'nuance', stuck.id, later)).toMatchObject({ status: 'expired', detail: 'never reached the runner' })
    expect(existsSync(join(jobDir(paths, stuck.id), 'cancel'))).toBe(false)
    const next = sampleRequest({ issued_at: iso(later), expires_at: iso(later + 15 * 60_000) })
    expect(gateStart(JSON.stringify(next), gate(h, later))).toMatchObject({ status: 'admitted' })
    expect(readState(paths, stuck.id)).toMatchObject({ status: 'expired', detail: 'never reached the runner', ended_at: iso(later) })
    expect(resultOf(h, stuck.id)).toMatchObject({ status: 'expired', detail: 'never reached the runner' })
    expect(existsSync(join(paths.spool, stuck.id))).toBe(false)
    const endsOf = (id: string) => ledgerOf(h).filter((e) => e.event === 'job_end' && e.id === id)
    expect(endsOf(stuck.id)).toEqual([expect.objectContaining({ status: 'expired', detail: 'never reached the runner' })])
    // The runner then runs only the new job: the settled one is not started and gets no second job_end.
    fake.setMode('ok')
    expect(await runOnce(rdeps(h))).toBe(1)
    expect(readState(paths, next.id)?.status).toBe('completed')
    expect(existsSync(join(jobDir(paths, stuck.id), 'claimed'))).toBe(false)
    expect(endsOf(stuck.id)).toHaveLength(1)
    expect(verifyLedger(paths.ledger).ok).toBe(true)
  })
  describe('review #8: one outcome for a job that never started, wherever it is decided', () => {
    const past = { expires_at: iso(Date.now() - CLOCK_SKEW_MS - 60_000) }
    test('without a cancel: status says expired, never reached the runner, and the runner ends it the same way', async () => {
      const h = targetHome(); const paths = summonPaths(h); const req = enqueue(h, past)
      const said = statusOf(paths, 'nuance', req.id, Date.now())
      expect(said).toMatchObject({ status: 'expired', detail: 'never reached the runner' })
      await runOnce(rdeps(h)) // the marker is still there, so the runner claims it and decides for itself
      expect(readState(paths, req.id)).toMatchObject({ status: said.status, detail: said.detail })
      expect(existsSync(fake.argvOut)).toBe(false)
    })
    test('with a cancel marker: status says cancelled before it started, and so do the runner and the gate', async () => {
      const h = targetHome(); const paths = summonPaths(h)
      const viaRunner = enqueue(h, past); writeFileSync(join(jobDir(paths, viaRunner.id), 'cancel'), '')
      const said = statusOf(paths, 'nuance', viaRunner.id, Date.now())
      expect(said).toMatchObject({ status: 'cancelled', detail: 'cancelled before it started' })
      await runOnce(rdeps(h))
      expect(readState(paths, viaRunner.id)).toMatchObject({ status: said.status, detail: said.detail })
      const viaGate = enqueue(h, past); writeFileSync(join(jobDir(paths, viaGate.id), 'cancel'), '')
      expect(settleNeverReached(paths, Date.now())).toBe(1)
      expect(readState(paths, viaGate.id)).toMatchObject({ status: 'cancelled', detail: 'cancelled before it started' })
      expect(ledgerOf(h).find((e) => e.event === 'job_end' && e.id === viaGate.id)).toMatchObject({ status: 'cancelled' })
    })
  })
  test('inside the skew grace, or once the runner has claimed it, it still counts and still says queued', () => {
    const h = targetHome(); const paths = summonPaths(h); const t0 = Date.now()
    const req = sampleRequest({ expires_at: iso(t0 + 60_000) })
    expect(gateStart(JSON.stringify(req), gate(h, t0)).status).toBe('admitted')
    const inGrace = t0 + 60_000 + CLOCK_SKEW_MS - 1_000
    expect(countActive(paths, inGrace)).toBe(1)
    expect(statusOf(paths, 'nuance', req.id, inGrace).status).toBe('queued')
    unlinkSync(join(paths.spool, req.id)); writeFileSync(join(jobDir(paths, req.id), 'claimed'), '') // the runner has it
    const past = t0 + 60_000 + CLOCK_SKEW_MS + 1_000
    expect(countActive(paths, past)).toBe(1)
    expect(statusOf(paths, 'nuance', req.id, past).status).toBe('queued')
    expect(gateStart(JSON.stringify(sampleRequest({ issued_at: iso(past), expires_at: iso(past + 60_000) })), gate(h, past))).toMatchObject({ reason: 'busy' })
    expect(readState(paths, req.id)?.status).toBe('queued')
  })
})

describe('runner-main (a fresh process, as launchd starts it)', () => {
  test('after a runner is killed mid-job, the next start marks the job unknown, reaps the stranded, runs the queue and exits 0', async () => {
    const h = targetHome(); const paths = summonPaths(h)
    const env = { PATH: process.env.PATH!, HOME: h, SUMMON_HOME_OVERRIDE: h, SUMMON_CLAUDE_BIN: fake.bin }
    const start = () => Bun.spawn([process.execPath, RUNNER_MAIN], { env, stdout: 'pipe', stderr: 'pipe' })

    fake.setMode('slow')
    const first = admit(h)
    const p1 = start()
    await waitFor(() => readState(paths, first.id)?.status === 'running' && existsSync(join(jobDir(paths, first.id), 'heartbeat')))
    const pid = readState(paths, first.id)!.pid!
    p1.kill('SIGKILL'); await p1.exited
    process.kill(pid, 'SIGKILL') // the claude child is gone too: a dead pid behind a state that still says running
    await waitFor(() => !alive(pid))
    expect(readState(paths, first.id)?.status).toBe('running')
    expect(readdirSync(paths.spool)).toEqual([])

    fake.setMode('ok')
    const next = enqueue(h)
    const stranded = enqueue(h, { expires_at: iso(Date.now() - CLOCK_SKEW_MS - 60_000) })
    unlinkSync(join(paths.spool, stranded.id))
    const p2 = start()
    expect(await p2.exited).toBe(0)

    expect(readState(paths, first.id)).toMatchObject({ status: 'unknown', detail: 'runner stopped mid-job' })
    const st = statusOf(paths, 'nuance', first.id, Date.now())
    expect(st.status).toBe('unknown')
    expect(typeof st.heartbeat_age_s).toBe('number')
    expect(readState(paths, next.id)?.status).toBe('completed')
    expect(readState(paths, stranded.id)?.status).toBe('expired')
    expect(readdirSync(paths.spool)).toEqual([])
    expect(verifyLedger(paths.ledger).ok).toBe(true)
  }, 30_000)
  test('review #1: a job whose claim keeps failing is settled once past expiry + grace: one pass removes its marker and exits 0', async () => {
    const h = targetHome(); const paths = summonPaths(h)
    const env = { PATH: process.env.PATH!, HOME: h, SUMMON_HOME_OVERRIDE: h, SUMMON_CLAUDE_BIN: fake.bin }
    const req = enqueue(h, { expires_at: iso(Date.now() - CLOCK_SKEW_MS - 60_000) })
    chmodSync(jobDir(paths, req.id), 0o500) // the claim rename fails (EACCES), and so does every write into the job dir
    let code: number
    try { code = await Bun.spawn([process.execPath, RUNNER_MAIN], { env, stdout: 'ignore', stderr: 'ignore' }).exited } finally { chmodSync(jobDir(paths, req.id), 0o700) }
    expect(code).toBe(0) // the loop is over: nothing is left in the spool to relaunch the runner over
    expect(readdirSync(paths.spool)).toEqual([])
    expect(statusOf(paths, 'nuance', req.id, Date.now())).toMatchObject({ status: 'expired', detail: 'never reached the runner' })
    expect(ledgerOf(h).filter((e) => e.event === 'claim_failed')).toEqual([])
    // Once the job dir is writable again, the next start settles it on disk, once.
    expect(await Bun.spawn([process.execPath, RUNNER_MAIN], { env, stdout: 'ignore', stderr: 'ignore' }).exited).toBe(0)
    expect(readState(paths, req.id)).toMatchObject({ status: 'expired', detail: 'never reached the runner' })
    expect(ledgerOf(h).filter((e) => e.event === 'job_end' && e.id === req.id)).toHaveLength(1)
  }, 30_000)
  test('review #3: a runner start and a gate start at the same moment settle a never-reached job exactly once', async () => {
    for (let round = 0; round < 3; round++) {
      const h = targetHome(); const paths = summonPaths(h)
      const env = { PATH: process.env.PATH!, HOME: h, SUMMON_HOME_OVERRIDE: h, SUMMON_CLAUDE_BIN: fake.bin }
      const stuck = enqueue(h, { expires_at: iso(Date.now() - CLOCK_SKEW_MS - 60_000) })
      unlinkSync(join(paths.spool, stuck.id)) // stranded: both settlers can see it at once
      fake.setMode('ok')
      const runner = Bun.spawn([process.execPath, RUNNER_MAIN], { env, stdout: 'ignore', stderr: 'ignore' })
      const [code, gate] = await Promise.all([runner.exited, runGatekeeper(h, 'start', JSON.stringify(sampleRequest()))])
      expect(code).toBe(0)
      expect(gate.out.status).toBe('admitted')
      expect(readState(paths, stuck.id)?.status).toBe('expired')
      expect(ledgerOf(h).filter((e) => e.event === 'job_end' && e.id === stuck.id)).toHaveLength(1)
    }
  }, 60_000)
  test('F25: exits non-zero while an admitted job cannot be claimed, and keeps its marker for the retry', async () => {
    const h = targetHome(); const paths = summonPaths(h); const req = admit(h)
    const env = { PATH: process.env.PATH!, HOME: h, SUMMON_HOME_OVERRIDE: h, SUMMON_CLAUDE_BIN: fake.bin }
    chmodSync(jobDir(paths, req.id), 0o500)
    let code: number, stderr: string
    try {
      const p = Bun.spawn([process.execPath, RUNNER_MAIN], { env, stdout: 'pipe', stderr: 'pipe' })
      ;[code, stderr] = await Promise.all([p.exited, new Response(p.stderr).text()])
    } finally { chmodSync(jobDir(paths, req.id), 0o700) }
    expect(code).toBe(1)
    expect(stderr).toContain('summon-runner: runOnce failed: EACCES')
    expect(existsSync(join(paths.spool, req.id))).toBe(true)
    expect(readState(paths, req.id)?.status).toBe('queued')
  }, 30_000)
})
