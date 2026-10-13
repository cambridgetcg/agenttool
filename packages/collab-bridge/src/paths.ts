// Every place the bridge reads or writes, on the Air and on Nuance (spec §4.3). Pure: nothing here touches the disk.
import { homedir } from 'node:os'
import { join } from 'node:path'
import { overrideActive, type Env } from './sysbin.ts'

/** sun_path is 104 bytes with its NUL (K46), and Bun binds longer paths silently (F7): every listen and connect checks this (P16). */
export const MAX_SOCKET_PATH_BYTES = 103

export function socketPathOk(p: string): boolean {
  return p.startsWith('/') && !p.includes('\0') && Buffer.byteLength(p, 'utf8') <= MAX_SOCKET_PATH_BYTES
}

/** The installed Collab build the hub's children run (spec §10.4). */
export const INSTALLED_COLLAB_DIST = '/opt/homebrew/lib/node_modules/@agenttool/collab/dist'

/** The Collab dist to run: the installed one, or under the override COLLAB_BRIDGE_COLLAB_DIST (required there). */
export function collabDist(env: Env = process.env): string {
  if (overrideActive(env)) {
    const d = env.COLLAB_BRIDGE_COLLAB_DIST
    if (!d) throw new Error('collabDist: COLLAB_BRIDGE_COLLAB_DIST is not set under the test override')
    return d
  }
  if (env.NODE_ENV === 'test') throw new Error('collabDist: refused under NODE_ENV=test without the override')
  return INSTALLED_COLLAB_DIST
}

/**
 * The home everything hangs off: the override when active, else HOME, else the passwd home. Under NODE_ENV=test without
 * the override it refuses, like systemBin: Bun 1.3.13 gives a child spawned without `env` the startup environment (the
 * real HOME, NODE_ENV=test, no override), never the preload's, so a bridge process started that way stops here instead
 * of reaching this Mac's real files.
 */
export function homeOf(env: Env = process.env): string {
  if (overrideActive(env)) return env.COLLAB_BRIDGE_HOME_OVERRIDE!
  if (env.NODE_ENV === 'test') throw new Error('homeOf: refused under NODE_ENV=test without the override')
  return env.HOME || homedir()
}

/** One path segment from a caller's value (a device, a session id, a digest): it may never climb out or nest. */
function seg(s: string): string {
  if (s === '' || s === '.' || s === '..' || s.includes('/') || s.includes('\0')) throw new Error(`paths: unsafe path segment ${JSON.stringify(s)}`)
  return s
}

function pid(n: number): number {
  if (!Number.isInteger(n) || n < 1) throw new Error(`paths: not a pid: ${n}`)
  return n
}

function absolute(home: string): string {
  if (!home.startsWith('/')) throw new Error('paths: home must be absolute')
  return home
}

export interface AirPaths {
  home: string; agenttoolShare: string; privateJournal: string; sharedDir: string; sharedJournal: string
  collabSessions: string; knockLedger: string; mirrorsRoot: string
  mirrorDir(device: string, user: string, mirrorId: string): string; credentialFile(sessionId: string): string
  bridgeShare: string; hubDir(sha: string): string; hubJs(sha: string): string
  launcherApp: string; launcherExe: string; cliLauncher: string
  configDir: string; devicesDir: string; deviceFile(device: string): string
  sshDir: string; sshConfig: string; sshKey(device: string): string; knownHosts: string
  stateDir: string; ledger: string; lineages: string; deviceStatusDir: string; deviceStatus(device: string): string
  hostKeyAck(device: string): string
  requestsDir: string; unparkRequest(lineage: string): string
  hubStatus: string; baselineLabels: string; hubLock: string; hubLog: string
  plist: string; summonKnownHosts: string
}

export function airPaths(home: string): AirPaths {
  absolute(home)
  const agenttoolShare = join(home, '.local', 'share', 'agenttool')
  const sharedDir = join(agenttoolShare, 'collab-shared')
  // Collab keeps credentials beside the journal it is given: dirname(db)/collab-sessions/<id>.json (K22).
  const collabSessions = join(sharedDir, 'collab-sessions')
  const mirrorsRoot = join(sharedDir, 'mirrors')
  const bridgeShare = join(home, '.local', 'share', 'collab-bridge')
  const launcherApp = join(home, 'Applications', 'CollabBridgeHub.app')
  const configDir = join(home, '.config', 'collab-bridge')
  const devicesDir = join(configDir, 'devices')
  const sshDir = join(home, '.ssh', 'collab-bridge')
  const stateDir = join(home, '.local', 'state', 'collab-bridge')
  const deviceStatusDir = join(stateDir, 'devices')
  const requestsDir = join(stateDir, 'requests')
  return {
    home,
    agenttoolShare,
    privateJournal: join(agenttoolShare, 'collab.sqlite'), // never opened by the bridge (spec §11.2)
    sharedDir,
    sharedJournal: join(sharedDir, 'collab.sqlite'),
    collabSessions,
    knockLedger: join(collabSessions, 'knock-ledger.json'),
    mirrorsRoot,
    mirrorDir: (device, user, mirrorId) => join(mirrorsRoot, seg(device), seg(user), seg(mirrorId)),
    credentialFile: (sessionId) => join(collabSessions, `${seg(sessionId)}.json`),
    bridgeShare,
    hubDir: (sha) => join(bridgeShare, 'air', seg(sha)),
    hubJs: (sha) => join(bridgeShare, 'air', seg(sha), 'hub.js'),
    launcherApp,
    launcherExe: join(launcherApp, 'Contents', 'MacOS', 'collab-bridge-hub'),
    cliLauncher: join(home, '.local', 'bin', 'collab-bridge'),
    configDir,
    devicesDir,
    deviceFile: (device) => join(devicesDir, `${seg(device)}.json`),
    sshDir,
    sshConfig: join(sshDir, 'config'),
    sshKey: (device) => join(sshDir, `collab_${seg(device)}_ed25519`),
    knownHosts: join(sshDir, 'known_hosts'),
    stateDir,
    ledger: join(stateDir, 'ledger.jsonl'),
    lineages: join(stateDir, 'lineages.json'),
    deviceStatusDir,
    deviceStatus: (device) => join(deviceStatusDir, `${seg(device)}.status.json`),
    hostKeyAck: (device) => join(deviceStatusDir, `${seg(device)}.host-key-ack`),
    requestsDir,
    unparkRequest: (lineage) => join(requestsDir, `unpark-${seg(lineage)}.json`),
    hubStatus: join(stateDir, 'hub.status.json'),
    baselineLabels: join(stateDir, 'baseline-labels.txt'),
    hubLock: join(stateDir, 'hub.lock'),
    hubLog: join(stateDir, 'hub.log'),
    plist: join(home, 'Library', 'LaunchAgents', 'dev.agenttool.collab-bridge.plist'),
    summonKnownHosts: join(home, '.ssh', 'summon', 'known_hosts'),
  }
}

export interface NuancePaths {
  home: string; share: string; binary: string; installed: string
  config: string; seatKey: string; seatPub: string; shares: string
  state: string; sockRoot: string; run: string; hubSock: string; relayStatus: string
  pipes: string; pipeSock(hostPid: number, pipePid: number): string; pipeJson(hostPid: number, pipePid: number): string
  lineages: string; lineageFile(key: string): string
  tools: string; toolFile(digest: string): string; toolsCurrent: string; toolsSeed: string
  ledger: string
  summonAllowlist: string; summonInstalled: string; summonKeysOnly: string; summonDropin: string
  authorizedKeys: string; loveUnlimited: string
}

export function nuancePaths(home: string, env: Env = process.env): NuancePaths {
  absolute(home)
  const test = overrideActive(env)
  const share = join(home, '.local', 'share', 'collab-bridge')
  const config = join(home, '.config', 'collab-bridge')
  const state = join(home, '.local', 'state', 'collab-bridge')
  // Sockets only: a temp home is too deep for sun_path (K46), so tests give them a short root.
  const sockRoot = test && env.COLLAB_BRIDGE_SOCK_ROOT ? env.COLLAB_BRIDGE_SOCK_ROOT : state
  let summonDropin = '/etc/ssh/sshd_config.d/010-summon.conf'
  if (test) {
    const d = env.COLLAB_BRIDGE_SUMMON_DROPIN
    if (!d) throw new Error('nuancePaths: COLLAB_BRIDGE_SUMMON_DROPIN is not set under the test override')
    summonDropin = d
  }
  const run = join(sockRoot, 'run')
  const pipes = join(sockRoot, 'pipes')
  const lineages = join(state, 'lineages')
  const tools = join(state, 'tools')
  const summonShare = join(home, '.local', 'share', 'summon')
  return {
    home,
    share,
    binary: join(share, 'collab-bridge'),
    installed: join(share, 'INSTALLED'),
    config,
    seatKey: join(config, 'seat_ed25519'),
    seatPub: join(config, 'seat_ed25519.pub'),
    shares: join(config, 'shares.json'),
    state,
    sockRoot,
    run,
    hubSock: join(run, 'hub.sock'),
    relayStatus: join(run, 'relay.json'),
    pipes,
    pipeSock: (hostPid, pipePid) => join(pipes, `${pid(hostPid)}-${pid(pipePid)}.sock`),
    pipeJson: (hostPid, pipePid) => join(pipes, `${pid(hostPid)}-${pid(pipePid)}.json`),
    lineages,
    lineageFile: (key) => join(lineages, `${seg(key)}.json`),
    tools,
    toolFile: (digest) => join(tools, `${seg(digest)}.json`),
    toolsCurrent: join(tools, 'current'),
    toolsSeed: join(tools, 'seed'),
    ledger: join(state, 'ledger.jsonl'),
    summonAllowlist: join(home, '.config', 'summon', 'allowlist.yaml'),
    summonInstalled: join(summonShare, 'INSTALLED'),
    summonKeysOnly: join(summonShare, 'keys-only'),
    summonDropin,
    authorizedKeys: join(home, '.ssh', 'authorized_keys'),
    loveUnlimited: join(home, 'love-unlimited'),
  }
}
