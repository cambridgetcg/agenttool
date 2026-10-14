// The hub's Collab children (C9, R4, R6): one long-lived child per lineage, so a harness session keeps one Collab session
// across Wi-Fi drops, pipe respawns and hub restarts. The rules, all from the spec:
// - A detached child lives 10 minutes, then is drained (no new forwards; a reattach clears it) and stopped only at zero
//   calls in flight; a respawn waits for the old child's exit; a resume runs the child with AGENTOOL_COLLAB_SESSION_FILE
//   and never with AGENTOOL_COLLAB_ALLOW_CURSOR_RECOVERY (§9.6 item 3).
// - A child that dies before initialize is classified by its pinned ✖ line and never respawned automatically (§9.6 item 4).
// - A session whose credential file is gone has ended, and a parked lineage waits for Ai's repair (§9.6 item 5, P53, P54).
// Every age in memory reads the injected monotonic clock (CLOCK_MONOTONIC in the hub, which counts sleep; Review Focus 4).
import { existsSync } from 'node:fs'
import type { AgentCode } from '../failure.ts'
import type { LedgerFields } from '../ledger.ts'
import type { AirPaths } from '../paths.ts'
import { TIMING } from '../timing.ts'
import { CHILD_REQUEST_TIMEOUT_MS, CollabChild, type ChildSpec, type StartFailure } from './children.ts'
import type { LineageEntry, LineageStore } from './lineages.ts'
import { classifyStart } from './startup.ts'

export interface PoolDeps {
  spec: Omit<ChildSpec, 'sessionFile'>; store: LineageStore; paths: AirPaths
  mono(): number; now(): Date; ledger(f: LedgerFields): void
  status(lineage: string, note: string | null): void; buildChanged(): boolean
  childWindowMs?: number; requestTimeoutMs?: number
}
export type ChildFor = { ok: true; child: CollabChild } | { ok: false; code: AgentCode; message: string }

/** What the pool knows about one lineage in this hub run; lineages.json holds everything that must outlive it. */
interface Runtime {
  child: CollabChild | null
  starting: Promise<ChildFor> | null // one spawn per lineage at a time
  stopping: Promise<void> | null
  draining: boolean // no new forwards; a reattach clears it until the stop has begun
  attached: boolean
  detachedAt: number | null // monotonic
  startFailed: boolean // child_start_failed: not respawned for this lineage until the hub restarts
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
} as const

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const refuse = (code: AgentCode, message: string): ChildFor => ({ ok: false, code, message })

export class ChildPool {
  private readonly rts = new Map<string, Runtime>()
  private journalInvalid = false // P64: no new child for any lineage until the hub restarts
  private ticking = false
  private readonly windowMs: number
  private readonly requestTimeoutMs: number

  constructor(private readonly deps: PoolDeps) {
    // Children only ever get the shared journal; the private one is never opened (§11.2).
    if (deps.spec.journal !== deps.paths.sharedJournal) throw new Error('ChildPool: children only ever get the shared journal')
    this.windowMs = deps.childWindowMs ?? TIMING.childDetachedMs
    this.requestTimeoutMs = deps.requestTimeoutMs ?? CHILD_REQUEST_TIMEOUT_MS
  }

  private rt(lineage: string): Runtime {
    let r = this.rts.get(lineage)
    if (!r) {
      r = { child: null, starting: null, stopping: null, draining: false, attached: false, detachedAt: null, startFailed: false }
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
