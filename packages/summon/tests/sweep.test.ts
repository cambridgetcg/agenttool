import { afterEach, describe, expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { livePs, parsePs, parseTrackerRecord, ProcessTracker, type PsRow, type TrackerRecord } from '../src/sweep.ts'

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

describe('ProcessTracker: its record, for a runner that comes after the one that died', () => {
  test('toRecord() holds claude\'s pid, its group (the same number: claude leads it), its start time and every recorded process with its start time', () => {
    const t = table([row(100, 1, 100, L(5)), row(101, 100, 100, L(6)), row(102, 101, 102, L(7))])
    const tracker = new ProcessTracker(100, t.ps, t.kill, t.sleep)
    tracker.snapshot()
    expect(tracker.toRecord()).toEqual({ pid: 100, pgid: 100, start: L(5), seen: [[101, L(6)], [102, L(7)]] })
  })
  test('a tracker restored from a record kills the group and the recorded processes, as the one that made it would', async () => {
    const t = table([row(100, 1, 100, L(5)), row(101, 100, 100, L(6)), row(102, 101, 102, L(7)), row(300, 1, 300)])
    const first = new ProcessTracker(100, t.ps, t.kill, t.sleep); first.snapshot()
    const restored = ProcessTracker.restore(JSON.parse(JSON.stringify(first.toRecord())), t.ps, t.kill, t.sleep)
    await restored.sweep()
    expect(t.kills[0]).toEqual([-100, 'SIGKILL'])
    expect(t.rows.map((r) => r.pid)).toEqual([300]) // the bystander stays
  })
  test('a restored tracker finds what claude started after the record was made, from a recorded process that is still there (claude itself is gone)', async () => {
    const t = table([row(101, 1, 101, L(6)), row(150, 101, 150, L(9))])
    const restored = ProcessTracker.restore({ pid: 100, pgid: 100, start: L(5), seen: [[101, L(6)]] }, t.ps, t.kill, t.sleep)
    await restored.sweep()
    expect(t.rows).toEqual([])
  })
  test('a restored tracker does not signal a group whose leader pid now has another start time: that is a stranger\'s', async () => {
    const t = table([row(100, 1, 100, L(40)), row(101, 100, 100, L(41))])
    const restored = ProcessTracker.restore({ pid: 100, pgid: 100, start: L(5), seen: [] }, t.ps, t.kill, t.sleep)
    const out = await restored.sweep()
    expect(out).toEqual({ groupKilled: false, killed: 0 })
    expect(t.kills).toEqual([])
    expect(t.rows).toHaveLength(2)
  })
  test('a restored tracker with no start time on record cannot tell claude from a stranger: while the pid is alive it signals nothing', async () => {
    const t = table([row(100, 1, 100, L(40))])
    const restored = ProcessTracker.restore({ pid: 100, pgid: 100, start: null, seen: [] }, t.ps, t.kill, t.sleep)
    await restored.sweep()
    expect(t.kills).toEqual([])
    expect(t.rows).toHaveLength(1)
  })
  // Ruling S10: a group is signalled only on proof. A process group number outlives its leader while any member is alive, and once the group is empty the
  // number can be handed to a stranger who then leads a group of its own, so "somebody is in group 100" proves nothing about a job that ended long ago.
  test('S10: claude is gone and the live members of its group are all unrecorded: the group is not signalled (it may be a stranger\'s now)', async () => {
    const t = table([row(150, 1, 100, L(9)), row(151, 150, 100, L(10)), row(300, 1, 300)])
    const restored = ProcessTracker.restore({ pid: 100, pgid: 100, start: L(5), seen: [] }, t.ps, t.kill, t.sleep)
    expect(await restored.sweep()).toEqual({ groupKilled: false, killed: 0 })
    expect(t.kills).toEqual([])
    expect(t.rows.map((r) => r.pid)).toEqual([150, 151, 300])
  })
  test('S10: claude is gone and a live member of its group is a recorded process with the recorded start time: the group is signalled, and so are its unrecorded members', async () => {
    const t = table([row(101, 1, 100, L(6)), row(150, 1, 100, L(9)), row(300, 1, 300)])
    const restored = ProcessTracker.restore({ pid: 100, pgid: 100, start: L(5), seen: [[101, L(6)]] }, t.ps, t.kill, t.sleep)
    expect((await restored.sweep()).groupKilled).toBe(true)
    expect(t.kills[0]).toEqual([-100, 'SIGKILL'])
    expect(t.rows.map((r) => r.pid)).toEqual([300])
  })
  test('S10: a member of the group that was recorded under another start time is another process, so it proves nothing', async () => {
    const t = table([row(101, 1, 100, L(59)), row(150, 1, 100, L(9))])
    const restored = ProcessTracker.restore({ pid: 100, pgid: 100, start: L(5), seen: [[101, L(6)]] }, t.ps, t.kill, t.sleep)
    expect(await restored.sweep()).toEqual({ groupKilled: false, killed: 0 })
    expect(t.kills).toEqual([])
  })
  test('S10: a recorded process in some other group does not make claude\'s group the job\'s', async () => {
    const t = table([row(101, 1, 101, L(6)), row(150, 1, 100, L(9))])
    const restored = ProcessTracker.restore({ pid: 100, pgid: 100, start: L(5), seen: [[101, L(6)]] }, t.ps, t.kill, t.sleep)
    await restored.sweep()
    expect(t.kills).toEqual([[101, 'SIGKILL']]) // the recorded process itself goes, by pid; the group does not
    expect(t.rows.map((r) => r.pid)).toEqual([150])
  })
  test('S10: a record with a null start time is never signalled: not when claude\'s pid is alive, not when it is gone with unrecorded members, not even beside a matching recorded member', async () => {
    const alive = table([row(100, 1, 100, L(40))])
    await ProcessTracker.restore({ pid: 100, pgid: 100, start: null, seen: [] }, alive.ps, alive.kill, alive.sleep).sweep()
    expect(alive.kills).toEqual([])
    const gone = table([row(150, 1, 100, L(9))])
    await ProcessTracker.restore({ pid: 100, pgid: 100, start: null, seen: [] }, gone.ps, gone.kill, gone.sleep).sweep()
    expect(gone.kills).toEqual([])
    const beside = table([row(101, 1, 100, L(6)), row(150, 1, 100, L(9))])
    const out = await ProcessTracker.restore({ pid: 100, pgid: 100, start: null, seen: [[101, L(6)]] }, beside.ps, beside.kill, beside.sleep).sweep()
    expect(out.groupKilled).toBe(false)
    expect(beside.kills.every(([pid]) => pid > 0)).toBe(true) // no group signal; the recorded process itself, by its own start time, may go
    expect(beside.rows.map((r) => r.pid)).toEqual([150])
  })
  test('S10 does not change the tracker that spawned claude: with claude reaped and the group still populated it signals the group it made', async () => {
    const t = table([row(150, 1, 100, L(9))])
    const out = await new ProcessTracker(100, t.ps, t.kill, t.sleep).sweep()
    expect(out.groupKilled).toBe(true)
    expect(t.kills[0]).toEqual([-100, 'SIGKILL'])
  })
  test('a restored tracker that cannot read the process table signals nothing: with no table, the number could be anyone\'s now', async () => {
    const t = table([row(100, 1, 100, L(5)), row(101, 100, 101, L(6))])
    const restored = ProcessTracker.restore({ pid: 100, pgid: 100, start: L(5), seen: [[101, L(6)]] }, () => null, t.kill, t.sleep)
    expect(await restored.sweep()).toEqual({ groupKilled: false, killed: 0 })
    expect(t.kills).toEqual([])
  })
  test('a recorded process whose pid is another process now is not killed by a restored tracker', async () => {
    const t = table([row(101, 1, 101, L(59))])
    const restored = ProcessTracker.restore({ pid: 100, pgid: 100, start: L(5), seen: [[101, L(6)]] }, t.ps, t.kill, t.sleep)
    await restored.sweep()
    expect(t.kills).toEqual([])
  })
  test('parseTrackerRecord accepts what toRecord() makes, and refuses a pid that could name init, a group or everything, and any wrong shape', () => {
    const good: TrackerRecord = { pid: 100, pgid: 100, start: L(5), seen: [[101, L(6)]] }
    expect(parseTrackerRecord(JSON.parse(JSON.stringify(good)))).toEqual(good)
    expect(parseTrackerRecord({ ...good, start: null })).toEqual({ ...good, start: null })
    for (const bad of [{ ...good, pid: 1 }, { ...good, pid: 0 }, { ...good, pid: -5 }, { ...good, pid: 1.5 }, { ...good, pid: '100' }, { ...good, pgid: 99 }, { ...good, start: 7 },
      { ...good, seen: [[1, L(6)]] }, { ...good, seen: [[-3, L(6)]] }, { ...good, seen: [[101]] }, { ...good, seen: [[101, 5]] }, { ...good, seen: 'x' }, { pid: 100 }, null, 'x', [], 7]) {
      expect(parseTrackerRecord(bad)).toBeNull()
    }
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
