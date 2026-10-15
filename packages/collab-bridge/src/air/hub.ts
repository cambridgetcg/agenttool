// The Air hub's supervisor (C7, spec §10.4). `hub.js run` is this function: launchd starts it through the launcher app
// (C15), and `collab-bridge hub run` starts it from Terminal (§10.4's fallback). The start order is §10.4's:
//   (1) hub.lock with flock, which the kernel releases when its holder dies, so a stale lock never blocks a restart;
//   (2) the uid and user through getpwuid (launchd gives only HOME and PATH, and Bun's os.userInfo() reads $USER: F3,
//       Review Focus 2), the run record (P58), the device and lineage files, and the installed Collab dist against the
//       sha256s this bundle was built for;
//   (3) the policy table against a tools/list probe child on a throwaway journal, never the shared one;
//   (4) only then the reconcile (once, never in a loop, P64), the dial loops and the seat streams.
// Every deliberate refusal writes hub status, logs one line and returns 0, so launchd does not restart it every 10 s;
// only an unexpected fault returns non-zero, and five of those within 10 minutes become `needs Yu: config` at the next
// start (P58). A fault before step (2) (the state dir, hub.lock) is recorded and counted like any other, and a refusal
// before runHub (the bare `run` meeting a harness variable) is recorded by recordRefusedStart. The hub never starts a
// harness, never runs Summon and never opens the private journal.
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { AIR_LEDGER_KEYS, appendLedger, type LedgerFields } from '../ledger.ts'
import type { ToolDef } from '../link/messages.ts'
import { monoNowMs, passwdOfSelf, tryFlock } from '../native.ts'
import { sha256File } from '../nuance/git-resolve.ts'
import { airPaths, collabDist, homeOf, type AirPaths } from '../paths.ts'
import { overrideActive, systemBin, type Env } from '../sysbin.ts'
import { BACKOFF, scaled, TIMING } from '../timing.ts'
import { toolsDigest } from '../tools-digest.ts'
import { CallRegistry } from './calls.ts'
import { probeCollabTools } from './children.ts'
import { listDevices, type DeviceFile } from './devices.ts'
import { DialPolicy, liveTcpProbe, runDialLoop, type TcpProbe } from './dialer.ts'
import { Forwarder, LedgerFailures } from './forward.ts'
import { airGit } from './git.ts'
import { knockReportFor } from './knocks.ts'
import { LineageStore } from './lineages.ts'
import { liveMirrorDeps, MirrorLock } from './mirror.ts'
import { seatTools, unclassified } from './policy-table.ts'
import { ChildPool, liveLstartOf, liveProcAlive, makeHostCli } from './pool.ts'
import {
  readDeviceStatus, readHubStatus, uncleanRunsWithin, writeDeviceStatus, writeHubStatus, type DeviceStatus, type HubRun, type HubStatus, type SeatNote,
} from './status.ts'
import { AttachTable, LinkSession } from './streams.ts'
import { MirrorRegistry } from './sync-points.ts'

export interface BuildInfo { commit: string; collab_commit: string; mcp_sha256: string; host_sha256: string; hub_build: string }
declare const __COLLAB_BRIDGE_BUILD__: BuildInfo | undefined

const MCP_JS = 'agenttool-collab-mcp.js'
const HOST_JS = 'agenttool-collab-host.js'
const DEVICE_RELOAD_MS = 2_000 // §9.10 step 1: the running hub reloads the device file "at once"
const DIST_CHECK_MS = 10_000 // §10.4: a Collab reinstall after start refuses new children
const STOP_WAIT_MS = 5_000 // what a stop waits for loops and children; the rest end on stdin EOF when the hub exits
const UNPARK_RE = /^unpark-(lin_[0-9a-f]{32})\.json$/

/** The build `scripts/build-hub.ts` put into hub.js with Bun.build's define (P32); null when run from source. */
export function embeddedBuild(): BuildInfo | null {
  return typeof __COLLAB_BRIDGE_BUILD__ !== 'undefined' ? __COLLAB_BRIDGE_BUILD__ : null
}

/** A source-mode run under the test override takes the tracked dist as its own build (P32). */
export function sourceBuild(collabDist: string): BuildInfo {
  return { commit: 'source', collab_commit: 'source', mcp_sha256: sha256File(join(collabDist, MCP_JS)),
    host_sha256: sha256File(join(collabDist, HOST_JS)), hub_build: '00000000' }
}

/** Both Collab dist files hash to what the build names; a missing or unreadable file is a mismatch. */
export function distMatches(collabDist: string, build: BuildInfo): boolean {
  try {
    return sha256File(join(collabDist, MCP_JS)) === build.mcp_sha256 && sha256File(join(collabDist, HOST_JS)) === build.host_sha256
  } catch {
    return false
  }
}

export interface HubDeps { paths: AirPaths; build: BuildInfo | null; collabDist: string; bun: string; ssh: string; git: string; ps: string;
  passwd(): { uid: number; name: string }; expected: { uid: number; name: string }; mono(): number; now(): Date; rand(): number;
  tcpProbe?: TcpProbe; signal?: AbortSignal; distCheckMs?: number; deviceReloadMs?: number }

export function defaultHubDeps(env: Env): HubDeps {
  const dist = collabDist(env)
  return {
    paths: airPaths(homeOf(env)),
    build: embeddedBuild() ?? (overrideActive(env) ? sourceBuild(dist) : null),
    collabDist: dist,
    bun: systemBin('bun', env),
    ssh: systemBin('ssh', env),
    git: systemBin('git', env),
    ps: systemBin('ps', env), // production /bin/ps: the hub checks real pids (liveProcAlive)
    passwd: () => {
      const p = passwdOfSelf()
      return { uid: p.uid, name: p.name }
    },
    expected: { uid: 502, name: 'yuai' },
    mono: monoNowMs,
    now: () => new Date(),
    rand: Math.random,
  }
}

const sane = (e: unknown, max: number) => String(e instanceof Error ? e.message : e).replace(/[^\x20-\x7e]/g, '?').slice(0, max)
const text = (e: unknown) => sane(e, 200)
/** A refused start's reason is a sentence of ours that ends in what Yu must do, so it is cut far later than an error text: 200 characters lose that advice. */
const REFUSAL_MAX = 1000
const logLine = (line: string) => { try { process.stderr.write(`collab-bridge hub: ${line}\n`) } catch { /* no stderr */ } }

function privateDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  chmodSync(dir, 0o700) // the mode passed to mkdir is cut by the umask
}

const noStatus = (at: string): HubStatus => ({ word: 'running', code: null, detail: null, at, build: null, unexpected_exits: [], runs: [], seats: [] })

/**
 * A start refused before runHub ever ran: the bare `run` under launchd, which found a harness variable in the job's
 * environment or a process table it could not read (spec §10.4 Exits). It is recorded as a refused status and a clean run,
 * so `hub status` shows why the hub is not running, and the caller exits 0, so launchd does not restart it every 10 s.
 * Only while no hub holds hub.lock: a running hub's status is its own, and a refused second start must not overwrite it
 * (the same rule as the lock_held refusal, which the running hub puts back at its next reload). Never throws.
 */
export function recordRefusedStart(deps: Pick<HubDeps, 'paths' | 'build' | 'now'>, code: string, detail: string): void {
  const { paths } = deps
  try {
    privateDir(paths.stateDir)
    const fd = openSync(paths.hubLock, 'a', 0o600)
    try {
      if (tryFlock(fd) === 'busy') return
      const at = deps.now().toISOString()
      const base = readHubStatus(paths) ?? noStatus(at)
      writeHubStatus(paths, { ...base, word: 'refused', code, detail: sane(detail, REFUSAL_MAX), at, build: deps.build?.hub_build ?? null,
        runs: [...base.runs, { started_at: at, ended_at: at, clean: true }] })
    } finally {
      closeSync(fd)
    }
  } catch (e) {
    logLine(`refused start not recorded: ${text(e)}`)
  }
}

function waitAtMost(p: Promise<unknown>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([p.then(() => {}, () => {}), new Promise<void>((r) => { timer = setTimeout(r, ms) })]).finally(() => clearTimeout(timer))
}

type Probe = { ok: true; list: ToolDef[] } | { ok: false; code: string; detail: string }

/** One tools/list from a child on a throwaway journal in a fresh 0700 dir under the state dir, removed afterwards (§10.4 (3)). */
async function probeTools(deps: HubDeps): Promise<Probe> {
  const p = await probeCollabTools({ bun: deps.bun, dist: deps.collabDist, tmpRoot: deps.paths.stateDir, home: deps.paths.home })
  if (p.ok) return p
  return { ok: false, code: 'child_start_failed', detail: p.stage === 'start' ? 'the tools/list probe child did not start' : 'the probe child gave no tool list' }
}

interface DeviceRun {
  device: string; policy: DialPolicy; stopped: boolean
  wake(): void; session: LinkSession | null; done: Promise<void>
}

export async function runHub(deps: HubDeps): Promise<number> {
  const { paths } = deps
  const iso = () => deps.now().toISOString()
  const say = logLine
  let hubCode: string | null = null
  const status = (patch: Partial<HubStatus>) => {
    const base: HubStatus = readHubStatus(paths) ?? noStatus(iso())
    const next: HubStatus = { ...base, ...patch, build: deps.build?.hub_build ?? null, at: iso() }
    try { writeHubStatus(paths, next) } catch (e) { say(`hub status not written: ${text(e)}`) }
  }
  const endRun = (startedAt: string, clean: boolean): HubRun[] =>
    (readHubStatus(paths)?.runs ?? []).map((r) => (r.started_at === startedAt && r.ended_at === null ? { ...r, ended_at: iso(), clean } : r))
  const refuse = (code: string, detail: string | null, startedAt?: string): number => {
    status({ word: 'refused', code, detail, ...(startedAt ? { runs: endRun(startedAt, true) } : {}) })
    say(`refused: ${code}${detail ? ` (${detail})` : ''}`)
    return 0
  }

  // A fault before the run record exists (the state dir, hub.lock) is still an unexpected fault: launchd restarts a non-zero
  // exit every 10 s, so it is recorded as an unclean run, and five within 10 minutes stop the restarts like any other (P58).
  const startFault = (e: unknown): number => {
    say(`unexpected fault before the start: ${text(e)}`)
    const at = iso()
    const cur = readHubStatus(paths)
    const earlier = cur?.runs ?? []
    if (uncleanRunsWithin(earlier, deps.now().getTime(), BACKOFF.unexpectedExitsWindowMs) >= BACKOFF.unexpectedExitsMax) {
      status({ word: 'refused', code: 'needs Yu: config', detail: `${BACKOFF.unexpectedExitsMax} hub runs ended unexpectedly within 10 minutes`,
        runs: [...earlier, { started_at: at, ended_at: at, clean: true }] })
      return 0
    }
    status({ word: 'stopped', detail: `unexpected fault: ${text(e)}`, runs: [...earlier, { started_at: at, ended_at: at, clean: false }],
      unexpected_exits: [...(cur?.unexpected_exits ?? []), at] })
    return 1
  }

  // (1) One hub per user. Closing the fd (any exit, a crash included) releases the flock.
  let fd: number
  let lock: 'locked' | 'busy'
  try {
    privateDir(paths.stateDir)
    fd = openSync(paths.hubLock, 'a', 0o600)
    try { lock = tryFlock(fd) } catch (e) {
      closeSync(fd)
      throw e
    }
  } catch (e) {
    return startFault(e)
  }
  try {
    if (lock === 'busy') return refuse('lock_held', 'another hub is already running for this user')
    return await supervise()
  } finally {
    closeSync(fd)
  }

  async function supervise(): Promise<number> {
    // (2) The user from the passwd database, never from the environment.
    let me: { uid: number; name: string }
    try { me = deps.passwd() } catch (e) { return refuse('wrong_user', `getpwuid failed: ${text(e)}`) }
    if (me.uid !== deps.expected.uid || me.name !== deps.expected.name) {
      return refuse('wrong_user', `running as uid ${me.uid} (${me.name}); the hub runs only as ${deps.expected.name}, uid ${deps.expected.uid}`)
    }
    const startedAt = iso()
    const earlier = readHubStatus(paths)?.runs ?? []
    // A crash, an abort, an OOM kill or a SIGKILL never records its end, so it counts as unclean too (P58). Seat notes are
    // this run's to derive: parked lineages from lineages.json below, the rest from the pool as they happen.
    status({ word: 'running', code: null, detail: 'starting', runs: [...earlier, { started_at: startedAt, ended_at: null, clean: false }], seats: [] })
    try {
      return await serve(startedAt, earlier)
    } catch (e) {
      say(`unexpected fault during start: ${text(e)}`)
      const cur = readHubStatus(paths)
      status({ word: 'stopped', detail: `unexpected fault: ${text(e)}`, runs: endRun(startedAt, false), unexpected_exits: [...(cur?.unexpected_exits ?? []), iso()] })
      return 1
    }
  }

  async function serve(startedAt: string, earlier: HubRun[]): Promise<number> {
    if (uncleanRunsWithin(earlier, deps.now().getTime(), BACKOFF.unexpectedExitsWindowMs) >= BACKOFF.unexpectedExitsMax) {
      return refuse('needs Yu: config', `${BACKOFF.unexpectedExitsMax} hub runs ended unexpectedly within 10 minutes`, startedAt)
    }
    let devices: DeviceFile[]
    try { devices = listDevices(paths.devicesDir) } catch (e) { return refuse('needs Yu: config', text(e), startedAt) }
    const store = new LineageStore(paths.lineages)
    try { store.load() } catch (e) { return refuse('needs Yu: config', text(e), startedAt) }
    const build = deps.build
    if (build === null || !distMatches(deps.collabDist, build)) {
      return refuse('collab_build_mismatch', 'the installed Collab is not the build this hub was made for; rebuild the hub bundle from the installed build\'s commit', startedAt)
    }

    let finished = false
    // A failed append never stops the hub, but it is never silent: the one LedgerFailures counts it, whichever writer failed, and
    // logs the 1st and every 100th (the Task 24 rule: the error code, never its message). The Forwarder is handed the append
    // itself, which throws, and counts its own failures there; every other writer calls its ledger unguarded, so theirs is the
    // wrapper, which catches.
    const ledgerFailures = new LedgerFailures()
    const append = (f: LedgerFields) => { if (!finished) appendLedger(paths.ledger, AIR_LEDGER_KEYS, f) }
    const ledger = (f: LedgerFields) => {
      try { append(f) } catch (e) { ledgerFailures.note(e) }
    }

    // (3) The policy table against what this Collab build really lists (§6.3: fail closed).
    const probed = await probeTools(deps)
    if (!probed.ok) return refuse(probed.code, probed.detail, startedAt)
    const bad = unclassified(probed.list.map((t) => t.name))
    if (bad.length > 0) return refuse('policy_unclassified_tool', bad.join(', '), startedAt)
    const seatList = (d: DeviceFile) => {
      const list = seatTools(probed.list, d.device, d.user)
      return { digest: toolsDigest(list), list }
    }
    const seatLists = new Map<string, { digest: string; list: ToolDef[] }>()
    try {
      for (const d of devices) seatLists.set(d.device, seatList(d))
    } catch (e) {
      // reduceToolSchema throws when a field the hub limits is gone from Collab's schema: fail closed (§6.3).
      return refuse('policy_unclassified_tool', `the seat tool list cannot be built: ${text(e)}`, startedAt)
    }
    ledger({ event: 'probe', outcome: 'ok', code: toolsDigest(probed.list) })

    // (4) Children, mirrors, seats and links.
    let buildChanged = false
    let stopping = false
    const seatNotes = new Map<string, SeatNote>()
    for (const e of store.all()) {
      if (e.parked) seatNotes.set(e.lineage, { lineage: e.lineage, device: e.device, user: e.user, session_id: e.session_id, note: `needs Ai: seat_recovery ${e.session_id ?? e.lineage}` })
    }
    status({ seats: [...seatNotes.values()] })
    // After a Collab reinstall the host CLI is a host.js the hub has not verified (checkDist): knock reads and retirement run none (§10.4).
    const hostCli = makeHostCli({ bun: deps.bun, dist: deps.collabDist, journal: paths.sharedJournal, home: paths.home }, { refused: () => buildChanged })
    const pool = new ChildPool({
      spec: { bun: deps.bun, dist: deps.collabDist, journal: paths.sharedJournal, home: paths.home },
      store, paths, hostCli, mono: deps.mono, now: deps.now, ledger, procAlive: liveProcAlive(deps.ps), lstartOf: liveLstartOf(deps.ps),
      status: (lineage, note) => {
        if (finished) return
        const e = store.get(lineage)
        if (note === null) seatNotes.delete(lineage)
        else seatNotes.set(lineage, { lineage, device: e?.device ?? 'unknown', user: e?.user ?? 'unknown', session_id: e?.session_id ?? null, note })
        if (note === 'journal_invalid') hubCode = 'journal_invalid' // §9.8: every seat reads hub_away until a restart
        status({ code: hubCode, seats: [...seatNotes.values()] })
      },
      buildChanged: () => buildChanged,
      childWindowMs: scaled(TIMING.childDetachedMs),
    })

    const mirrors = new MirrorRegistry()
    let current = new Map(devices.map((d) => [d.device, d]))
    const forwarder = new Forwarder({
      pool, store, calls: new CallRegistry(), mirrors,
      mirrorDeps: liveMirrorDeps({ paths, git: airGit({ git: deps.git, home: paths.home }), ssh: deps.ssh, alias: 'collab-nuance' }),
      devices: () => current, devicePath: (d) => paths.deviceFile(d), seatTools: (d) => seatLists.get(d)?.list ?? [],
      knock: (sid, ms) => knockReportFor(sid, ms, { hostCli, journal: paths.sharedJournal, index: () => store.sessionIndex() }),
      journal: paths.sharedJournal, ledger: append, ledgerFailures, mono: deps.mono, now: deps.now,
    })
    const attachments = new AttachTable()

    let fault!: (e: unknown) => void
    const faulted = new Promise<unknown>((resolve) => { fault = resolve })
    let requestStop!: () => void
    const stopRequested = new Promise<void>((resolve) => { requestStop = resolve })
    if (deps.signal) {
      if (deps.signal.aborted) requestStop()
      else deps.signal.addEventListener('abort', () => requestStop(), { once: true })
    }

    const deviceStatus = (device: string, patch: Partial<DeviceStatus>) => {
      if (finished) return
      try {
        const cur = readDeviceStatus(paths, device)
        writeDeviceStatus(paths, { device, word: 'connecting', reason: null, since: iso(), hint: null, relay_contested: false, sticky: [],
          refused_tools: null, skew_s: null, ...cur, ...patch })
      } catch (e) { say(`device status not written for ${device}: ${text(e)}`) }
    }

    const runs = new Map<string, DeviceRun>()
    const halted = new Set<string>() // stopped for Yu (auth, config, noise) or unpaired: dialled again only after a restart
    const unpaired = new Set<string>() // the devices whose §9.10 steps 1 and 4 this run has done

    const prepare = (d: DeviceFile) => {
      if (!seatLists.has(d.device)) seatLists.set(d.device, seatList(d)) // a device paired after the start
      for (const s of d.shares) {
        if (s.remote_gitdir === null) continue
        const known = mirrors.get(d.device, d.user, s.mirror_id)
        mirrors.set({
          spec: { device: d.device, user: d.user, mirrorId: s.mirror_id, mirrorPath: paths.mirrorDir(d.device, d.user, s.mirror_id),
            airClone: s.air_clone, remoteGitdir: s.remote_gitdir, caps: s.caps },
          lock: new MirrorLock(), worktreeId: s.mirror_worktree_id ?? known?.worktreeId ?? null,
        })
      }
    }

    const startLoop = (d: DeviceFile) => {
      prepare(d)
      // Only the sticky warnings carry over from an earlier run (§5.5, P52); every other field starts afresh. No ack filter
      // here: writeDeviceStatus drops every warning at or before the ack stamp on each write, this hub's included (Task 47).
      const policy = new DialPolicy({ mono: deps.mono, now: deps.now, rand: deps.rand, sticky: readDeviceStatus(paths, d.device)?.sticky ?? [] })
      try {
        writeDeviceStatus(paths, { device: d.device, word: 'connecting', reason: null, since: iso(), hint: null, relay_contested: false,
          sticky: policy.sticky(), refused_tools: null, skew_s: null })
      } catch (e) { say(`device status not written for ${d.device}: ${text(e)}`) }
      // One backoff sleep at a time; a stop or an unpair ends it at once instead of waiting out a 15-minute away cap.
      let wakeSleep: (() => void) | null = null
      const r: DeviceRun = { device: d.device, policy, stopped: false, wake: () => wakeSleep?.(), session: null, done: Promise.resolve() }
      const own = (patch: Partial<DeviceStatus>) => { if (!r.stopped) deviceStatus(d.device, patch) }
      const sleep = (ms: number) => new Promise<void>((resolve) => {
        if (r.stopped || stopping) return resolve()
        const h = setTimeout(() => { wakeSleep = null; resolve() }, scaled(ms)) // P33: the backoff scales with every link deadline in tests
        wakeSleep = () => { clearTimeout(h); wakeSleep = null; resolve() }
      })
      runs.set(d.device, r)
      r.done = runDialLoop({
        device: d, paths, ssh: deps.ssh, policy, configExists: () => existsSync(paths.sshConfig),
        onLink: async (link) => {
          const s = new LinkSession({
            link, device: () => current.get(d.device) ?? { ...d, state: 'unpaired', seat_public: null },
            tools: () => seatLists.get(d.device)!, hubBuild: build.hub_build, store, pool, attachments, handlers: forwarder,
            status: own, onRelayReplaced: () => { if (policy.noteRelayReplaced()) own({ relay_contested: true }) },
            ledger, mono: deps.mono, now: deps.now,
          })
          r.session = s
          try {
            if (r.stopped || stopping) s.close('hub_stopping')
            else await s.run()
          } finally {
            r.session = null
          }
        },
        status: own, ledger, tcpProbe: deps.tcpProbe ?? liveTcpProbe, stopped: () => r.stopped || stopping, sleep,
      }).then((result) => {
        if (runs.get(d.device) === r) runs.delete(d.device)
        if (result === 'needs_yu') halted.add(d.device)
      }, (e) => fault(e))
    }

    const applyUnparkRequests = () => {
      let names: string[]
      try { names = readdirSync(paths.requestsDir) } catch { return }
      for (const name of names) {
        const m = UNPARK_RE.exec(name)
        if (!m) continue
        const result = pool.unpark(m[1]!) // P54: refused while a child of that lineage is alive
        ledger({ event: 'unpark_request', lineage: m[1]!, outcome: result })
        try { rmSync(join(paths.requestsDir, name), { force: true }) } catch { /* removed on the next tick */ }
      }
    }

    let damagedSaid = false // one log line per damaged spell, not one per tick
    const reload = async () => {
      let fresh: DeviceFile[] | null = null
      try {
        fresh = listDevices(paths.devicesDir)
      } catch (e) {
        if (!damagedSaid) say(`device files not reloaded, keeping the last good view: ${text(e)}`)
        damagedSaid = true
      }
      if (fresh !== null) {
        damagedSaid = false
        current = new Map(fresh.map((d) => [d.device, d]))
        // Every device this run has dialled: one with a loop, and one whose loop stopped for Yu (needs Yu: auth, config,
        // noise), whose children are still detached. Unpairing the second is as much §9.10 as the first (Task 63 launcher-1-5).
        for (const name of new Set([...runs.keys(), ...halted])) {
          const d = current.get(name)
          if (unpaired.has(name) || (d && d.state === 'paired' && d.seat_public !== null)) continue
          // §9.10 steps 1 and 4: the link drops, the device is never dialled again in this run, its children stop. Once.
          unpaired.add(name)
          const r = runs.get(name)
          if (r) {
            r.stopped = true
            r.wake()
            r.session?.close('unpaired')
            runs.delete(name)
          }
          halted.add(name)
          await pool.stopDevice(name)
          deviceStatus(name, { word: 'unpaired', reason: null, hint: null })
          ledger({ event: 'unpaired', device: name })
        }
        for (const d of fresh) {
          if (d.state === 'paired' && d.seat_public !== null && !runs.has(d.device) && !halted.has(d.device) && !stopping) startLoop(d)
        }
      }
      applyUnparkRequests()
      await pool.tick()
      // A second start that was refused (lock_held) wrote over this hub's status: put it back.
      if (!stopping && readHubStatus(paths)?.word !== 'running') status({ word: 'running', code: hubCode, detail: null })
    }

    const checkDist = () => {
      if (buildChanged || distMatches(deps.collabDist, build)) return
      buildChanged = true // the pool refuses new children; live ones keep forwarding (§10.4)
      hubCode = 'collab_build_changed'
      status({ code: hubCode, detail: 'the Collab build changed under the hub: rebuild the hub bundle from the installed build\'s commit, then restart' })
      ledger({ event: 'collab_build_changed', code: build.hub_build })
      for (const r of runs.values()) r.session?.notice('collab_build_changed')
    }

    // A stop that arrived during the probe (or during the reconcile, which cannot be cut short) is acted on before the next
    // step: no reconcile, no dial loop, no TCP probe or ssh for a hub that was told to stop, so launchd's 20 s are not spent
    // on a start and the run ends clean (Task 63 launcher-1-6).
    const stopWanted = () => deps.signal?.aborted === true
    try {
      if (!stopWanted()) {
        await pool.reconcile() // never throws, once per start (P64)
        if (!stopWanted()) {
          applyUnparkRequests()
          for (const d of devices) if (d.state === 'paired' && d.seat_public !== null) startLoop(d)
          status({ word: 'running', code: hubCode, detail: null })
          ledger({ event: 'hub_start', code: build.hub_build })
        }
      }
    } catch (e) {
      fault(e) // stopped below like any other fault, so no loop outlives this run
    }

    let ticking = false
    const reloadTimer = setInterval(() => {
      if (ticking || stopping) return
      ticking = true
      reload().catch((e) => fault(e)).finally(() => { ticking = false })
    }, deps.deviceReloadMs ?? DEVICE_RELOAD_MS)
    const distTimer = setInterval(() => {
      if (stopping) return
      try { checkDist() } catch (e) { fault(e) }
    }, deps.distCheckMs ?? DIST_CHECK_MS)

    const ended = await Promise.race([stopRequested.then(() => null), faulted.then((e) => ({ e }))])
    stopping = true
    clearInterval(reloadTimer)
    clearInterval(distTimer)
    // §5.4: every attached stream hears link_closing; the pipes reattach when the hub returns.
    for (const r of runs.values()) {
      r.stopped = true
      r.wake()
      r.session?.close('hub_stopping')
    }
    await waitAtMost(Promise.all([...runs.values()].map((r) => r.done)), STOP_WAIT_MS)
    await waitAtMost(pool.stopAll(), STOP_WAIT_MS)
    const clean = ended === null
    if (!clean) say(`unexpected fault: ${text(ended.e)}`)
    const cur = readHubStatus(paths)
    status({ word: 'stopped', code: clean ? null : 'unexpected_fault', detail: clean ? null : text(ended.e), runs: endRun(startedAt, clean),
      ...(clean ? {} : { unexpected_exits: [...(cur?.unexpected_exits ?? []), iso()] }) })
    ledger({ event: 'hub_stop', outcome: clean ? 'ok' : 'error' })
    finished = true
    return clean ? 0 : 1
  }
}
