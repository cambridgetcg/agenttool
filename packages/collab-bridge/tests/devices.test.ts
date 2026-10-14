import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_CAPS } from '../src/air/diff-check.ts'
import { listDevices, parseDevice, readDevice, shareForFolder, updateDevice, writeDevice, type DeviceFile } from '../src/air/devices.ts'
import { airPaths } from '../src/paths.ts'
import { cleanupTmps, modeOf, PKG, temp, testEnv } from './helpers.ts'

afterEach(cleanupTmps)

const TRAILER = 'Co-Authored-By: The Fable of the Eternal Universe <Yu@Ai-love.cc>'
/** What prepare-pairing writes (Task 60): the Nuance side is not known yet. */
const PREPARED: DeviceFile = {
  v: 1, device: 'nuance', user: 'macair', state: 'prepared', host_alias: 'collab-nuance', seat_public: null,
  bundle_build: '5c09726b', key_expiry: '20270111', trailer: TRAILER, git: null, summon: null,
  shares: [{
    remote_realpath: '/Users/macair/Projects/collab-trial', remote_gitdir: null, air_clone: '/Users/yuai/Projects/collab-trial',
    mirror_id: '0123456789abcdef', mirror_worktree_id: null, workspace_id: null, caps: DEFAULT_CAPS,
  }],
  prepared_at: '2026-10-13T14:00:00.000Z', paired_at: null,
}
/** What pin-device makes of it from hello (Task 61). */
const PAIRED: DeviceFile = {
  ...PREPARED, state: 'paired', seat_public: 'ab'.repeat(32),
  git: { path: '/Library/Developer/CommandLineTools/usr/bin/git', version: '2.39.5', sha256: 'cd'.repeat(32), guard: true, apple: true },
  summon: { key_sha256: 'ef'.repeat(32), dropin_stat: '1234 270 1760300000000 0 600' },
  shares: [{ ...PREPARED.shares[0]!, remote_gitdir: '/Users/macair/Projects/collab-trial/.git', workspace_id: `ws_${'a'.repeat(24)}` }],
  paired_at: '2026-10-13T15:00:00.000Z',
}
const text = (d: unknown) => JSON.stringify(d, null, 2) + '\n'

describe('the device file', () => {
  test('a device file round-trips and is 0600', () => {
    const paths = airPaths(temp('cb-dev-'))
    const file = paths.deviceFile('nuance')
    writeDevice(file, PAIRED)
    expect(readDevice(file)).toEqual(PAIRED)
    expect(modeOf(file)).toBe(0o600)
    expect(modeOf(paths.devicesDir)).toBe(0o700)
    expect(modeOf(paths.configDir)).toBe(0o700)
    writeDevice(file, PREPARED)
    expect(readDevice(file)).toEqual(PREPARED)
    expect(readDevice(join(paths.devicesDir, 'absent.json'))).toBeNull()
  })

  test('a device file with a bad field is refused', () => {
    const share = PAIRED.shares[0]!
    const bad: Array<[string, unknown]> = [
      ['v 2', { ...PAIRED, v: 2 }],
      ['an uppercase device', { ...PAIRED, device: 'Nuance', host_alias: 'collab-Nuance' }],
      ['a user with a space', { ...PAIRED, user: 'mac air' }],
      ['an alias that is not collab-<device>', { ...PAIRED, host_alias: 'summon-nuance' }],
      ['an unknown state', { ...PAIRED, state: 'paused' }],
      ['an uppercase seat key', { ...PAIRED, seat_public: 'AB'.repeat(32) }],
      ['a short seat key', { ...PAIRED, seat_public: 'ab'.repeat(31) }],
      ['a 9-hex build', { ...PAIRED, bundle_build: '5c09726b0' }],
      ['an expiry with dashes', { ...PAIRED, key_expiry: '2027-01-11' }],
      ['a trailer with a quote', { ...PAIRED, trailer: "it's" }],
      ['an empty trailer', { ...PAIRED, trailer: '' }],
      ['a relative git path', { ...PAIRED, git: { ...PAIRED.git!, path: 'git' } }],
      ['a git without its guard flag', { ...PAIRED, git: { path: '/usr/local/bin/git', version: '2.52.0', sha256: 'cd'.repeat(32), apple: false } }],
      ['a summon stat that is not five numbers', { ...PAIRED, summon: { ...PAIRED.summon!, dropin_stat: 'root wheel' } }],
      ['no shares', { ...PAIRED, shares: [] }],
      ['a relative share', { ...PAIRED, shares: [{ ...share, remote_realpath: 'Projects/collab-trial' }] }],
      ['a share with a !', { ...PAIRED, shares: [{ ...share, remote_realpath: '/Users/macair/Projects/hey!' }] }],
      ['a share over 1019 bytes', { ...PAIRED, shares: [{ ...share, remote_realpath: '/' + 'a'.repeat(1019) }] }],
      ['a share not written normalised', { ...PAIRED, shares: [{ ...share, remote_realpath: '/Users/macair/Projects/./collab-trial' }] }],
      ['a 15-hex mirror id', { ...PAIRED, shares: [{ ...share, mirror_id: '0123456789abcde' }] }],
      ['a worktree id that is not Collab\'s', { ...PAIRED, shares: [{ ...share, mirror_worktree_id: 'worktree-1' }] }],
      ['a workspace id that is not Collab\'s', { ...PAIRED, shares: [{ ...share, workspace_id: 'ws_short' }] }],
      ['zero caps', { ...PAIRED, shares: [{ ...share, caps: { ...DEFAULT_CAPS, maxEntries: 0 } }] }],
      ['two shares with one mirror id', { ...PAIRED, shares: [share, { ...share, remote_realpath: '/Users/macair/Projects/other' }] }],
      ['an extra key', { ...PAIRED, note: 'hello' }],
      ['a missing key', (({ trailer: _t, ...rest }) => rest)(PAIRED)],
      ['an extra share key', { ...PAIRED, shares: [{ ...share, extra: 1 }] }],
      ['a paired_at that is not ISO', { ...PAIRED, paired_at: '20261013150000' }],
    ]
    for (const [why, d] of bad) expect([why, parseDevice(text(d))]).toEqual([why, null])
    expect(parseDevice('not json')).toBeNull()
    expect(parseDevice('[]')).toBeNull()
    expect(parseDevice(text(PAIRED))).toEqual(PAIRED)
  })

  test('a prepared device file may have a null remote_gitdir, a paired one may not', () => {
    expect(parseDevice(text(PREPARED))).toEqual(PREPARED)
    expect(parseDevice(text({ ...PREPARED, state: 'paired' }))).toBeNull()
    for (const missing of ['seat_public', 'git', 'summon', 'paired_at'] as const) {
      expect([missing, parseDevice(text({ ...PAIRED, [missing]: null }))]).toEqual([missing, null])
    }
    expect(parseDevice(text({ ...PAIRED, shares: [{ ...PAIRED.shares[0]!, remote_gitdir: null }] }))).toBeNull()
    // Unpair drops the seat key (Task 54): an unpaired file keeps the rest and needs none of it.
    expect(parseDevice(text({ ...PAIRED, state: 'unpaired', seat_public: null }))).toMatchObject({ state: 'unpaired', seat_public: null })
  })

  test('writeDevice refuses an invalid device file and writes nothing', () => {
    const paths = airPaths(temp('cb-dev-'))
    const file = paths.deviceFile('nuance')
    expect(() => writeDevice(file, { ...PAIRED, seat_public: null })).toThrow('devices: refusing to write an invalid device file')
    expect(existsSync(file)).toBe(false)
  })

  test('updateDevice re-reads the file, so an unpair written by another process is kept', () => {
    const home = temp('cb-dev-')
    const file = airPaths(home).deviceFile('nuance')
    writeDevice(file, PAIRED)
    const stale = readDevice(file)! // the hub's copy, read before the unpair
    const script = [
      `import { readDevice, writeDevice } from ${JSON.stringify(`${PKG}/src/air/devices.ts`)}`,
      `const f = ${JSON.stringify(file)}`,
      `writeDevice(f, { ...readDevice(f), state: 'unpaired', seat_public: null })`,
    ].join('\n')
    const r = Bun.spawnSync([process.execPath, '--no-env-file', '--config=/dev/null', '-e', script], { env: testEnv(home), cwd: '/', stderr: 'pipe' })
    expect([r.exitCode, r.stderr.toString()]).toEqual([0, ''])
    // The hub records a worktree id only while the device is still paired (Task 51).
    const WT = `wt_${'1'.repeat(24)}`
    const record = (d: DeviceFile) => (d.state === 'paired' ? { ...d, shares: d.shares.map((s) => ({ ...s, mirror_worktree_id: WT })) } : null)
    expect(stale.state).toBe('paired')
    expect(updateDevice(file, record)).toBeNull()
    expect(readDevice(file)).toEqual({ ...PAIRED, state: 'unpaired', seat_public: null })
    expect(existsSync(`${file}.lock`)).toBe(false)
    // While it is paired, the same update is written.
    writeDevice(file, PAIRED)
    expect(updateDevice(file, record)!.shares[0]!.mirror_worktree_id).toBe(WT)
    expect(readDevice(file)!.shares[0]!.mirror_worktree_id).toBe(WT)
  })

  test('updateDevice writes nothing for a missing file and throws on a damaged one', () => {
    const paths = airPaths(temp('cb-dev-'))
    const file = paths.deviceFile('nuance')
    let called = false
    expect(updateDevice(file, (d) => { called = true; return d })).toBeNull()
    expect(called).toBe(false)
    expect(existsSync(file)).toBe(false)
    mkdirSync(paths.devicesDir, { recursive: true, mode: 0o700 })
    writeFileSync(file, '{"v":1', { mode: 0o600 })
    expect(() => updateDevice(file, (d) => d)).toThrow('devices: nuance.json is damaged')
    expect(readFileSync(file, 'utf8')).toBe('{"v":1')
  })

  test('listDevices reads every device file and throws on a damaged one', () => {
    const paths = airPaths(temp('cb-dev-'))
    expect(listDevices(paths.devicesDir)).toEqual([])
    writeDevice(paths.deviceFile('nuance'), PAIRED)
    const zerone = { ...PREPARED, device: 'zerone', host_alias: 'collab-zerone' }
    writeDevice(paths.deviceFile('zerone'), zerone)
    writeFileSync(join(paths.devicesDir, 'nuance.json.lock'), '')
    writeFileSync(join(paths.devicesDir, '.nuance.json.123.abc.tmp'), 'partial')
    expect(listDevices(paths.devicesDir)).toEqual([PAIRED, zerone])
    // A file whose device is not its name is damaged too: the hub would dial the wrong entry.
    writeFileSync(join(paths.devicesDir, 'other.json'), text(PAIRED))
    expect(() => listDevices(paths.devicesDir)).toThrow('devices: other.json is damaged (needs Yu: config)')
    writeFileSync(join(paths.devicesDir, 'other.json'), 'garbage')
    expect(() => listDevices(paths.devicesDir)).toThrow('devices: other.json is damaged (needs Yu: config)')
  })

  test('shareForFolder matches the realpath only', () => {
    expect(shareForFolder(PAIRED, '/Users/macair/Projects/collab-trial')).toEqual(PAIRED.shares[0]!)
    for (const near of ['/Users/macair/Projects/collab-trial/', '/Users/macair/Projects/collab-trial/notes', '/Users/macair/projects/collab-trial', '~/Projects/collab-trial', '/Users/macair/Projects/collab-trial/.git']) {
      expect([near, shareForFolder(PAIRED, near)]).toEqual([near, null])
    }
  })
})
