// The hub's call pipeline (C7, C8, C9; spec §6.3, §6.6, §7.2, §9.3). Every remote call arrives here from its seat
// stream and leaves, at most once, toward that lineage's Collab child. In order:
//   1. the call_ref is recorded on receipt (§9.3 item 2): another lineage's prefix closes the stream, a repeat is
//      duplicate_call_ref and never runs twice; there is no result cache;
//   2. the front-door rates (§6.6): 4 calls in flight per lineage, 5 mutations a second (burst 20) per seat,
//      collab_next at least 1 s apart and journal_verify at most once a minute per lineage;
//   3. the policy decision (Task 36), which stamps, normalises, pins the workspace and refuses what remote seats may
//      not do; nothing the seat sent reaches Collab any other way;
//   4. session_start binds only to a mirror that is synced (K17: an unborn or missing mirror would let review pass
//      with no git evidence), through the pool's durable start marker (§9.3 item 8), and records the mirror's Collab
//      worktree id and workspace id from Collab's own answer (§7.2, P55);
//   5. claim, complete, takeover and attach run as edit flows under the mirror lock (Task 45); everything else is one
//      tools/call on the lineage's child;
//   6. a call is written to a child only while TIMING.callMinRemainingMs of its timeout_ms remains on the hub's own
//      monotonic clock (§5.4, as for knocks): a call held on the Air (the mirror lock, the start chain, a drain before a
//      respawn) past that is refused hub_away and never sent, so the agent's read after the pipe's unknown tells the truth
//      (P49). This is not a cancel: nothing already written to a child is ever withdrawn (§9.3 item 4, K28, K65);
//   7. knock reads run one at a time per lineage, at least RATES.knocksMinMs apart (T9): each one starts a host CLI.
//   8. a collab_session_end holds its lineage from the moment it is decided until its answer has been settled: any call
//      of that lineage meanwhile is refused hub_away and never sent, so nothing is forwarded to a Collab that has
//      already unbound (P53, "there is no legacy mode");
//   9. a fault of the hub's own after a call may have reached a child (a thrown store write, a bug) is hub_outcome_unknown,
//      ledgered forwarder_fault and logged to stderr (hub.log, §10.4), never a rejection (R18); a write that fails after
//      Collab has answered is logged and the answer still goes back.
// Every refusal is an isError result with outcome `error` (P50), so "not sent" stays definite; anything after the
// request reached a child without a definite answer is hub_outcome_unknown (§9.3 item 4). Nothing here retries.
import { bridgeFailure, type AgentCode } from '../failure.ts'
import type { LedgerFields } from '../ledger.ts'
import {
  encodeMessage, MAX_HUB_TO_PIPE, newStartNonce,
  type CallMsg, type HubKnockReportMsg, type KnocksMsg, type ResultMsg, type ToolDef, type ToolResult,
} from '../link/messages.ts'
import type { CallRegistry } from './calls.ts'
import type { CallOutcome } from './children.ts'
import { scaled, TIMING } from '../timing.ts'
import { shareForFolder, updateDevice, type DeviceFile, type DeviceShare } from './devices.ts'
import { runEditFlow } from './edit-flows.ts'
import { MinInterval, RATES, TokenBucket } from './limits.ts'
import type { LineageEntry, LineageStore } from './lineages.ts'
import { mirrorHead, mirrorWorkspaceId, syncedOid, type MirrorDeps } from './mirror.ts'
import { decide, isMutation, type Decision, type SeatCtx } from './policy.ts'
import type { ChildPool } from './pool.ts'
import type { SeatHandlers, SeatRef } from './streams.ts'
import type { MirrorHandle, MirrorRegistry } from './sync-points.ts'

export interface ForwardDeps { pool: ChildPool; store: LineageStore; calls: CallRegistry; mirrors: MirrorRegistry; mirrorDeps: MirrorDeps;
  devices(): Map<string, DeviceFile>; devicePath(device: string): string; seatTools(device: string): ToolDef[];
  knock(sessionId: string, timeoutMs: number): Promise<HubKnockReportMsg>; journal: string;
  ledger(f: LedgerFields): void; mono(): number; now(): Date }

const START = 'collab_session_start'
const END = 'collab_session_end'

export const FORWARD_MESSAGES = {
  duplicate: 'This call_ref was already received in this hub run, so it was not run again; nothing was sent.',
  inflight: 'Four Collab calls of this session are already in flight; nothing was sent. Wait for one to answer.',
  mutations: 'Too many Collab changes from this Mac in a short time (5 a second, burst 20); nothing was sent.',
  next: 'collab_next was called less than a second ago; nothing was sent.',
  verify: 'collab_journal_verify runs at most once a minute per session; nothing was sent.',
  noLineage: 'The hub has no record of this Collab session; nothing was sent.',
  notPaired: 'This Mac is not paired with the Air hub; nothing was sent.',
  noShare: 'This folder is not shared with the Air; nothing was sent. Start Claude at a shared folder\'s root.',
  ended: 'This Collab session has ended; nothing was sent. Start a new one with collab_session_start.',
  tampered: 'The mirror of this folder on the Air is missing or not at its last synced commit; nothing was sent. Ai looks on the Air.',
  late: 'This call waited on the Air past its deadline and was not sent; nothing was applied.',
  stopped: 'This session\'s Collab child on the Air was stopping, so nothing was sent; call again if you choose.',
  ending: 'A collab_session_end of this session is still in flight on the Air, so nothing was sent. Call again once it has answered.',
  unknown: 'The Collab call may or may not have taken effect on the Air. Never re-send it under a new idempotency_key: check with ' +
    'collab_task_get, collab_task_list, collab_next or collab_report_list, or replay it with the same key.',
} as const

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
/** Collab's error code of an isError result, or null (an SDK input-validation result has no structuredContent). */
const errorOf = (r: ToolResult): string | null => (isObj(r.structuredContent) && typeof r.structuredContent.error === 'string' ? r.structuredContent.error : null)
/** Silence for the tap: no read ran and nothing was marked (§8 item 4). */
const quiet = (): HubKnockReportMsg => ({ t: 'knock_report', count: 0, origins: [], seqs: [] })
const DEADLINE = { reason: 'deadline_passed' } as const
// The ledger stays content-free, so the cause of a fault of the hub's own goes to its stderr, which launchd keeps as hub.log
// (§10.4): one line of printable ASCII cut at 200 characters, like src/air/edit-flows.ts, never an argument or a body. A
// stderr that cannot be written changes nothing the agent is told.
const printable = (s: string) => s.replace(/[^\x20-\x7e]/g, '?').slice(0, 200)
const causeOf = (e: unknown): string => (e instanceof Error ? `${e.name}: ${e.message}` : String(e))
function logLine(line: string): void {
  try { process.stderr.write(`collab-bridge hub: ${line}\n`) } catch { /* the ledger line or the answer that follows still stands */ }
}

export class Forwarder implements SeatHandlers {
  private readonly inflight = new Map<string, number>()
  private readonly buckets = new Map<string, TokenBucket>()
  private readonly nextGap: MinInterval
  private readonly verifyGap: MinInterval
  private readonly knocking = new Set<string>()
  private readonly knockGap: MinInterval
  /** Lineages with a collab_session_end in flight: from the moment it is decided until its answer is settled (item 8). */
  private readonly ending = new Set<string>()
  private ledgerFailures = 0

  constructor(private readonly deps: ForwardDeps) {
    this.nextGap = new MinInterval(RATES.nextMinMs, () => deps.mono())
    this.verifyGap = new MinInterval(RATES.journalVerifyMinMs, () => deps.mono())
    this.knockGap = new MinInterval(RATES.knocksMinMs, () => deps.mono())
  }

  async call(seat: SeatRef, m: CallMsg): Promise<ResultMsg | 'close'> {
    // timeout_ms is a relative duration on the hub's own clock (§5.4), counted from receipt.
    const notAfter = this.deps.mono() + m.timeout_ms - scaled(TIMING.callMinRemainingMs)
    const verdict = this.deps.calls.accept(seat.lineage, m.call_ref)
    this.ledger({ event: 'call', device: seat.device, user: seat.user, lineage: seat.lineage, tool: m.name, call_ref: m.call_ref, code: verdict })
    if (verdict === 'foreign_prefix' || verdict === 'malformed') return 'close'
    if (verdict === 'duplicate') return this.refused(seat, m, 'duplicate_call_ref', FORWARD_MESSAGES.duplicate)
    const limited = this.rateLimited(seat, m.name)
    if (limited !== null) return this.refused(seat, m, 'rate_limited', limited)
    this.inflight.set(seat.lineage, (this.inflight.get(seat.lineage) ?? 0) + 1)
    try {
      return await this.run(seat, m, notAfter)
    } catch (e) {
      // Whatever threw, the call may already have reached a child: the agent is told "unknown", never a rejection (§9.3 item 4, R18).
      this.fault(seat, e)
      this.ledger({ event: 'result', device: seat.device, user: seat.user, lineage: seat.lineage, tool: m.name, call_ref: m.call_ref, outcome: 'unknown', code: 'forwarder_fault' })
      return this.unknown(m)
    } finally {
      const n = (this.inflight.get(seat.lineage) ?? 1) - 1
      if (n > 0) this.inflight.set(seat.lineage, n)
      else this.inflight.delete(seat.lineage)
    }
  }

  /** Recorded, never forwarded: a cancel cannot stop Collab's synchronous handlers and would only drop the result (§9.3 item 4, K28). */
  cancel(seat: SeatRef, callRef: string): void {
    this.ledger({ event: 'cancel', device: seat.device, user: seat.user, lineage: seat.lineage, call_ref: callRef })
  }

  /**
   * Only for the stream's own bound session (§8 item 3); a lineage with no live session hears count 0. Each read starts
   * a host CLI on the Air, so a seat may not start them faster than one at a time per lineage, RATES.knocksMinMs apart
   * (T9); an overlapping or early read is silence and marks nothing, and its note still taps at a later turn.
   */
  async knocks(seat: SeatRef, m: KnocksMsg): Promise<HubKnockReportMsg> {
    const received = this.deps.mono()
    const e = this.deps.store.get(seat.lineage)
    if (!e || e.state !== 'live' || e.session_id === null) return quiet()
    // The in-flight check comes before allow(), so a refused overlap does not move the window.
    if (this.knocking.has(seat.lineage)) return quiet()
    if (!this.knockGap.allow(seat.lineage)) return quiet()
    this.knocking.add(seat.lineage)
    try {
      return await this.deps.knock(e.session_id, m.timeout_ms - (this.deps.mono() - received))
    } finally {
      this.knocking.delete(seat.lineage)
    }
  }

  /** The §6.6 rates, before anything else is read. A refused call takes no token and does not move a window. */
  private rateLimited(seat: SeatRef, name: string): string | null {
    if ((this.inflight.get(seat.lineage) ?? 0) >= RATES.inflightPerLineage) return FORWARD_MESSAGES.inflight
    if (isMutation(name)) {
      const key = `${seat.device}/${seat.user}`
      let bucket = this.buckets.get(key)
      if (!bucket) {
        bucket = new TokenBucket(RATES.mutationsPerS, RATES.mutationBurst, () => this.deps.mono())
        this.buckets.set(key, bucket)
      }
      if (!bucket.take()) return FORWARD_MESSAGES.mutations
    }
    if (name === 'collab_next' && !this.nextGap.allow(seat.lineage)) return FORWARD_MESSAGES.next
    if (name === 'collab_journal_verify' && !this.verifyGap.allow(seat.lineage)) return FORWARD_MESSAGES.verify
    return null
  }

  private async run(seat: SeatRef, m: CallMsg, notAfter: number): Promise<ResultMsg> {
    const entry = this.deps.store.get(seat.lineage)
    if (!entry) return this.refused(seat, m, 'hub_away', FORWARD_MESSAGES.noLineage)
    const device = this.deps.devices().get(seat.device)
    if (!device || device.state !== 'paired') return this.refused(seat, m, 'hub_away', FORWARD_MESSAGES.notPaired)
    const share = shareForFolder(device, seat.folder)
    if (!share || share.mirror_id !== entry.mirror_id) return this.refused(seat, m, 'folder_not_shared', FORWARD_MESSAGES.noShare)
    // A retired lineage is never used again; an ended one may only start a new session (§9.2, P53).
    if (entry.state === 'retired' || (entry.state === 'ended' && m.name !== START)) return this.refused(seat, m, 'seat_session_ended', FORWARD_MESSAGES.ended)
    if (this.ending.has(seat.lineage)) return this.refused(seat, m, 'hub_away', FORWARD_MESSAGES.ending)
    const handle = this.deps.mirrors.get(seat.device, seat.user, entry.mirror_id) ?? null
    const nonce = m.name === START ? newStartNonce() : ''
    const ctx: SeatCtx = {
      device: seat.device, user: seat.user, harness: entry.harness, lineage: seat.lineage,
      sessionId: entry.state === 'live' ? entry.session_id : null,
      workspaceId: entry.workspace_id ?? share.workspace_id,
      mirrorPath: handle?.spec.mirrorPath ?? '',
      sameSeatSessions: this.deps.store.sameSeat(seat.device, seat.user),
      startNonce: nonce,
      tool: this.deps.seatTools(seat.device).find((t) => t.name === m.name) ?? null,
    }
    const d = decide(ctx, m.name, m.arguments)
    if (d.kind === 'refuse') return this.refused(seat, m, d.code, d.message)
    if (d.kind === 'session_start') return this.sessionStart(seat, m, entry, device, share, handle, d.args, nonce, notAfter)
    if (m.name !== END) return this.forwardBound(seat, m, entry, device, handle, d, notAfter)
    // Synchronously after decide(), before the first await: the arrival check above holds every later call of this lineage.
    this.ending.add(seat.lineage)
    try {
      return await this.forwardBound(seat, m, entry, device, handle, d, notAfter)
    } finally {
      this.ending.delete(seat.lineage)
    }
  }

  /** A decided call on a lineage with a session: an edit flow under the mirror lock, or one tools/call on its child. */
  private async forwardBound(seat: SeatRef, m: CallMsg, entry: LineageEntry, device: DeviceFile, handle: MirrorHandle | null,
    d: Extract<Decision, { kind: 'forward' | 'edit_flow' }>, notAfter: number): Promise<ResultMsg> {
    const got = await this.deps.pool.childFor(seat.lineage)
    if (!got.ok) return this.refused(seat, m, got.code, got.message)
    const sessionId = entry.session_id!
    if (d.kind === 'edit_flow') {
      if (!handle) return this.refused(seat, m, 'mirror_tampered', FORWARD_MESSAGES.tampered)
      const flow = await runEditFlow({
        flow: d.flow, name: m.name, args: d.args, declared: m.declared, device: seat.device, user: seat.user, sessionId,
        workspaceId: entry.workspace_id!, child: got.child, mirror: handle,
        // One MirrorDeps for the hub; the Host alias is the device's own, so a second Mac fetches from itself (§5.6).
        mirrorDeps: { ...this.deps.mirrorDeps, alias: device.host_alias }, nowMs: this.deps.now().getTime(),
        notAfterMono: notAfter, mono: () => this.deps.mono(),
      })
      if (flow.kind === 'refuse') {
        return this.refused(seat, m, flow.code, flow.message, flow.extra, flow.extra?.reason === DEADLINE.reason ? DEADLINE.reason : undefined)
      }
      return this.settle(seat, m, sessionId, flow.outcome)
    }
    // In the same turn as the write: too little time left, a child stopped since childFor answered, or a collab_session_end
    // written meanwhile (the end itself is the one call that may pass) is not sent (§9.3 item 3).
    if (this.deps.mono() >= notAfter) return this.late(seat, m)
    if (!got.child.accepting()) return this.refused(seat, m, 'hub_away', FORWARD_MESSAGES.stopped)
    if (m.name !== END && this.ending.has(seat.lineage)) return this.refused(seat, m, 'hub_away', FORWARD_MESSAGES.ending)
    return this.settle(seat, m, sessionId, await got.child.call(m.name, d.args))
  }

  /**
   * A remote session_start (§6.3 rewritten row, §9.3 item 8). A lineage with a session is forwarded to its own child,
   * resumed when needed, and Collab answers session_already_bound. Otherwise the start binds to the mirror only when its
   * HEAD reads and equals the synced ref, through the pool's durable marker, never re-sent. The lineage is read again under
   * the mirror lock, after a wait that can last minutes: one that an earlier start bound meanwhile takes the live path.
   */
  private async sessionStart(seat: SeatRef, m: CallMsg, entry: LineageEntry, device: DeviceFile, share: DeviceShare,
    handle: MirrorHandle | null, args: Record<string, unknown>, nonce: string, notAfter: number): Promise<ResultMsg> {
    if (entry.state === 'live') {
      const live = await this.startOnLive(seat, m, entry.session_id, args, notAfter)
      if (!('ended' in live)) return live
      entry = live.ended
    }
    if (!handle) return this.refused(seat, m, 'mirror_tampered', FORWARD_MESSAGES.tampered)
    const mirrorDeps: MirrorDeps = { ...this.deps.mirrorDeps, alias: device.host_alias }
    const out = await handle.lock.run(async (): Promise<ResultMsg | { live: LineageEntry }> => {
      // First under the lock: a start that waited here past its deadline reads no git and starts no child (§5.4).
      if (this.deps.mono() >= notAfter) return this.late(seat, m)
      const now = this.deps.store.get(seat.lineage)
      if (now?.state === 'live') return { live: now }
      if (now) entry = now
      const head = await mirrorHead(handle.spec, mirrorDeps)
      const synced = await syncedOid(handle.spec, mirrorDeps)
      if (head === null || synced === null || head !== synced) return this.refused(seat, m, 'mirror_tampered', FORWARD_MESSAGES.tampered)
      const got = await this.deps.pool.childFor(seat.lineage, { forStart: true })
      if (!got.ok) return this.refused(seat, m, got.code, got.message)
      const workspaceId = entry.workspace_id ?? share.workspace_id ?? await mirrorWorkspaceId(handle.spec, mirrorDeps)
      if (workspaceId === null) return this.refused(seat, m, 'mirror_tampered', FORWARD_MESSAGES.tampered)
      // The pool checks the deadline again after its own waits (the start chain, a drain, a reconcile), before the marker.
      const started = await this.deps.pool.startSession(seat.lineage, args, m.call_ref, nonce, workspaceId, notAfter)
      if ('refuse' in started) {
        // A hub_away once the deadline has passed is the pool's deadline refusal (or hides behind it): say so in the answer and the ledger.
        const late = started.refuse === 'hub_away' && this.deps.mono() >= notAfter
        return this.refused(seat, m, started.refuse, started.message, late ? DEADLINE : undefined, late ? DEADLINE.reason : undefined)
      }
      if (started.outcome === 'ok') {
        try {
          this.recordBinding(seat, share, handle, started.result)
        } catch (e) {
          this.fault(seat, e) // Collab has bound the session; a failed record must not replace its answer
        }
      }
      return this.settle(seat, m, this.deps.store.get(seat.lineage)?.session_id ?? null, started)
    })
    if (!('live' in out)) return out
    // Left the lock: the live path may wait on the child, and nothing below needs the mirror.
    const live = await this.startOnLive(seat, m, out.live.session_id, args, notAfter)
    return 'ended' in live ? this.refused(seat, m, live.code, live.message) : live
  }

  /**
   * A start on a lineage that has a session: its own child, resumed when needed, answers session_already_bound; no marker,
   * since nothing new can start. `ended` when the credential was gone (a host end, K23): the pool has ended the lineage, so
   * a start that arrived first begins a new session (P53).
   */
  private async startOnLive(seat: SeatRef, m: CallMsg, sessionId: string | null, args: Record<string, unknown>, notAfter: number):
    Promise<ResultMsg | { ended: LineageEntry; code: AgentCode; message: string }> {
    const got = await this.deps.pool.childFor(seat.lineage)
    if (got.ok) {
      // In the same turn as the write, as for a plain forward.
      if (this.deps.mono() >= notAfter) return this.late(seat, m)
      if (!got.child.accepting()) return this.refused(seat, m, 'hub_away', FORWARD_MESSAGES.stopped)
      if (this.ending.has(seat.lineage)) return this.refused(seat, m, 'hub_away', FORWARD_MESSAGES.ending)
      return this.settle(seat, m, sessionId, await got.child.call(START, args))
    }
    const now = this.deps.store.get(seat.lineage)
    if (got.code !== 'seat_session_ended' || now?.state !== 'ended') return this.refused(seat, m, got.code, got.message)
    return { ended: now, code: got.code, message: got.message }
  }

  /**
   * Collab's answer names the mirror's worktree id and the workspace (§7.2, P55). The device file is re-read under its
   * lock and written only while it is still paired, so an unpair written meanwhile by another process is never undone;
   * the registry gets the worktree id either way, so the very next claim sees it (the one-task rule needs it).
   */
  private recordBinding(seat: SeatRef, share: DeviceShare, handle: MirrorHandle, result: ToolResult): void {
    const sc = result.structuredContent
    const worktreeId = isObj(sc) && isObj(sc.worktree) && typeof sc.worktree.id === 'string' ? sc.worktree.id : null
    const workspaceId = isObj(sc) && isObj(sc.workspace) && typeof sc.workspace.id === 'string' ? sc.workspace.id : null
    if (worktreeId === null || workspaceId === null) return
    let code: 'recorded' | 'corrected' | null = null
    try {
      updateDevice(this.deps.devicePath(seat.device), (d) => {
        if (d.state !== 'paired') return null
        const s = d.shares.find((x) => x.mirror_id === share.mirror_id)
        if (!s || (s.mirror_worktree_id === worktreeId && s.workspace_id === workspaceId)) return null
        code = s.workspace_id === null ? 'recorded' : s.workspace_id !== workspaceId ? 'corrected' : null
        return { ...d, shares: d.shares.map((x) => (x === s ? { ...x, mirror_worktree_id: worktreeId, workspace_id: workspaceId } : x)) }
      })
    } catch {
      code = null
      this.ledger({ event: 'workspace_id', device: seat.device, user: seat.user, lineage: seat.lineage, code: 'device_write_failed' })
    }
    if (code !== null) this.ledger({ event: 'workspace_id', device: seat.device, user: seat.user, lineage: seat.lineage, code })
    this.deps.mirrors.set({ ...handle, worktreeId })
  }

  /**
   * One forwarded call's answer. Both ledger lines are written once the call has been forwarded (the pool and the edit
   * flows decide that themselves, and their CallOutcome says it happened): one `forward` line per call_ref, naming the
   * journal the child was given (§11.2), and one `result` line. Never an argument or a body.
   */
  private settle(seat: SeatRef, m: CallMsg, sessionId: string | null, out: CallOutcome): ResultMsg {
    const base = { device: seat.device, user: seat.user, lineage: seat.lineage, session_id: sessionId ?? undefined, tool: m.name, call_ref: m.call_ref }
    this.ledger({ event: 'forward', ...base, journal: this.deps.journal })
    if (out.outcome === 'unknown') {
      this.ledger({ event: 'result', ...base, outcome: 'unknown', code: out.reason, ms: out.ms })
      return this.unknown(m)
    }
    const msg: ResultMsg = { t: 'result', call_ref: m.call_ref, outcome: out.outcome, result: out.result }
    const bytes = encodeMessage(msg).byteLength
    if (bytes > MAX_HUB_TO_PIPE) {
      // Collab answered, but the answer cannot cross in one frame (§6.6): to the agent it is an unknown outcome.
      this.ledger({ event: 'result', ...base, outcome: 'unknown', code: 'frame_too_large', bytes, ms: out.ms })
      return this.unknown(m)
    }
    const code = out.outcome === 'error' ? errorOf(out.result) : null
    this.ledger({ event: 'result', ...base, outcome: out.outcome, code: code ?? undefined, bytes, ms: out.ms })
    if (code === 'cursor_reset_required') {
      // §9.6 item 5: the lineage is parked until Ai repairs it; Collab's answer still goes back unchanged.
      const { error: _error, message: _message, ...details } = out.result.structuredContent as Obj
      try {
        this.deps.pool.park(seat.lineage, 'cursor_reset_required', details)
      } catch (e) {
        this.fault(seat, e) // Collab answered: a failed lineage write is logged, and its answer still goes back
      }
    }
    if (out.outcome === 'ok' && m.name === END) {
      try {
        this.deps.pool.sessionEnded(seat.lineage)
      } catch (e) {
        this.fault(seat, e) // the lineage stays live in lineages.json; Collab's definite answer still goes back
      }
    }
    return msg
  }

  /** A definite "not sent" (P50). `ledgerCode` names the cause in the ledger when the agent code alone does not (deadline_passed). */
  private refused(seat: SeatRef, m: CallMsg, code: AgentCode, message: string, extra?: Record<string, unknown>, ledgerCode?: string): ResultMsg {
    this.ledger({ event: 'result', device: seat.device, user: seat.user, lineage: seat.lineage, tool: m.name, call_ref: m.call_ref, outcome: 'refused', code: ledgerCode ?? code })
    return { t: 'result', call_ref: m.call_ref, outcome: 'error', result: bridgeFailure(code, message, m.call_ref, extra) }
  }

  /** Held on the Air until too little of its timeout_ms remained: never written to a child, so never applied (§5.4). */
  private late(seat: SeatRef, m: CallMsg): ResultMsg {
    return this.refused(seat, m, 'hub_away', FORWARD_MESSAGES.late, DEADLINE, DEADLINE.reason)
  }

  private unknown(m: CallMsg): ResultMsg {
    return { t: 'result', call_ref: m.call_ref, outcome: 'unknown', result: bridgeFailure('hub_outcome_unknown', FORWARD_MESSAGES.unknown, m.call_ref) }
  }

  /** A fault of the hub's own while it handled one call: one line in hub.log, nothing of the call's arguments. */
  private fault(seat: SeatRef, e: unknown): void {
    try {
      logLine(`forward ${printable(seat.device)}/${printable(seat.user)}: ${printable(causeOf(e))}`)
    } catch { /* a cause that cannot be printed changes nothing the agent is told */ }
  }

  /**
   * The call, forward and result lines are the audit evidence (R18), but a failed append does not fail the call: it is
   * counted, and the first and every 100th failure is logged, so a ledger that stopped writing is not silent.
   */
  private ledger(f: LedgerFields): void {
    try {
      this.deps.ledger(f)
    } catch (e) {
      this.ledgerFailures += 1
      if (this.ledgerFailures === 1 || this.ledgerFailures % 100 === 0) {
        try {
          logLine(`forwarder ledger append failed (${this.ledgerFailures} so far): ${printable(causeOf(e))}`)
        } catch { /* nothing more can be said */ }
      }
    }
  }
}
