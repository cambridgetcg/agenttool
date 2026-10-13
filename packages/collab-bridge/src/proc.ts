// The process table the pipe, the tap and `hub on` read (spec §6.2 Lineage, §8 item 2, §10.3 step 7; K68).
// The format and parser are Collab's own (KN src/process-tree.ts): comm is the last column so it is never cut to 16 chars,
// and lstart is squeezed to single spaces, so `host_lstart` has one form on every side ("Wed Oct 7 16:22:59 2026").
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'

export interface ProcRecord { pid: number; ppid: number; started_at: string; comm: string }
export type ProcTable = ReadonlyMap<number, ProcRecord>

export const PS_ARGS = ['-A', '-ww', '-o', 'pid=,ppid=,lstart=,comm='] as const
/** Collab's STATUS_LINE: lstart is always five tokens under LC_ALL=C, and comm (which may hold spaces) is the rest. */
export const STATUS_LINE = /^\s*(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\S+\s+\S+\s+\S+)\s+(.+)$/
const PS_ENV = { LC_ALL: 'C', PATH: '/usr/bin:/bin' }
const PS_TIMEOUT_MS = 2_000
const PS_MAX_BUFFER = 64 * 1024 * 1024
const MAX_ANCESTRY = 256
export const HARNESS_COMMS: ReadonlySet<string> = new Set(['claude', 'codex', 'hermes'])

export function parsePs(out: string): ProcTable {
  const table = new Map<number, ProcRecord>()
  for (const line of out.split('\n')) {
    const m = STATUS_LINE.exec(line)
    if (!m) continue
    const pid = Number(m[1])
    if (table.has(pid)) continue
    table.set(pid, { pid, ppid: Number(m[2]), started_at: m[3]!.replace(/\s+/g, ' '), comm: m[4]!.trim() })
  }
  return table
}

/** The whole table from one `ps` run with a built env (never inherited), or null on any failure: callers fail closed. */
export function readPs(psBin: string): ProcTable | null {
  const r = spawnSync(psBin, [...PS_ARGS], {
    encoding: 'utf8', env: PS_ENV, cwd: '/', timeout: PS_TIMEOUT_MS, maxBuffer: PS_MAX_BUFFER, stdio: ['ignore', 'pipe', 'ignore'],
  })
  if (r.error || r.status !== 0 || typeof r.stdout !== 'string') return null
  const table = parsePs(r.stdout)
  return table.size > 0 ? table : null
}

/** `pid` and its ancestors, nearest first; stops at a missing pid, a cycle, pid 1 (launchd) or 256 steps. */
export function ancestry(pid: number, table: ProcTable): ProcRecord[] {
  const chain: ProcRecord[] = []
  const seen = new Set<number>()
  let current = pid
  while (current > 1 && chain.length < MAX_ANCESTRY && !seen.has(current)) {
    const rec = table.get(current)
    if (!rec) break
    chain.push(rec)
    seen.add(current)
    current = rec.ppid
  }
  return chain
}

/** Collab's rule (K68): the executable's basename. A comm cut to 16 chars ("/Users/macair/.l") never matches. */
export function isClaudeComm(comm: string): boolean {
  return comm.split('/').pop() === 'claude'
}

/** The nearest ancestor of `startPid` (never `startPid` itself) whose comm is claude. */
export function nearestClaude(startPid: number, table: ProcTable): ProcRecord | null {
  return ancestry(startPid, table).slice(1).find((r) => isClaudeComm(r.comm)) ?? null
}

/** §6.2: sha256(host_pid|host_lstart|"agenttool-collab-hub")[:32], with host_lstart in the squeezed form. */
export function lineageKey(hostPid: number, hostLstart: string): string {
  return createHash('sha256').update(`${hostPid}|${hostLstart}|agenttool-collab-hub`).digest('hex').slice(0, 32)
}

/** The controlling tty of a process, or null for none (`??`), a dead pid or any ps failure. */
export function ttyOf(pid: number, psBin: string): string | null {
  if (!Number.isInteger(pid) || pid <= 0) return null
  const r = spawnSync(psBin, ['-o', 'tty=', '-p', String(pid)], {
    encoding: 'utf8', env: PS_ENV, cwd: '/', timeout: PS_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'ignore'],
  })
  if (r.error || r.status !== 0 || typeof r.stdout !== 'string') return null
  const tty = r.stdout.trim()
  return /^[A-Za-z0-9]{1,32}$/.test(tty) ? tty : null
}

/**
 * Whether a process exists, by kill(pid, 0) (P61): ESRCH is gone, EPERM is alive but another user's. pid 0, 1 and
 * anything that is not a positive integer are never "alive": kill(0) and kill(-1) would address process groups.
 */
export function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 1) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}
