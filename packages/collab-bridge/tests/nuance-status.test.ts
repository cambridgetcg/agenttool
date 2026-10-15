import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pipeRecordName, readPipeRecords, writePipeRecord, type PipeRecord } from '../src/nuance/pipe-record.ts'
import type { RelayStatusFile } from '../src/nuance/relay.ts'
import { nuanceStatus, renderNuanceStatus } from '../src/nuance/status.ts'
import { nuancePaths, type NuancePaths } from '../src/paths.ts'
import { cleanupTmps, modeOf, PKG, shortSockRoot, temp, testEnv } from './helpers.ts'

afterEach(cleanupTmps)

function nuance(): NuancePaths {
  const home = temp('cb-status-')
  return nuancePaths(home, { HOME: home, COLLAB_BRIDGE_HOME_OVERRIDE: home, COLLAB_BRIDGE_SOCK_ROOT: shortSockRoot(), COLLAB_BRIDGE_SUMMON_DROPIN: join(home, 'dropin') })
}

function writeRelayJson(paths: NuancePaths, s: RelayStatusFile): void {
  mkdirSync(paths.run, { recursive: true, mode: 0o700 })
  writeFileSync(paths.relayStatus, JSON.stringify(s) + '\n')
}

/** A pid that has exited and been reaped, so kill(pid, 0) answers ESRCH. */
function deadPid(): number {
  return Bun.spawnSync(['/usr/bin/true']).pid
}

const rec = (host: number, pipe: number, o: Partial<PipeRecord> = {}): PipeRecord => ({
  v: 1, host_pid: host, host_lstart: 'Wed Oct 7 16:22:59 2026', pipe_pid: pipe, lineage: `lin_${'0'.repeat(32)}`, state: 'ready', refused: null, ...o,
})

const runMain = (args: string[], home: string) =>
  Bun.spawnSync([process.execPath, '--no-env-file', '--config=/dev/null', `${PKG}/src/nuance/main.ts`, ...args], { env: testEnv(home), cwd: '/' })

describe('collab-bridge status', () => {
  test('none, up and stale from relay.json', () => {
    const paths = nuance()
    const none = nuanceStatus(paths, () => 50_000)
    expect(none).toEqual({ relay: 'none', stale_since_mono: null, last_ping_age_s: null, pipes: 0, refused: [] })
    expect(renderNuanceStatus(none, 50_000)).toEqual(['relay: none', 'last PING: none', 'pipes attached: 0'])

    writeRelayJson(paths, { pid: process.pid, started_mono: 1_000, last_ping_mono: 30_000, streams: 1 })
    const up = nuanceStatus(paths, () => 35_000)
    expect(up).toEqual({ relay: 'up', stale_since_mono: null, last_ping_age_s: 5, pipes: 0, refused: [] })
    expect(renderNuanceStatus(up, 35_000)).toEqual(['relay: up', 'last PING: 5 s ago', 'pipes attached: 0'])
    expect(nuanceStatus(paths, () => 50_000).relay).toBe('up')   // exactly 20 s is not yet stale (§5.3: more than 20 s)

    const stale = nuanceStatus(paths, () => 80_000)
    expect(stale).toEqual({ relay: 'stale', stale_since_mono: 50_000, last_ping_age_s: 50, pipes: 0, refused: [] })
    expect(renderNuanceStatus(stale, 80_000)).toEqual(['relay: stale since 30s', 'last PING: 50 s ago', 'pipes attached: 0'])

    writeRelayJson(paths, { pid: process.pid, started_mono: 1_000, last_ping_mono: null, streams: 0 })
    expect(nuanceStatus(paths, () => 6_000)).toEqual({ relay: 'up', stale_since_mono: null, last_ping_age_s: null, pipes: 0, refused: [] })
    expect(nuanceStatus(paths, () => 21_001)).toMatchObject({ relay: 'stale', stale_since_mono: 21_000 })

    writeRelayJson(paths, { pid: deadPid(), started_mono: 1_000, last_ping_mono: 30_000, streams: 1 })
    expect(nuanceStatus(paths, () => 35_000).relay).toBe('none')
  })

  test('a relay.json written under an earlier boot, whose clock ran ahead of this one, is not a live relay (Task 63 relay-2-3)', () => {
    const paths = nuance()
    // A power loss or SIGKILL leaves relay.json (only finish() removes it). CLOCK_MONOTONIC restarts near 0 at boot, so the
    // old readings are ahead of `now`; if any process has the recorded pid, now - heard is negative and used to read as up.
    writeRelayJson(paths, { pid: process.pid, started_mono: 260_000_000, last_ping_mono: 260_000_000, streams: 1 })
    expect(nuanceStatus(paths, () => 5_000)).toEqual({ relay: 'none', stale_since_mono: null, last_ping_age_s: null, pipes: 0, refused: [] })
    expect(renderNuanceStatus(nuanceStatus(paths, () => 5_000), 5_000)).toEqual(['relay: none', 'last PING: none', 'pipes attached: 0'])
    writeRelayJson(paths, { pid: process.pid, started_mono: 260_000_000, last_ping_mono: null, streams: 0 })
    expect(nuanceStatus(paths, () => 5_000).relay).toBe('none')
    // Either reading ahead of now is enough, though a real relay's PING can never be ahead of its start.
    writeRelayJson(paths, { pid: process.pid, started_mono: 1_000, last_ping_mono: 260_000_000, streams: 0 })
    expect(nuanceStatus(paths, () => 5_000).relay).toBe('none')
    // A reading that is exactly now is a live relay's: both clocks are the same system-wide CLOCK_MONOTONIC.
    writeRelayJson(paths, { pid: process.pid, started_mono: 5_000, last_ping_mono: 5_000, streams: 0 })
    expect(nuanceStatus(paths, () => 5_000)).toMatchObject({ relay: 'up', last_ping_age_s: 0 })
  })

  test('a PING the relay records between the CLI reading the clock and reading relay.json does not make a live relay `none` (Task 63 new-status-skew)', () => {
    const paths = nuance()
    writeRelayJson(paths, { pid: process.pid, started_mono: 1_000, last_ping_mono: 30_000, streams: 1 })
    // The clock reads 35_000; the CLI is then held up (preempted), and the live relay writes the PING that arrived at 35_001
    // before the file is read. The mono() below does that right after it answers, which is the moment the old order read the file.
    const mono = (): number => {
      writeRelayJson(paths, { pid: process.pid, started_mono: 1_000, last_ping_mono: 35_001, streams: 1 })
      return 35_000
    }
    expect(nuanceStatus(paths, mono)).toMatchObject({ relay: 'up' })
    // Read in that order the file can only be older than the clock, so no skew has to be allowed: a reading ahead of now is still none.
    writeRelayJson(paths, { pid: process.pid, started_mono: 1_000, last_ping_mono: 35_001, streams: 1 })
    expect(nuanceStatus(paths, () => 35_000).relay).toBe('none')
  })

  test('counts ready pipes and lists refused codes', () => {
    const paths = nuance()
    writePipeRecord(paths, rec(4100, process.pid))
    writePipeRecord(paths, rec(4101, process.pid))
    writePipeRecord(paths, rec(4102, process.pid, { state: 'connecting', refused: 'seat_proof_failed' }))
    writePipeRecord(paths, rec(4103, process.pid, { state: 'stopped', lineage: null, refused: 'seat_session_ended' }))
    writePipeRecord(paths, rec(4104, process.pid, { state: 'detached', refused: 'seat_proof_failed' }))
    writePipeRecord(paths, rec(4105, deadPid(), { refused: 'lineage_cap' }))
    const s = nuanceStatus(paths, () => 1)
    expect(s.pipes).toBe(2)
    expect(s.refused).toEqual(['seat_proof_failed', 'seat_session_ended'])
    expect(renderNuanceStatus(s, 1)).toEqual(['relay: none', 'last PING: none', 'pipes attached: 2', 'refused: seat_proof_failed, seat_session_ended'])
  })

  test('collab-bridge status prints its three lines and exits 0', () => {
    const home = temp('cb-status-main-')
    const p = runMain(['status'], home)
    expect(p.stderr.toString()).toBe('')
    expect(p.exitCode).toBe(0)
    expect(p.stdout.toString()).toBe('relay: none\nlast PING: none\npipes attached: 0\n')
  })

  test('an unknown verb exits 2 with the usage line', () => {
    const home = temp('cb-status-main-')
    const p = runMain(['bogus'], home)
    expect(p.exitCode).toBe(2)
    expect(p.stdout.toString()).toBe('')
    expect(p.stderr.toString()).toStartWith('usage: collab-bridge ')
    expect(p.stderr.toString().split('\n')).toHaveLength(2)
    expect(runMain(['status', 'extra'], home).exitCode).toBe(2)
  })
})

describe('pipe records', () => {
  test('a pipe record round-trips and is 0600', () => {
    const paths = nuance()
    const r = rec(4100, process.pid)
    writePipeRecord(paths, r)
    expect(readPipeRecords(paths)).toEqual([r])
    expect(modeOf(paths.pipeJson(4100, process.pid))).toBe(0o600)
    expect(modeOf(paths.pipes)).toBe(0o700)
    expect(readdirSync(paths.pipes)).toEqual([`4100-${process.pid}.json`])
    expect(pipeRecordName(4100, 77)).toBe('4100-77')
    expect(() => writePipeRecord(paths, rec(4100, process.pid, { state: 'Ready now' }))).toThrow()
  })

  test('a record whose name and pids disagree, or whose pipe is dead, is skipped', () => {
    const paths = nuance()
    writePipeRecord(paths, rec(4100, process.pid))
    writeFileSync(join(paths.pipes, `4200-${process.pid}.json`), JSON.stringify(rec(4201, process.pid)))
    writeFileSync(join(paths.pipes, '4300-1.json'), JSON.stringify(rec(4300, 2)))
    const dead = deadPid()
    writePipeRecord(paths, rec(4400, dead))
    writeFileSync(join(paths.pipes, `4500-${process.pid}.json`), '{"v":1,')
    writeFileSync(join(paths.pipes, `4600-${process.pid}.json`), JSON.stringify({ ...rec(4600, process.pid), lineage: 'lin_short' }))
    writeFileSync(join(paths.pipes, `4700-${process.pid}.sock.json.tmp`), JSON.stringify(rec(4700, process.pid)))
    expect(readPipeRecords(paths).map((r) => r.host_pid)).toEqual([4100])
    expect(readPipeRecords(paths, () => true).map((r) => r.host_pid)).toEqual([4100, 4400])
    expect(existsSync(paths.pipeJson(4400, dead))).toBe(true)   // skipped, never deleted here (a starting pipe sweeps its own host's)
  })

  test('no pipes dir reads as no records', () => {
    expect(readPipeRecords(nuance())).toEqual([])
  })
})
