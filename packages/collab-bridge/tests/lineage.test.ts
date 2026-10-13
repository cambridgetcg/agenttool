import { afterEach, describe, expect, test } from 'bun:test'
import { chmodSync, existsSync, mkdirSync, readdirSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanupTmps, modeOf, PS_STUB_HOST, temp, writePsStub } from './helpers.ts'
import { nuancePaths } from '../src/paths.ts'
import { lineageKey, readPs, type ProcTable } from '../src/proc.ts'
import { findHost, interactiveCheck, openLineage, readLineageFile, sweepLineages, type HostInfo } from '../src/nuance/lineage.ts'

afterEach(cleanupTmps)

const NOW = () => new Date('2026-10-13T12:00:00.000Z')
const NOW_MS = Date.parse('2026-10-13T12:00:00.000Z')
const DAY = 86_400_000
const HOST: HostInfo = { pid: 4100, lstart: 'Wed Oct 7 16:22:59 2026', comm: 'claude' }

function table(...rows: Array<[number, number, string, string]>): ProcTable {
  return new Map(rows.map(([pid, ppid, started_at, comm]) => [pid, { pid, ppid, started_at, comm }]))
}

function aged(path: string, ms: number): void {
  const t = (NOW_MS - ms) / 1000
  utimesSync(path, t, t)
}

describe('lineage files', () => {
  test('a respawn under the same claude process reuses the lineage', () => {
    const paths = nuancePaths(temp('cb-lin-'))
    const stubs = temp('cb-ps-')
    // The P43 stub chains this test process to a fake claude at pid 4100, with ps's two-space lstart.
    const host = findHost(process.pid, readPs(writePsStub(stubs))!)!
    expect(host).toEqual({ pid: PS_STUB_HOST.pid, lstart: 'Wed Oct 7 16:22:59 2026', comm: 'claude' })
    const first = openLineage(paths, host, NOW)
    expect(first.key).toBe(lineageKey(4100, 'Wed Oct 7 16:22:59 2026'))
    expect(first.file).toEqual({ v: 1, lineage: first.file.lineage, host_pid: 4100, host_lstart: 'Wed Oct 7 16:22:59 2026',
      created_at: '2026-10-13T12:00:00.000Z', inflight: [] })
    expect(first.file.lineage).toMatch(/^lin_[0-9a-f]{32}$/)
    // A /mcp reconnect: a new pipe process under the same Claude reads the same table again, a day later.
    const again = openLineage(paths, findHost(process.pid, readPs(join(stubs, 'ps'))!)!, () => new Date('2026-10-14T12:00:00.000Z'))
    expect(again).toEqual(first)
    expect(readLineageFile(paths, first.key)).toEqual(first.file)
  }, 10_000)

  test('a new claude process gets a new lineage', () => {
    const paths = nuancePaths(temp('cb-lin-'))
    const a = openLineage(paths, HOST, NOW)
    const b = openLineage(paths, { ...HOST, lstart: 'Wed Oct 7 16:23:00 2026' }, NOW) // the same pid, reused by a later claude
    const c = openLineage(paths, { ...HOST, pid: 4101 }, NOW)
    expect(new Set([a.key, b.key, c.key]).size).toBe(3)
    expect(new Set([a.file.lineage, b.file.lineage, c.file.lineage]).size).toBe(3)
  })

  test('lineage files are 0600 in a 0700 dir', () => {
    const paths = nuancePaths(temp('cb-lin-'))
    mkdirSync(paths.lineages, { recursive: true, mode: 0o755 })
    chmodSync(paths.state, 0o755)
    chmodSync(paths.lineages, 0o755)
    const { key } = openLineage(paths, HOST, NOW)
    expect(modeOf(paths.state)).toBe(0o700)
    expect(modeOf(paths.lineages)).toBe(0o700)
    expect(modeOf(paths.lineageFile(key))).toBe(0o600)
    expect(readdirSync(paths.lineages)).toEqual([`${key}.json`]) // no temp file and no lock left behind
  })

  test('a damaged lineage file is replaced by a new lineage', () => {
    const paths = nuancePaths(temp('cb-lin-'))
    const { key, file } = openLineage(paths, HOST, NOW)
    writeFileSync(paths.lineageFile(key), '{"v":1,"lineage":')
    const next = openLineage(paths, HOST, NOW)
    expect(next.key).toBe(key)
    expect(next.file.lineage).not.toBe(file.lineage)
    expect(readLineageFile(paths, key)).toEqual(next.file)
  })

  test('the sweep removes only files whose host is gone and older than 7 days', () => {
    const paths = nuancePaths(temp('cb-lin-'))
    const live = openLineage(paths, HOST, NOW)
    const goneOld = openLineage(paths, { pid: 4200, lstart: 'Mon Oct 5 09:00:00 2026', comm: 'claude' }, NOW)
    const goneNew = openLineage(paths, { pid: 4300, lstart: 'Tue Oct 13 11:00:00 2026', comm: 'claude' }, NOW)
    const reused = openLineage(paths, { pid: 4100, lstart: 'Thu Oct 1 08:00:00 2026', comm: 'claude' }, NOW) // pid 4100 now runs a later claude
    writeFileSync(join(paths.lineages, 'notes.txt'), 'not a lineage')
    aged(paths.lineageFile(live.key), 8 * DAY)
    aged(paths.lineageFile(goneOld.key), 8 * DAY)
    aged(paths.lineageFile(goneNew.key), 1 * DAY)
    aged(paths.lineageFile(reused.key), 8 * DAY)
    aged(join(paths.lineages, 'notes.txt'), 30 * DAY)
    const running = table([4100, 1, 'Wed Oct 7 16:22:59 2026', 'claude'], [4300, 1, 'Sun Oct 4 10:00:00 2026', 'claude'])
    expect(sweepLineages(paths, running, NOW_MS)).toBe(2)
    expect(existsSync(paths.lineageFile(live.key))).toBe(true)
    expect(existsSync(paths.lineageFile(goneOld.key))).toBe(false)
    expect(existsSync(paths.lineageFile(goneNew.key))).toBe(true)
    expect(existsSync(paths.lineageFile(reused.key))).toBe(false)
    expect(existsSync(join(paths.lineages, 'notes.txt'))).toBe(true)
    // A shorter age is honoured; the caller's own host still keeps its file.
    expect(sweepLineages(paths, running, NOW_MS, DAY / 2)).toBe(1)
    expect(readdirSync(paths.lineages).sort()).toEqual([`${live.key}.json`, 'notes.txt'].sort())
  })

  test('a missing lineages dir sweeps nothing', () => {
    const paths = nuancePaths(temp('cb-lin-'))
    expect(sweepLineages(paths, table(), NOW_MS)).toBe(0)
  })
})

describe('interactive check', () => {
  const tty = () => 'ttys001'

  test('sdk-cli and sdk-ts are refused', () => {
    for (const ep of ['sdk-cli', 'sdk-ts', 'sdk-py']) {
      expect(interactiveCheck({ CLAUDE_CODE_ENTRYPOINT: ep }, HOST, tty)).toEqual({ ok: false, reason: 'sdk_entrypoint' })
    }
  })

  test('no claude ancestor is refused', () => {
    const shellOnly = table([process.pid, 900, 'Tue Oct 13 11:33:11 2026', 'collab-bridge'], [900, 1, 'Tue Oct 13 11:00:00 2026', '/bin/zsh'])
    expect(findHost(process.pid, shellOnly)).toBeNull()
    // A comm cut to 16 characters is never taken as claude (K68).
    const truncated = table([process.pid, 900, 'Tue Oct 13 11:33:11 2026', 'collab-bridge'], [900, 1, 'Tue Oct 13 11:00:00 2026', '/Users/macair/.l'])
    expect(findHost(process.pid, truncated)).toBeNull()
    expect(interactiveCheck({ CLAUDE_CODE_ENTRYPOINT: 'cli' }, null, tty)).toEqual({ ok: false, reason: 'no_claude_host' })
  })

  test('a full-path claude comm is the host', () => {
    const t = table([process.pid, 900, 'Tue Oct 13 11:33:11 2026', 'collab-bridge'], [900, 1, 'Tue Oct 13 11:00:00 2026', '/Users/macair/.local/bin/claude'])
    expect(findHost(process.pid, t)).toEqual({ pid: 900, lstart: 'Tue Oct 13 11:00:00 2026', comm: '/Users/macair/.local/bin/claude' })
  })

  test('a missing entrypoint is accepted only with a tty', () => {
    const asked: number[] = []
    expect(interactiveCheck({}, HOST, (pid) => { asked.push(pid); return 'ttys004' })).toEqual({ ok: true, entrypoint: 'unknown' })
    expect(asked).toEqual([4100])
    expect(interactiveCheck({}, HOST, () => null)).toEqual({ ok: false, reason: 'no_tty' })
    expect(interactiveCheck({ CLAUDE_CODE_ENTRYPOINT: '' }, HOST, () => null)).toEqual({ ok: false, reason: 'no_tty' })
    // A present, non-sdk entrypoint needs no tty.
    expect(interactiveCheck({ CLAUDE_CODE_ENTRYPOINT: 'cli' }, HOST, () => null)).toEqual({ ok: true, entrypoint: 'cli' })
  })

  test('an odd entrypoint value is labelled unknown', () => {
    for (const ep of ['claude code', 'x'.repeat(33), 'cli\n', 'é', '$(id)']) {
      expect(interactiveCheck({ CLAUDE_CODE_ENTRYPOINT: ep }, HOST, () => null)).toEqual({ ok: true, entrypoint: 'unknown' })
    }
    expect(interactiveCheck({ CLAUDE_CODE_ENTRYPOINT: 'claude-vscode' }, HOST, () => null)).toEqual({ ok: true, entrypoint: 'claude-vscode' })
  })
})
