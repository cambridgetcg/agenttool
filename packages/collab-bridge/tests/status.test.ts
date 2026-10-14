import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import {
  activeSticky, mergeSticky, readDeviceStatus, readHostKeyAck, readHubStatus, statusLines, uncleanRunsWithin, writeDeviceStatus,
  writeHostKeyAck, writeHubStatus, type DeviceStatus, type HubRun, type HubStatus, type StickyWarning,
} from '../src/air/status.ts'
import { airPaths } from '../src/paths.ts'
import { cleanupTmps, modeOf, temp } from './helpers.ts'

afterEach(cleanupTmps)

const T = '2026-10-13T11:50:00.000Z'
const FP = 'SHA256:C/JQOifBld6TAkrNhJn6UfvfParPv6E5xha7zm1I9/A'
const LIN = `lin_${'0'.repeat(32)}`
const dev = (over: Partial<DeviceStatus> = {}): DeviceStatus => ({
  device: 'nuance', word: 'up', reason: null, since: T, hint: null, relay_contested: false, sticky: [], refused_tools: null, skew_s: null, ...over,
})
const hub = (over: Partial<HubStatus> = {}): HubStatus => ({
  word: 'running', code: null, detail: null, at: T, build: '1c3659c5', unexpected_exits: [], runs: [], seats: [], ...over,
})
const warning = (at: string, fingerprint: string | null = FP): StickyWarning => ({ kind: 'host_key_mismatch', at, fingerprint })
const deviceLines = (s: DeviceStatus) => statusLines(hub(), [s]).slice(1)

describe('status lines', () => {
  test('every §9.2 status word renders as written', () => {
    const rows: Array<[Partial<DeviceStatus>, string[]]> = [
      [{ word: 'up' }, ['nuance: up']],
      [{ word: 'connecting' }, ['nuance: connecting']],
      [{ word: 'connecting', hint: 'no preamble; check ~/.zshenv' }, ['nuance: connecting (no preamble; check ~/.zshenv)']],
      [{ word: 'away', since: T }, [`nuance: away since ${T}`]],
      [{ word: 'host_key_mismatch', since: T }, [`nuance: host_key_mismatch (retrying since ${T})`]],
      [{ word: 'needs_yu', reason: 'auth_refused' }, ['nuance: needs Yu: auth_refused']],
      [{ word: 'needs_yu', reason: 'host_key_mismatch' }, ['nuance: needs Yu: host_key_mismatch']],
      [{ word: 'needs_yu', reason: 'config' }, ['nuance: needs Yu: config']],
      [{ word: 'needs_yu', reason: 'login_shell_noise' }, ['nuance: needs Yu: login_shell_noise']],
      [{ word: 'needs_yu', reason: 'login_shell_noise', hint: 'noise before the preamble; check ~/.zshenv' },
        ['nuance: needs Yu: login_shell_noise (noise before the preamble; check ~/.zshenv)']],
      [{ word: 'unpaired' }, ['nuance: unpaired']],
      [{ word: 'up', relay_contested: true }, ['nuance: up', 'nuance: relay_contested']],
      [{ word: 'up', sticky: [warning(T)] }, ['nuance: up', `nuance: host key mismatch seen at ${T}, presented ${FP}`]],
      [{ word: 'up', sticky: [warning(T, null)] }, ['nuance: up', `nuance: host key mismatch seen at ${T}, presented unknown`]],
    ]
    for (const [over, want] of rows) expect([over, deviceLines(dev(over))]).toEqual([over, want])
    const notes = [
      { lineage: LIN, device: 'nuance', user: 'macair', session_id: 'session_1', note: 'needs Ai: seat_recovery session_1' },
      { lineage: LIN, device: 'nuance', user: 'macair', session_id: 'session_2', note: 'orphan_session session_2' },
      { lineage: LIN, device: 'nuance', user: 'macair', session_id: null, note: 'journal_invalid' },
      { lineage: LIN, device: 'nuance', user: 'macair', session_id: null, note: 'child_start_failed' },
    ]
    expect(statusLines(hub({ seats: notes }), [])).toEqual([
      'hub: running',
      `nuance/macair ${LIN}: needs Ai: seat_recovery session_1`,
      `nuance/macair ${LIN}: orphan_session session_2`,
      `nuance/macair ${LIN}: journal_invalid`,
      `nuance/macair ${LIN}: child_start_failed`,
    ])
    const hubRows: Array<[HubStatus | null, string]> = [
      [null, 'hub: not running'],
      [hub({ word: 'stopped' }), 'hub: stopped'],
      [hub({ word: 'refused', code: 'collab_build_mismatch' }), 'hub: collab_build_mismatch'],
      [hub({ word: 'refused', code: 'policy_unclassified_tool', detail: 'collab_new_tool' }), 'hub: policy_unclassified_tool (collab_new_tool)'],
      [hub({ word: 'refused', code: 'needs Yu: config', detail: 'lineages.json is damaged' }), 'hub: needs Yu: config (lineages.json is damaged)'],
      [hub({ word: 'refused', code: 'lock_held' }), 'hub: lock_held'],
      [hub({ word: 'running', code: 'collab_build_changed' }), 'hub: collab_build_changed'],
    ]
    for (const [h, want] of hubRows) expect(statusLines(h, [])).toEqual([want])
  })

  test('a 61 s skew warns in hub status and 59 s does not', () => {
    expect(deviceLines(dev({ skew_s: 61 }))).toEqual(['nuance: up', 'nuance: clock skew 61 s (warn)'])
    expect(deviceLines(dev({ skew_s: -61 }))).toEqual(['nuance: up', 'nuance: clock skew -61 s (warn)'])
    for (const ok of [59, 60, -60, 0]) expect([ok, deviceLines(dev({ skew_s: ok }))]).toEqual([ok, ['nuance: up']])
  })

  test('a refused hub tool list shows in hub status', () => {
    const refused = `${LIN}: 0123abcd digest_mismatch`
    expect(deviceLines(dev({ refused_tools: refused }))).toEqual(['nuance: up', `nuance: hub tool list refused: ${refused}`])
  })
})

describe('status files', () => {
  test('device and hub status round-trip, 0600 in 0700 dirs, and a damaged file reads as none', () => {
    const paths = airPaths(temp('cb-status-'))
    expect(readDeviceStatus(paths, 'nuance')).toBeNull()
    expect(readHubStatus(paths)).toBeNull()
    const d = dev({ word: 'away', reason: 'timeout', skew_s: 3 })
    writeDeviceStatus(paths, d)
    expect(readDeviceStatus(paths, 'nuance')).toEqual(d)
    const h = hub({ seats: [{ lineage: LIN, device: 'nuance', user: 'macair', session_id: null, note: 'journal_invalid' }] })
    writeHubStatus(paths, h)
    expect(readHubStatus(paths)).toEqual(h)
    expect([modeOf(paths.deviceStatus('nuance')), modeOf(paths.deviceStatusDir), modeOf(paths.stateDir), modeOf(paths.hubStatus)])
      .toEqual([0o600, 0o700, 0o700, 0o600])
    expect(() => writeDeviceStatus(paths, { ...d, word: 'sleeping' as never })).toThrow('status: refusing to write an invalid device status')
    writeFileSync(paths.deviceStatus('nuance'), '{"device":"nuance"')
    writeFileSync(paths.hubStatus, 'garbage')
    expect(readDeviceStatus(paths, 'nuance')).toBeNull()
    expect(readHubStatus(paths)).toBeNull()
    // A status file for another device is not this one's.
    writeDeviceStatus(paths, dev({ device: 'zerone' }))
    mkdirSync(paths.deviceStatusDir, { recursive: true })
    writeFileSync(paths.deviceStatus('nuance'), JSON.stringify(dev({ device: 'zerone' })))
    expect(readDeviceStatus(paths, 'nuance')).toBeNull()
  })

  test('a sticky warning stays across writes until an ack at or after its time', () => {
    const paths = airPaths(temp('cb-status-'))
    const w = warning('2026-10-13T10:00:00.000Z')
    writeDeviceStatus(paths, dev({ word: 'host_key_mismatch', sticky: [w] }))
    writeDeviceStatus(paths, dev({ word: 'up', sticky: [] })) // a later write that does not carry it
    expect(readDeviceStatus(paths, 'nuance')!.sticky).toEqual([w])
    writeHostKeyAck(paths, 'nuance', '2026-10-13T09:59:59.000Z') // before the warning: it stays
    writeDeviceStatus(paths, dev())
    expect(readDeviceStatus(paths, 'nuance')!.sticky).toEqual([w])
    writeHostKeyAck(paths, 'nuance', '2026-10-13T10:00:00.000Z') // at its time: it goes
    expect(readHostKeyAck(paths, 'nuance')).toBe('2026-10-13T10:00:00.000Z')
    expect(modeOf(paths.hostKeyAck('nuance'))).toBe(0o600)
    writeDeviceStatus(paths, dev({ sticky: [w] })) // a writer still holding the old warning cannot bring it back
    expect(readDeviceStatus(paths, 'nuance')!.sticky).toEqual([])
    const later = warning('2026-10-13T11:00:00.000Z') // a mismatch after the ack shows again
    writeDeviceStatus(paths, dev({ sticky: [later] }))
    expect(readDeviceStatus(paths, 'nuance')!.sticky).toEqual([later])
    expect(activeSticky([w, later], '2026-10-13T10:30:00.000Z')).toEqual([later])
    expect(activeSticky([w, later], null)).toEqual([w, later])
    expect(() => writeHostKeyAck(paths, 'nuance', 'yesterday')).toThrow('status: an ack time must be an ISO time')
    writeFileSync(paths.hostKeyAck('nuance'), 'garbage\n')
    expect(readHostKeyAck(paths, 'nuance')).toBeNull()
  })

  test('sticky warnings keep one entry per presented key, its latest time', () => {
    const a1 = warning('2026-10-13T10:00:00.000Z', FP)
    const a2 = warning('2026-10-13T10:05:00.000Z', FP)
    const b = warning('2026-10-13T10:01:00.000Z', `SHA256:${'B'.repeat(43)}`)
    expect(mergeSticky([a1], [b, a2])).toEqual([b, a2])
    expect(mergeSticky([a2], [a1])).toEqual([a2])
    const many = Array.from({ length: 12 }, (_, i) => warning(new Date(Date.parse(T) + i * 1000).toISOString(), `SHA256:${String(i).padStart(43, 'x')}`))
    expect(mergeSticky([], many)).toEqual(many.slice(-8))
  })

  test('the hub status records unexpected exits and counts unclean runs in a window', () => {
    const paths = airPaths(temp('cb-status-'))
    const now = Date.parse('2026-10-13T12:00:00.000Z')
    const ago = (ms: number) => new Date(now - ms).toISOString()
    const runs: HubRun[] = [
      ...Array.from({ length: 18 }, (_, i) => ({ started_at: ago(86_400_000 - i * 1000), ended_at: ago(86_000_000 - i * 1000), clean: true })),
      { started_at: ago(660_000), ended_at: null, clean: false }, // 11 minutes ago: outside the window
      { started_at: ago(500_000), ended_at: ago(499_000), clean: true },
      { started_at: ago(400_000), ended_at: null, clean: false }, // a crash never records its end
      { started_at: ago(300_000), ended_at: ago(299_000), clean: false }, // an unexpected throw
      { started_at: ago(200_000), ended_at: null, clean: false },
      { started_at: ago(100_000), ended_at: null, clean: false },
      { started_at: ago(50_000), ended_at: null, clean: false },
    ]
    const exits = [ago(299_000), ago(10_000)]
    writeHubStatus(paths, hub({ unexpected_exits: exits, runs }))
    const read = readHubStatus(paths)!
    expect(read.unexpected_exits).toEqual(exits)
    expect(read.runs).toEqual(runs.slice(-20)) // the last 20 runs (P58)
    expect(uncleanRunsWithin(read.runs, now, 600_000)).toBe(5)
    expect(uncleanRunsWithin(read.runs, now, 120_000)).toBe(2)
    expect(uncleanRunsWithin([], now, 600_000)).toBe(0)
  })
})
