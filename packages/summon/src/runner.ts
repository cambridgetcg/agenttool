import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { claudeInvocation, interpretClaudeStream, usageWarning, type Invocation, type Outcome } from './harness.ts'
import { jobDir, readJson, readState, writeJsonAtomic, writeState, type JobResult, type JobState } from './jobs.ts'
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
  collectInventory(): Promise<unknown>
  heartbeatMs: number
  pollMs: number
  killGraceMs: number
}

const MAX_STDOUT_BYTES = 8 * 1024 * 1024
/** Kept in memory only, to recognise a command line claude rejects; never written anywhere. */
const STDERR_KEEP_BYTES = 4096
const INVENTORY_REQ_RE = /^inventory-\d+\.req$/
const iso = (ms: number) => new Date(ms).toISOString()

/** Content-free tag for an error: an errno-style code (ENOENT, ENOTDIR...) or a fixed word. Never the message. */
function errTag(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,31}$/.test(code) ? code : 'error'
}

/** Result file first, then state, then ledger: a terminal state always has its result beside it. */
function finishJob(paths: SummonPaths, nowMs: number, s: JobState, o: Outcome, exitCode: number | null = null): void {
  const result: JobResult = { status: o.status, ...(o.reason ? { reason: o.reason } : {}), ...(o.detail ? { detail: o.detail } : {}),
    ...(o.result_text !== undefined ? { result_text: o.result_text } : {}), exit_code: exitCode,
    ...(o.num_turns !== undefined ? { num_turns: o.num_turns } : {}), ...(o.cost_usd !== undefined ? { cost_usd: o.cost_usd } : {}),
    ...(o.resets_at ? { resets_at: o.resets_at } : {}) }
  writeJsonAtomic(join(jobDir(paths, s.id), 'result.json'), result)
  writeState(paths, { ...s, status: o.status, reason: o.reason, detail: o.detail, ended_at: iso(nowMs), pid: undefined })
  appendLedger(paths.ledger, { event: 'job_end', id: s.id, status: o.status, reason: o.reason, detail: o.detail?.slice(0, 200) }, nowMs)
}
const finish = (deps: RunnerDeps, s: JobState, o: Outcome, exitCode: number | null = null) => finishJob(deps.paths, deps.nowMs(), s, o, exitCode)

/** Spawns claude. Bun reports some failures by throwing (ENOTDIR) and some later as an 'error' event with no pid (ENOENT). */
function startChild(inv: Invocation, cwd: string): Promise<{ child: ChildProcess } | { error: string }> {
  let child: ChildProcess
  try { child = spawn(inv.bin, inv.args, { cwd, env: inv.env, stdio: ['pipe', 'pipe', 'pipe'] }) } catch (e) { return Promise.resolve({ error: errTag(e) }) }
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
  if (existsSync(join(dir, 'cancel'))) return finish(deps, s, { status: 'cancelled', detail: 'cancelled before it started' })
  // The same ±5 min grace the gate admitted it under: a job the gate admitted is never expired by the skew alone.
  if (deps.nowMs() > Date.parse(s.expires_at) + CLOCK_SKEW_MS) return finish(deps, s, { status: 'expired', detail: 'expired before the runner reached it' })
  const req = readJson<SummonRequest>(join(dir, 'request.json'))
  if (!req || typeof req.prompt !== 'string') return finish(deps, s, { status: 'failed', detail: 'request file is missing or unreadable' })
  const bin = deps.claudeBin()
  if (!bin) return finish(deps, s, { status: 'failed', detail: 'claude is not installed on this Mac' })
  let inv: Invocation
  try { inv = claudeInvocation({ model: s.model, effort: s.effort, access: s.access, cwdReal: s.cwd_real, prompt: req.prompt }, deps.home, bin, deps.user) } catch {
    return finish(deps, s, { status: 'failed', detail: 'could not start claude: the command could not be built for this folder' })
  }
  const started = await startChild(inv, s.cwd_real)
  if ('error' in started) return finish(deps, s, { status: 'failed', detail: `could not start claude: ${started.error}` })
  const { child } = started
  const startedMs = deps.nowMs()
  try { writeState(deps.paths, { ...s, status: 'running', started_at: iso(startedMs), pid: child.pid }) } catch (e) {
    try { child.kill('SIGKILL') } catch { /* gone */ }
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

  const beat = () => { try { writeFileSync(join(dir, 'heartbeat'), String(deps.nowMs()), { mode: 0o600 }) } catch { /* dir swept */ } }
  beat()
  let lastBeat = deps.nowMs()
  const timer = setInterval(() => {
    const now = deps.nowMs()
    if (now - lastBeat >= deps.heartbeatMs) { beat(); lastBeat = now }
    if (existsSync(join(dir, 'cancel'))) stop({ status: 'cancelled', detail: 'cancelled by request' })
    if (now - startedMs > s.timeout_s * 1000) stop({ status: 'timed_out', detail: `ran past ${s.timeout_s}s` })
  }, deps.pollMs)

  // 'close' waits for the pipes; a grandchild holding one open must not hold the runner, so 'exit' gets a bounded wait.
  const code: number | null = await new Promise((resolve) => {
    let exitTimer: ReturnType<typeof setTimeout> | undefined
    child.once('close', (c) => { clearTimeout(exitTimer); resolve(c) })
    child.once('exit', (c) => { exitTimer = setTimeout(() => resolve(c), deps.killGraceMs) })
  })
  clearInterval(timer)
  clearTimeout(killTimer)
  child.stdout!.destroy(); child.stderr!.destroy()
  if (buf) lines.push(buf)
  const interpreted = interpretClaudeStream(lines, code, Buffer.concat(stderrHead).toString('utf8'))
  const stoppedBy = stopped as Outcome | null // set from the callbacks above, which control-flow analysis cannot see
  finish(deps, { ...s, status: 'running', started_at: iso(startedMs) }, stoppedBy ? stoppedOutcome(stoppedBy, interpreted) : interpreted, code)
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
 * is left behind for launchd's QueueDirectories to relaunch the runner over, except what arrives while a job runs.
 */
export async function runOnce(deps: RunnerDeps): Promise<number> {
  mkdirSync(deps.paths.spool, { recursive: true, mode: 0o700 })
  const names = readdirSync(deps.paths.spool).sort()
  discardStrays(deps, names.filter((n) => !INVENTORY_REQ_RE.test(n) && !ID_RE.test(n)))
  const reqs = names.filter((n) => INVENTORY_REQ_RE.test(n))
  if (reqs.length > 0) await answerInventory(deps, reqs)
  let ran = 0
  for (const id of names.filter((n) => ID_RE.test(n))) {
    const marker = join(deps.paths.spool, id)
    try { renameSync(marker, join(jobDir(deps.paths, id), 'claimed')) } catch {
      if (removeEntry(marker)) appendLedger(deps.paths.ledger, { event: 'spool_discard', id, detail: 'no job to claim' }, deps.nowMs())
      continue
    }
    try { await runJob(deps, id) } catch (e) { failStranded(deps, id, e) }
    ran++
  }
  return ran
}

function jobIds(paths: SummonPaths): string[] {
  try { return readdirSync(paths.jobs).filter((n) => ID_RE.test(n)) } catch { return [] }
}

/**
 * A runner killed mid-job leaves `running` with a dead pid (or `queued` with a claim it never got to use). The next
 * runner start calls this: the job becomes `unknown` (never retried), and its last heartbeat stays on disk for `status`.
 */
export function markOrphans(paths: SummonPaths, nowMs: number,
  isAlive: (pid: number) => boolean = (pid) => { try { process.kill(pid, 0); return true } catch { return false } }): number {
  let n = 0
  for (const id of jobIds(paths)) {
    const s = readState(paths, id)
    let detail: string | undefined
    if (s?.status === 'running' && (!s.pid || !isAlive(s.pid))) detail = 'runner stopped mid-job'
    else if (s?.status === 'queued' && existsSync(join(jobDir(paths, id), 'claimed'))) detail = 'runner stopped before the job started'
    if (!s || !detail) continue
    writeState(paths, { ...s, status: 'unknown', detail, ended_at: iso(nowMs), pid: undefined })
    appendLedger(paths.ledger, { event: 'job_end', id, status: 'unknown', detail }, nowMs)
    n++
  }
  return n
}

/**
 * A `queued` job past its expiry (plus the gate's skew grace) with no spool marker and no claim was stranded by a gate
 * that died between writing state.json and the marker. Nothing will ever run it, and it would count toward
 * max_concurrent, so it ends `expired`.
 */
export function reapStranded(paths: SummonPaths, nowMs: number): number {
  let n = 0
  for (const id of jobIds(paths)) {
    const s = readState(paths, id)
    if (s?.status !== 'queued' || !(nowMs > Date.parse(s.expires_at) + CLOCK_SKEW_MS)) continue
    if (existsSync(join(paths.spool, id)) || existsSync(join(jobDir(paths, id), 'claimed'))) continue
    finishJob(paths, nowMs, s, { status: 'expired', detail: 'never reached the runner' })
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
