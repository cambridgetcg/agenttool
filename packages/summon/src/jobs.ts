import { mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SummonPaths } from './paths.ts'
import { ID_RE, type Access, type Runtime } from './request.ts'
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

export function heartbeatAgeS(paths: SummonPaths, id: string, nowMs: number): number | null {
  try { return Math.round((nowMs - statSync(join(jobDir(paths, id), 'heartbeat')).mtimeMs) / 1000) } catch { return null }
}

function allStates(paths: SummonPaths): JobState[] {
  let names: string[] = []
  try { names = readdirSync(paths.jobs) } catch { return [] }
  return names.filter((n) => ID_RE.test(n)).map((n) => readState(paths, n)).filter((s): s is JobState => s !== null)
}

export function countActive(paths: SummonPaths): number {
  return allStates(paths).filter((s) => s.status === 'queued' || s.status === 'running').length
}

export function admittedSince(paths: SummonPaths, sinceMs: number): number {
  return allStates(paths).filter((s) => Date.parse(s.admitted_at) >= sinceMs).length
}
