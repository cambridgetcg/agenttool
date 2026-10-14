// The hub's Collab children (C9, R4, R6): one long-lived child per lineage, so a harness session keeps one Collab session
// across Wi-Fi drops, pipe respawns and hub restarts. The rules, all from the spec:
// - A detached child lives 10 minutes, then is drained (no new forwards; a reattach clears it) and stopped only at zero
//   calls in flight; a respawn waits for the old child's exit; a resume runs the child with AGENTOOL_COLLAB_SESSION_FILE
//   and never with AGENTOOL_COLLAB_ALLOW_CURSOR_RECOVERY (§9.6 item 3).
// - A child that dies before initialize is classified by its pinned ✖ line and never respawned automatically (§9.6 item 4).
// - A session whose credential file is gone has ended, and a parked lineage waits for Ai's repair (§9.6 item 5, P53, P54).
// - session_start is the one keyless call that creates state, so its marker is on disk before it is forwarded, and an
//   unknown outcome is settled from Collab's own journal, by the start nonce in the role stamp, never by re-sending
//   (§9.3 item 8, P55, P64).
// - A lineage whose session ended may start a new one; a lineage 7 days detached is retired for good (§6.2, P53).
// Every age in memory reads the injected monotonic clock (CLOCK_MONOTONIC in the hub, which counts sleep); the 7-day
// retirement reads the wall-clock detached_since kept in lineages.json, so it survives restarts (Review Focus 4).
import { existsSync } from 'node:fs'
import type { AgentCode } from '../failure.ts'
import type { LedgerFields } from '../ledger.ts'
import type { AirPaths } from '../paths.ts'
import { readPs } from '../proc.ts'
import { TIMING } from '../timing.ts'
import { CHILD_REQUEST_TIMEOUT_MS, childEnv, CollabChild, type CallOutcome, type ChildSpec, type StartFailure } from './children.ts'
import type { LineageEntry, LineageStore } from './lineages.ts'
import { roleNonce } from './stamp.ts'
import { classifyStart } from './startup.ts'

export type HostCli = (args: string[], timeoutMs: number) => Promise<{ code: number | null; stdout: string; stderr: string }>

const MAX_TIMER_MS = 2_147_483_647
const HOST_OUTPUT_MAX = 1024 * 1024

async function readCapped(stream: ReadableStream<Uint8Array>, max: number): Promise<string> {
  const parts: Uint8Array[] = []
  let size = 0
  for await (const chunk of stream) {
    if (size < max) parts.push(chunk.subarray(0, max - size))
    size += chunk.byteLength
  }
  return Buffer.concat(parts).toString('utf8')
}

/** The installed host CLI, run the children's way: --no-env-file --config=/dev/null, cwd '/', and the children's
 *  three-key env, so a call that leaves out --db still names the shared journal, never the private one (§10.4, §11.2,
 *  R39, P14). Never a session file: `end` takes the credential as --session-file. */
export function makeHostCli(spec: Omit<ChildSpec, 'sessionFile'>): HostCli {
  const env = childEnv({ bun: spec.bun, dist: spec.dist, journal: spec.journal, home: spec.home })
  return async (args, timeoutMs) => {
    let proc: ReturnType<typeof Bun.spawn>
    try {
      proc = Bun.spawn([spec.bun, '--no-env-file', '--config=/dev/null', `${spec.dist}/agenttool-collab-host.js`, ...args], {
        cwd: '/', env, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe',
      })
    } catch {
      return { code: null, stdout: '', stderr: 'the host CLI could not be started' }
    }
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; proc.kill('SIGTERM') }, Math.min(MAX_TIMER_MS, Math.max(1, Math.floor(timeoutMs))))
    const [stdout, stderr] = await Promise.all([
      readCapped(proc.stdout as ReadableStream<Uint8Array>, HOST_OUTPUT_MAX),
      readCapped(proc.stderr as ReadableStream<Uint8Array>, HOST_OUTPUT_MAX),
    ])
    await proc.exited
    clearTimeout(timer)
    return { code: timedOut ? null : proc.exitCode, stdout, stderr }
  }
}

/** Whether a recorded child still runs: its pid is in the table and, when an lstart was recorded, it is the same process.
 *  A failed ps answers true (fail closed: an unreadable table never lets reconcile run while the old child may live). The hub
 *  passes /bin/ps (P43). */
export function liveProcAlive(psBin: string): (pid: number, lstart: string | null) => boolean {
  return (pid, lstart) => {
    const table = readPs(psBin)
    if (!table) return true
    const rec = table.get(pid)
    if (!rec) return false
    return lstart === null || rec.started_at === lstart
  }
}

/** A child's squeezed lstart, recorded in the session_start marker so a reused pid is never taken for it. */
export function liveLstartOf(psBin: string): (pid: number) => string | null {
  return (pid) => readPs(psBin)?.get(pid)?.started_at ?? null
}

export interface PoolDeps {
  spec: Omit<ChildSpec, 'sessionFile'>; store: LineageStore; paths: AirPaths; hostCli: HostCli
  mono(): number; now(): Date; ledger(f: LedgerFields): void; procAlive(pid: number, lstart: string | null): boolean
  status(lineage: string, note: string | null): void; buildChanged(): boolean
  childWindowMs?: number; retireAfterMs?: number; requestTimeoutMs?: number
  lstartOf?(pid: number): string | null
}
export type ChildFor = { ok: true; child: CollabChild } | { ok: false; code: AgentCode; message: string }
type Refusal = { refuse: AgentCode; message: string }

/** What the pool knows about one lineage in this hub run; lineages.json holds everything that must outlive it. */
interface Runtime {
  child: CollabChild | null
  starting: Promise<ChildFor> | null // one spawn per lineage at a time
  stopping: Promise<void> | null
  draining: boolean // no new forwards; a reattach clears it until the stop has begun
  attached: boolean
  detachedAt: number | null // monotonic
  startFailed: boolean // child_start_failed: not respawned for this lineage until the hub restarts
  startChain: Promise<unknown> // session_starts of one lineage run one at a time
}

const MSG = {
  unknownLineage: 'The hub has no record of this Collab session; nothing was sent.',
  retired: 'This Collab session was retired after 7 days detached; start a new Claude session.',
  parked: 'This Collab session needs a cursor repair on the Air before it can continue; nothing was sent.',
  ended: 'This Collab session has ended; start a new one with collab_session_start.',
  required: 'Start a Collab session first with collab_session_start; nothing was sent.',
  journal: 'The shared Collab journal on the Air failed verification; nothing was sent.',
  startFailed: 'Collab could not start on the Air for this session; nothing was sent.',
  build: 'The Collab build on the Air changed under the hub; nothing was sent.',
  pending: 'An earlier collab_session_start of this session has no known outcome yet; nothing was sent. Call collab_session_start again shortly.',
  stopped: "This session's Collab child on the Air was stopping, so nothing was sent; call again if you choose.",
  late: 'This collab_session_start waited on the Air past its deadline and was not sent; nothing was applied.',
} as const

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const refuse = (code: AgentCode, message: string): ChildFor => ({ ok: false, code, message })

export class ChildPool {
  private readonly rts = new Map<string, Runtime>()
  private journalInvalid = false // P64: no new child for any lineage until the hub restarts
  private reconciled = false
  private ticking = false
  private readonly windowMs: number
  private readonly retireMs: number
  private readonly requestTimeoutMs: number

  constructor(private readonly deps: PoolDeps) {
    // Children only ever get the shared journal; the private one is never opened (§11.2).
    if (deps.spec.journal !== deps.paths.sharedJournal) throw new Error('ChildPool: children only ever get the shared journal')
    this.windowMs = deps.childWindowMs ?? TIMING.childDetachedMs
    this.retireMs = deps.retireAfterMs ?? TIMING.lineageRetireMs
    this.requestTimeoutMs = deps.requestTimeoutMs ?? CHILD_REQUEST_TIMEOUT_MS
  }

  private rt(lineage: string): Runtime {
    let r = this.rts.get(lineage)
    if (!r) {
      r = { child: null, starting: null, stopping: null, draining: false, attached: false, detachedAt: null, startFailed: false, startChain: Promise.resolve() }
      this.rts.set(lineage, r)
    }
    return r
  }

  async childFor(lineage: string, o: { forStart?: boolean } = {}): Promise<ChildFor> {
    const rt = this.rt(lineage)
    if (rt.starting) return rt.starting
    let e = this.deps.store.get(lineage)
    if (!e) return refuse('hub_away', MSG.unknownLineage)
    if (e.state === 'retired') return refuse('seat_session_ended', MSG.retired)
    if (e.parked) return refuse('seat_recovery_required', MSG.parked)
    // A session whose credential is gone was ended from outside (a host end, K23): the lineage has ended (P53).
    if (e.state === 'live' && !existsSync(e.credential_path!)) e = this.markEnded(e, 'credential_missing')
    const c = rt.child
    // A live child keeps forwarding, even after a Collab reinstall (§10.4).
    if (c && c.alive() && !rt.draining && !rt.stopping && (e.state === 'live' || o.forStart)) return { ok: true, child: c }
    if (e.state !== 'live' && !o.forStart) return e.state === 'ended' ? refuse('seat_session_ended', MSG.ended) : refuse('session_required', MSG.required)
    if (this.journalInvalid) return refuse('hub_away', MSG.journal)
    if (rt.startFailed) return refuse('hub_away', MSG.startFailed)
    if (this.deps.buildChanged()) {
      this.deps.status(lineage, 'collab_build_changed')
      return refuse('collab_build_changed', MSG.build)
    }
    rt.starting = this.spawn(lineage, rt, e).finally(() => { rt.starting = null })
    return rt.starting
  }

  /** A fresh child, or a resume of the lineage's session; only after any old child of the lineage has exited. */
  private async spawn(lineage: string, rt: Runtime, e: LineageEntry): Promise<ChildFor> {
    if (rt.child) await this.stopChild(rt)
    const resume = e.state === 'live'
    const spec: ChildSpec = resume ? { ...this.deps.spec, sessionFile: e.credential_path! } : { ...this.deps.spec }
    const started = await CollabChild.start(spec, { requestTimeoutMs: this.requestTimeoutMs })
    const base = { event: 'child_start', device: e.device, user: e.user, lineage, session_id: e.session_id ?? undefined, journal: spec.journal }
    if ('failed' in started) {
      const cls = classifyStart(started.lastErrLine)
      this.deps.ledger({ ...base, outcome: 'failed', code: cls })
      return this.startFailed(lineage, rt, cls, started)
    }
    this.deps.ledger({ ...base, outcome: 'ok', code: resume ? 'resume' : 'fresh' })
    rt.child = started
    rt.draining = false
    rt.stopping = null
    void started.exited.then((code) => {
      this.deps.ledger({ event: 'child_exit', device: e.device, user: e.user, lineage, outcome: code === 0 ? 'ok' : 'error', code: code === null ? 'signal' : String(code) })
      if (rt.child === started) {
        rt.child = null
        rt.draining = false
      }
    })
    return { ok: true, child: started }
  }

  private startFailed(lineage: string, rt: Runtime, cls: ReturnType<typeof classifyStart>, f: StartFailure): ChildFor {
    if (cls === 'seat_recovery_required') {
      this.park(lineage, 'cursor_reset_required', { at: 'resume', message: f.lastErrLine ?? '' })
      return refuse('seat_recovery_required', MSG.parked)
    }
    if (cls === 'journal_invalid') {
      this.journalInvalid = true
      this.deps.status(lineage, 'journal_invalid')
      return refuse('hub_away', MSG.journal)
    }
    if (cls === 'seat_session_ended') {
      const e = this.deps.store.get(lineage)
      if (e && e.state === 'live') this.markEnded(e, 'credential_invalid')
      return refuse('seat_session_ended', MSG.ended)
    }
    rt.startFailed = true
    this.deps.status(lineage, 'child_start_failed')
    return refuse('hub_away', MSG.startFailed)
  }

  /** Drains a child: no new forwards, then the stop at zero in flight. Resolves once it has exited. */
  private stopChild(rt: Runtime): Promise<void> {
    const c = rt.child
    if (!c) return Promise.resolve()
    rt.draining = true
    if (!rt.stopping) {
      rt.stopping = c.stop().then(() => {
        if (rt.child === c) {
          rt.child = null
          rt.draining = false
        }
        rt.stopping = null
      })
    }
    return rt.stopping
  }

  private markEnded(e: LineageEntry, reason: string): LineageEntry {
    const past = e.session_id && !e.past_sessions.includes(e.session_id) ? [...e.past_sessions, e.session_id] : e.past_sessions
    const next: LineageEntry = { ...e, state: 'ended', session_id: null, credential_path: null, past_sessions: past }
    this.deps.store.upsert(next)
    this.deps.ledger({ event: 'session_ended', device: e.device, user: e.user, lineage: e.lineage, session_id: e.session_id ?? undefined, code: reason })
    const rt = this.rt(e.lineage)
    if (rt.child) void this.stopChild(rt)
    return next
  }

  startSession(lineage: string, args: Record<string, unknown>, callRef: string, nonce: string, workspaceId: string, notAfterMono?: number): Promise<CallOutcome | Refusal> {
    const rt = this.rt(lineage)
    const run = rt.startChain.then(() => this.start(lineage, args, callRef, nonce, workspaceId, notAfterMono))
    rt.startChain = run.catch(() => {})
    return run
  }

  private async start(lineage: string, args: Record<string, unknown>, callRef: string, nonce: string, workspaceId: string, notAfterMono?: number): Promise<CallOutcome | Refusal> {
    // The forwarder's deadline (§5.4): a start that waited here (the start chain, a drain, a reconcile) until too little of
    // its timeout_ms remained is never sent, so no marker is left for it. A start already written is never withdrawn.
    const late = () => notAfterMono !== undefined && this.deps.mono() >= notAfterMono
    let e = this.deps.store.get(lineage)
    if (!e) return { refuse: 'hub_away', message: MSG.unknownLineage }
    if (e.state === 'retired') return { refuse: 'seat_session_ended', message: MSG.retired }
    if (e.parked) return { refuse: 'seat_recovery_required', message: MSG.parked }
    const rt = this.rt(lineage)
    if (e.pending_start) {
      // An earlier start of this lineage has no known outcome: settle it from Collab's own state, never re-send it.
      if (rt.child) await this.stopChild(rt)
      if ((await this.reconcileOne(lineage)) === 'kept') return { refuse: 'hub_away', message: MSG.pending }
      e = this.deps.store.get(lineage)!
    }
    if (e.state === 'live' && !existsSync(e.credential_path!)) e = this.markEnded(e, 'credential_missing')
    if (late()) return { refuse: 'hub_away', message: MSG.late }
    if (e.state === 'live') {
      // The lineage has a session: its child answers session_already_bound (§6.3). No marker: nothing new can start.
      // accepting() in the same turn as call(): a child stopped after childFor answered is not sent to (§9.3 item 3).
      const got = await this.childFor(lineage)
      if (!got.ok) return { refuse: got.code, message: got.message }
      if (late()) return { refuse: 'hub_away', message: MSG.late }
      return got.child.accepting() ? got.child.call('collab_session_start', args) : { refuse: 'hub_away', message: MSG.stopped }
    }
    const got = await this.childFor(lineage, { forStart: true })
    if (!got.ok) return { refuse: got.code, message: got.message }
    const child = got.child
    if (late()) return { refuse: 'hub_away', message: MSG.late }
    if (!child.accepting()) return { refuse: 'hub_away', message: MSG.stopped }
    // The marker, durably, before the forward (§9.3 item 8): the start nonce in the role stamp finds the session later.
    this.deps.store.upsert({
      ...this.deps.store.get(lineage)!,
      pending_start: { nonce, call_ref: callRef, child_pid: child.pid, child_lstart: this.deps.lstartOf?.(child.pid) ?? null, workspace_id: workspaceId, at: this.deps.now().toISOString() },
    })
    const out = await child.call('collab_session_start', args)
    const after = this.deps.store.get(lineage)!
    const sc = out.outcome === 'ok' ? out.result.structuredContent : undefined
    const sessionId = isRecord(sc) && isRecord(sc.session) && typeof sc.session.id === 'string' ? sc.session.id : null
    if (out.outcome === 'ok' && sessionId) {
      const ws = isRecord(sc!.workspace) && typeof sc!.workspace.id === 'string' ? sc!.workspace.id : workspaceId
      // Recorded and the marker cleared before the result goes back to the pipe.
      this.deps.store.upsert({ ...after, state: 'live', session_id: sessionId, credential_path: this.deps.paths.credentialFile(sessionId), workspace_id: ws, pending_start: null })
      this.deps.ledger({ event: 'session_start', device: after.device, user: after.user, lineage, session_id: sessionId, journal: this.deps.spec.journal, outcome: 'ok' })
      return out
    }
    if (out.outcome === 'error') {
      // Collab refused it, so nothing was created; the unbound child stays for the next start.
      this.deps.store.upsert({ ...after, pending_start: null })
      return out
    }
    // Unknown: the marker stays, and the child that may hold the new session is stopped, so the next start (or the next
    // hub start) settles it from the journal.
    void this.stopChild(rt)
    return out
  }

  /** After a successful session_end through the pipe (P53). */
  sessionEnded(lineage: string): void {
    const e = this.deps.store.get(lineage)
    if (e && e.state === 'live') this.markEnded(e, 'session_end')
  }

  attached(lineage: string): void {
    const rt = this.rt(lineage)
    rt.attached = true
    rt.detachedAt = null
    if (!rt.stopping) rt.draining = false
    const e = this.deps.store.get(lineage)
    if (e && e.state !== 'retired' && e.detached_since !== null) this.deps.store.upsert({ ...e, detached_since: null })
  }

  detached(lineage: string): void {
    const rt = this.rt(lineage)
    rt.attached = false
    rt.detachedAt = this.deps.mono()
    const e = this.deps.store.get(lineage)
    if (e && e.state !== 'retired') this.deps.store.upsert({ ...e, detached_since: this.deps.now().toISOString() })
  }

  liveCount(device: string): number {
    let n = 0
    for (const e of this.deps.store.all()) {
      if (e.device !== device) continue
      const rt = this.rts.get(e.lineage)
      if (rt && (rt.attached || rt.starting !== null || (rt.child !== null && rt.child.alive()))) n += 1
    }
    return n
  }

  async tick(): Promise<void> {
    if (this.ticking) return
    this.ticking = true
    try {
      await this.drainDetached()
      await this.retireDue()
    } finally {
      this.ticking = false
    }
  }

  /** A child detached for the whole window is marked draining, and stopped once it has no call in flight (§9.6 item 3). */
  private async drainDetached(): Promise<void> {
    const mono = this.deps.mono()
    const stops: Promise<void>[] = []
    for (const rt of this.rts.values()) {
      if (!rt.child) continue
      if (!rt.attached && rt.detachedAt !== null && mono - rt.detachedAt >= this.windowMs) rt.draining = true
      if (rt.draining && !rt.stopping && rt.child.inFlight() === 0) stops.push(this.stopChild(rt))
    }
    await Promise.all(stops)
  }

  /** A lineage detached for 7 days by the wall clock, read from detached_since so it survives restarts, is retired (§6.2). */
  private async retireDue(): Promise<void> {
    const now = this.deps.now().getTime()
    for (const e of this.deps.store.all()) {
      if (e.state === 'retired' || e.detached_since === null || e.pending_start !== null) continue
      if (this.rts.get(e.lineage)?.attached) continue
      if (now - Date.parse(e.detached_since) < this.retireMs) continue
      await this.retire(e)
    }
  }

  private async retire(e: LineageEntry): Promise<void> {
    const rt = this.rt(e.lineage)
    if (rt.child) await this.stopChild(rt)
    let past = e.past_sessions
    if (e.state === 'live' && e.session_id) {
      // Every lease has expired by now (the TTL maximum is 3600 s, K26). No --release-leases: the store refuses an end
      // only for unexpired leases, and expired claims stay recoverable (§6.2).
      if (existsSync(e.credential_path!)) {
        const r = await this.deps.hostCli(['end', '--session-file', e.credential_path!, '--reason', 'lineage retired', '--db', this.deps.spec.journal], TIMING.callDefaultMs)
        this.deps.ledger({ event: 'retire_end', device: e.device, user: e.user, lineage: e.lineage, session_id: e.session_id, outcome: r.code === 0 ? 'ok' : 'error', code: r.code === null ? 'timeout' : String(r.code) })
      }
      if (!past.includes(e.session_id)) past = [...past, e.session_id]
    }
    this.deps.store.upsert({ ...this.deps.store.get(e.lineage)!, state: 'retired', session_id: null, credential_path: null, past_sessions: past })
    this.deps.ledger({ event: 'retire', device: e.device, user: e.user, lineage: e.lineage, outcome: 'ok' })
  }

  /** Once per hub start; never throws and never loops (P64). */
  async reconcile(): Promise<void> {
    if (this.reconciled) return
    this.reconciled = true
    const at = this.deps.now().toISOString()
    for (const e of this.deps.store.all()) {
      // Every lineage begins a hub run detached, so a pipe that never comes back still retires 7 days from now.
      if (e.state === 'retired' || e.detached_since !== null) continue
      try {
        this.deps.store.upsert({ ...e, detached_since: at })
      } catch {
        this.deps.status(e.lineage, 'reconcile_failed')
      }
    }
    for (const e of this.deps.store.all()) {
      if (!e.pending_start) continue
      if (this.journalInvalid) break // a broken journal is never re-verified in a loop (§9.6 item 4)
      try {
        await this.reconcileOne(e.lineage)
      } catch {
        this.deps.status(e.lineage, 'reconcile_failed')
      }
    }
  }

  /** Settles one pending_start from Collab's journal: confirm the child is gone, then look for the start nonce. */
  private async reconcileOne(lineage: string): Promise<'cleared' | 'recorded' | 'orphan' | 'kept'> {
    const e = this.deps.store.get(lineage)
    if (!e?.pending_start) return 'cleared'
    const m = e.pending_start
    const note = (outcome: string, extra: Record<string, string> = {}) =>
      this.deps.ledger({ event: 'reconcile', device: e.device, user: e.user, lineage, outcome, ...extra })
    if (this.deps.procAlive(m.child_pid, m.child_lstart)) {
      note('kept', { code: 'child_alive' })
      return 'kept'
    }
    const u = await this.unboundChild()
    if ('failed' in u) {
      const cls = classifyStart(u.lastErrLine)
      if (cls === 'journal_invalid') this.journalInvalid = true
      this.deps.status(lineage, cls === 'journal_invalid' ? 'journal_invalid' : 'child_start_failed')
      note('kept', { code: cls })
      return 'kept'
    }
    let out: CallOutcome
    try {
      out = await u.call('collab_workspace_status', { workspace_id: m.workspace_id })
    } finally {
      await u.stop()
    }
    const clear = () => this.deps.store.upsert({ ...this.deps.store.get(lineage)!, pending_start: null })
    if (out.outcome === 'error' && out.result.structuredContent?.error === 'workspace_not_found') {
      clear()
      note('cleared')
      return 'cleared'
    }
    if (out.outcome !== 'ok') {
      note('kept', { code: out.outcome === 'unknown' ? out.reason : String(out.result.structuredContent?.error ?? 'error') })
      return 'kept'
    }
    const active = out.result.structuredContent?.active_sessions
    // The nonce sits at a fixed position in the hub-built role prefix; a nonce in free text never matches (§6.4).
    const found = (Array.isArray(active) ? active : []).filter((s): s is Record<string, unknown> & { id: string } =>
      isRecord(s) && typeof s.id === 'string' && typeof s.role === 'string' && roleNonce(s.role, e.device, e.user) === m.nonce)
    if (found.length === 0) {
      clear()
      note('cleared')
      return 'cleared'
    }
    const credential = this.deps.paths.credentialFile(found[0]!.id)
    if (found.length === 1 && existsSync(credential)) {
      const ws = typeof found[0]!.workspace_id === 'string' ? found[0]!.workspace_id : m.workspace_id
      this.deps.store.upsert({ ...this.deps.store.get(lineage)!, state: 'live', session_id: found[0]!.id, credential_path: credential, workspace_id: ws, pending_start: null })
      note('recorded', { session_id: found[0]!.id })
      return 'recorded'
    }
    // Killed between Collab's commit and its credential write (K23): Ai decides; a new start is allowed.
    this.deps.status(lineage, found.map((s) => `orphan_session ${s.id}`).join('; '))
    clear()
    note('orphan', { session_id: found[0]!.id })
    return 'orphan'
  }

  park(lineage: string, cause: string, details: Record<string, unknown>): void {
    const e = this.deps.store.get(lineage)
    if (!e) return
    this.deps.store.upsert({ ...e, parked: { cause, details: isRecord(details) ? details : {} } })
    this.deps.ledger({ event: 'park', device: e.device, user: e.user, lineage, session_id: e.session_id ?? undefined, code: cause })
    this.deps.status(lineage, `needs Ai: seat_recovery ${e.session_id ?? lineage}`)
    const rt = this.rt(lineage)
    if (rt.child) void this.stopChild(rt)
  }

  /** After Ai's repair (§9.6 item 5, P54): refused while a child of the lineage still runs. */
  unpark(lineage: string): 'ok' | 'not_parked' | 'child_alive' {
    const e = this.deps.store.get(lineage)
    if (!e?.parked) return 'not_parked'
    const rt = this.rts.get(lineage)
    if (rt?.child?.alive()) return 'child_alive'
    this.deps.store.upsert({ ...e, parked: null })
    if (rt) rt.startFailed = false
    this.deps.status(lineage, null)
    this.deps.ledger({ event: 'unpark', device: e.device, user: e.user, lineage, session_id: e.session_id ?? undefined, outcome: 'ok' })
    return 'ok'
  }

  /** Drains that device's children to zero in flight, then stops them (§9.10 step 4). */
  async stopDevice(device: string): Promise<void> {
    const stops: Promise<void>[] = []
    for (const e of this.deps.store.all()) {
      const rt = this.rts.get(e.lineage)
      if (e.device === device && rt?.child) stops.push(this.stopChild(rt))
    }
    await Promise.all(stops)
  }

  /** A fresh child on the shared journal with no session (reconcile, unpair). Not a seat child: it forwards no seat call,
   *  so neither the build check nor journal_invalid gates it; its caller stops it. */
  async unboundChild(): Promise<CollabChild | StartFailure> {
    const c = await CollabChild.start({ ...this.deps.spec }, { requestTimeoutMs: this.requestTimeoutMs })
    const failed = 'failed' in c
    this.deps.ledger({ event: 'child_start', journal: this.deps.spec.journal, outcome: failed ? 'failed' : 'ok', code: failed ? classifyStart(c.lastErrLine) : 'unbound' })
    return c
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.rts.values()].map((rt) => this.stopChild(rt)))
  }
}
