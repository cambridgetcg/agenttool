// The Air's verbs (C14). `hub on` and `hub off` are Yu's: they refuse inside any agent harness and read his y from
// /dev/tty, so only Yu turns the hub on or off (spec §10.3 step 7, §10.4). `hub doctor --ack-host-key` is his too: it
// acknowledges a security warning (§5.5). `hub status`, `hub doctor` and `version` only read. The bare `run` is
// launchd's verb (the plist's ProgramArguments end `…/hub.js`, `run`: C7, §10.4) and `hub run` is the Terminal fallback
// (C14, §10.4); both are refused inside any agent harness and for any uid but 502, with no question, so no agent starts
// a hub that serves seats without Yu. `hub unpark` is Ai's repair step after a seat recovery (§9.6 item 5, P54).
// Every side effect comes through AirCliDeps; bin/collab-bridge.ts is the only place that builds the live ones.
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, rmSync, writeSync } from 'node:fs'
import { basename, dirname } from 'node:path'
import { listDevices, type DeviceFile } from './air/devices.ts'
import { distMatches, type BuildInfo } from './air/hub.ts'
import { LineageStore } from './air/lineages.ts'
import { renderPlist } from './air/plist.ts'
import {
  activeSticky, readDeviceStatus, readHostKeyAck, readHubStatus, statusLines, writeDeviceStatus, writeHostKeyAck, type DeviceStatus,
} from './air/status.ts'
import { LINEAGE_RE } from './link/messages.ts'
import { writeFileDurable } from './native.ts'
import { mkdirPrivate } from './private-dir.ts'
import type { AirPaths } from './paths.ts'
import { ancestry, HARNESS_COMMS, type ProcTable } from './proc.ts'
import { overrideActive, type Env } from './sysbin.ts'

export const HUB_LABEL = 'dev.agenttool.collab-bridge'
/** yuai's uid: the hub lives in gui/502 only, never in another account's domain on this Air (P10). */
export const HUB_UID = 502
const DOMAIN = `gui/${HUB_UID}`
const SERVICE = `${DOMAIN}/${HUB_LABEL}`

export interface AirCliDeps {
  paths: AirPaths; env: Env; selfPid: number; uid(): number; table(): ProcTable | null; ask(prompt: string): string | null
  launchctl: string; codesign: string; bun: string; hubSha: string | null; build: BuildInfo | null; collabDist: string
  runHub(): Promise<number>; out(line: string): void; err(line: string): void; now(): Date
}

export const USAGE: readonly string[] = [
  'usage: collab-bridge hub on | hub off | hub status [--json] | hub doctor [--ack-host-key] | hub run | hub unpark <lineage>',
  '       collab-bridge version | run (launchd only)',
]

const SHA_RE = /^[0-9a-f]{64}$/
/** Per-run launchd entries: apps Yu opens and one-shot jobs come and go between the baseline and any later check. */
const PER_RUN: readonly RegExp[] = [/^application\./, /^\[0x/, /^com\.apple\.xpc\.launchd\.oneshot\./]
const REPLY_MAX_BYTES = 256

/** The fixed ~/.local/bin/collab-bridge (spec §4.3 with P14's env -u): zsh -f reads no rc file, and bun gets no BUN_OPTIONS. */
export function cliLauncherText(sha: string): string {
  if (!SHA_RE.test(sha)) throw new Error('cliLauncherText: sha must be 64 lowercase hex')
  return '#!/bin/zsh -f\n'
    + `cd / && exec /usr/bin/env -u BUN_OPTIONS -u BUN_BE_BUN /Users/yuai/.bun/bin/bun --no-env-file --config=/dev/null /Users/yuai/.local/share/collab-bridge/air/${sha}/hub.js "$@"\n`
}

/** One label from a `launchctl list` row (`PID\tStatus\tLabel`), or from a line of the stored baseline (the label alone). */
function labelOf(line: string): string | null {
  const trimmed = line.trim()
  if (trimmed === '') return null
  let cols = line.split('\t')
  if (cols.length < 3) {
    const words = trimmed.split(/\s+/)
    cols = words.length >= 3 && /^(-|\d+)$/.test(words[0]!) && /^-?\d+$/.test(words[1]!) ? words
      : words[0] === 'PID' ? words : [trimmed]
  }
  if (cols.length < 3) return trimmed
  if (cols[0]!.trim() === 'PID') return null // launchctl's header
  return cols.slice(2).join(' ').trim() || null
}

export function stableLabels(launchctlList: string): string[] {
  const labels = new Set<string>()
  for (const line of launchctlList.split('\n')) {
    const label = labelOf(line)
    if (label !== null && !PER_RUN.some((re) => re.test(label))) labels.add(label)
  }
  return [...labels].sort()
}

export function labelDiff(baseline: string, current: string): { added: string[]; removed: string[] } {
  const before = new Set(stableLabels(baseline))
  const after = new Set(stableLabels(current))
  return { added: [...after].filter((l) => !before.has(l)), removed: [...before].filter((l) => !after.has(l)) }
}

/**
 * Why this process may not turn the hub on or off, or start it (`run`, `hub run`), or null when it may. Fails closed: a
 * process table that cannot be read, or that does not hold this process, cannot rule out a harness ancestor. An agent
 * may ask Yu; it never answers for him.
 */
export function hubOnRefusal(env: Env, table: ProcTable | null, selfPid: number, uid: number): string | null {
  const only = 'only Yu turns the hub on or off, from his own Terminal'
  if (env.CLAUDECODE !== undefined) return `CLAUDECODE is set (a Claude Code session); ${only}`
  for (const k of Object.keys(env).sort()) {
    if (env[k] !== undefined && (k.startsWith('CODEX_') || k.startsWith('HERMES_'))) {
      return `${k} is set (an agent harness); ${only} (if his shell exports it, run it as env -u ${k} collab-bridge …)`
    }
  }
  if (table === null) return `the process table could not be read, so an agent harness ancestor cannot be ruled out; ${only}`
  const chain = ancestry(selfPid, table)
  if (chain.length === 0) return `this process is not in the process table, so an agent harness ancestor cannot be ruled out; ${only}`
  for (const rec of chain) {
    const name = basename(rec.comm)
    if (HARNESS_COMMS.has(name)) return `${name} (pid ${rec.pid}) is an ancestor of this process; ${only}`
  }
  if (uid !== HUB_UID) return `this is uid ${uid}; the hub runs as uid ${HUB_UID} (yuai) in ${DOMAIN} only`
  return null
}

/** Reads one reply line from an open tty fd, at most REPLY_MAX_BYTES; null at once on EOF. */
function readReply(fd: number): string | null {
  const bytes: number[] = []
  const one = Buffer.alloc(1)
  while (bytes.length < REPLY_MAX_BYTES) {
    if (readSync(fd, one, 0, 1, null) !== 1) return bytes.length === 0 ? null : Buffer.from(bytes).toString('utf8')
    if (one[0] === 0x0a) break
    bytes.push(one[0]!)
  }
  return Buffer.from(bytes).toString('utf8').replace(/\r$/, '')
}

/**
 * The question, asked on /dev/tty. Under the test override it never opens the real tty: it reads COLLAB_BRIDGE_TTY, one
 * line per question, and with no such file there is no tty (spec §12.1 Prompts). No tty → null, which is never a yes.
 */
export function ttyAsk(env: Env): (prompt: string) => string | null {
  if (overrideActive(env)) {
    const file = env.COLLAB_BRIDGE_TTY
    let next = 0
    return () => {
      if (!file) return null
      let lines: string[]
      try { lines = readFileSync(file, 'utf8').split('\n') } catch { return null }
      return next < lines.length ? lines[next++]! : null
    }
  }
  return (prompt) => {
    let fd: number
    try { fd = openSync('/dev/tty', 'r+') } catch { return null } // no controlling terminal: launchd, ssh -T, a harness
    try {
      writeSync(fd, prompt)
      return readReply(fd)
    } catch {
      return null
    } finally {
      closeSync(fd)
    }
  }
}

const isYes = (answer: string | null) => answer !== null && /^y$/i.test(answer.trim())
const firstLine = (s: string) => s.split('\n').map((l) => l.trim()).find((l) => l !== '') ?? ''
const message = (e: unknown) => firstLine(String((e as Error)?.message ?? e))

/** launchctl (or codesign) with a built env, never an inherited one (P14), from cwd /. */
function run(deps: AirCliDeps, argv: string[]): { code: number | null; stdout: string; stderr: string } {
  try {
    const r = Bun.spawnSync(argv, { cwd: '/', env: { PATH: '/usr/bin:/bin', HOME: deps.paths.home }, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
    return { code: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() }
  } catch (e) {
    return { code: null, stdout: '', stderr: message(e) }
  }
}

const launchctl = (deps: AirCliDeps, ...args: string[]) => run(deps, [deps.launchctl, ...args])

/** The refusal and the y/N question shared by every verb that is Yu's alone; true when he said y. */
function yuConfirms(deps: AirCliDeps, question: string): boolean {
  const refusal = hubOnRefusal(deps.env, deps.table(), deps.selfPid, deps.uid())
  if (refusal !== null) {
    deps.err(`✗ refused: ${refusal}`)
    return false
  }
  if (!isYes(deps.ask(question))) {
    deps.err('✗ Not confirmed')
    return false
  }
  return true
}

function devicesOrNote(deps: AirCliDeps, notes: string[]): DeviceFile[] {
  try {
    return listDevices(deps.paths.devicesDir)
  } catch (e) {
    notes.push(`devices: ${message(e)}`)
    return []
  }
}

/** Each device's status as `hub status` and `hub doctor` show it: sticky warnings already acknowledged are left out (P52). */
function shownStatus(paths: AirPaths, device: string): DeviceStatus | null {
  const s = readDeviceStatus(paths, device)
  return s && { ...s, sticky: activeSticky(s.sticky, readHostKeyAck(paths, device)) }
}

/** §9.2's lines for the hub and every paired device, then a line for each device the hub has not reported on. */
function statusReport(deps: AirCliDeps, devices: DeviceFile[]): string[] {
  const paired = devices.filter((d) => d.state === 'paired')
  const shown = paired.map((d) => shownStatus(deps.paths, d.device))
  const lines = statusLines(readHubStatus(deps.paths), shown.filter((s): s is DeviceStatus => s !== null))
  paired.forEach((d, i) => { if (shown[i] === null) lines.push(`${d.device}: no status yet (is the hub on?)`) })
  for (const d of devices) if (d.state !== 'paired') lines.push(`${d.device}: ${d.state} (device file)`)
  return lines
}

/** Waits until launchd has let go of the service, so the bootstrap that follows a bootout does not race it. */
async function untilGone(deps: AirCliDeps): Promise<void> {
  for (let i = 0; i < 20; i++) {
    if (launchctl(deps, 'print', SERVICE).code !== 0) return
    await Bun.sleep(250)
  }
}

async function hubOn(deps: AirCliDeps): Promise<number> {
  const { paths } = deps
  const refusal = hubOnRefusal(deps.env, deps.table(), deps.selfPid, deps.uid())
  if (refusal !== null) {
    deps.err(`✗ refused: ${refusal}`)
    return 1
  }
  // What the plist will run must exist before Yu is asked, or launchd would restart a missing program every 10 s.
  if (deps.hubSha === null) {
    deps.err('✗ this collab-bridge is not a pinned hub bundle: run ~/.local/bin/collab-bridge, which runs ~/.local/share/collab-bridge/air/<sha>/hub.js')
    return 1
  }
  if (!existsSync(paths.hubJs(deps.hubSha))) {
    deps.err(`✗ the pinned hub bundle is missing: ${paths.hubJs(deps.hubSha)}`)
    return 1
  }
  if (!existsSync(paths.launcherExe)) {
    deps.err(`✗ the launcher app is missing: ${paths.launcherExe}`)
    return 1
  }
  if (!isYes(deps.ask('Turn the Collab bridge hub on? [y/N] '))) {
    deps.err('✗ Not confirmed')
    return 1
  }
  mkdirPrivate(paths.stateDir)
  // The first hub on records what launchd ran before the hub, so §12.3 step 8 can show the hub added exactly one label.
  if (!existsSync(paths.baselineLabels)) {
    const list = launchctl(deps, 'list')
    if (list.code !== 0) {
      deps.err(`✗ launchctl list failed (exit ${list.code}): ${firstLine(list.stderr)}; nothing was written`)
      return 1
    }
    const labels = stableLabels(list.stdout).filter((l) => l !== HUB_LABEL)
    writeFileDurable(paths.baselineLabels, labels.map((l) => `${l}\n`).join(''), 0o600)
  }
  if (!existsSync(paths.hubLog)) closeSync(openSync(paths.hubLog, 'a', 0o600))
  chmodSync(paths.hubLog, 0o600) // launchd opens StandardErrorPath with its own mode only when the file is missing
  mkdirSync(dirname(paths.plist), { recursive: true })
  writeFileDurable(paths.plist, renderPlist({ home: paths.home, sha: deps.hubSha, bun: deps.bun }), 0o644)
  if (launchctl(deps, 'bootout', SERVICE).code === 0) await untilGone(deps) // a running hub restarts on the new plist
  const boot = launchctl(deps, 'bootstrap', DOMAIN, paths.plist)
  if (boot.code !== 0) {
    deps.err(`✗ launchctl bootstrap ${DOMAIN} failed (exit ${boot.code}): ${firstLine(boot.stderr)}`)
    return 1
  }
  deps.out(`✓ Hub on: ${HUB_LABEL} is bootstrapped in ${DOMAIN}.`)
  const notes: string[] = []
  const devices = devicesOrNote(deps, notes)
  for (const line of [...statusReport(deps, devices), ...notes]) deps.out(line)
  deps.out('collab-bridge hub status shows each link once the hub has dialled (about a minute).')
  return 0
}

async function hubOff(deps: AirCliDeps): Promise<number> {
  if (!yuConfirms(deps, 'Turn the Collab bridge hub off? [y/N] ')) return 1
  const out = launchctl(deps, 'bootout', SERVICE) // not loaded is fine: off is the state Yu asked for
  rmSync(deps.paths.plist, { force: true })
  deps.out(out.code === 0 ? `✓ Hub off: ${HUB_LABEL} is booted out of ${DOMAIN} and its plist removed.`
    : `✓ Hub off: ${HUB_LABEL} was not loaded in ${DOMAIN}; its plist is removed.`)
  return 0
}

function hubStatus(deps: AirCliDeps, json: boolean): number {
  const notes: string[] = []
  const devices = devicesOrNote(deps, notes)
  if (json) {
    deps.out(JSON.stringify({
      hub: readHubStatus(deps.paths),
      devices: devices.map((d) => ({ device: d.device, state: d.state, status: shownStatus(deps.paths, d.device) })),
      ...(notes.length > 0 ? { notes } : {}),
    }))
  } else {
    for (const line of [...statusReport(deps, devices), ...notes]) deps.out(line)
  }
  return notes.length > 0 ? 1 : 0
}

/** The pinned summon-<device> lines of a known_hosts text, sorted (spec §5.6: the copy must equal Summon's pin). */
function pinLines(text: string, alias: string): string[] {
  return text.split('\n').map((l) => l.trim()).filter((l) => l.startsWith(`${alias} `)).sort()
}

function pinProblem(paths: AirPaths, device: string): string | null {
  const alias = `summon-${device}`
  let summon: string
  let copy: string
  try { summon = readFileSync(paths.summonKnownHosts, 'utf8') } catch { return `${device}: Summon's pin is missing (${paths.summonKnownHosts}); tell Yu` }
  try { copy = readFileSync(paths.knownHosts, 'utf8') } catch { return `${device}: the known_hosts copy is missing (${paths.knownHosts}); pin-device writes it` }
  const a = pinLines(copy, alias)
  const b = pinLines(summon, alias)
  if (a.length === 0 || a.join('\n') !== b.join('\n')) {
    return `${device}: the known_hosts copy differs from Summon's pin for ${alias}: never re-pin from the network; tell Yu`
  }
  return null
}

async function hubDoctor(deps: AirCliDeps, ack: boolean): Promise<number> {
  const { paths } = deps
  const warnings: string[] = []
  const devices = devicesOrNote(deps, warnings)
  if (ack) {
    const owed = devices.filter((d) => (shownStatus(paths, d.device)?.sticky.length ?? 0) > 0)
    if (owed.length === 0) {
      deps.out('No host-key warning to acknowledge.')
    } else {
      const names = owed.map((d) => d.device).join(', ')
      if (!yuConfirms(deps, `Acknowledge the host-key warning(s) of ${names}? [y/N] `)) return 1
      const at = deps.now().toISOString()
      for (const d of owed) {
        writeHostKeyAck(paths, d.device, at)
        // writeDeviceStatus drops every warning at or before the ack, so this rewrite clears them from the file at once,
        // and every later write (the hub's dial loop included) keeps them out (P52).
        const s = readDeviceStatus(paths, d.device)
        if (s) writeDeviceStatus(paths, s)
        deps.out(`✓ Acknowledged ${d.device}'s host-key warning(s) at ${at}; they are gone from the status file, and no later status write brings them back.`)
      }
    }
  }
  // The pinned bundle this command runs from.
  if (deps.hubSha === null) deps.out('hub bundle: source mode (not a pinned bundle)')
  else if (!existsSync(paths.hubJs(deps.hubSha))) warnings.push(`the pinned hub bundle is missing: ${paths.hubJs(deps.hubSha)}`)
  else deps.out(`hub bundle: ${paths.hubJs(deps.hubSha)}`)
  // The installed Collab against the build the bundle embeds (§10.4 build check).
  if (deps.build === null) deps.out('collab dist: not checked (no embedded build)')
  else if (!distMatches(deps.collabDist, deps.build)) {
    warnings.push("the installed Collab dist differs from this hub's build (collab_build_mismatch): rebuild the hub bundle from the installed build's commit")
  } else deps.out(`collab dist: matches build ${deps.build.hub_build}`)
  // The launcher: the hub's own Local Network identity (C15).
  if (!existsSync(paths.launcherExe)) warnings.push(`the launcher app is missing: ${paths.launcherExe}`)
  else {
    const v = run(deps, [deps.codesign, '--verify', '--deep', '--strict', paths.launcherApp])
    if (v.code !== 0) warnings.push(`the launcher app fails codesign --verify --deep --strict: ${firstLine(v.stderr) || `exit ${v.code}`}`)
    else deps.out('launcher: the signature verifies')
  }
  // The host-key copy against Summon's pin, for every paired device (§5.6).
  for (const d of devices) {
    if (d.state !== 'paired') continue
    const p = pinProblem(paths, d.device)
    if (p) warnings.push(p)
  }
  // launchd: the service, and every label added since the first hub on (§12.3 step 8).
  deps.out(launchctl(deps, 'print', SERVICE).code === 0 ? `launchd: ${HUB_LABEL} is loaded in ${DOMAIN}` : `launchd: ${HUB_LABEL} is not loaded in ${DOMAIN}`)
  if (!existsSync(paths.baselineLabels)) deps.out('launchd labels added since hub on: unknown (no baseline: hub on has not run)')
  else {
    const list = launchctl(deps, 'list')
    if (list.code !== 0) warnings.push(`launchctl list failed (exit ${list.code}): ${firstLine(list.stderr)}`)
    else {
      const diff = labelDiff(readFileSync(paths.baselineLabels, 'utf8'), list.stdout)
      deps.out(`launchd labels added since hub on: ${diff.added.length > 0 ? diff.added.join(', ') : 'none'}`)
      deps.out(`launchd labels removed since hub on: ${diff.removed.length > 0 ? diff.removed.join(', ') : 'none'}`)
    }
  }
  // §9.2's status lines, the sticky host-key warning among them.
  const sticky = devices.reduce((n, d) => n + (d.state === 'paired' ? (shownStatus(paths, d.device)?.sticky.length ?? 0) : 0), 0)
  for (const line of statusReport(deps, devices)) deps.out(line)
  for (const w of warnings) deps.out(`warn: ${w}`)
  return warnings.length > 0 || sticky > 0 ? 1 : 0
}

/** §9.6 item 5, after Ai's repair: a request file the running hub (or its next start) applies through pool.unpark (P54). */
function hubUnpark(deps: AirCliDeps, lineage: string): number {
  const uid = deps.uid()
  if (uid !== HUB_UID) {
    deps.err(`✗ refused: this is uid ${uid}; hub unpark runs as uid ${HUB_UID} (yuai) only`)
    return 1
  }
  const store = new LineageStore(deps.paths.lineages)
  try { store.load() } catch (e) {
    deps.err(`✗ ${message(e)}; nothing was written`)
    return 1
  }
  const entry = store.get(lineage)
  if (!entry) {
    deps.err(`✗ ${lineage} is not in ${deps.paths.lineages}; nothing was written`)
    return 1
  }
  if (entry.parked === null) {
    deps.err(`✗ ${lineage} is not parked; nothing was written`)
    return 1
  }
  mkdirPrivate(deps.paths.requestsDir)
  const req = deps.paths.unparkRequest(lineage)
  writeFileDurable(req, JSON.stringify({ v: 1, lineage, requested_at: deps.now().toISOString() }) + '\n', 0o600)
  deps.out(`Unpark requested: ${req}`)
  deps.out("It is applied at the hub's next reload (or its next start), and refused while a child of that lineage still runs.")
  return 0
}

/**
 * `run` (launchd's) and `hub run` (the Terminal fallback): the hub starts only where `hub on` could be answered, so an
 * agent cannot start one that dials devices and serves seats without Yu. No question, since launchd has no tty, and
 * nothing is touched before the refusal, so a refused start never writes `lock_held` over a running hub's status.
 */
async function startHub(deps: AirCliDeps): Promise<number> {
  const refusal = hubOnRefusal(deps.env, deps.table(), deps.selfPid, deps.uid())
  if (refusal !== null) {
    deps.err(`✗ refused: ${refusal}`)
    return 1
  }
  return deps.runHub()
}

function usage(deps: AirCliDeps): number {
  for (const line of USAGE) deps.err(line)
  return 2
}

export async function runAirCli(argv: string[], deps: AirCliDeps): Promise<number> {
  const [verb, sub, ...rest] = argv
  if (verb === 'version' && sub === undefined) {
    deps.out(JSON.stringify(deps.build ?? { build: null }))
    return 0
  }
  // launchd's verb: the plist's ProgramArguments end '…/hub.js', 'run' (spec C7, §10.4)
  if (verb === 'run' && sub === undefined) return startHub(deps)
  if (verb !== 'hub') return usage(deps)
  if (sub === 'on' && rest.length === 0) return hubOn(deps)
  if (sub === 'off' && rest.length === 0) return hubOff(deps)
  if (sub === 'status' && (rest.length === 0 || (rest.length === 1 && rest[0] === '--json'))) return hubStatus(deps, rest.length === 1)
  if (sub === 'doctor' && (rest.length === 0 || (rest.length === 1 && rest[0] === '--ack-host-key'))) return hubDoctor(deps, rest.length === 1)
  if (sub === 'run' && rest.length === 0) return startHub(deps) // the Terminal fallback (C14, §10.4)
  if (sub === 'unpark' && rest.length === 1 && LINEAGE_RE.test(rest[0]!)) return hubUnpark(deps, rest[0]!)
  return usage(deps)
}
