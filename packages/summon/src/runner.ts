import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { claudeInvocation, interpretClaudeStream, usageWarning, type Invocation, type Outcome } from './harness.ts'
import { codexInvocation, codexReady } from './codex.ts'
import { interpretCodexStream } from './codex-output.ts'
import { groupMembers, signalOwnedGroup, type GroupMembers } from './process-group.ts'
import { claimFailedNote, errTag, finishJob, jobDir, notStartedOutcome, readJson, readState, settleJob, writeJsonAtomic, writeState, type JobResult, type JobState } from './jobs.ts'
import { appendLedger, withLock } from './ledger.ts'
import type { SummonPaths } from './paths.ts'
import { CLOCK_SKEW_MS, ID_RE, type SummonRequest } from './request.ts'
import { TERMINAL } from './status.ts'

export interface RunnerDeps {
  paths: SummonPaths
  home: string
  user: string
  nowMs(): number
  claudeBin(): string | null
  codexBin?(): string | null
  collectInventory(): Promise<unknown>
  heartbeatMs: number
  pollMs: number
  killGraceMs: number
  /** The start time of a pid (runner-main passes processStartTime); recorded at spawn so a reused pid is not taken for the job. */
  processStartTime(pid: number): string | null
  /** A monotonic clock for the timeout and heartbeat intervals; defaults to performance.now(). nowMs stamps what is written to disk. */
  monoMs?(): number
}

const MAX_STDOUT_BYTES = 8 * 1024 * 1024
/** Kept in memory only, to recognise a command line claude rejects; never written anywhere. */
const STDERR_KEEP_BYTES = 4096
const INVENTORY_REQ_RE = /^inventory-\d+\.req$/
const iso = (ms: number) => new Date(ms).toISOString()

const finish = (deps: RunnerDeps, s: JobState, o: Outcome, exitCode: number | null = null) => finishJob(deps.paths, deps.nowMs(), s, o, exitCode)

/** Spawns claude. Bun reports some failures by throwing (ENOTDIR) and some later as an 'error' event with no pid (ENOENT). */
function startChild(inv: Invocation, cwd: string, processGroup = false): Promise<{ child: ChildProcess } | { error: string }> {
  let child: ChildProcess
  try { child = spawn(inv.bin, inv.args, { cwd, env: inv.env, detached: processGroup, stdio: ['pipe', 'pipe', 'pipe'] }) } catch (e) { return Promise.resolve({ error: errTag(e) }) }
  if (child.pid !== undefined) {
    child.on('error', () => { /* a kill that did not land; the close event still decides */ })
    return Promise.resolve({ child })
  }
  return new Promise((resolve) => {
    child.once('error', (e) => resolve({ error: errTag(e) }))
    child.once('close', () => resolve({ error: 'error' }))
  })
}

/** What a stopped job reports: the stop reason wins, and the stream's partial text/cost ride along. A usage stop keeps the stream's own detail and reset time. */
function stoppedOutcome(stopped: Outcome, interpreted: Outcome): Outcome {
  if (stopped.reason === 'usage' && interpreted.reason === 'usage') return interpreted
  return { result_text: interpreted.result_text, num_turns: interpreted.num_turns, cost_usd: interpreted.cost_usd, ...stopped }
}

async function runJob(deps: RunnerDeps, id: string): Promise<void> {
  const dir = jobDir(deps.paths, id)
  const s = readState(deps.paths, id)
  if (!s) { appendLedger(deps.paths.ledger, { event: 'spool_discard', id, detail: 'job state unreadable' }, deps.nowMs()); return }
  if (s.status !== 'queued') return
  // A cancel asked for, or past expiry plus the same ±5 min grace the gate admitted it under (a job the gate admitted is
  // never expired by the skew alone): it ends as the gate and `status` would say it does.
  if (existsSync(join(dir, 'cancel')) || deps.nowMs() > Date.parse(s.expires_at) + CLOCK_SKEW_MS) return finish(deps, s, notStartedOutcome(deps.paths, id))
  const req = readJson<SummonRequest>(join(dir, 'request.json'))
  if (!req || typeof req.prompt !== 'string') return finish(deps, s, { status: 'failed', detail: 'request file is missing or unreadable' })
  if (s.runtime !== 'claude' && s.runtime !== 'codex') return finish(deps, s, { status: 'failed', detail: 'runtime is not supported' })
  const isCodex = s.runtime === 'codex'
  const runtime = isCodex ? 'codex' : 'claude'
  if (isCodex && (s.access !== 'review' || req.runtime !== 'codex' || req.access !== 'review' || req.provider !== undefined)) {
    return finish(deps, s, { status: 'failed', detail: 'codex request does not match the review-only contract' })
  }
  const bin = isCodex ? deps.codexBin?.() : deps.claudeBin()
  if (!bin) return finish(deps, s, { status: 'failed', detail: `${runtime} is not installed on this Mac` })
  if (isCodex && !codexReady(bin, deps.home, deps.user)) {
    return finish(deps, s, { status: 'failed', detail: 'codex CLI failed the supported-version check' })
  }
  const supervisorStart = isCodex ? deps.processStartTime(process.pid) : null
  if (isCodex && !supervisorStart) return finish(deps, s, { status: 'failed', detail: 'could not identify the Codex supervisor' })
  let inv: Invocation
  try { inv = (isCodex ? codexInvocation : claudeInvocation)({ model: s.model, effort: s.effort, access: s.access, cwdReal: s.cwd_real, prompt: req.prompt }, deps.home, bin, deps.user) } catch {
    return finish(deps, s, { status: 'failed', detail: `could not start ${runtime}: the command could not be built for this folder` })
  }
  const started = await startChild(inv, s.cwd_real, isCodex)
  if ('error' in started) return finish(deps, s, { status: 'failed', detail: `could not start ${runtime}: ${started.error}` })
  const { child } = started
  const childStart = deps.processStartTime(child.pid!)
  let knownGroup: GroupMembers = new Map(childStart ? [[child.pid!, childStart]] : [])
  const observeGroup = () => {
    const observed = groupMembers(child.pid!)
    // One snapshot proves both leader identity and membership. Retain earlier observed descendants.
    if (childStart && observed?.get(child.pid!) === childStart) {
      for (const [pid, start] of observed) knownGroup.set(pid, start)
    }
  }
  // Codex can launch sandboxed commands. Its fresh process group belongs only to this job.
  const signalChild = (signal: NodeJS.Signals) => {
    if (isCodex) {
      observeGroup()
      return signalOwnedGroup(child.pid!, knownGroup, signal)
    }
    try { child.kill(signal); return true } catch { return false }
  }
  const startedMs = deps.nowMs()
  // A job whose start cannot be recorded (state or ledger) is stopped at once: nothing runs on unrecorded.
  try {
    if (isCodex && !childStart) { child.kill('SIGKILL'); throw new Error('unidentified Codex child') }
    writeState(deps.paths, { ...s, status: 'running', started_at: iso(startedMs), pid: child.pid,
      ...(childStart ? { pid_lstart: childStart } : {}),
      ...(isCodex ? { codex_group: true, supervisor_pid: process.pid, supervisor_lstart: supervisorStart! } : {}) })
    appendLedger(deps.paths.ledger, { event: 'job_start', id, status: 'running' }, startedMs)
  } catch (e) {
    signalChild('SIGKILL')
    throw e
  }
  // Keep the Mac awake exactly as long as the job (spec §2 step 3).
  try {
    const awake = spawn('/usr/bin/caffeinate', ['-i', '-w', String(child.pid)], { stdio: 'ignore', detached: true })
    awake.on('error', () => { /* no caffeinate (not a Mac): the job still runs */ })
    awake.unref()
  } catch { /* same */ }
  child.stdin!.on('error', () => { /* the CLI may exit before reading all of stdin */ })
  child.stdin!.end(inv.stdin)

  const lines: string[] = []
  let buf = ''
  let bytes = 0
  let stopped: Outcome | null = null
  let killTimer: ReturnType<typeof setTimeout> | undefined
  const stop = (o: Outcome) => {
    if (stopped) return
    stopped = o
    signalChild('SIGTERM')
    killTimer = setTimeout(() => signalChild('SIGKILL'), deps.killGraceMs)
  }
  child.stdout!.setEncoding('utf8')
  child.stdout!.on('data', (chunk: string) => {
    bytes += Buffer.byteLength(chunk)
    if (bytes > MAX_STDOUT_BYTES) return stop({ status: 'failed', detail: 'output over 8 MiB' })
    buf += chunk
    let i: number
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1)
      lines.push(line)
      if (!isCodex && usageWarning(line)) stop({ status: 'blocked', reason: 'usage' })
    }
  })
  const stderrHead: Buffer[] = []
  let stderrBytes = 0
  child.stderr!.on('data', (chunk: Buffer) => {
    if (stderrBytes >= STDERR_KEEP_BYTES) return
    const part = chunk.subarray(0, STDERR_KEEP_BYTES - stderrBytes)
    stderrHead.push(part); stderrBytes += part.length
  })

  // Intervals are measured on a monotonic clock, so a wall-clock step (NTP) neither pauses the heartbeat nor moves the timeout.
  const mono = deps.monoMs ?? (() => performance.now())
  const beat = () => { try { writeFileSync(join(dir, 'heartbeat'), String(deps.nowMs()), { mode: 0o600 }) } catch { /* dir swept */ } }
  const startedMono = mono()
  beat()
  let lastBeat = mono()
  const timer = setInterval(() => {
    const m = mono()
    const sinceBeat = m - lastBeat
    if (sinceBeat >= deps.heartbeatMs || sinceBeat < 0) {
      beat(); lastBeat = m
      if (isCodex) observeGroup()
    }
    if (existsSync(join(dir, 'cancel'))) stop({ status: 'cancelled', detail: 'cancelled by request' })
    if (m - startedMono > s.timeout_s * 1000) stop({ status: 'timed_out', detail: `ran past ${s.timeout_s}s` })
  }, deps.pollMs)

  // 'close' waits for the pipes; a grandchild holding one open must not hold the runner, so 'exit' gets a bounded wait.
  const code: number | null = await new Promise((resolve) => {
    let exitTimer: ReturnType<typeof setTimeout> | undefined
    child.once('close', (c) => { clearTimeout(exitTimer); resolve(c) })
    child.once('exit', (c) => { exitTimer = setTimeout(() => resolve(c), deps.killGraceMs) })
  })
  clearInterval(timer)
  clearTimeout(killTimer)
  let cleanupUnverified = false
  if (isCodex) {
    // A parent may exit before its command. Settle owned descendants before publishing a terminal result.
    const remaining = groupMembers(child.pid!)
    if (remaining === null) cleanupUnverified = true
    else if (remaining.size > 0) {
      if (!signalChild('SIGTERM')) cleanupUnverified = true
      else {
        await new Promise((resolve) => setTimeout(resolve, deps.killGraceMs))
        if (!signalChild('SIGKILL')) cleanupUnverified = true
      }
    }
  }
  child.stdout!.destroy(); child.stderr!.destroy()
  if (buf) lines.push(buf)
  const interpreted = (isCodex ? interpretCodexStream : interpretClaudeStream)(lines, code, Buffer.concat(stderrHead).toString('utf8'))
  const stoppedBy = stopped as Outcome | null // set from the callbacks above, which control-flow analysis cannot see
  finish(deps, { ...s, status: 'running', started_at: iso(startedMs) }, cleanupUnverified
    ? { status: 'unknown', detail: 'Codex process group cleanup could not be verified' }
    : stoppedBy ? stoppedOutcome(stoppedBy, interpreted) : interpreted, code)
}

/** Last resort for a throw that escaped runJob: end the job failed (runner-authored detail) rather than leave it queued or running. */
function failStranded(deps: RunnerDeps, id: string, e: unknown): void {
  try {
    const s = readState(deps.paths, id)
    if (s && !TERMINAL.has(s.status)) finish(deps, s, { status: 'failed', detail: `runner error: ${errTag(e)}` })
  } catch { /* the next runner start marks a running job unknown */ }
}

/** Removes a spool entry of any kind (file, directory, link). True if there was something to remove. */
function removeEntry(path: string): boolean {
  try { lstatSync(path) } catch { return false }
  rmSync(path, { recursive: true, force: true })
  return true
}

/**
 * Anything in the spool that is not an inventory request or an id marker. Removed under the admission lock: the gate writes
 * `<id>.tmp` and renames it inside that lock, so under the lock a `.tmp` that still exists was left by a gate that died.
 */
function discardStrays(deps: RunnerDeps, names: string[]): void {
  if (names.length === 0) return
  try {
    withLock(join(deps.paths.state, 'admission'), () => {
      for (const n of names) {
        if (removeEntry(join(deps.paths.spool, n))) appendLedger(deps.paths.ledger, { event: 'spool_discard', detail: 'unrecognised name' }, deps.nowMs())
      }
    })
  } catch { /* the gate is busy or the lock is stuck: leave them for the next start */ }
}

/** One collection answers every request that was waiting (callers that gave up leave theirs behind). A failure still consumes them. */
async function answerInventory(deps: RunnerDeps, reqs: string[]): Promise<void> {
  try {
    writeJsonAtomic(deps.paths.inventory, await deps.collectInventory())
  } catch (e) {
    appendLedger(deps.paths.ledger, { event: 'inventory_failed', detail: `could not collect inventory: ${errTag(e)}` }, deps.nowMs())
  }
  for (const n of reqs) removeEntry(join(deps.paths.spool, n))
}

/**
 * Consume every spool entry once (strays first, then inventory, then jobs in id = time order), then return. Nothing
 * is left behind for launchd's QueueDirectories to relaunch the runner over, except what arrives while a job runs,
 * and the marker of a real job whose claim failed (ENOSPC, EACCES): that one stays, and runOnce throws once the rest
 * of the spool is done, so the runner exits non-zero and launchd retries it. The retries end when the claim works or
 * the job passes expiry + grace, when runner-main's settleNeverReached removes the marker. claim_failed is ledgered once.
 */
export async function runOnce(deps: RunnerDeps): Promise<number> {
  mkdirSync(deps.paths.spool, { recursive: true, mode: 0o700 })
  const names = readdirSync(deps.paths.spool).sort()
  discardStrays(deps, names.filter((n) => !INVENTORY_REQ_RE.test(n) && !ID_RE.test(n)))
  const reqs = names.filter((n) => INVENTORY_REQ_RE.test(n))
  if (reqs.length > 0) await answerInventory(deps, reqs)
  let ran = 0
  let claimError: unknown
  for (const id of names.filter((n) => ID_RE.test(n))) {
    const marker = join(deps.paths.spool, id)
    const note = claimFailedNote(deps.paths, id)
    try { renameSync(marker, join(jobDir(deps.paths, id), 'claimed')) } catch (e) {
      if (errTag(e) === 'ENOENT' || readState(deps.paths, id) === null) {
        if (removeEntry(marker)) appendLedger(deps.paths.ledger, { event: 'spool_discard', id, detail: 'no job to claim' }, deps.nowMs())
        try { rmSync(note, { force: true }) } catch { /* only a note */ } // nothing will ever claim it, so no note accumulates
      } else {
        if (!existsSync(note)) {
          try {
            appendLedger(deps.paths.ledger, { event: 'claim_failed', id, detail: `could not claim the job: ${errTag(e)}` }, deps.nowMs())
            mkdirSync(dirname(note), { recursive: true, mode: 0o700 })
            writeFileSync(note, '', { mode: 0o600 })
          } catch { /* the exit code still says it */ }
        }
        claimError ??= e
      }
      continue
    }
    try { rmSync(note, { force: true }) } catch { /* only a note */ }
    try { await runJob(deps, id) } catch (e) { failStranded(deps, id, e) }
    ran++
  }
  if (claimError !== undefined) throw claimError
  return ran
}

/**
 * When the kernel started this pid, exactly as `ps -o lstart= -p <pid>` prints it (C locale, UTC, trimmed), or null when ps
 * cannot say (no such process). A pid alone is not an identity: the counter wraps and the number goes to another process.
 */
export function processStartTime(pid: number): string | null {
  const r = spawnSync('/bin/ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', timeout: 3000, env: { LC_ALL: 'C', TZ: 'UTC' } })
  const out = r.status === 0 ? String(r.stdout ?? '').trim() : ''
  return out === '' ? null : out
}

function jobIds(paths: SummonPaths): string[] {
  try { return readdirSync(paths.jobs).filter((n) => ID_RE.test(n)) } catch { return [] }
}

/**
 * A runner killed mid-job leaves `running` with a dead pid (or `queued` with a claim it never got to use). The next
 * runner start calls this: the job becomes `unknown` (never retried), and its last heartbeat stays on disk for `status`.
 * A `running` job is alive only while its pid is alive AND still has the start time recorded at spawn; a pid whose start
 * time differs belongs to another process, so it is never probed or signalled, and the job is orphaned.
 */
export function markOrphans(paths: SummonPaths, nowMs: number,
  isAlive: (pid: number) => boolean = (pid) => { try { process.kill(pid, 0); return true } catch { return false } },
  startTimeOf: (pid: number) => string | null = processStartTime): number {
  const stillOurs = (s: JobState) => !!s.pid && !!s.pid_lstart && startTimeOf(s.pid) === s.pid_lstart && isAlive(s.pid)
  let n = 0
  for (const id of jobIds(paths)) {
    const s = readState(paths, id)
    let detail: string | undefined
    if (s?.status === 'running' && s.runtime === 'codex' && s.codex_group && stillOurs(s)
      && s.supervisor_pid && s.supervisor_lstart
      && !(startTimeOf(s.supervisor_pid) === s.supervisor_lstart && isAlive(s.supervisor_pid))) {
      // This is a stopped supervisor, never a retry. The leader's identity proves this detached group is ours.
      const known = new Map([[s.pid!, s.pid_lstart!]])
      if (!signalOwnedGroup(s.pid!, known, 'SIGKILL')) continue // keep its slot occupied when ownership/cleanup is uncertain
      detail = 'Codex supervisor stopped; owned process group terminated'
    } else if (s?.status === 'running' && !stillOurs(s)) detail = 'runner stopped mid-job'
    else if (s?.status === 'queued' && existsSync(join(jobDir(paths, id), 'claimed'))) detail = 'runner stopped before the job started'
    if (!s || !detail) continue
    // result.json is written atomically and before state.json, so one that parses is the job's whole outcome.
    const r = readJson<JobResult>(join(jobDir(paths, id), 'result.json'))
    if (r && TERMINAL.has(r.status)) settleJob(paths, nowMs, s, { status: r.status, reason: r.reason, detail: r.detail, resets_at: r.resets_at })
    // A claimed job that never started, with a cancel asked for, ends as every never-started job does; without one, unknown.
    else if (s.status === 'queued' && existsSync(join(jobDir(paths, id), 'cancel'))) finishJob(paths, nowMs, s, notStartedOutcome(paths, id))
    else settleJob(paths, nowMs, s, { status: 'unknown', detail })
    n++
  }
  return n
}

/** Finished jobs older than maxAge (from `ended_at`, else admission) are deleted. The ledger keeps their history. */
export function sweepJobs(paths: SummonPaths, nowMs: number, maxAgeMs: number = 30 * 86_400_000): number {
  let n = 0
  for (const id of jobIds(paths)) {
    const s = readState(paths, id)
    if (s && TERMINAL.has(s.status) && nowMs - Date.parse(s.ended_at ?? s.admitted_at) > maxAgeMs) {
      rmSync(jobDir(paths, id), { recursive: true, force: true })
      n++
    }
  }
  return n
}
