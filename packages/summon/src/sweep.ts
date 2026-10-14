// Phase 0.5 §3 "Process sweep" (Ruling S3). An edit or build job runs claude in a process group of its own. While it runs, the
// runner records its process tree every 2 s from `/bin/ps`, walked in memory from the claude pid and keyed by pid AND start
// time, so a pid the kernel has since handed to another process is never mistaken for one of the job's. When the job ends, the
// runner kills the group, then every recorded process still alive with the same start time. That catches a child that called
// setsid or left the group, provided it lived through one snapshot. (An environment marker cannot be the key: Spike B3 found
// that `ps -E` shows no other process's environment on this macOS.)
import { spawnSync } from 'node:child_process'

export interface PsRow { pid: number; ppid: number; pgid: number; lstart: string }
/** The process table, or null when it could not be read. */
export type PsSnapshot = () => PsRow[] | null
export type Kill = (pid: number, signal: NodeJS.Signals) => void

const ROW = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S.*?)\s*$/

/** `ps -A -o pid=,ppid=,pgid=,lstart=`: three numbers, then the start time as ps prints it. Lines that are not rows are skipped. */
export function parsePs(text: string): PsRow[] {
  const rows: PsRow[] = []
  for (const line of text.split('\n')) {
    const m = ROW.exec(line)
    if (m) rows.push({ pid: Number(m[1]), ppid: Number(m[2]), pgid: Number(m[3]), lstart: m[4]! })
  }
  return rows
}

/** The real table. C locale and UTC, as processStartTime reads it, so the same process always prints the same start time. */
export const livePs: PsSnapshot = () => {
  const r = spawnSync('/bin/ps', ['-A', '-o', 'pid=,ppid=,pgid=,lstart='], { encoding: 'utf8', timeout: 3000, env: { LC_ALL: 'C', TZ: 'UTC' } })
  return r.status === 0 && typeof r.stdout === 'string' && r.stdout.trim() !== '' ? parsePs(r.stdout) : null
}

const realKill: Kill = (pid, signal) => { process.kill(pid, signal) }
const SWEEP_ROUNDS = 3
const SETTLE_MS = 30

/** The process tree of one job, from its claude process down. */
export class ProcessTracker {
  /** claude's start time, as the first snapshot that saw it printed it; a later row for the same pid with another one is another process. */
  private rootStart: string | null = null
  private readonly seen = new Map<number, string>()

  constructor(private readonly root: number, private readonly ps: PsSnapshot = livePs, private readonly kill: Kill = realKill,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => Bun.sleep(ms)) {}

  /** Records every process whose parent chain reaches claude, or a process already recorded (so what a detached child starts later is found). */
  snapshot(): void {
    const rows = this.ps()
    if (rows) this.record(rows)
  }

  private record(rows: PsRow[]): void {
    const byPid = new Map(rows.map((r) => [r.pid, r]))
    const roots: number[] = []
    const me = byPid.get(this.root)
    if (me && this.rootStart === null) this.rootStart = me.lstart
    if (me && me.lstart === this.rootStart) roots.push(this.root)
    for (const [pid, start] of this.seen) {
      if (byPid.get(pid)?.lstart === start) roots.push(pid)
      else this.seen.delete(pid) // gone, or the pid belongs to another process now
    }
    const kids = new Map<number, PsRow[]>()
    for (const r of rows) { const list = kids.get(r.ppid); if (list) list.push(r); else kids.set(r.ppid, [r]) }
    const walked = new Set<number>(roots)
    const queue = [...roots]
    while (queue.length > 0) {
      for (const k of kids.get(queue.shift()!) ?? []) {
        if (walked.has(k.pid)) continue
        walked.add(k.pid)
        this.seen.set(k.pid, k.lstart)
        queue.push(k.pid)
      }
    }
  }

  /** The pids recorded so far (claude's own is not among them). */
  tracked(): number[] { return [...this.seen.keys()] }

  private tryKill(pid: number): void { try { this.kill(pid, 'SIGKILL') } catch { /* already gone */ } }

  /**
   * One last look, then: kill the group; then kill every recorded process still alive with the start time it was recorded under,
   * looking again after each round (three at most), since a process can start another as it dies.
   * The group is signalled only when it is the job's: claude's pid, if it is in the table with another start time than it had, belongs
   * to a stranger now, and so does the group it leads. With no table to read, the group is signalled anyway.
   */
  async sweep(): Promise<{ groupKilled: boolean; killed: number }> {
    const first = this.ps()
    if (first) this.record(first)
    const me = first?.find((r) => r.pid === this.root)
    const members = first ? first.some((r) => r.pgid === this.root) : true
    const ours = me ? this.rootStart === null || me.lstart === this.rootStart : members
    const groupKilled = ours
    if (groupKilled) this.tryKill(-this.root)
    let killed = 0
    for (let round = 0; round < SWEEP_ROUNDS; round++) {
      const rows = this.ps()
      if (rows) this.record(rows)
      const alive = rows ? this.tracked().filter((pid) => rows.some((r) => r.pid === pid && r.lstart === this.seen.get(pid))) : []
      if (alive.length === 0) break
      for (const pid of alive) { this.tryKill(pid); killed++ }
      await this.sleep(SETTLE_MS)
    }
    return { groupKilled, killed }
  }
}
