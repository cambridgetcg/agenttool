import { afterEach, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  ancestry, HARNESS_COMMS, isClaudeComm, lineageKey, nearestClaude, parsePs, pidAlive, PS_ARGS, readPs, STATUS_LINE, ttyOf,
} from '../src/proc.ts'
import { cleanupTmps, PS_STUB_HOST, temp, writePsStub, writeStub } from './helpers.ts'

afterEach(cleanupTmps)

// Lines as `LC_ALL=C /bin/ps -A -ww -o pid=,ppid=,lstart=,comm=` prints them on the Air (plan-facts air-env §15).
const LIVE = [
  '    1     0 Thu Oct  1 18:30:08 2026     /sbin/launchd',
  '  784     1 Thu Oct  1 18:38:26 2026     /Applications/Visual Studio Code.app/Contents/MacOS/Electron',
  '89980     1 Wed Oct  7 16:20:01 2026     /bin/zsh',
  '90013 89980 Wed Oct  7 16:22:59 2026     /Users/yuai/.local/bin/claude',
  '95900 90013 Tue Oct 13 11:33:11 2026     bun',
  '',
].join('\n')

const table = (lines: string[]) => parsePs(lines.join('\n') + '\n')

describe('the ps table', () => {
  test('parses the live format and squeezes lstart', () => {
    const t = parsePs(LIVE)
    expect(t.size).toBe(5)
    expect(t.get(1)).toEqual({ pid: 1, ppid: 0, started_at: 'Thu Oct 1 18:30:08 2026', comm: '/sbin/launchd' })
    expect(t.get(784)?.comm).toBe('/Applications/Visual Studio Code.app/Contents/MacOS/Electron')
    expect(t.get(90013)).toEqual({ pid: 90013, ppid: 89980, started_at: 'Wed Oct 7 16:22:59 2026', comm: '/Users/yuai/.local/bin/claude' })
    expect(t.get(95900)?.started_at).toBe('Tue Oct 13 11:33:11 2026')
    expect(parsePs('garbage\n  12 x Wed\n').size).toBe(0)
    expect(PS_ARGS).toEqual(['-A', '-ww', '-o', 'pid=,ppid=,lstart=,comm='])
    expect(STATUS_LINE.test('90013 89980 Wed Oct  7 16:22:59 2026     /Users/yuai/.local/bin/claude')).toBe(true)
  })
  test('readPs on /bin/ps finds this test process', () => {
    const t = readPs('/bin/ps')
    expect(t).not.toBeNull()
    const me = t!.get(process.pid)
    expect(me?.ppid).toBe(process.ppid)
    expect(me?.started_at).toMatch(/^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{1,2} \d\d:\d\d:\d\d \d{4}$/)
    expect(ancestry(process.pid, t!)[0]?.pid).toBe(process.pid)
  })
  test('readPs on the P43 stub chains the caller to claude 4100', () => {
    const ps = writePsStub(temp('cb-ps-'))
    const t = readPs(ps)!
    expect(t.get(process.pid)?.ppid).toBe(PS_STUB_HOST.pid)
    expect(nearestClaude(process.pid, t)).toEqual({ pid: 4100, ppid: 1, started_at: 'Wed Oct 7 16:22:59 2026', comm: 'claude' })
  })
  test('readPs returns null when ps fails', () => {
    const dir = temp('cb-ps-')
    expect(readPs(writeStub(dir, 'ps', 'exit 1'))).toBeNull()
    expect(readPs(writeStub(dir, 'ps-empty', 'exit 0'))).toBeNull()
    expect(readPs(writeStub(dir, 'ps-slow', 'exec /bin/sleep 5'))).toBeNull()   // past the 2000 ms timeout
    expect(readPs(`${dir}/no-such-ps`)).toBeNull()
  }, 10_000)
})

describe('host detection', () => {
  test('finds the nearest claude by a full-path comm', () => {
    const t = table([
      '    1     0 Thu Oct  1 18:30:08 2026     /sbin/launchd',
      ' 4000     1 Wed Oct  7 16:20:00 2026     /bin/zsh',
      ' 4100  4000 Wed Oct  7 16:22:59 2026     /Users/macair/.local/bin/claude',
      ' 4150  4100 Wed Oct  7 16:23:05 2026     /bin/zsh',
      ' 4200  4150 Wed Oct  7 16:23:10 2026     /Users/macair/.local/share/collab-bridge/collab-bridge',
    ])
    expect(nearestClaude(4200, t)).toEqual({ pid: 4100, ppid: 4000, started_at: 'Wed Oct 7 16:22:59 2026', comm: '/Users/macair/.local/bin/claude' })
    expect(isClaudeComm('claude')).toBe(true)
    expect(isClaudeComm('/Users/macair/.local/bin/claude')).toBe(true)
    expect(isClaudeComm('/Users/macair/.local/bin/claude-code')).toBe(false)
  })
  test('a 16-char truncated comm is never taken as claude', () => {
    const t = table([
      ' 4000     1 Wed Oct  7 16:20:00 2026     /bin/zsh',
      ' 4100  4000 Wed Oct  7 16:22:59 2026     /Users/macair/.l',
      ' 4200  4100 Wed Oct  7 16:23:10 2026     /Users/macair/.local/share/collab-bridge/collab-bridge',
    ])
    expect('/Users/macair/.l'.length).toBe(16)
    expect(isClaudeComm('/Users/macair/.l')).toBe(false)
    expect(nearestClaude(4200, t)).toBeNull()
  })
  test('skips itself and stops at a cycle', () => {
    const t = table([
      ' 4200  4300 Wed Oct  7 16:23:10 2026     claude',
      ' 4300  4200 Wed Oct  7 16:23:11 2026     /bin/zsh',
    ])
    expect(nearestClaude(4200, t)).toBeNull()
    expect(ancestry(4200, t).map((r) => r.pid)).toEqual([4200, 4300])
    expect(nearestClaude(4300, t)?.pid).toBe(4200)
  })
  test('ancestry is capped at 256 and stops before pid 1', () => {
    const lines = ['    1     0 Thu Oct  1 18:30:08 2026     /sbin/launchd']
    for (let pid = 1000; pid < 1300; pid++) lines.push(`${pid} ${pid === 1000 ? 1 : pid - 1} Wed Oct  7 16:20:00 2026     /bin/zsh`)
    const t = table(lines)
    expect(ancestry(1299, t)).toHaveLength(256)
    expect(ancestry(1010, t).map((r) => r.pid).at(-1)).toBe(1000)
    expect(ancestry(1, t)).toEqual([])
    expect(ancestry(77777, t)).toEqual([])
  })
  test('the lineage key is 32 hex and differs by lstart', () => {
    const k = lineageKey(4100, 'Wed Oct 7 16:22:59 2026')
    expect(k).toMatch(/^[0-9a-f]{32}$/)
    expect(k).toBe(createHash('sha256').update('4100|Wed Oct 7 16:22:59 2026|agenttool-collab-hub').digest('hex').slice(0, 32))
    expect(k).toBe('973d421f743c59759e3eb654307cf8a4')   // shasum -a 256 of the same string, first 32 hex
    expect(lineageKey(4100, 'Wed Oct 7 16:23:00 2026')).not.toBe(k)
    expect(lineageKey(4101, 'Wed Oct 7 16:22:59 2026')).not.toBe(k)
  })
  test('HARNESS_COMMS names the three harnesses', () => {
    expect([...HARNESS_COMMS].sort()).toEqual(['claude', 'codex', 'hermes'])
  })
})

describe('tty and liveness', () => {
  test('ttyOf maps ?? to null', () => {
    expect(ttyOf(4100, writePsStub(temp('cb-ps-')))).toBe('ttys001')
    expect(ttyOf(4100, writePsStub(temp('cb-ps-'), { tty: null }))).toBeNull()
    expect(ttyOf(4100, writeStub(temp('cb-ps-'), 'ps', 'exit 1'))).toBeNull()
    // Against the real ps: whatever it prints for this process, ?? reads as null.
    const raw = spawnSync('/bin/ps', ['-o', 'tty=', '-p', String(process.pid)], { encoding: 'utf8', env: { LC_ALL: 'C', PATH: '/usr/bin:/bin' } }).stdout.trim()
    expect(ttyOf(process.pid, '/bin/ps')).toBe(raw === '??' ? null : raw)
  })
  test('pidAlive is true for this process and false for a reaped child', async () => {
    expect(pidAlive(process.pid)).toBe(true)
    const child = Bun.spawn(['/bin/sleep', '10'])
    child.kill()
    await child.exited
    expect(pidAlive(child.pid)).toBe(false)
    for (const pid of [1, 0, -1, 1.5, Number.NaN]) expect(pidAlive(pid)).toBe(false)
  })
  test('pidAlive counts another user’s live process (EPERM) as alive', () => {
    const out = spawnSync('/bin/ps', ['-A', '-o', 'pid=,uid='], { encoding: 'utf8', env: { LC_ALL: 'C', PATH: '/usr/bin:/bin' } }).stdout
    const rootPid = out.split('\n').map((l) => l.trim().split(/\s+/).map(Number)).find(([pid, uid]) => uid === 0 && pid! > 1)?.[0]
    expect(rootPid).toBeGreaterThan(1)
    expect(pidAlive(rootPid!)).toBe(true)
  })
})
