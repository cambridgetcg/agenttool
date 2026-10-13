import { afterEach, describe, expect, test } from 'bun:test'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { airPaths, collabDist, homeOf, MAX_SOCKET_PATH_BYTES, nuancePaths, socketPathOk } from '../src/paths.ts'
import { cleanupTmps, COLLAB_DIST, shortSockRoot, temp } from './helpers.ts'

afterEach(cleanupTmps)

/** Sample arguments for a path function by its arity: a segment, a pair of pids, or device/user/mirror id. */
const sampleArgs = (n: number): unknown[] => (n === 1 ? ['probe'] : n === 2 ? [4100, 4200] : n === 3 ? ['nuance', 'macair', '0123456789abcdef'] : [])

/** Every string field, and every function field's result for sample arguments. */
function allPaths(o: object): string[] {
  return Object.values(o).flatMap((v) => (typeof v === 'string' ? [v] : typeof v === 'function' ? [String(v(...sampleArgs(v.length)))] : []))
}

const nuanceEnv = (h: string, extra: Record<string, string> = {}) => ({ HOME: h, COLLAB_BRIDGE_HOME_OVERRIDE: h, COLLAB_BRIDGE_SUMMON_DROPIN: join(h, 'dropin.conf'), ...extra })

describe('paths', () => {
  test('every Air path is absolute and under home', () => {
    const h = temp('cb-paths-')
    const all = allPaths(airPaths(h))
    expect(all.length).toBe(37)
    for (const p of all) expect([p, p === h || p.startsWith(`${h}/`)]).toEqual([p, true])
  })

  test("the Air paths are §4.3's", () => {
    const a = airPaths('/Users/yuai')
    expect({
      mirror: a.mirrorDir('nuance', 'macair', '0123456789abcdef'), credential: a.credentialFile('ses_1'), hubJs: a.hubJs('ab'),
      launcherExe: a.launcherExe, cliLauncher: a.cliLauncher, device: a.deviceFile('nuance'), sshConfig: a.sshConfig,
      sshKey: a.sshKey('nuance'), knownHosts: a.knownHosts, ledger: a.ledger, lineages: a.lineages, status: a.deviceStatus('nuance'),
      ack: a.hostKeyAck('nuance'), unpark: a.unparkRequest('lin_1'), hubStatus: a.hubStatus, lock: a.hubLock, log: a.hubLog,
      plist: a.plist, summon: a.summonKnownHosts, knock: a.knockLedger,
    }).toEqual({
      mirror: '/Users/yuai/.local/share/agenttool/collab-shared/mirrors/nuance/macair/0123456789abcdef',
      credential: '/Users/yuai/.local/share/agenttool/collab-shared/collab-sessions/ses_1.json',
      hubJs: '/Users/yuai/.local/share/collab-bridge/air/ab/hub.js',
      launcherExe: '/Users/yuai/Applications/CollabBridgeHub.app/Contents/MacOS/collab-bridge-hub',
      cliLauncher: '/Users/yuai/.local/bin/collab-bridge',
      device: '/Users/yuai/.config/collab-bridge/devices/nuance.json',
      sshConfig: '/Users/yuai/.ssh/collab-bridge/config',
      sshKey: '/Users/yuai/.ssh/collab-bridge/collab_nuance_ed25519',
      knownHosts: '/Users/yuai/.ssh/collab-bridge/known_hosts',
      ledger: '/Users/yuai/.local/state/collab-bridge/ledger.jsonl',
      lineages: '/Users/yuai/.local/state/collab-bridge/lineages.json',
      status: '/Users/yuai/.local/state/collab-bridge/devices/nuance.status.json',
      ack: '/Users/yuai/.local/state/collab-bridge/devices/nuance.host-key-ack',
      unpark: '/Users/yuai/.local/state/collab-bridge/requests/unpark-lin_1.json',
      hubStatus: '/Users/yuai/.local/state/collab-bridge/hub.status.json',
      lock: '/Users/yuai/.local/state/collab-bridge/hub.lock',
      log: '/Users/yuai/.local/state/collab-bridge/hub.log',
      plist: '/Users/yuai/Library/LaunchAgents/dev.agenttool.collab-bridge.plist',
      summon: '/Users/yuai/.ssh/summon/known_hosts',
      knock: '/Users/yuai/.local/share/agenttool/collab-shared/collab-sessions/knock-ledger.json',
    })
  })

  test('the Nuance hub socket for macair is 53 bytes', () => {
    const n = nuancePaths('/Users/macair', { HOME: '/Users/macair' })
    expect(n.hubSock).toBe('/Users/macair/.local/state/collab-bridge/run/hub.sock')
    expect(Buffer.byteLength(n.hubSock)).toBe(53)
    expect(socketPathOk(n.hubSock)).toBe(true)
    expect(n.pipeSock(99999, 99999)).toBe('/Users/macair/.local/state/collab-bridge/pipes/99999-99999.sock')
    expect(socketPathOk(n.pipeSock(99999, 99999))).toBe(true)
    expect(n.binary).toBe('/Users/macair/.local/share/collab-bridge/collab-bridge')
    expect(n.summonDropin).toBe('/etc/ssh/sshd_config.d/010-summon.conf')
  })

  test('socket paths under a short root fit 103 bytes', () => {
    const h = temp('cb-paths-')
    const root = shortSockRoot()
    const n = nuancePaths(h, nuanceEnv(h, { COLLAB_BRIDGE_SOCK_ROOT: root }))
    expect(n.hubSock).toBe(`${root}/run/hub.sock`)
    expect(n.relayStatus).toBe(`${root}/run/relay.json`)
    expect(socketPathOk(n.hubSock) && socketPathOk(n.pipeSock(99999, 99999))).toBe(true)
    expect(n.lineages.startsWith(`${h}/`)).toBe(true) // only sockets move to the short root
    expect(MAX_SOCKET_PATH_BYTES).toBe(103)
    expect(socketPathOk('/' + 'a'.repeat(102))).toBe(true) // 103 bytes
    expect(socketPathOk('/' + 'a'.repeat(103))).toBe(false) // 104: no room left for sun_path's NUL
    expect(socketPathOk('/' + 'é'.repeat(51))).toBe(true) // 103 bytes in 52 characters
    expect(socketPathOk('/' + 'é'.repeat(51) + 'a')).toBe(false) // bytes count, not characters
    expect(socketPathOk('run/hub.sock')).toBe(false)
  })

  test('the private journal and the shared journal are different files', () => {
    const a = airPaths('/Users/yuai')
    expect(a.privateJournal).toBe('/Users/yuai/.local/share/agenttool/collab.sqlite')
    expect(a.sharedJournal).toBe('/Users/yuai/.local/share/agenttool/collab-shared/collab.sqlite')
    expect(a.sharedJournal).not.toBe(a.privateJournal)
    expect(dirname(a.sharedJournal)).toBe(a.sharedDir)
    // Everything Collab keeps beside the shared journal lies in the shared dir, never beside the private journal (K22).
    for (const p of [a.collabSessions, a.knockLedger, a.mirrorsRoot, a.credentialFile('ses_1')]) expect([p, p.startsWith(`${a.sharedDir}/`)]).toEqual([p, true])
  })

  test('collabDist is the installed dist outside tests, the knob under the override, and refused in tests without it', () => {
    expect(collabDist({ HOME: '/h' })).toBe('/opt/homebrew/lib/node_modules/@agenttool/collab/dist')
    expect(collabDist({ HOME: '/h', COLLAB_BRIDGE_HOME_OVERRIDE: '/h', COLLAB_BRIDGE_COLLAB_DIST: COLLAB_DIST })).toBe(COLLAB_DIST)
    expect(() => collabDist({ HOME: '/h', COLLAB_BRIDGE_HOME_OVERRIDE: '/h' })).toThrow('collabDist: COLLAB_BRIDGE_COLLAB_DIST is not set under the test override')
    expect(() => collabDist({ HOME: '/h', NODE_ENV: 'test' })).toThrow('collabDist: refused under NODE_ENV=test without the override')
    expect(collabDist()).toBe(COLLAB_DIST) // the preload's knob
  })

  test('the Summon drop-in comes from its knob under the override, which is then required', () => {
    const h = temp('cb-paths-')
    expect(nuancePaths(h, nuanceEnv(h)).summonDropin).toBe(join(h, 'dropin.conf'))
    expect(() => nuancePaths(h, { HOME: h, COLLAB_BRIDGE_HOME_OVERRIDE: h })).toThrow('nuancePaths: COLLAB_BRIDGE_SUMMON_DROPIN is not set under the test override')
  })

  test('a caller value can never climb out of or nest inside its directory', () => {
    const a = airPaths('/Users/yuai')
    const n = nuancePaths('/Users/macair', { HOME: '/Users/macair' })
    for (const bad of ['', '.', '..', 'a/b', 'x\0y']) {
      expect(() => a.deviceFile(bad)).toThrow('paths: unsafe path segment')
      expect(() => a.mirrorDir('nuance', bad, 'm')).toThrow('paths: unsafe path segment')
      expect(() => n.lineageFile(bad)).toThrow('paths: unsafe path segment')
    }
    for (const bad of [0, 1.5, -2, Number.NaN]) expect(() => n.pipeSock(bad, 4200)).toThrow('paths: not a pid')
    expect(() => airPaths('Users/yuai')).toThrow('paths: home must be absolute')
    expect(() => nuancePaths('relative', { HOME: 'relative' })).toThrow('paths: home must be absolute')
  })

  test('homeOf is the override, then HOME, then the passwd home, and refuses in tests without the override', () => {
    expect(homeOf({ HOME: '/a', COLLAB_BRIDGE_HOME_OVERRIDE: '/a' })).toBe('/a')
    expect(homeOf({ HOME: '/b', COLLAB_BRIDGE_HOME_OVERRIDE: '/other' })).toBe('/b')
    expect(homeOf({})).toBe(homedir())
    expect(() => homeOf({ HOME: '/b', NODE_ENV: 'test' })).toThrow('homeOf: refused under NODE_ENV=test without the override')
    expect(homeOf()).toBe(process.env.HOME!) // the preload's suite home
  })
})
