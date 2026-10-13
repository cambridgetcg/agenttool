// The `pipes/<host_pid>-<pipe_pid>.json` record (spec §8 item 1): a pipe writes it beside its tap socket (Task 31), the
// tap reads it to find its own pipe (Task 32), and `collab-bridge status` counts it. It holds no secret: two pids, the
// host's start time, the lineage id (not a secret, §6.1), the link state and the latest refusal code.
import { chmodSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { LINEAGE_RE } from '../link/messages.ts'
import { writeFileDurable } from '../native.ts'
import type { NuancePaths } from '../paths.ts'
import { pidAlive } from '../proc.ts'

export interface PipeRecord { v: 1; host_pid: number; host_lstart: string; pipe_pid: number; lineage: string | null; state: string; refused: string | null }

const NAME_RE = /^([1-9][0-9]{0,9})-([1-9][0-9]{0,9})\.json$/
const LSTART_RE = /^[\x20-\x7e]{1,64}$/
const WORD_RE = /^[a-z][a-z0-9_]{0,63}$/   // a link state or a refusal code
const isPid = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 1

export function pipeRecordName(hostPid: number, pipePid: number): string {
  return `${hostPid}-${pipePid}`
}

/** Null unless every field is present and well-formed; keys this build does not know are dropped. */
export function parsePipeRecord(text: string): PipeRecord | null {
  let o: unknown
  try { o = JSON.parse(text) } catch { return null }
  if (typeof o !== 'object' || o === null || Array.isArray(o)) return null
  const r = o as Record<string, unknown>
  if (r.v !== 1 || !isPid(r.host_pid) || !isPid(r.pipe_pid)) return null
  if (typeof r.host_lstart !== 'string' || !LSTART_RE.test(r.host_lstart)) return null
  if (r.lineage !== null && (typeof r.lineage !== 'string' || !LINEAGE_RE.test(r.lineage))) return null
  if (typeof r.state !== 'string' || !WORD_RE.test(r.state)) return null
  if (r.refused !== null && (typeof r.refused !== 'string' || !WORD_RE.test(r.refused))) return null
  return { v: 1, host_pid: r.host_pid, host_lstart: r.host_lstart, pipe_pid: r.pipe_pid,
    lineage: r.lineage as string | null, state: r.state, refused: r.refused as string | null }
}

/** Replaces the record whole (temp file, F_FULLFSYNC, rename), 0600 in the 0700 pipes dir; a malformed record is never written. */
export function writePipeRecord(paths: NuancePaths, r: PipeRecord): void {
  const text = JSON.stringify({ v: 1, host_pid: r.host_pid, host_lstart: r.host_lstart, pipe_pid: r.pipe_pid, lineage: r.lineage, state: r.state, refused: r.refused })
  if (!parsePipeRecord(text)) throw new Error(`pipe record ${pipeRecordName(r.host_pid, r.pipe_pid)} is malformed`)
  mkdirSync(paths.pipes, { recursive: true, mode: 0o700 })
  chmodSync(paths.pipes, 0o700)
  writeFileDurable(paths.pipeJson(r.host_pid, r.pipe_pid), text + '\n', 0o600)
}

/**
 * Every record whose file name matches its own host_pid and pipe_pid and whose pipe is alive (P61: kill(pid, 0), because
 * a SIGKILLed pipe's files outlive it, F8). Dead records are skipped, never deleted here: a starting pipe removes its own
 * host's (Task 31). Sorted by host pid, then pipe pid.
 */
export function readPipeRecords(paths: NuancePaths, alive: (pid: number) => boolean = pidAlive): PipeRecord[] {
  let names: string[]
  try { names = readdirSync(paths.pipes) } catch { return [] }
  const out: PipeRecord[] = []
  for (const name of names) {
    const m = NAME_RE.exec(name)
    if (!m) continue
    let text: string
    try { text = readFileSync(join(paths.pipes, name), 'utf8') } catch { continue }
    const r = parsePipeRecord(text)
    if (!r || r.host_pid !== Number(m[1]) || r.pipe_pid !== Number(m[2]) || !alive(r.pipe_pid)) continue
    out.push(r)
  }
  return out.sort((a, b) => a.host_pid - b.host_pid || a.pipe_pid - b.pipe_pid)
}
