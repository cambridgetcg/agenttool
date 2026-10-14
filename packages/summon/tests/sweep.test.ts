import { afterEach, describe, expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { livePs, parsePs, ProcessTracker, type PsRow } from '../src/sweep.ts'

const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }
async function waitUntil(fn: () => boolean, ms = 6000) {
  const end = Date.now() + ms
  while (!fn()) { if (Date.now() > end) throw new Error('timed out waiting'); await Bun.sleep(20) }
}
const L = (n: number) => `Wed Oct 14 00:00:${String(n).padStart(2, '0')} 2026`
const row = (pid: number, ppid: number, pgid: number, lstart = L(1)): PsRow => ({ pid, ppid, pgid, lstart })

describe('parsePs: /bin/ps -A -o pid=,ppid=,pgid=,lstart=', () => {
  test('reads the three numbers and the start time as printed, whatever the padding', () => {
    const text = '    1     0     1 Thu  1 Oct 18:30:08 2026    \n  189     1   189 Sat 10 Oct 11:24:06 2026\n34049 34048 34049 Wed Oct 14 00:10:59 2026\n'
    expect(parsePs(text)).toEqual([
      { pid: 1, ppid: 0, pgid: 1, lstart: 'Thu  1 Oct 18:30:08 2026' },
      { pid: 189, ppid: 1, pgid: 189, lstart: 'Sat 10 Oct 11:24:06 2026' },
      { pid: 34049, ppid: 34048, pgid: 34049, lstart: 'Wed Oct 14 00:10:59 2026' },
    ])
  })
  test('skips blank lines and lines that are not rows', () => {
    expect(parsePs('\nPID PPID PGID STARTED\nnot a row\n 7 1 7 x\n12 x 12 y\n')).toEqual([{ pid: 7, ppid: 1, pgid: 7, lstart: 'x' }])
  })
})

describe('livePs: the real table', () => {
  test('lists this process with its parent and a start time, and nothing but numbers where numbers belong', () => {
    const rows = livePs()!
    const me = rows.find((r) => r.pid === process.pid)!
    expect(me).toMatchObject({ ppid: process.ppid })
    expect(me.lstart).toMatch(/^[A-Z][a-z]{2} [A-Z][a-z]{2} [ \d]\d \d{2}:\d{2}:\d{2} \d{4}$/) // C locale, UTC: the form processStartTime prints
    expect(rows.every((r) => Number.isInteger(r.pid) && Number.isInteger(r.ppid) && Number.isInteger(r.pgid))).toBe(true)
  })
})

/** A fake process table and a fake kill that removes what it is told to kill (unless it is told to spare it). */
function table(initial: PsRow[]) {
  const rows = [...initial]
  const kills: Array<[number, string]> = []
  const spare = new Set<number>()
  const t = {
    rows, kills, spare,
    ps: () => rows.map((r) => ({ ...r })),
    kill: (pid: number, signal: NodeJS.Signals) => {
      kills.push([pid, signal])
      const victims = pid < 0 ? rows.filter((r) => r.pgid === -pid) : rows.filter((r) => r.pid === pid)
      for (const v of victims) if (!spare.has(v.pid)) rows.splice(rows.indexOf(v), 1)
    },
    sleep: async () => {},
  }
  return t
}

describe('ProcessTracker: the job\'s process tree, keyed by pid and start time', () => {
  test('records every process whose parent chain reaches claude, and not the others', async () => {
    const t = table([row(1, 0, 1), row(100, 1, 100), row(101, 100, 100), row(102, 101, 102), row(200, 1, 200), row(201, 200, 200)])
    const tracker = new ProcessTracker(100, t.ps, t.kill, t.sleep)
    tracker.snapshot()
    expect(tracker.tracked().sort()).toEqual([101, 102])
    const out = await tracker.sweep()
    expect(out.groupKilled).toBe(true)
    expect(t.kills[0]).toEqual([-100, 'SIGKILL'])
    expect(t.rows.map((r) => r.pid).sort((a, b) => a - b)).toEqual([1, 200, 201]) // 100, 101 and 102 are gone; the others stay
  })
  test('a child that left the group and the session is still found by its parent chain, and killed by pid', async () => {
    const t = table([row(100, 1, 100), row(101, 100, 101)]) // 101 called setsid: its own group
    const tracker = new ProcessTracker(100, t.ps, t.kill, t.sleep)
    tracker.snapshot()
    await tracker.sweep()
    expect(t.kills).toContainEqual([101, 'SIGKILL'])
    expect(t.rows).toEqual([])
  })
  test('a process seen once stays tracked after it is reparented to launchd, and so does what it starts later', async () => {
    const t = table([row(100, 1, 100), row(101, 100, 101)])
    const tracker = new ProcessTracker(100, t.ps, t.kill, t.sleep)
    tracker.snapshot()
    // claude is gone, 101 now belongs to launchd and has started a worker of its own
    t.rows.splice(0, t.rows.length, row(101, 1, 101), row(150, 101, 150))
    tracker.snapshot()
    expect(tracker.tracked().sort()).toEqual([101, 150])
    await tracker.sweep()
    expect(t.rows).toEqual([])
  })
  test('a recorded pid that now has another start time is another process and is not killed', async () => {
    const t = table([row(100, 1, 100), row(101, 100, 101, L(5))])
    const tracker = new ProcessTracker(100, t.ps, t.kill, t.sleep)
    tracker.snapshot()
    t.rows.splice(0, t.rows.length, row(101, 1, 101, L(59))) // the pid was reused
    await tracker.sweep()
    expect(t.kills.filter(([pid]) => pid === 101)).toEqual([])
    expect(t.rows).toHaveLength(1)
  })
  test('claude\'s own pid reused by another process is not walked: its children are not the job\'s', async () => {
    const t = table([row(100, 1, 100, L(5))])
    const tracker = new ProcessTracker(100, t.ps, t.kill, t.sleep)
    tracker.snapshot()
    t.rows.splice(0, t.rows.length, row(100, 1, 100, L(40)), row(300, 100, 300))
    tracker.snapshot()
    expect(tracker.tracked()).toEqual([])
    await tracker.sweep()
    expect(t.kills).toEqual([]) // the group of a recycled pid is not touched either: no member is the job's
    expect(t.rows).toHaveLength(2)
  })
  test('the group is not signalled when no process in the table belongs to it', async () => {
    const t = table([row(1, 0, 1), row(200, 1, 200)])
    const out = await new ProcessTracker(100, t.ps, t.kill, t.sleep).sweep()
    expect(out).toEqual({ groupKilled: false, killed: 0 })
    expect(t.kills).toEqual([])
  })
  test('when ps cannot be read the group is still killed (nothing else can be known)', async () => {
    const t = table([])
    const out = await new ProcessTracker(100, () => null, t.kill, t.sleep).sweep()
    expect(out.groupKilled).toBe(true)
    expect(t.kills).toEqual([[-100, 'SIGKILL']])
  })
  test('a process that survives its kill is tried again, three rounds at most', async () => {
    const t = table([row(100, 1, 100), row(101, 100, 101)])
    const tracker = new ProcessTracker(100, t.ps, t.kill, t.sleep)
    tracker.snapshot()
    t.spare.add(101)
    await tracker.sweep()
    expect(t.kills.filter(([pid]) => pid === 101)).toHaveLength(3)
  })
  test('the last look before the kill catches a process started since the previous snapshot', async () => {
    const t = table([row(100, 1, 100)])
    const tracker = new ProcessTracker(100, t.ps, t.kill, t.sleep)
    tracker.snapshot()
    t.rows.push(row(120, 100, 120))
    await tracker.sweep()
    expect(t.kills).toContainEqual([120, 'SIGKILL'])
  })
  test('a kill that throws (the process just went) does not stop the sweep', async () => {
    const t = table([row(100, 1, 100), row(101, 100, 101), row(102, 100, 102)])
    const tracker = new ProcessTracker(100, t.ps, (pid, sig) => { if (pid === 101) throw new Error('ESRCH'); t.kill(pid, sig) }, t.sleep)
    tracker.snapshot()
    await tracker.sweep()
    expect(t.rows.map((r) => r.pid)).toEqual([101])
  })
})

describe('ProcessTracker with real processes', () => {
  const spawned: Array<{ pid?: number }> = []
  afterEach(() => { for (const c of spawned.splice(0)) { try { process.kill(-c.pid!, 'SIGKILL') } catch { /* gone */ } try { process.kill(c.pid!, 'SIGKILL') } catch { /* gone */ } } })
  test('a detached group with two sleepers, and a sleeper that left its group, are all gone after one sweep', async () => {
    const child = spawn('/bin/sh', ['-c', '/bin/sleep 600 & /bin/sleep 600 & wait'], { detached: true, stdio: 'ignore' })
    spawned.push(child)
    const leaver = spawn(process.execPath, ['-e', "const {spawn}=require('node:child_process');const k=spawn('/bin/sleep',['600'],{detached:true,stdio:'ignore'});console.log(k.pid);setTimeout(()=>{},600000)"], { stdio: ['ignore', 'pipe', 'ignore'] })
    spawned.push(leaver)
    const leaverKid = await new Promise<number>((resolve) => leaver.stdout!.once('data', (d) => resolve(Number(String(d).trim()))))
    const tracker = new ProcessTracker(leaver.pid!)
    tracker.snapshot()
    expect(tracker.tracked()).toContain(leaverKid)
    const groupTracker = new ProcessTracker(child.pid!)
    await Bun.sleep(200)
    groupTracker.snapshot()
    const members = groupTracker.tracked()
    expect(members.length).toBeGreaterThanOrEqual(2)
    await groupTracker.sweep(); await tracker.sweep()
    await waitUntil(() => !alive(child.pid!) && members.every((p) => !alive(p)) && !alive(leaverKid))
  })
})
