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

/**
 * What a later runner needs to find a job whose runner died: claude's pid, its process group (claude leads it, so the same number),
 * the start time claude had, and each process recorded under the start time it had. Written to the job's private state directory
 * (0600) at spawn and whenever the recorded set changes; the pids are checked against their start times before anything is signalled.
 */
export interface TrackerRecord { pid: number; pgid: number; start: string | null; seen: Array<[number, string]> }

/** A pid is only ever signalled if it is above init's and a whole number: 0, 1, negatives and fractions would name init, a group or everyone. */
const goodPid = (n: unknown): n is number => Number.isInteger(n) && (n as number) > 1

/** Reads a record back from the job's state directory; null for anything that is not exactly one. */
export function parseTrackerRecord(x: unknown): TrackerRecord | null {
  const r = x as Partial<TrackerRecord> | null
  if (!r || typeof r !== 'object' || Array.isArray(r) || !goodPid(r.pid) || r.pgid !== r.pid || !(r.start === null || typeof r.start === 'string') || !Array.isArray(r.seen)) return null
  const seen: Array<[number, string]> = []
  for (const e of r.seen as unknown[]) {
    if (!Array.isArray(e) || e.length !== 2 || !goodPid(e[0]) || typeof e[1] !== 'string') return null
    seen.push([e[0], e[1]])
  }
  return { pid: r.pid, pgid: r.pgid, start: r.start, seen }
}
const SWEEP_ROUNDS = 3
const SETTLE_MS = 30

/** The process tree of one job, from its claude process down. */
export class ProcessTracker {
  /** claude's start time, as the first snapshot that saw it printed it; a later row for the same pid with another one is another process. */
  private rootStart: string | null = null
  private readonly seen = new Map<number, string>()

  /**
   * `strict` is for a tracker rebuilt from a record by a runner that did not spawn claude: it holds no child handle, so a pid it finds
   * alive is claude only if its start time is the recorded one, and a record without a start time proves nothing.
   */
  constructor(private readonly root: number, private readonly ps: PsSnapshot = livePs, private readonly kill: Kill = realKill,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => Bun.sleep(ms), private readonly strict = false) {}

  /** A tracker that carries on from a record (see TrackerRecord): the sweep a runner owes a job whose own runner died. */
  static restore(rec: TrackerRecord, ps: PsSnapshot = livePs, kill: Kill = realKill, sleep: (ms: number) => Promise<void> = (ms) => Bun.sleep(ms)): ProcessTracker {
    const t = new ProcessTracker(rec.pid, ps, kill, sleep, true)
    t.rootStart = rec.start
    for (const [pid, start] of rec.seen) t.seen.set(pid, start)
    return t
  }

  /** What to save so another runner can sweep this job (see TrackerRecord). */
  toRecord(): TrackerRecord { return { pid: this.root, pgid: this.root, start: this.rootStart, seen: [...this.seen] } }

  /** Records every process whose parent chain reaches claude, or a process already recorded (so what a detached child starts later is found). */
  snapshot(): void {
    const rows = this.ps()
    if (rows) this.record(rows)
  }

  private record(rows: PsRow[]): void {
    const byPid = new Map(rows.map((r) => [r.pid, r]))
    const roots: number[] = []
    const me = byPid.get(this.root)
    if (me && this.rootStart === null && !this.strict) this.rootStart = me.lstart
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
    // With no table to read, the runner that spawned claude still signals the group it made; one rebuilt from a record cannot know the number is still claude's.
    const members = first ? first.some((r) => r.pgid === this.root) : !this.strict
    const ours = me ? (this.rootStart === null ? !this.strict : me.lstart === this.rootStart) : members
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
