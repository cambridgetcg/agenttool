import { spawnSync } from 'node:child_process'

export type GroupMembers = Map<number, string>

/** PID, process group and kernel start time only; no command arguments or environment. */
export function groupMembers(group: number): GroupMembers | null {
  const r = spawnSync('/bin/ps', ['-axo', 'pid=,pgid=,lstart='],
    { encoding: 'utf8', timeout: 3000, maxBuffer: 1024 * 1024, env: { LC_ALL: 'C', TZ: 'UTC' } })
  if (r.status !== 0) return null
  const members = new Map<number, string>()
  for (const line of r.stdout.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line)
    if (m && Number(m[2]) === group) members.set(Number(m[1]), m[3]!)
  }
  return members
}

/** Recheck an observed member's identity before signalling; a recycled group number is not ownership. */
export function signalOwnedGroup(group: number, known: GroupMembers, signal: NodeJS.Signals,
  inspect = groupMembers, send: (pid: number, signal: NodeJS.Signals) => void = process.kill): boolean {
  const current = inspect(group)
  if (!current) return false
  if (current.size === 0) return true
  if (![...known].some(([pid, start]) => current.get(pid) === start)) return false
  try { send(-group, signal); return true } catch (e: any) { return e.code === 'ESRCH' }
}
