import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Outcome } from './harness.ts'
import { appendLedger } from './ledger.ts'
import type { SummonPaths } from './paths.ts'
import { CLOCK_SKEW_MS, ID_RE, type Access, type Runtime } from './request.ts'
import type { JobStatus } from './status.ts'

export interface JobState {
  id: string
  status: JobStatus
  reason?: string
  detail?: string
  runtime: Runtime
  model: string
  /** The effort the allowlist admitted, passed to claude as `--effort`. Absent when the request named none. */
  effort?: string
  access: Access
  cwd_real: string
  admitted_at: string
  expires_at: string
  timeout_s: number
  started_at?: string
  ended_at?: string
  pid?: number
  /** The child's start time as `ps -o lstart=` printed it at spawn: with `pid`, what identifies the process. */
  pid_lstart?: string
  /** Codex's detached group and the runner that owns its timeout watcher. */
  codex_group?: boolean
  supervisor_pid?: number
  supervisor_lstart?: string
  /** When Yu's usage limit resets, for a job that ended blocked(usage) and was told. */
  resets_at?: string
}
export interface JobResult {
  status: JobStatus
  reason?: string
  detail?: string
  result_text?: string
  exit_code?: number | null
  num_turns?: number
  cost_usd?: number
  resets_at?: string
  codex_diagnostics?: Outcome['codex_diagnostics']
}

/** Content-free tag for an error: an errno-style code (ENOENT, ENOTDIR...) or a fixed word. Never the message. */
export function errTag(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,31}$/.test(code) ? code : 'error'
}

export function jobDir(paths: SummonPaths, id: string): string {
  if (!ID_RE.test(id)) throw new Error('bad id')
  return join(paths.jobs, id)
}

export function writeJsonAtomic(path: string, obj: unknown): void {
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(tmp, JSON.stringify(obj), { mode: 0o600 })
  renameSync(tmp, path)
}

export function readJson<T>(path: string): T | null {
  try { return JSON.parse(readFileSync(path, 'utf8')) as T } catch { return null }
}

export function readState(paths: SummonPaths, id: string): JobState | null {
  return readJson<JobState>(join(jobDir(paths, id), 'state.json'))
}

export function writeState(paths: SummonPaths, s: JobState): void {
  const dir = jobDir(paths, s.id)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  writeJsonAtomic(join(dir, 'state.json'), s)
}

/** Result file first, then state, then ledger: a terminal state always has its result beside it. */
export function finishJob(paths: SummonPaths, nowMs: number, s: JobState, o: Outcome, exitCode: number | null = null): void {
  const result: JobResult = { status: o.status, ...(o.reason ? { reason: o.reason } : {}), ...(o.detail ? { detail: o.detail } : {}),
    ...(o.result_text !== undefined ? { result_text: o.result_text } : {}), exit_code: exitCode,
    ...(o.num_turns !== undefined ? { num_turns: o.num_turns } : {}), ...(o.cost_usd !== undefined ? { cost_usd: o.cost_usd } : {}),
    ...(o.resets_at ? { resets_at: o.resets_at } : {}),
    ...(o.codex_diagnostics ? { codex_diagnostics: o.codex_diagnostics } : {}) }
  writeJsonAtomic(join(jobDir(paths, s.id), 'result.json'), result)
  settleJob(paths, nowMs, s, o)
}

/** The terminal state, then its ledger entry. finishJob's second half, and all of it for a job whose result.json is already there. */
export function settleJob(paths: SummonPaths, nowMs: number, s: JobState, o: Outcome): void {
  writeState(paths, { ...s, status: o.status, reason: o.reason, detail: o.detail, ...(o.resets_at ? { resets_at: o.resets_at } : {}),
    ended_at: new Date(nowMs).toISOString(), pid: undefined, pid_lstart: undefined,
    codex_group: undefined, supervisor_pid: undefined, supervisor_lstart: undefined })
  appendLedger(paths.ledger, { event: 'job_end', id: s.id, status: o.status, reason: o.reason, detail: o.detail?.slice(0, 200) }, nowMs)
}

export function heartbeatAgeS(paths: SummonPaths, id: string, nowMs: number): number | null {
  try { return Math.round((nowMs - statSync(join(jobDir(paths, id), 'heartbeat')).mtimeMs) / 1000) } catch { return null }
}

function allStates(paths: SummonPaths): JobState[] {
  let names: string[] = []
  try { names = readdirSync(paths.jobs) } catch { return [] }
  return names.filter((n) => ID_RE.test(n)).map((n) => readState(paths, n)).filter((s): s is JobState => s !== null)
}

/**
 * A `queued` job past its expiry plus the gate's skew grace that the runner never claimed. The runner would only end it
 * `expired` (runJob's own check uses the same grace), so it no longer counts as active and `status` already says expired.
 */
export function neverReached(paths: SummonPaths, s: JobState, nowMs: number): boolean {
  return s.status === 'queued' && nowMs > Date.parse(s.expires_at) + CLOCK_SKEW_MS && !existsSync(join(jobDir(paths, s.id), 'claimed'))
}

export const NEVER_REACHED = 'never reached the runner'
export const CANCELLED_BEFORE_START = 'cancelled before it started'

/**
 * How a job that never started ends, wherever that is decided (the gate, `status`, the runner): `cancelled` if a cancel
 * was asked for, else `expired`. One function, so the three never disagree.
 */
export function notStartedOutcome(paths: SummonPaths, id: string): Outcome {
  return existsSync(join(jobDir(paths, id), 'cancel'))
    ? { status: 'cancelled', detail: CANCELLED_BEFORE_START }
    : { status: 'expired', detail: NEVER_REACHED }
}

/** Where the runner notes that it has ledgered a job's failed claim, so a retry loop ledgers it once. Never in the spool. */
export function claimFailedNote(paths: SummonPaths, id: string): string {
  if (!ID_RE.test(id)) throw new Error('bad id')
  return join(paths.state, 'claim-failed', id)
}

/**
 * Run under the admission lock, by the gate before each admission and by the runner before each pass. Each never-reached
 * job first loses its spool marker, which ends any claim-retry loop even when its job dir cannot be written, then ends
 * with notStartedOutcome.
 */
export function settleNeverReached(paths: SummonPaths, nowMs: number): number {
  let n = 0
  for (const s of allStates(paths)) {
    if (!neverReached(paths, s, nowMs)) continue
    try {
      rmSync(join(paths.spool, s.id), { force: true })
      // A claim that landed before the marker went is the runner's: its own expiry check ends the job.
      if (existsSync(join(jobDir(paths, s.id), 'claimed'))) continue
      rmSync(claimFailedNote(paths, s.id), { force: true })
      finishJob(paths, nowMs, s, notStartedOutcome(paths, s.id))
      n++
    } catch { /* best effort: it no longer counts as active either way, and the next pass tries again */ }
  }
  return n
}

export function countActive(paths: SummonPaths, nowMs: number): number {
  return allStates(paths).filter((s) => s.status === 'running' || (s.status === 'queued' && !neverReached(paths, s, nowMs))).length
}

export function admittedSince(paths: SummonPaths, sinceMs: number): number {
  return allStates(paths).filter((s) => Date.parse(s.admitted_at) >= sinceMs).length
}
