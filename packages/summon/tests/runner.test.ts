import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gateStart } from '../src/gate.ts'
import { requestCancel, statusOf } from '../src/gatekeeper.ts'
import { countActive, jobDir, readJson, readState, writeJsonAtomic, writeState, type JobState } from '../src/jobs.ts'
import { verifyLedger } from '../src/ledger.ts'
import { summonPaths } from '../src/paths.ts'
import { newRequestId } from '../src/request.ts'
import { markOrphans, reapStranded, runOnce, sweepJobs, type RunnerDeps } from '../src/runner.ts'
import { cleanupTmps, makeFakeClaude, sampleRequest, targetHome } from './helpers.ts'

afterEach(cleanupTmps)

let fake: ReturnType<typeof makeFakeClaude>
beforeEach(() => { fake = makeFakeClaude() })

const RUNNER_MAIN = join(import.meta.dir, '..', 'src', 'runner-main.ts')
const iso = (ms: number) => new Date(ms).toISOString()
const rdeps = (home: string, over: Partial<RunnerDeps> = {}): RunnerDeps => ({
  paths: summonPaths(home), home, user: 'yu', nowMs: () => Date.now(), claudeBin: () => fake.bin,
  collectInventory: async () => ({ macos: 'test' }), heartbeatMs: 50, pollMs: 25, killGraceMs: 200, ...over,
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
  test('timeout stops the job', async () => {
    const h = targetHome(); const req = admit(h, { timeout_s: 1 })
    fake.setMode('slow')
    await runOnce(rdeps(h))
    expect(readState(summonPaths(h), req.id)?.status).toBe('timed_out')
    expect(resultOf(h, req.id)).toMatchObject({ status: 'timed_out', detail: 'ran past 1s' })
  }, 15_000)
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
    test('an edit job whose folder has a comma ends failed (claudeInvocation throws)', async () => {
      const h = targetHome(); mkdirSync(join(h, 'Projects/a,b'))
      const req = enqueue(h, { access: 'edit', cwd_real: join(h, 'Projects/a,b') })
      await runOnce(rdeps(h))
      const s = failedWith(h, req.id, 'could not start claude: the command could not be built for this folder')
      expect(JSON.stringify(s)).not.toContain(req.prompt)
      expect(JSON.stringify(ledgerOf(h))).not.toContain(req.prompt)
    })
    test('a job whose folder is a regular file ends failed (spawn throws)', async () => {
      const h = targetHome(); writeFileSync(join(h, 'Projects/afile'), '')
      const req = enqueue(h, { cwd_real: join(h, 'Projects/afile') })
      await runOnce(rdeps(h))
      failedWith(h, req.id, /^could not start claude: E[A-Z]+$/)
    })
    test('a job whose folder no longer exists ends failed (spawn reports the error later)', async () => {
      const h = targetHome()
      const req = enqueue(h, { cwd_real: join(h, 'Projects/gone') })
      await runOnce(rdeps(h))
      failedWith(h, req.id, 'could not start claude: ENOENT')
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
  test('a running job whose pid is still alive is left alone', () => {
    const paths = summonPaths(targetHome()); const id = running(paths)
    expect(markOrphans(paths, Date.now(), () => true)).toBe(0)
    expect(readState(paths, id)?.status).toBe('running')
  })
  test('a running job with no pid at all becomes unknown', () => {
    const paths = summonPaths(targetHome()); const id = running(paths, { pid: undefined })
    expect(markOrphans(paths, Date.now(), () => true)).toBe(1)
    expect(readState(paths, id)?.status).toBe('unknown')
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

  describe('reapStranded (ruling 3)', () => {
    const past = { expires_at: iso(Date.now() - 60_000) }
    test('a queued job past expiry with no spool marker and no claim becomes expired and stops counting as active', () => {
      const h = targetHome(); const paths = summonPaths(h)
      const req = enqueue(h, past)
      unlinkSync(join(paths.spool, req.id)) // the gate died between state.json and the marker
      expect(countActive(paths)).toBe(1)
      expect(reapStranded(paths, Date.now())).toBe(1)
      expect(readState(paths, req.id)).toMatchObject({ status: 'expired' })
      expect(resultOf(h, req.id)).toMatchObject({ status: 'expired' })
      expect(ledgerOf(h)).toContainEqual(expect.objectContaining({ event: 'job_end', id: req.id, status: 'expired' }))
      expect(countActive(paths)).toBe(0)
      expect(reapStranded(paths, Date.now())).toBe(0) // idempotent
    })
    test('is left alone: not yet expired, still in the spool, claimed, or already finished', () => {
      const h = targetHome(); const paths = summonPaths(h)
      const fresh = enqueue(h); unlinkSync(join(paths.spool, fresh.id))
      const inSpool = enqueue(h, past)
      const claimed = enqueue(h, past); unlinkSync(join(paths.spool, claimed.id)); writeFileSync(join(jobDir(paths, claimed.id), 'claimed'), '')
      const done = enqueue(h, { ...past, status: 'completed' }); unlinkSync(join(paths.spool, done.id))
      expect(reapStranded(paths, Date.now())).toBe(0)
      expect(readState(paths, fresh.id)?.status).toBe('queued')
      expect(readState(paths, inSpool.id)?.status).toBe('queued')
      expect(readState(paths, claimed.id)?.status).toBe('queued')
      expect(readState(paths, done.id)?.status).toBe('completed')
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
    const stranded = enqueue(h, { expires_at: iso(Date.now() - 60_000) })
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
})
