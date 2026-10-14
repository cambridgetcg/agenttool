import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { checkAdmission, loadAllowlist, type Admission } from './allowlist.ts'
import { describePaths, parseBaseline, restoreBaseline, serializeBaseline, takeBaseline, type Baseline, type ListDir } from './fingerprint.ts'
import { claudeInvocation, interpretClaudeStream, usageWarning, type Invocation, type Outcome } from './harness.ts'
import { claimFailedNote, errTag, finishJob, jobDir, notStartedOutcome, readJson, readState, settleJob, writeJsonAtomic, writeState, type JobResult, type JobState } from './jobs.ts'
import { ensureExcluded, makeJobTmp, removeJobTmp } from './jobtmp.ts'
import { appendLedger, withLock } from './ledger.ts'
import type { SummonPaths } from './paths.ts'
import { ACCESSES, CLOCK_SKEW_MS, ID_RE, type SummonRequest } from './request.ts'
import { TERMINAL } from './status.ts'
import { livePs, parseTrackerRecord, ProcessTracker, type PsSnapshot } from './sweep.ts'

export interface RunnerDeps {
  paths: SummonPaths
  home: string
  user: string
  nowMs(): number
  claudeBin(): string | null
  collectInventory(): Promise<unknown>
  heartbeatMs: number
  pollMs: number
  killGraceMs: number
  /** The start time of a pid (runner-main passes processStartTime); recorded at spawn so a reused pid is not taken for the job. */
  processStartTime(pid: number): string | null
  /** A monotonic clock for the timeout and heartbeat intervals; defaults to performance.now(). nowMs stamps what is written to disk. */
  monoMs?(): number
  /** Edit and build jobs (Phase 0.5): how often the job's process tree is recorded. Defaults to 2 s. */
  snapshotMs?: number
  /** Edit and build jobs: the process table. Defaults to `/bin/ps -A -o pid=,ppid=,pgid=,lstart=`. */
  ps?: PsSnapshot
  /** Edit and build jobs: the listing the fingerprint finds the git files by, which must show names as stored. Defaults to readdirSync. */
  listDir?: ListDir
  /** Set by runner-main on SIGTERM (launchctl bootout, logout): the job that runs is stopped and closed, and no other is started. */
  halt?: HaltSignal
}

/**
 * A runner that is asked to stop (launchd sends SIGTERM and allows about 20 s, `ExitTimeOut`, before SIGKILL). Idle, it exits at once.
 * During a job it does not: it stops claude the way a cancel does, so the job is swept, restored and cleaned up before the process
 * ends. Claude runs in a session of its own, so launchd's cleanup of the runner's process group never reaches it.
 */
export class HaltSignal {
  requested = false
  private stopJob: (() => void) | null = null
  private inJob = false
  constructor(private readonly exitNow: () => void) {}
  request(): void {
    this.requested = true
    if (this.stopJob) this.stopJob()
    else if (!this.inJob) this.exitNow()
  }
  beginJob(): void { this.inJob = true }
  endJob(): void { this.inJob = false; this.stopJob = null }
  /** Called once claude runs: how to stop it. A halt that came in before that stops it now. */
  onRunning(stop: () => void): void {
    this.stopJob = stop
    if (this.requested) stop()
  }
}

/** The detail of a job the runner did not live to see through, whether it stopped on SIGTERM or died: the same words either way. */
const RUNNER_STOPPED = 'runner stopped mid-job'

const SNAPSHOT_MS = 2000
const NOT_BUILT = 'could not start claude: the command could not be built for this folder'
const MAX_STDOUT_BYTES = 8 * 1024 * 1024
/** Kept in memory only, to recognise a command line claude rejects; never written anywhere. */
const STDERR_KEEP_BYTES = 4096
const INVENTORY_REQ_RE = /^inventory-\d+\.req$/
const iso = (ms: number) => new Date(ms).toISOString()

const finish = (deps: RunnerDeps, s: JobState, o: Outcome, exitCode: number | null = null) => finishJob(deps.paths, deps.nowMs(), s, o, exitCode)

/**
 * Spawns claude. Bun reports some failures by throwing (ENOTDIR) and some later as an 'error' event with no pid (ENOENT).
 * `ownGroup` (edit and build jobs) starts it as the leader of a process group and session of its own, so the end-of-job sweep can
 * signal everything it left in that group at once. A review job is started exactly as in Phase 0.
 */
function startChild(inv: Invocation, cwd: string, ownGroup: boolean): Promise<{ child: ChildProcess } | { error: string }> {
  let child: ChildProcess
  try { child = spawn(inv.bin, inv.args, { cwd, env: inv.env, stdio: ['pipe', 'pipe', 'pipe'], ...(ownGroup ? { detached: true } : {}) }) } catch (e) { return Promise.resolve({ error: errTag(e) }) }
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

/**
 * Design section 2, "Admission result": the whole admission again, when the job starts, on what the job will run with (its state's
 * runtime, model, effort, access and folder; the rest comes from the request the gate kept). A build entry removed while the job
 * waited, a folder that stopped being a repository root or became nested, an allowlist that went missing or broke: each ends
 * in a refusal. A folder that now resolves somewhere else than where the gate admitted it is refused too, so a swapped link never moves a job.
 */
function readmit(deps: RunnerDeps, s: JobState, req: SummonRequest): Admission {
  const al = loadAllowlist(deps.paths.allowlist, deps.home)
  if (!al.ok) {
    return { ok: false, reason: 'outside_allowlist', detail: `allowlist: ${al.detail}`,
      hint: `fix ~/.config/summon/allowlist.yaml on Nuance (${al.detail}); the installer's starter file is the reference` }
  }
  const adm = checkAdmission({ ...req, runtime: s.runtime, model: s.model, effort: s.effort, access: s.access, cwd: s.cwd_real }, al.allowlist, deps.home)
  if (adm.ok && adm.cwdReal !== s.cwd_real) {
    return { ok: false, reason: 'outside_allowlist', detail: 'the folder now resolves somewhere else than when the job was admitted',
      hint: 'ask again: a new summon is admitted against the folder as it is now' }
  }
  return adm
}

/** What an edit or build job needs around it: its folder, its temp directory, the baseline of its git files, and (once it runs) its process tree. */
interface Guard { cwd: string; id: string; baseline: Baseline; tracker?: ProcessTracker; procsText?: string }

/**
 * The two files that let a runner which did not see a job through (SIGKILL, a crash, power) clean up after it, both 0600 in the job's
 * private state directory and gone when the job is closed. guard.json: who runs the job and the git baseline (it holds file contents:
 * a `.git/config` can hold credentials, which is why the job's sandbox denies reading this directory and why it is deleted at the end).
 * procs.json: claude's pid, its group and start time, and the processes recorded under theirs.
 */
const GUARD_FILE = 'guard.json'
const PROCS_FILE = 'procs.json'
const guardFile = (paths: SummonPaths, id: string) => join(jobDir(paths, id), GUARD_FILE)
const procsFile = (paths: SummonPaths, id: string) => join(jobDir(paths, id), PROCS_FILE)
function dropGuardFiles(paths: SummonPaths, id: string): void {
  for (const f of [guardFile(paths, id), procsFile(paths, id)]) { try { rmSync(f, { force: true }) } catch { /* the next start tries again */ } }
}

/** Saves the process record if the tree it holds changed since the last save. Throws if it cannot be written. */
function saveProcs(deps: RunnerDeps, g: Guard): void {
  if (!g.tracker) return
  const record = g.tracker.toRecord(); const text = JSON.stringify(record)
  if (text === g.procsText) return
  writeJsonAtomic(procsFile(deps.paths, g.id), record)
  g.procsText = text
}

/**
 * Before claude is spawned: the temp directory, the exclude line (before the baseline), the baseline, and the saved copy of it
 * (guard.json). Throws, having cleaned up, if any of it cannot be done.
 */
function prepareGuard(deps: RunnerDeps, cwd: string, id: string): Guard {
  makeJobTmp(cwd, id)
  try {
    ensureExcluded(cwd)
    const baseline = takeBaseline(cwd, deps.listDir)
    writeJsonAtomic(guardFile(deps.paths, id), { v: 1, runner: { pid: process.pid, lstart: deps.processStartTime(process.pid) }, baseline: serializeBaseline(baseline) })
    return { cwd, id, baseline }
  } catch (e) { removeJobTmp(cwd, id); dropGuardFiles(deps.paths, id); throw e }
}

/**
 * When the job is over, in this order: sweep its processes (so nothing is left to change a file under us), compare the git files and
 * put back what differs, remove the temp directory, drop the saved guard files. Never throws.
 */
async function closeGuard(deps: RunnerDeps, g: Guard): Promise<{ changed: string[]; failed: string[] }> {
  if (g.tracker) { try { await g.tracker.sweep() } catch { /* the sandbox still confines whatever was missed */ } }
  let out: { changed: string[]; failed: string[] }
  try { out = restoreBaseline(g.cwd, g.baseline, deps.listDir) } catch { out = { changed: [], failed: ['(the git files could not be compared)'] } }
  removeJobTmp(g.cwd, g.id)
  dropGuardFiles(deps.paths, g.id)
  return out
}

type Tamper = { changed: string[]; failed: string[] }
/** The first line of a result says what was put back (and, on a second, what could not be). */
function tamperHead(t: Tamper): string {
  return `tampered: ${describePaths([...new Set([...t.changed, ...t.failed])])}${t.failed.length > 0 ? `\nnot restored: ${describePaths(t.failed)}` : ''}`
}
/** The ledger gets a fixed word and a count, never the paths. */
function ledgerTamper(deps: RunnerDeps | OrphanDeps, id: string, t: Tamper): void {
  const n = new Set([...t.changed, ...t.failed]).size
  try {
    appendLedger(deps.paths.ledger, { event: 'job_tampered', id, detail: `tampered: ${n} path(s)${t.failed.length > 0 ? `, ${t.failed.length} not restored` : ''}` }, deps.nowMs())
  } catch { /* the result file carries it, and job_end is next */ }
}
function noteTamper(deps: RunnerDeps, id: string, o: Outcome, t: Tamper): Outcome {
  const head = tamperHead(t)
  ledgerTamper(deps, id, t)
  return { ...o, result_text: o.result_text ? `${head}\n${o.result_text}` : head }
}

async function runJob(deps: RunnerDeps, id: string): Promise<void> {
  deps.halt?.beginJob()
  try { await runJobBody(deps, id) } finally { deps.halt?.endJob() }
}

async function runJobBody(deps: RunnerDeps, id: string): Promise<void> {
  const dir = jobDir(deps.paths, id)
  const s = readState(deps.paths, id)
  if (!s) { appendLedger(deps.paths.ledger, { event: 'spool_discard', id, detail: 'job state unreadable' }, deps.nowMs()); return }
  if (s.status !== 'queued') return
  // A cancel asked for, or past expiry plus the same ±5 min grace the gate admitted it under (a job the gate admitted is
  // never expired by the skew alone): it ends as the gate and `status` would say it does.
  if (existsSync(join(dir, 'cancel')) || deps.nowMs() > Date.parse(s.expires_at) + CLOCK_SKEW_MS) return finish(deps, s, notStartedOutcome(deps.paths, id))
  const req = readJson<SummonRequest>(join(dir, 'request.json'))
  if (!req || typeof req.prompt !== 'string') return finish(deps, s, { status: 'failed', detail: 'request file is missing or unreadable' })
  // A state that names an access this runner does not know is damaged: it is never admitted, and never gains powers.
  if (!(ACCESSES as readonly string[]).includes(s.access)) return finish(deps, s, { status: 'failed', detail: NOT_BUILT })
  const adm = readmit(deps, s, req)
  if (!adm.ok) return finish(deps, s, { status: 'refused', reason: adm.reason, detail: adm.detail, ...(adm.hint ? { result_text: adm.hint } : {}) })
  const bin = deps.claudeBin()
  if (!bin) return finish(deps, s, { status: 'failed', detail: 'claude is not installed on this Mac' })
  let inv: Invocation
  try { inv = claudeInvocation({ id, model: s.model, effort: s.effort, access: s.access, cwdReal: adm.cwdReal, commands: adm.commands, prompt: req.prompt }, deps.home, bin, deps.user) } catch {
    return finish(deps, s, { status: 'failed', detail: NOT_BUILT })
  }
  // Edit and build jobs run in the sandbox, in a folder they can write into: they get a temp directory, a baseline of the git files that
  // could run code later, and (once spawned) a process group and a recorded process tree. Review jobs have none of it, as in Phase 0.
  const sandboxed = s.access !== 'review'
  let guard: Guard | null = null
  if (sandboxed) {
    try { guard = prepareGuard(deps, adm.cwdReal, id) } catch { return finish(deps, s, { status: 'failed', detail: 'could not start claude: the job folder could not be prepared' }) }
  }
  const started = await startChild(inv, adm.cwdReal, sandboxed)
  if ('error' in started) {
    if (guard) await closeGuard(deps, guard)
    return finish(deps, s, { status: 'failed', detail: `could not start claude: ${started.error}` })
  }
  const { child } = started
  if (guard) { guard.tracker = new ProcessTracker(child.pid!, deps.ps ?? livePs); guard.tracker.snapshot() }
  const startedMs = deps.nowMs()
  // A job whose start cannot be recorded (state or ledger) is stopped at once: nothing runs on unrecorded. The process record comes
  // first, so a job that looks started is one a later runner could find.
  try {
    const lstart = deps.processStartTime(child.pid!)
    if (guard) saveProcs(deps, guard)
    writeState(deps.paths, { ...s, status: 'running', started_at: iso(startedMs), pid: child.pid, ...(lstart ? { pid_lstart: lstart } : {}) })
    appendLedger(deps.paths.ledger, { event: 'job_start', id, status: 'running' }, startedMs)
  } catch (e) {
    try { child.kill('SIGKILL') } catch { /* gone */ }
    if (guard) await closeGuard(deps, guard)
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
    try { child.kill('SIGTERM') } catch { /* gone */ }
    killTimer = setTimeout(() => { try { child.kill('SIGKILL') } catch { /* gone */ } }, deps.killGraceMs)
  }
  deps.halt?.onRunning(() => stop({ status: 'unknown', detail: RUNNER_STOPPED }))
  child.stdout!.setEncoding('utf8')
  child.stdout!.on('data', (chunk: string) => {
    bytes += Buffer.byteLength(chunk)
    if (bytes > MAX_STDOUT_BYTES) return stop({ status: 'failed', detail: 'output over 8 MiB' })
    buf += chunk
    let i: number
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1)
      lines.push(line)
      if (usageWarning(line)) stop({ status: 'blocked', reason: 'usage' })
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
    if (sinceBeat >= deps.heartbeatMs || sinceBeat < 0) { beat(); lastBeat = m }
    if (existsSync(join(dir, 'cancel'))) stop({ status: 'cancelled', detail: 'cancelled by request' })
    if (m - startedMono > s.timeout_s * 1000) stop({ status: 'timed_out', detail: `ran past ${s.timeout_s}s` })
  }, deps.pollMs)
  // The job's process tree, recorded at spawn and then every 2 s while it runs (design section 3), and saved when it changes.
  const tracker = guard?.tracker
  const snapTimer = tracker ? setInterval(() => { try { tracker.snapshot(); saveProcs(deps, guard!) } catch { /* a missed look is the residual the sweep already accepts */ } }, deps.snapshotMs ?? SNAPSHOT_MS) : undefined

  // 'close' waits for the pipes; a grandchild holding one open must not hold the runner, so 'exit' gets a bounded wait.
  const code: number | null = await new Promise((resolve) => {
    let exitTimer: ReturnType<typeof setTimeout> | undefined
    child.once('close', (c) => { clearTimeout(exitTimer); resolve(c) })
    child.once('exit', (c) => { exitTimer = setTimeout(() => resolve(c), deps.killGraceMs) })
  })
  clearInterval(timer)
  clearInterval(snapTimer)
  clearTimeout(killTimer)
  child.stdout!.destroy(); child.stderr!.destroy()
  // Whatever the job ended by: its processes first, then the git files, then the temp directory. The job's status is not changed by any of it.
  const tamper = guard ? await closeGuard(deps, guard) : null
  if (buf) lines.push(buf)
  const interpreted = interpretClaudeStream(lines, code, Buffer.concat(stderrHead).toString('utf8'), s.access)
  const stoppedBy = stopped as Outcome | null // set from the callbacks above, which control-flow analysis cannot see
  let outcome = stoppedBy ? stoppedOutcome(stoppedBy, interpreted) : interpreted
  if (tamper && (tamper.changed.length > 0 || tamper.failed.length > 0)) outcome = noteTamper(deps, id, outcome, tamper)
  finish(deps, { ...s, status: 'running', started_at: iso(startedMs) }, outcome, code)
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
    if (deps.halt?.requested) break // asked to stop: what is left stays in the spool for the next start
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
const pidAlive = (pid: number): boolean => { try { process.kill(pid, 0); return true } catch { return false } }

export function markOrphans(paths: SummonPaths, nowMs: number,
  isAlive: (pid: number) => boolean = pidAlive,
  startTimeOf: (pid: number) => string | null = processStartTime): number {
  const stillOurs = (s: JobState) => !!s.pid && !!s.pid_lstart && startTimeOf(s.pid) === s.pid_lstart && isAlive(s.pid)
  let n = 0
  for (const id of jobIds(paths)) {
    const s = readState(paths, id)
    let detail: string | undefined
    if (s?.status === 'running' && !stillOurs(s)) detail = RUNNER_STOPPED
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

/** What recoverOrphans needs of a runner. */
export type OrphanDeps = Pick<RunnerDeps, 'paths' | 'nowMs' | 'processStartTime'> & Partial<Pick<RunnerDeps, 'ps' | 'listDir'>>

/**
 * The runner that took an edit or build job may not have lived to see it through (SIGKILL, a crash, power; a SIGTERM it handles
 * itself). Claude runs in a session of its own, so it outlives that runner, with no timeout and nothing to sweep, restore or clean up
 * after it. This is called first when a runner starts, before markOrphans settles the job and before any job is claimed. For each job
 * that has guard files and whose runner is gone it:
 *   1. sweeps the job's processes: the group and the recorded tree, each only where the start time still matches the one recorded;
 *   2. compares the git files with the saved baseline and puts back what differs;
 *   3. removes the job's temp directory and the guard files;
 *   4. if it put anything back (or could not check), writes the job's result.json (`unknown`, first line `tampered: <paths>` or
 *      `fingerprint not checked: <why>`), so markOrphans settles the job from it.
 * A runner that is still alive (same pid and start time as recorded) owns its job: nothing is touched. A job that already ended only
 * has its leftover guard files dropped. Returns the number of jobs recovered.
 */
export async function recoverOrphans(deps: OrphanDeps, isAlive: (pid: number) => boolean = pidAlive): Promise<number> {
  let n = 0
  for (const id of jobIds(deps.paths)) {
    try { if (await recoverOne(deps, id, isAlive)) n++ } catch { /* left for the next start; the guard files stay until the work is done */ }
  }
  return n
}

async function recoverOne(deps: OrphanDeps, id: string, isAlive: (pid: number) => boolean): Promise<boolean> {
  const dir = jobDir(deps.paths, id)
  const gPath = guardFile(deps.paths, id); const pPath = procsFile(deps.paths, id)
  if (!existsSync(gPath) && !existsSync(pPath)) return false
  const s = readState(deps.paths, id)
  if (!s || TERMINAL.has(s.status)) { dropGuardFiles(deps.paths, id); return false } // its job is over; nothing here is still needed
  if (!(s.status === 'running' || (s.status === 'queued' && existsSync(join(dir, 'claimed'))))) return false
  const guard = readJson<{ v?: unknown; runner?: { pid?: unknown; lstart?: unknown }; baseline?: unknown }>(gPath)
  // The runner that took the job, if it is still there (same pid, same start time), is running it. With no start time on record, a live pid is taken as the owner.
  const owner = guard?.runner
  if (owner && typeof owner.pid === 'number' && Number.isInteger(owner.pid) && owner.pid > 0 && isAlive(owner.pid)
    && (typeof owner.lstart !== 'string' || deps.processStartTime(owner.pid) === owner.lstart)) return false

  const notes: string[] = []
  // 1. Its processes. The record is procs.json; before that exists, the pid and start time the runner put in the job's state at spawn.
  let record = parseTrackerRecord(readJson(pPath))
  if (!record && existsSync(pPath)) notes.push('processes not swept: the record is not usable')
  if (!record && !existsSync(pPath) && s.pid) record = parseTrackerRecord({ pid: s.pid, pgid: s.pid, start: s.pid_lstart ?? null, seen: [] })
  if (record) {
    const tracker = ProcessTracker.restore({ ...record, start: record.start ?? s.pid_lstart ?? null }, deps.ps ?? livePs)
    try { await tracker.sweep() } catch { notes.push('processes not swept: the sweep failed') }
  }
  // 2. The git files.
  let tamper: Tamper = { changed: [], failed: [] }
  let baseline: Baseline | null = null
  if (!guard) notes.unshift(existsSync(gPath) ? 'fingerprint not checked: the saved baseline is not usable' : 'fingerprint not checked: no baseline was saved')
  else { try { baseline = parseBaseline(guard.baseline, s.cwd_real) } catch { notes.unshift('fingerprint not checked: the saved baseline is not usable') } }
  if (baseline) tamper = restoreBaseline(s.cwd_real, baseline, deps.listDir)
  // 3. The temp directory, and 4. what the next reader of the job should see first.
  removeJobTmp(s.cwd_real, id)
  const found = tamper.changed.length > 0 || tamper.failed.length > 0
  const lines = [...(found ? [tamperHead(tamper)] : []), ...notes]
  const resultPath = join(dir, 'result.json')
  if (lines.length > 0 && !(readJson<JobResult>(resultPath)?.status && TERMINAL.has(readJson<JobResult>(resultPath)!.status))) {
    writeJsonAtomic(resultPath, { status: 'unknown', detail: s.status === 'running' ? RUNNER_STOPPED : 'runner stopped before the job started', result_text: lines.join('\n'), exit_code: null })
    if (found) ledgerTamper(deps, id, tamper)
  }
  dropGuardFiles(deps.paths, id)
  return true
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
