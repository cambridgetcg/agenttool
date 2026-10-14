import { afterEach, describe, expect, test } from 'bun:test'
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { writeDevice, type DeviceFile } from '../src/air/devices.ts'
import { DEFAULT_CAPS } from '../src/air/diff-check.ts'
import { sourceBuild, type BuildInfo } from '../src/air/hub.ts'
import { LineageStore, type LineageEntry } from '../src/air/lineages.ts'
import { renderPlist } from '../src/air/plist.ts'
import {
  readDeviceStatus, readHostKeyAck, readHubStatus, statusLines, writeDeviceStatus, writeHubStatus, type DeviceStatus, type HubStatus,
} from '../src/air/status.ts'
import { cliLauncherText, HUB_LABEL, HUB_UID, hubOnRefusal, labelDiff, runAirCli, stableLabels, ttyAsk, type AirCliDeps } from '../src/cli.ts'
import { readLedger } from '../src/ledger.ts'
import { airPaths, type AirPaths } from '../src/paths.ts'
import type { ProcRecord, ProcTable } from '../src/proc.ts'
import { systemBin } from '../src/sysbin.ts'
import { cleanupTmps, COLLAB_DIST, modeOf, PKG, PS_STUB_HOST, temp, testEnv } from './helpers.ts'

afterEach(cleanupTmps)

const SHA = 'b'.repeat(64)
const BUN = '/Users/yuai/.bun/bin/bun'
const NOW = new Date('2026-10-13T12:00:00.000Z')
const SELF = 9100
const SERVICE = `gui/502/${HUB_LABEL}`
/** What `launchctl list` shows before the hub: two lasting jobs and two per-run ones that come and go. */
const BASE_LABELS = ['com.apple.Finder', 'love.awaken', 'application.com.apple.Terminal.1201.1202', 'com.apple.xpc.launchd.oneshot.0x10000001.mdworker']
const PIN = 'summon-nuance ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGNvbGxhYi1icmlkZ2UtdGVzdC1waW4tb25lLW9uZQ'
const OTHER_PIN = 'summon-nuance ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGFub3RoZXIta2V5LWZyb20tdGhlLW5ldHdvcmst'

/** A process table: this CLI (SELF, bun) and then `chain`, each the parent of the one before; the last one's parent is launchd. */
function table(chain: Array<{ pid: number; comm: string }>): ProcTable {
  const recs = [{ pid: SELF, comm: 'bun' }, ...chain]
  const m = new Map<number, ProcRecord>()
  recs.forEach((r, i) => m.set(r.pid, { pid: r.pid, ppid: recs[i + 1]?.pid ?? 1, started_at: 'Tue Oct 13 11:33:11 2026', comm: r.comm }))
  return m
}
/** Yu's Terminal: bun under his login zsh, under login, under Terminal. */
const TERMINAL = table([{ pid: 9000, comm: '-zsh' }, { pid: 8900, comm: 'login' }, { pid: 8800, comm: '/System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal' }])
/** launchd's hub: bun under the launcher app (C15), whose parent is launchd. */
const UNDER_LAUNCHD = table([{ pid: 700, comm: '/Users/yuai/Applications/CollabBridgeHub.app/Contents/MacOS/collab-bridge-hub' }])
/** An agent's shell: bun under a full-path claude. */
const UNDER_CLAUDE = table([{ pid: 9000, comm: '/Users/yuai/.local/bin/claude' }])
/** The hub verbs never ask: launchd has no tty, and an agent must not be able to answer for Yu. */
const neverAsk = () => { throw new Error('run and hub run must never ask') }

/**
 * A ps for a `hub run` spawned from source: the real /bin/ps, except that the caller's (the CLI's) parent reads as
 * launchd, as under the launcher. The harness check then passes, and every child pid and lstart the hub reads stays real (P43).
 */
function launchdPs(dir: string): string {
  const p = join(dir, 'ps')
  writeFileSync(p, [
    '#!/bin/bash',
    'set -o pipefail',
    `LC_ALL=C /bin/ps "$@" | /usr/bin/awk -v me="$PPID" '$1 == me { $2 = 1 } { print }'`,
    '',
  ].join('\n'))
  chmodSync(p, 0o755)
  return p
}

async function until(cond: () => boolean, what: string, ms = 15_000): Promise<void> {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
    await Bun.sleep(25)
  }
}

/** The bin from source, as launchd's `hub.js run` or Yu's `collab-bridge hub run` runs it, under the override. */
function spawnBin(home: string, argv: string[], extra: Record<string, string> = {}) {
  return Bun.spawn([process.execPath, '--no-env-file', '--config=/dev/null', join(PKG, 'bin', 'collab-bridge.ts'), ...argv],
    { cwd: '/', env: testEnv(home, extra), stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
}

/**
 * A launchctl stand-in: it appends each call's arguments to <dir>/launchctl.calls, prints <dir>/list.txt for `list`
 * (tab-separated, with launchctl's header), exits 113 for `print` (no such service) and 0 for everything else.
 */
function fakeLaunchctl(dir: string, labels: string[]): { bin: string; calls(): string[]; setLabels(l: string[]): void } {
  const setLabels = (l: string[]) =>
    writeFileSync(join(dir, 'list.txt'), ['PID\tStatus\tLabel', ...l.map((label, i) => `${i % 2 === 0 ? '-' : String(400 + i)}\t0\t${label}`)].join('\n') + '\n')
  setLabels(labels)
  const bin = join(dir, 'launchctl')
  writeFileSync(bin, [
    '#!/bin/bash',
    `printf '%s\\n' "$*" >> '${dir}/launchctl.calls'`,
    'case "$1" in',
    `  list) cat '${dir}/list.txt' ;;`,
    "  print) echo 'Could not find service' >&2; exit 113 ;;",
    '  *) exit 0 ;;',
    'esac',
    '',
  ].join('\n'))
  chmodSync(bin, 0o755)
  const log = join(dir, 'launchctl.calls')
  return { bin, setLabels, calls: () => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : []) }
}

/** An app bundle at `app` whose executable is a copy of /usr/bin/true, ad hoc signed as a bundle, so codesign verifies it. */
function signedApp(app: string): void {
  mkdirSync(join(app, 'Contents', 'MacOS'), { recursive: true })
  copyFileSync('/usr/bin/true', join(app, 'Contents', 'MacOS', 'collab-bridge-hub'))
  writeFileSync(join(app, 'Contents', 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>CFBundleIdentifier</key>
\t<string>dev.agenttool.collab-bridge.hub</string>
\t<key>CFBundleExecutable</key>
\t<string>collab-bridge-hub</string>
\t<key>CFBundlePackageType</key>
\t<string>APPL</string>
</dict>
</plist>
`)
  const r = Bun.spawnSync(['/usr/bin/codesign', '-s', '-', '--force', app], { cwd: '/', env: { PATH: '/usr/bin:/bin' } })
  if (r.exitCode !== 0) throw new Error(`codesign could not sign the test app: ${r.stderr.toString()}`)
}

interface Cli { deps: AirCliDeps; out: string[]; err: string[]; asked: string[]; launchctl: ReturnType<typeof fakeLaunchctl>; paths: AirPaths; home: string }

/** The CLI over a temp home with the pinned bundle and a signed launcher in place, as Task 66 leaves them, and every side effect recorded. */
function cli(o: { env?: AirCliDeps['env']; uid?: number; table?: ProcTable | null; answer?: string | null; ask?: AirCliDeps['ask'];
  build?: BuildInfo | null; runHub?: () => Promise<number> } = {}): Cli {
  const home = temp('cb-cli-')
  const paths = airPaths(home)
  const stubs = join(home, 'stubs')
  mkdirSync(stubs)
  const launchctl = fakeLaunchctl(stubs, BASE_LABELS)
  mkdirSync(paths.hubDir(SHA), { recursive: true })
  writeFileSync(paths.hubJs(SHA), '// the pinned hub bundle\n')
  signedApp(paths.launcherApp)
  const out: string[] = []
  const err: string[] = []
  const asked: string[] = []
  const deps: AirCliDeps = {
    paths, env: o.env ?? {}, selfPid: SELF, uid: () => o.uid ?? 502, table: () => (o.table === undefined ? TERMINAL : o.table),
    ask: o.ask ?? ((prompt) => { asked.push(prompt); return o.answer === undefined ? 'y' : o.answer }),
    launchctl: launchctl.bin, codesign: '/usr/bin/codesign', bun: BUN, hubSha: SHA,
    build: o.build === undefined ? sourceBuild(COLLAB_DIST) : o.build, collabDist: COLLAB_DIST,
    runHub: o.runHub ?? (async () => 0), out: (l) => { out.push(l) }, err: (l) => { err.push(l) }, now: () => NOW,
  }
  return { deps, out, err, asked, launchctl, paths, home }
}

function pairedDevice(paths: AirPaths): DeviceFile {
  const d: DeviceFile = {
    v: 1, device: 'nuance', user: 'macair', state: 'paired', host_alias: 'collab-nuance', seat_public: 'a1'.repeat(32),
    bundle_build: 'abcdef01', key_expiry: '20270111', trailer: 'Co-Authored-By: The Fable of the Eternal Universe <Yu@Ai-love.cc>',
    git: { path: '/Library/Developer/CommandLineTools/usr/bin/git', version: '2.39.5', sha256: 'c'.repeat(64), guard: true, apple: true },
    summon: { key_sha256: 'd'.repeat(64), dropin_stat: '1234567 287 1760000000000 0 600' },
    shares: [{ remote_realpath: '/Users/macair/Projects/collab-trial', remote_gitdir: '/Users/macair/Projects/collab-trial/.git',
      air_clone: join(paths.home, 'Projects', 'collab-trial'), mirror_id: '0123456789abcdef', mirror_worktree_id: null, workspace_id: null, caps: DEFAULT_CAPS }],
    prepared_at: '2026-10-13T10:00:00.000Z', paired_at: '2026-10-13T11:00:00.000Z',
  }
  writeDevice(paths.deviceFile('nuance'), d)
  return d
}

function deviceStatus(over: Partial<DeviceStatus> = {}): DeviceStatus {
  return { device: 'nuance', word: 'up', reason: null, since: '2026-10-13T11:05:00.000Z', hint: null, relay_contested: false,
    sticky: [], refused_tools: null, skew_s: null, ...over }
}

function hubStatus(): HubStatus {
  return { word: 'running', code: null, detail: null, at: '2026-10-13T11:05:00.000Z', build: '00000000', unexpected_exits: [],
    runs: [{ started_at: '2026-10-13T11:04:00.000Z', ended_at: null, clean: false }], seats: [] }
}

/** Summon's pinned line and the bridge's copy of it (spec §5.6). */
function writePins(paths: AirPaths, summon: string, copy: string): void {
  mkdirSync(dirname(paths.summonKnownHosts), { recursive: true })
  writeFileSync(paths.summonKnownHosts, summon + '\n')
  mkdirSync(dirname(paths.knownHosts), { recursive: true })
  writeFileSync(paths.knownHosts, copy + '\n')
}

function lineage(over: Partial<LineageEntry>): LineageEntry {
  return { lineage: 'lin_' + '1'.repeat(32), device: 'nuance', user: 'macair', harness: 'claude', folder: '/Users/macair/Projects/collab-trial',
    state: 'pending', session_id: null, credential_path: null, past_sessions: [], mirror_id: '0123456789abcdef', workspace_id: null,
    pending_start: null, parked: null, detached_since: null, created_at: '2026-10-13T11:00:00.000Z', ...over }
}

const nothingWritten = (c: Cli) => {
  expect(existsSync(c.paths.plist)).toBe(false)
  expect(existsSync(c.paths.baselineLabels)).toBe(false)
  expect(existsSync(c.paths.hubLog)).toBe(false)
  expect(c.launchctl.calls()).toEqual([])
}

describe('hub on and hub off: only Yu, only gui/502', () => {
  test('hub on is refused under CLAUDECODE, CODEX_*, HERMES_*', async () => {
    for (const env of [{ CLAUDECODE: '1' }, { CODEX_THREAD_ID: 'thread-1' }, { HERMES_HOME: '/Users/yuai/.hermes' }]) {
      const c = cli({ env })
      expect(await runAirCli(['hub', 'on'], c.deps)).toBe(1)
      expect(c.err.join('\n')).toContain(`✗ refused: ${Object.keys(env)[0]} is set`)
      expect(c.asked).toEqual([])
      nothingWritten(c)
    }
  }, 20_000)

  test('hub on is refused under a full-path claude ancestor', async () => {
    const underClaude = table([{ pid: 9000, comm: '/bin/zsh' }, { pid: 8950, comm: '/Users/yuai/.local/bin/claude' }, { pid: 8900, comm: 'login' }])
    const c = cli({ table: underClaude })
    expect(await runAirCli(['hub', 'on'], c.deps)).toBe(1)
    expect(c.err.join('\n')).toContain('✗ refused: claude (pid 8950) is an ancestor of this process')
    expect(c.asked).toEqual([])
    nothingWritten(c)
    // the same rule by hand: Yu's Terminal passes, an unreadable process table never does
    expect(hubOnRefusal({}, TERMINAL, SELF, 502)).toBeNull()
    expect(hubOnRefusal({}, table([{ pid: 9000, comm: 'codex' }]), SELF, 502)).toContain('codex (pid 9000) is an ancestor')
    expect(hubOnRefusal({}, null, SELF, 502)).toContain('the process table could not be read')
    expect(hubOnRefusal({}, table([]), SELF + 1, 502)).toContain('this process is not in the process table')
  }, 20_000)

  test('hub on with no tty prints ✗ Not confirmed and writes nothing', async () => {
    const h = temp('cb-tty-')
    // under the override with no COLLAB_BRIDGE_TTY there is no tty at all: the real /dev/tty is never read in a test
    const c = cli({ ask: ttyAsk({ HOME: h, COLLAB_BRIDGE_HOME_OVERRIDE: h }) })
    expect(await runAirCli(['hub', 'on'], c.deps)).toBe(1)
    expect(c.err).toContain('✗ Not confirmed')
    nothingWritten(c)
    const n = cli({ answer: 'n' })
    expect(await runAirCli(['hub', 'on'], n.deps)).toBe(1)
    expect(n.err).toContain('✗ Not confirmed')
    nothingWritten(n)
  }, 20_000)

  test('ttyAsk reads COLLAB_BRIDGE_TTY only under the override, one line per question', () => {
    const h = temp('cb-tty-')
    const answers = join(h, 'answers')
    writeFileSync(answers, 'y\nn\n')
    const ask = ttyAsk({ HOME: h, COLLAB_BRIDGE_HOME_OVERRIDE: h, COLLAB_BRIDGE_TTY: answers })
    expect([ask('first? '), ask('second? '), ask('third? '), ask('fourth? ')]).toEqual(['y', 'n', '', null])
    expect(ttyAsk({ HOME: h, COLLAB_BRIDGE_HOME_OVERRIDE: h, COLLAB_BRIDGE_TTY: join(h, 'missing') })('q? ')).toBeNull()
  }, 20_000)

  test('hub on is refused for uid 501', async () => {
    const c = cli({ uid: 501 })
    expect(await runAirCli(['hub', 'on'], c.deps)).toBe(1)
    expect(c.err.join('\n')).toContain('✗ refused: this is uid 501; the hub runs as uid 502 (yuai) in gui/502 only')
    expect(c.asked).toEqual([])
    nothingWritten(c)
  }, 20_000)

  test('hub on is refused before any prompt when the pinned bundle or the launcher is missing', async () => {
    const c = cli()
    rmSync(c.paths.hubJs(SHA))
    expect(await runAirCli(['hub', 'on'], c.deps)).toBe(1)
    expect(c.err.join('\n')).toContain(`✗ the pinned hub bundle is missing: ${c.paths.hubJs(SHA)}`)
    const l = cli()
    rmSync(l.paths.launcherApp, { recursive: true })
    expect(await runAirCli(['hub', 'on'], l.deps)).toBe(1)
    expect(l.err.join('\n')).toContain(`✗ the launcher app is missing: ${l.paths.launcherExe}`)
    const s = cli()
    s.deps.hubSha = null
    expect(await runAirCli(['hub', 'on'], s.deps)).toBe(1)
    expect(s.err.join('\n')).toContain('✗ this collab-bridge is not a pinned hub bundle')
    for (const x of [c, l, s]) { expect(x.asked).toEqual([]); nothingWritten(x) }
  }, 20_000)

  test('hub on with y writes the exact plist, the baseline labels and a 0600 hub.log, and bootstraps gui/502', async () => {
    const c = cli()
    expect(await runAirCli(['hub', 'on'], c.deps)).toBe(0)
    expect(c.asked).toEqual(['Turn the Collab bridge hub on? [y/N] '])
    expect(readFileSync(c.paths.plist, 'utf8')).toBe(renderPlist({ home: c.home, sha: SHA, bun: BUN }))
    expect(modeOf(c.paths.plist)).toBe(0o644)
    expect(readFileSync(c.paths.baselineLabels, 'utf8')).toBe('com.apple.Finder\nlove.awaken\n')
    expect(modeOf(c.paths.baselineLabels)).toBe(0o600)
    expect(readFileSync(c.paths.hubLog, 'utf8')).toBe('')
    expect(modeOf(c.paths.hubLog)).toBe(0o600)
    expect(modeOf(c.paths.stateDir)).toBe(0o700)
    expect(c.launchctl.calls()).toEqual(['list', `bootout ${SERVICE}`, `print ${SERVICE}`, `bootstrap gui/502 ${c.paths.plist}`])
    expect(c.out[0]).toBe(`✓ Hub on: ${HUB_LABEL} is bootstrapped in gui/502.`)
    // a second hub on restarts the hub and keeps the first baseline, so the §12.3 label diff is against the Air before the hub
    c.launchctl.setLabels([...BASE_LABELS, HUB_LABEL, 'com.example.later'])
    expect(await runAirCli(['hub', 'on'], c.deps)).toBe(0)
    expect(readFileSync(c.paths.baselineLabels, 'utf8')).toBe('com.apple.Finder\nlove.awaken\n')
    expect(c.launchctl.calls().slice(4)).toEqual([`bootout ${SERVICE}`, `print ${SERVICE}`, `bootstrap gui/502 ${c.paths.plist}`])
  }, 20_000)

  test('hub off with y boots out and removes the plist', async () => {
    const c = cli()
    expect(await runAirCli(['hub', 'on'], c.deps)).toBe(0)
    const before = c.launchctl.calls().length
    expect(await runAirCli(['hub', 'off'], c.deps)).toBe(0)
    expect(c.asked).toEqual(['Turn the Collab bridge hub on? [y/N] ', 'Turn the Collab bridge hub off? [y/N] '])
    expect(c.launchctl.calls().slice(before)).toEqual([`bootout ${SERVICE}`])
    expect(existsSync(c.paths.plist)).toBe(false)
    expect(existsSync(c.paths.baselineLabels)).toBe(true)
    expect(c.out.at(-1)).toBe(`✓ Hub off: ${HUB_LABEL} is booted out of gui/502 and its plist removed.`)
    // the same refusals and prompt as hub on
    const r = cli({ env: { CLAUDECODE: '1' } })
    expect(await runAirCli(['hub', 'off'], r.deps)).toBe(1)
    const n = cli({ answer: null })
    expect(await runAirCli(['hub', 'off'], n.deps)).toBe(1)
    expect(n.err).toContain('✗ Not confirmed')
    for (const x of [r, n]) expect(x.launchctl.calls()).toEqual([])
  }, 20_000)

  test('every launchctl call names gui/502', async () => {
    const c = cli()
    pairedDevice(c.paths)
    writePins(c.paths, PIN, PIN)
    await runAirCli(['hub', 'on'], c.deps)
    await runAirCli(['hub', 'doctor'], c.deps)
    await runAirCli(['hub', 'off'], c.deps)
    const calls = c.launchctl.calls()
    expect(calls.length).toBeGreaterThanOrEqual(6)
    for (const call of calls) {
      // `list` takes no domain: it reads the caller's own, and hub on has checked the caller is uid 502
      if (call === 'list') continue
      expect([call, / gui\/502(\/| |$)/.test(` ${call}`)]).toEqual([call, true])
    }
    expect(calls.join('\n')).not.toMatch(/gui\/(?!502\b)|system\/|user\/|login\//)
  }, 20_000)
})

describe('hub status and hub doctor', () => {
  test('hub status prints the §9.2 lines and --json the files', async () => {
    const c = cli()
    pairedDevice(c.paths)
    writeHubStatus(c.paths, hubStatus())
    writeDeviceStatus(c.paths, deviceStatus({ skew_s: 61 }))
    expect(await runAirCli(['hub', 'status'], c.deps)).toBe(0)
    expect(c.out).toEqual(statusLines(readHubStatus(c.paths), [readDeviceStatus(c.paths, 'nuance')!]))
    expect(c.out).toContain('nuance: up')
    expect(c.out).toContain('nuance: clock skew 61 s (warn)')
    c.out.length = 0
    expect(await runAirCli(['hub', 'status', '--json'], c.deps)).toBe(0)
    expect(c.out).toHaveLength(1)
    expect(JSON.parse(c.out[0]!)).toEqual({
      hub: readHubStatus(c.paths),
      devices: [{ device: 'nuance', state: 'paired', status: readDeviceStatus(c.paths, 'nuance') }],
    })
    expect(c.asked).toEqual([])
  }, 20_000)

  test('hub status names a device with no status yet and a device that is not paired', async () => {
    const c = cli()
    const d = pairedDevice(c.paths)
    writeDevice(c.paths.deviceFile('zerone'), { ...d, device: 'zerone', host_alias: 'collab-zerone', state: 'prepared', seat_public: null,
      git: null, summon: null, paired_at: null, shares: d.shares.map((s) => ({ ...s, remote_gitdir: null })) })
    expect(await runAirCli(['hub', 'status'], c.deps)).toBe(0)
    expect(c.out).toEqual(['hub: not running', 'nuance: no status yet (is the hub on?)', 'zerone: prepared (device file)'])
  }, 20_000)

  test("hub doctor warns when the known_hosts copy and Summon's pin diverge, when the dist differs, and when the launcher fails codesign", async () => {
    const c = cli()
    pairedDevice(c.paths)
    writePins(c.paths, PIN, PIN)
    const warnings = () => c.out.filter((l) => l.startsWith('warn: '))
    expect(await runAirCli(['hub', 'doctor'], c.deps)).toBe(0)
    expect(warnings()).toEqual([])
    expect(c.out).toContain('hub: not running')
    expect(c.out).toContain(`hub bundle: ${c.paths.hubJs(SHA)}`)
    expect(c.out).toContain(`launchd: ${HUB_LABEL} is not loaded in gui/502`)

    c.out.length = 0
    writePins(c.paths, PIN, OTHER_PIN)
    expect(await runAirCli(['hub', 'doctor'], c.deps)).toBe(1)
    expect(warnings()).toEqual([
      "warn: nuance: the known_hosts copy differs from Summon's pin for summon-nuance: never re-pin from the network; tell Yu",
    ])

    c.out.length = 0
    writePins(c.paths, PIN, PIN)
    c.deps.build = { ...sourceBuild(COLLAB_DIST), mcp_sha256: '0'.repeat(64) }
    expect(await runAirCli(['hub', 'doctor'], c.deps)).toBe(1)
    expect(warnings()).toEqual([
      "warn: the installed Collab dist differs from this hub's build (collab_build_mismatch): rebuild the hub bundle from the installed build's commit",
    ])

    c.out.length = 0
    c.deps.build = sourceBuild(COLLAB_DIST)
    writeFileSync(c.paths.launcherExe, '#!/bin/sh\nexit 0\n')
    expect(await runAirCli(['hub', 'doctor'], c.deps)).toBe(1)
    expect(warnings()).toHaveLength(1)
    expect(warnings()[0]).toStartWith(`warn: the launcher app fails codesign --verify --deep --strict: ${c.paths.launcherApp}`)
    expect(c.asked).toEqual([])
  }, 20_000)

  test('hub doctor --ack-host-key writes the ack stamp and the sticky warning no longer prints', async () => {
    const c = cli()
    pairedDevice(c.paths)
    writePins(c.paths, PIN, PIN)
    writeDeviceStatus(c.paths, deviceStatus({ sticky: [{ kind: 'host_key_mismatch', at: '2026-10-13T11:10:00.000Z', fingerprint: 'SHA256:Zm9yZ2Vka2V5' }] }))
    const sticky = 'nuance: host key mismatch seen at 2026-10-13T11:10:00.000Z, presented SHA256:Zm9yZ2Vka2V5'
    expect(await runAirCli(['hub', 'doctor'], c.deps)).toBe(1)
    expect(c.out).toContain(sticky)
    c.out.length = 0
    expect(await runAirCli(['hub', 'doctor', '--ack-host-key'], c.deps)).toBe(0)
    expect(c.asked).toEqual(['Acknowledge the host-key warning(s) of nuance? [y/N] '])
    expect(readHostKeyAck(c.paths, 'nuance')).toBe(NOW.toISOString())
    expect(modeOf(c.paths.hostKeyAck('nuance'))).toBe(0o600)
    expect(c.out[0]).toBe("✓ Acknowledged nuance's host-key warning(s) at 2026-10-13T12:00:00.000Z; they are gone from the status file, and no later status write brings them back.")
    expect(readDeviceStatus(c.paths, 'nuance')!.sticky).toEqual([])
    expect(c.out).not.toContain(sticky)
    c.out.length = 0
    expect(await runAirCli(['hub', 'status'], c.deps)).toBe(0)
    expect(c.out).not.toContain(sticky)
  }, 20_000)

  test("hub doctor --ack-host-key is Yu's: refused inside a harness, and nothing is acknowledged without his y", async () => {
    for (const o of [{ env: { CLAUDECODE: '1' } }, { answer: 'n' }]) {
      const c = cli(o)
      pairedDevice(c.paths)
      writeDeviceStatus(c.paths, deviceStatus({ sticky: [{ kind: 'host_key_mismatch', at: '2026-10-13T11:10:00.000Z', fingerprint: null }] }))
      expect(await runAirCli(['hub', 'doctor', '--ack-host-key'], c.deps)).toBe(1)
      expect(readHostKeyAck(c.paths, 'nuance')).toBeNull()
      expect(readDeviceStatus(c.paths, 'nuance')!.sticky).toHaveLength(1)
    }
  }, 20_000)

  test('hub doctor prints the launchd labels added since hub on, ignoring application.* and oneshot entries', async () => {
    const c = cli()
    expect(await runAirCli(['hub', 'on'], c.deps)).toBe(0)
    c.launchctl.setLabels(['com.apple.Finder', 'love.awaken', HUB_LABEL, 'application.com.apple.Preview.5501.5502',
      'com.apple.xpc.launchd.oneshot.0x10000009.mdworker_shared', '[0x0-0x2f02f0].com.apple.Safari'])
    c.out.length = 0
    await runAirCli(['hub', 'doctor'], c.deps)
    expect(c.out).toContain(`launchd labels added since hub on: ${HUB_LABEL}`)
    expect(c.out).toContain('launchd labels removed since hub on: none')
    const fresh = cli()
    await runAirCli(['hub', 'doctor'], fresh.deps)
    expect(fresh.out).toContain('launchd labels added since hub on: unknown (no baseline: hub on has not run)')
  }, 20_000)

  test('stableLabels drops per-run entries and labelDiff is exactly the new label', () => {
    const before = 'PID\tStatus\tLabel\n-\t0\tcom.apple.Finder\n412\t0\tapplication.com.apple.Terminal.1.2\n-\t0\t[0x0-0x1a01a].com.apple.Safari\n'
    const after = before + `903\t0\t${HUB_LABEL}\n-\t0\tcom.apple.xpc.launchd.oneshot.0x10000004.x\n-\t0\tapplication.com.apple.Preview.3.4\n`
    expect(stableLabels(before)).toEqual(['com.apple.Finder'])
    expect(stableLabels(after)).toEqual(['com.apple.Finder', HUB_LABEL])
    expect(labelDiff(before, after)).toEqual({ added: [HUB_LABEL], removed: [] })
    expect(labelDiff(after, before)).toEqual({ added: [], removed: [HUB_LABEL] })
    // the stored baseline (one label per line) reads back the same way
    expect(labelDiff(stableLabels(before).join('\n') + '\n', after)).toEqual({ added: [HUB_LABEL], removed: [] })
    // whitespace instead of tabs still finds the label column
    expect(stableLabels('PID   Status   Label\n-     0        com.example.spaced\n')).toEqual(['com.example.spaced'])
  }, 20_000)
})

describe('hub unpark, hub run, version, the launcher line', () => {
  test('hub unpark writes the request only for a parked lineage, with no prompt, and is refused for uid 501', async () => {
    const parked = 'lin_' + 'a'.repeat(32)
    const free = 'lin_' + 'f'.repeat(32)
    const setup = (c: Cli) => {
      const store = new LineageStore(c.paths.lineages)
      store.load()
      store.upsert(lineage({ lineage: parked, parked: { cause: 'cursor_reset_required', details: { cause: 'host_cursor_mismatch' } } }))
      store.upsert(lineage({ lineage: free }))
    }
    const noAsk = () => { throw new Error('hub unpark must never ask') }
    const c = cli({ ask: noAsk })
    setup(c)
    expect(await runAirCli(['hub', 'unpark', parked], c.deps)).toBe(0)
    const req = c.paths.unparkRequest(parked)
    expect(JSON.parse(readFileSync(req, 'utf8'))).toEqual({ v: 1, lineage: parked, requested_at: NOW.toISOString() })
    expect(modeOf(req)).toBe(0o600)
    expect(modeOf(c.paths.requestsDir)).toBe(0o700)
    expect(c.out).toEqual([`Unpark requested: ${req}`, "It is applied at the hub's next reload (or its next start), and refused while a child of that lineage still runs."])
    // a lineage that is not parked, or not known, writes nothing
    expect(await runAirCli(['hub', 'unpark', free], c.deps)).toBe(1)
    expect(c.err.at(-1)).toBe(`✗ ${free} is not parked; nothing was written`)
    expect(await runAirCli(['hub', 'unpark', 'lin_' + 'e'.repeat(32)], c.deps)).toBe(1)
    expect(existsSync(c.paths.unparkRequest(free))).toBe(false)
    // a malformed id is a usage error
    expect(await runAirCli(['hub', 'unpark', 'lin_short'], c.deps)).toBe(2)
    // uid 501 is refused before anything is read
    const u = cli({ uid: 501, ask: noAsk })
    setup(u)
    expect(await runAirCli(['hub', 'unpark', parked], u.deps)).toBe(1)
    expect(u.err.at(-1)).toBe('✗ refused: this is uid 501; hub unpark runs as uid 502 (yuai) only')
    expect(existsSync(u.paths.unparkRequest(parked))).toBe(false)
    // no harness refusal: Ai runs it inside Claude Code after the repair (§9.6 item 5)
    const h = cli({ env: { CLAUDECODE: '1' }, ask: noAsk })
    setup(h)
    expect(await runAirCli(['hub', 'unpark', parked], h.deps)).toBe(0)
  }, 20_000)

  test('hub run runs the hub and returns its exit code', async () => {
    let ran = 0
    const c = cli({ runHub: async () => { ran++; return 7 } })
    expect(await runAirCli(['hub', 'run'], c.deps)).toBe(7)
    expect(ran).toBe(1)
    expect(c.launchctl.calls()).toEqual([])
  }, 20_000)

  test("the LaunchAgent's own words reach the hub: what the plist puts after hub.js is a verb runAirCli runs", async () => {
    // launchd starts the launcher, which spawns bun with the rest; bun hands hub.js the words after it as process.argv.slice(2)
    const f = join(temp('cb-plist-'), `${HUB_LABEL}.plist`)
    writeFileSync(f, renderPlist({ home: '/Users/yuai', sha: SHA, bun: BUN }))
    const json = Bun.spawnSync([systemBin('plutil'), '-convert', 'json', '-o', '-', f], { cwd: '/', env: { PATH: '/usr/bin:/bin' } })
    expect(json.exitCode).toBe(0)
    const program = (JSON.parse(json.stdout.toString()) as { ProgramArguments: string[] }).ProgramArguments
    const hubArgv = program.slice(program.findIndex((a) => a.endsWith('/hub.js')) + 1)
    expect(hubArgv).toEqual(['run'])
    let ran = 0
    const c = cli({ table: UNDER_LAUNCHD, ask: neverAsk, runHub: async () => { ran++; return 7 } })
    expect(await runAirCli(hubArgv, c.deps)).toBe(7)
    expect([ran, c.err, c.launchctl.calls()]).toEqual([1, [], []])
  }, 20_000)

  test('run and hub run refuse inside any agent harness and for any uid but 502, with no question; launchd and Terminal pass', async () => {
    const refused: Array<[NonNullable<Parameters<typeof cli>[0]>, string]> = [
      [{ env: { CLAUDECODE: '1' } }, 'CLAUDECODE is set'],
      [{ env: { HERMES_HOME: '/Users/yuai/.hermes' } }, 'HERMES_HOME is set'],
      [{ table: UNDER_CLAUDE }, 'claude (pid 9000) is an ancestor of this process'],
      [{ table: null }, 'the process table could not be read'],
      [{ uid: 501 }, 'this is uid 501; the hub runs as uid 502 (yuai) in gui/502 only'],
    ]
    for (const argv of [['run'], ['hub', 'run']]) {
      for (const [o, why] of refused) {
        let ran = 0
        const c = cli({ ...o, ask: neverAsk, runHub: async () => { ran++; return 7 } })
        expect([argv, why, await runAirCli(argv, c.deps), ran]).toEqual([argv, why, 1, 0])
        expect(c.err.join('\n')).toContain(`✗ refused: ${why}`)
        nothingWritten(c)
      }
      for (const chain of [UNDER_LAUNCHD, TERMINAL]) {
        let ran = 0
        const c = cli({ table: chain, ask: neverAsk, runHub: async () => { ran++; return 7 } })
        expect([argv, await runAirCli(argv, c.deps), ran, c.err]).toEqual([argv, 7, 1, []])
      }
    }
  }, 20_000)

  test('the launcher text is the exact zsh line', () => {
    const text = cliLauncherText(SHA)
    expect(text).toBe('#!/bin/zsh -f\n'
      + `cd / && exec /usr/bin/env -u BUN_OPTIONS -u BUN_BE_BUN /Users/yuai/.bun/bin/bun --no-env-file --config=/dev/null /Users/yuai/.local/share/collab-bridge/air/${SHA}/hub.js "$@"\n`)
    const f = join(temp('cb-launcher-'), 'collab-bridge')
    writeFileSync(f, text, { mode: 0o755 })
    expect(Bun.spawnSync(['/bin/zsh', '-n', f], { cwd: '/', env: { PATH: '/usr/bin:/bin' } }).exitCode).toBe(0)
    expect(() => cliLauncherText('B'.repeat(64))).toThrow('cliLauncherText: sha must be 64 lowercase hex')
  }, 20_000)

  test('version prints {"build":null} from source', async () => {
    const home = temp('cb-version-')
    const r = Bun.spawnSync([process.execPath, '--no-env-file', '--config=/dev/null', join(PKG, 'bin', 'collab-bridge.ts'), 'version'],
      { cwd: '/', env: testEnv(home) })
    expect([r.exitCode, r.stdout.toString(), r.stderr.toString()]).toEqual([0, '{"build":null}\n', ''])
    // a pinned bundle prints its embedded build info
    const c = cli()
    expect(await runAirCli(['version'], c.deps)).toBe(0)
    expect(JSON.parse(c.out[0]!)).toEqual(sourceBuild(COLLAB_DIST))
  }, 20_000)

  test('an unknown verb exits 2', async () => {
    const c = cli()
    for (const argv of [[], ['hub'], ['hub', 'restart'], ['hub', 'on', 'now'], ['hub', 'status', '--yaml'], ['hub', 'doctor', '--ack'],
      ['hub', 'unpark'], ['launch'], ['version', 'x'], ['--help'], ['run', 'x'], ['hub', 'run', 'x']]) {
      expect([argv, await runAirCli(argv, c.deps)]).toEqual([argv, 2])
    }
    expect(c.err[0]).toStartWith('usage: collab-bridge hub on')
    expect(c.asked).toEqual([])
    expect(c.launchctl.calls()).toEqual([])
  }, 20_000)
})

describe('the bin: run and hub run from source', () => {
  test('inside an agent harness the bin refuses run and hub run before anything is written', async () => {
    // the preload's ps stub chains every caller to a fake claude at pid 4100 (P43), as an agent's shell would
    const home = temp('cb-run-refused-')
    for (const argv of [['run'], ['hub', 'run']]) {
      const p = spawnBin(home, argv)
      const [code, stderr] = await Promise.all([p.exited, new Response(p.stderr).text()])
      expect([argv, code]).toEqual([argv, 1])
      expect(stderr).toContain(`✗ refused: claude (pid ${PS_STUB_HOST.pid}) is an ancestor of this process`)
      // no hub.lock taken and no hub.status.json written, so a running hub's status is never overwritten
      expect(existsSync(airPaths(home).stateDir)).toBe(false)
    }
  }, 20_000)

  test('SIGTERM, SIGINT and SIGHUP stop hub run cleanly: exit 0, stopped, the run recorded clean, one hub_stop', async () => {
    for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
      const home = temp('cb-run-signal-')
      const paths = airPaths(home)
      const stubs = join(home, 'stubs')
      mkdirSync(stubs)
      const p = spawnBin(home, ['hub', 'run'], { COLLAB_BRIDGE_BIN_PS: launchdPs(stubs) })
      let stderr = ''
      const drained = (async () => { for await (const c of p.stderr) stderr += new TextDecoder().decode(c) })()
      if (process.getuid!() !== HUB_UID) {
        // the hub's verbs belong to uid 502 alone (P10): on another account the bin refuses before the hub starts
        expect(await p.exited).toBe(1)
        await drained
        expect(stderr).toContain(`✗ refused: this is uid ${process.getuid!()}`)
        continue
      }
      await until(() => {
        if (p.exitCode !== null) throw new Error(`hub run exited ${p.exitCode} before it ran:\n${stderr}`)
        const s = readHubStatus(paths)
        return s?.word === 'running' && s.detail === null
      }, 'hub run to finish its start')
      p.kill(signal)
      expect([signal, await p.exited]).toEqual([signal, 0])
      await drained
      const s = readHubStatus(paths)!
      expect([signal, s.word, s.code, s.runs.length, s.runs.at(-1)!.clean, s.runs.at(-1)!.ended_at !== null])
        .toEqual([signal, 'stopped', null, 1, true, true])
      expect(readLedger(paths.ledger).filter((e) => e.event === 'hub_stop').map((e) => e.outcome)).toEqual(['ok'])
    }
  }, 60_000)
})
