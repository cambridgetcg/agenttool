// Seat streams on the Air (C7; spec §5.4, §6.1, §6.2, §6.6, §9.9). One LinkSession serves one ssh link to one device:
// the relay opens a stream per local pipe connection, and each stream must attach, answer a fresh challenge with its seat
// key and be told `ready` before anything else; any other message before ready closes it (§5.4). Device and user come
// from the link and the device file, never from the stream (§6.1). Only one stream per lineage is attached: the newest
// proven one wins and the older gets notice{hub_lost} (§6.2). The session PINGs on stream 0, drops a link whose PONGs
// stopped (P47), and treats the relay's relay_replaced as the end of the link (§5.3).
import type { LedgerFields } from '../ledger.ts'
import { FRAME_TYPE, FrameMalformed, FrameTooLarge, type Frame } from '../link/frame.ts'
import { Mux } from '../link/mux.ts'
import {
  callRefLineage, decodeJson, encodeMessage, MAX_ATTACH_BYTES, MAX_HANDSHAKE_BYTES, MAX_HUB_TO_PIPE, MAX_PIPE_TO_HUB,
  newChallengeNonce, parseAttach, parseCall, parseCancel, parseKnocks, parseProve, parseToolsGet, parseToolsRefused,
  type AttachMsg, type CallMsg, type ChallengeMsg, type HubKnockReportMsg, type KnocksMsg, type NoticeMsg, type ReadyMsg, type RefusedCode,
  type RefusedMsg, type ResultMsg, type ToolDef, type ToolsMsg,
} from '../link/messages.ts'
import { scaled, TIMING } from '../timing.ts'
import { shareForFolder, type DeviceFile } from './devices.ts'
import type { DeviceLink } from './dialer.ts'
import { RATES } from './limits.ts'
import type { LineageEntry, LineageStore } from './lineages.ts'
import type { ChildPool } from './pool.ts'
import { verifySeat } from './seats.ts'
import type { DeviceStatus } from './status.ts'

export interface SeatRef { device: string; user: string; lineage: string; harness: string; entrypoint: string; folder: string; stream: number }
export interface SeatHandlers { call(seat: SeatRef, m: CallMsg): Promise<ResultMsg | 'close'>; cancel(seat: SeatRef, callRef: string): void;
  knocks(seat: SeatRef, m: KnocksMsg): Promise<HubKnockReportMsg> }

/**
 * Which stream holds each lineage, across every link of the hub (§6.2: the newest wins). attach() of a lineage that is
 * already attached registers the new holder first, then calls the older one's close, which sends notice{hub_lost}.
 * detach() removes a holder only while it is still the registered one, so a late detach of a loser changes nothing.
 */
export class AttachTable {
  private readonly holders = new Map<string, () => void>()

  attach(lineage: string, close: () => void): void {
    const older = this.holders.get(lineage)
    this.holders.set(lineage, close)
    if (older !== undefined && older !== close) older()
  }

  detach(lineage: string, close: () => void): void {
    if (this.holders.get(lineage) === close) this.holders.delete(lineage)
  }

  has(lineage: string): boolean {
    return this.holders.has(lineage)
  }
}

export interface LinkSessionDeps { link: DeviceLink; device(): DeviceFile; tools(): { digest: string; list: ToolDef[] }; hubBuild: string;
  store: LineageStore; pool: ChildPool; attachments: AttachTable; handlers: SeatHandlers; status(s: Partial<DeviceStatus>): void;
  onRelayReplaced(): void; ledger(f: LedgerFields): void; mono(): number; now(): Date; stepMs?: number; pingMs?: number; pongDropMs?: number }

type Phase = 'attach' | 'prove' | 'ready' | 'closed'
interface Stream {
  id: number
  phase: Phase
  attach: AttachMsg | null
  nonce: string | null
  seat: SeatRef | null
  timer: ReturnType<typeof setTimeout> | null
  replaced: boolean            // a newer stream of the same lineage won: this one's end never detaches the lineage
  holder: (() => void) | null  // what the AttachTable calls when a newer stream wins
}

/** Everything the hub says on a seat stream (§5.4's hub → pipe rows). */
type HubToPipe = ChallengeMsg | ReadyMsg | RefusedMsg | ResultMsg | ToolsMsg | HubKnockReportMsg | NoticeMsg

const quietKnocks = (): HubKnockReportMsg => ({ t: 'knock_report', count: 0, origins: [], seqs: [] })

export class LinkSession {
  private readonly mux: Mux
  private readonly streams = new Map<number, Stream>()
  private readonly stepMs: number
  private readonly pingMs: number
  private readonly pongDropMs: number
  private lastPong = 0
  private pinger: ReturnType<typeof setInterval> | null = null
  private started = false
  private ended = false
  private resolveDone!: () => void
  private readonly done: Promise<void>

  constructor(private readonly deps: LinkSessionDeps) {
    // Inbound frames are pipe → hub: the relay already closes a local connection whose frame is over 2 MiB (§6.6).
    this.mux = new Mux({ write: (b) => this.write(b), maxInbound: MAX_PIPE_TO_HUB })
    this.stepMs = deps.stepMs ?? scaled(TIMING.handshakeStepMs)
    this.pingMs = deps.pingMs ?? scaled(TIMING.pingMs)
    this.pongDropMs = deps.pongDropMs ?? scaled(TIMING.pongDropMs)
    this.done = new Promise<void>((resolve) => { this.resolveDone = resolve })
  }

  /** Serves the link until it closes, the device is unpaired, no PONG came for pongDropMs (P47) or the relay was replaced. */
  run(): Promise<void> {
    if (this.started || this.ended) return this.done
    this.started = true
    this.lastPong = this.deps.mono()
    this.deps.link.onData((chunk) => this.onBytes(chunk))
    void this.deps.link.closed.then(() => this.end('link_closed'), () => this.end('link_closed'))
    this.mux.ping() // the first PING at once, so the relay and its pipes count freshness from now (§5.3)
    if (this.ended) return this.done // that write failed: end() ran while pinger was still null, so no interval may start
    this.pinger = setInterval(() => this.tick(), this.pingMs)
    return this.done
  }

  /** The hub is stopping or the device left (§5.4): every attached stream hears link_closing, then the link closes. */
  close(reason: string): void {
    if (this.ended) return
    for (const s of this.streams.values()) if (s.phase === 'ready') this.send(s, { t: 'notice', code: 'link_closing' })
    this.end(reason)
  }

  /** §10.4: the Collab build changed under the hub. Every attached stream hears it; the link and its calls go on. */
  notice(code: 'collab_build_changed'): void {
    if (this.ended) return
    for (const s of this.streams.values()) if (s.phase === 'ready') this.send(s, { t: 'notice', code })
  }

  private tick(): void {
    if (this.ended) return
    const d = this.currentDevice()
    if (d !== null && (d.state !== 'paired' || d.seat_public === null)) return this.close('unpaired')
    // §9.7: a Mac asleep or gone stops answering; mono counts sleep, so a long sleep drops the link at once.
    if (this.deps.mono() - this.lastPong > this.pongDropMs) return this.end('no_pong')
    this.mux.ping()
  }

  private onBytes(chunk: Uint8Array): void {
    if (this.ended) return
    let frames: Frame[]
    try {
      frames = this.mux.feed(chunk)
    } catch (e) {
      if (e instanceof FrameTooLarge) {
        for (const f of e.frames) this.onFrame(f)
        return this.oversized(e.stream)
      }
      if (e instanceof FrameMalformed) {
        for (const f of e.frames) this.onFrame(f)
        return this.end('malformed')
      }
      throw e
    }
    for (const f of frames) this.onFrame(f)
  }

  private onFrame(f: Frame): void {
    if (this.ended) return
    if (f.type === FRAME_TYPE.PONG) { this.lastPong = this.deps.mono(); return }
    if (f.type === FRAME_TYPE.OPEN) return this.onOpen(f.stream)
    if (f.type === FRAME_TYPE.CLOSE) {
      const s = this.streams.get(f.stream)
      if (s) this.finish(s)
      return
    }
    if (f.type !== FRAME_TYPE.DATA) return // the relay never PINGs the hub
    if (f.stream === 0) return this.onRelayNote(f.payload)
    const s = this.streams.get(f.stream)
    if (!s || s.phase === 'closed') return
    if (s.phase === 'attach') return this.onAttach(s, f.payload)
    if (s.phase === 'prove') return this.onProve(s, f.payload)
    return this.onSeatMessage(s, f.payload)
  }

  /** §5.3: a newer relay took hub.sock and this one exits right after saying so; the hub's DialPolicy counts these (T5). */
  private onRelayNote(payload: Uint8Array): void {
    if (decodeJson(payload)?.t !== 'relay_replaced') return
    try { this.deps.onRelayReplaced() } catch { /* status only */ }
    this.end('relay_replaced')
  }

  private onOpen(id: number): void {
    if (id === 0 || this.streams.has(id)) return // the relay never reuses an id within a link (§5.3)
    const s: Stream = { id, phase: 'attach', attach: null, nonce: null, seat: null, timer: null, replaced: false, holder: null }
    this.streams.set(id, s)
    this.arm(s)
  }

  /** Each handshake step has 5 s (§5.4); a stream that misses one is closed without an answer. */
  private arm(s: Stream): void {
    this.disarm(s)
    s.timer = setTimeout(() => {
      s.timer = null
      if (s.phase === 'attach' || s.phase === 'prove') this.closeStream(s)
    }, this.stepMs)
  }

  private disarm(s: Stream): void {
    if (s.timer !== null) { clearTimeout(s.timer); s.timer = null }
  }

  private onAttach(s: Stream, payload: Uint8Array): void {
    if (payload.byteLength > MAX_ATTACH_BYTES) return this.refuse(s, 'frame_too_large')
    const a = parseAttach(decodeJson(payload))
    if (!a) return this.closeStream(s) // anything but a well-formed attach first closes the stream (§5.4)
    const d = this.currentDevice()
    if (d === null || d.state !== 'paired' || d.seat_public === null) return this.refuse(s, 'hub_away', a.lineage)
    if (!shareForFolder(d, a.folder)) return this.refuse(s, 'folder_not_shared', a.lineage)
    const refusal = this.lineageRefusal(d, a)
    if (refusal !== null) return this.refuse(s, refusal, a.lineage)
    this.ledger({ event: 'attach', device: d.device, user: d.user, lineage: a.lineage, code: a.entrypoint })
    s.attach = a
    s.nonce = newChallengeNonce()
    s.phase = 'prove'
    this.send(s, { t: 'challenge', nonce: s.nonce })
    this.arm(s)
  }

  /** What the store says against this lineage on this device, asked at attach and again at prove (§6.2, §6.6); null if nothing. */
  private lineageRefusal(d: DeviceFile, a: AttachMsg): RefusedCode | null {
    const known = this.deps.store.get(a.lineage)
    if (known) {
      // A lineage belongs to one seat and one shared folder: its session is rooted at that folder's mirror.
      if (known.device !== d.device || known.user !== d.user) return 'seat_proof_failed'
      if (known.folder !== a.folder) return 'folder_not_shared'
      if (known.state === 'retired') return 'seat_session_ended'
      return null
    }
    // A reattach of a known lineage always comes before a new one (§6.6).
    return this.deps.pool.liveCount(d.device) >= RATES.lineagesPerDevice ? 'lineage_cap' : null
  }

  private onProve(s: Stream, payload: Uint8Array): void {
    const a = s.attach!
    if (payload.byteLength > MAX_HANDSHAKE_BYTES) return this.refuse(s, 'frame_too_large', a.lineage)
    const p = parseProve(decodeJson(payload))
    if (!p) return this.closeStream(s)
    const d = this.currentDevice()
    if (d === null || d.state !== 'paired' || d.seat_public === null) return this.refuse(s, 'hub_away', a.lineage)
    // P29: a wrong signature is a pipe bug or an impostor; the pipe answers its agent hub_away.
    if (!verifySeat(d.seat_public, d.device, d.user, a.lineage, s.nonce!, p.sig)) return this.refuse(s, 'seat_proof_failed', a.lineage)
    const share = shareForFolder(d, a.folder)
    if (!share) return this.refuse(s, 'folder_not_shared', a.lineage) // the device file changed between the two steps
    // Other streams ran during the step: the store and the live count are asked again, in the same synchronous step that
    // writes the entry and calls pool.attached, so concurrent handshakes cannot together pass the cap or a retirement.
    const refusal = this.lineageRefusal(d, a)
    if (refusal !== null) return this.refuse(s, refusal, a.lineage)
    let entry = this.deps.store.get(a.lineage)
    if (!entry) {
      // The first proven attach records the lineage, so its first call finds its seat, folder and mirror (§6.2).
      entry = { lineage: a.lineage, device: d.device, user: d.user, harness: a.harness, folder: a.folder, state: 'pending',
        session_id: null, credential_path: null, past_sessions: [], mirror_id: share.mirror_id, workspace_id: null,
        pending_start: null, parked: null, detached_since: null, created_at: this.deps.now().toISOString() } satisfies LineageEntry
      try { this.deps.store.upsert(entry) } catch { return this.refuse(s, 'hub_away', a.lineage) }
    }
    this.disarm(s)
    s.seat = { device: d.device, user: d.user, lineage: a.lineage, harness: a.harness, entrypoint: a.entrypoint, folder: a.folder, stream: s.id }
    s.phase = 'ready'
    s.holder = () => {
      s.replaced = true
      this.send(s, { t: 'notice', code: 'hub_lost' })
      this.closeStream(s)
    }
    this.deps.attachments.attach(a.lineage, s.holder)
    this.deps.pool.attached(a.lineage)
    // §9.9: skew is warned about, never bounded; it feeds only the status.
    const skew = Math.round((this.deps.now().getTime() - Date.parse(a.clock)) / 1000) || 0
    const hint = entry.state === 'live' && entry.session_id !== null && entry.workspace_id !== null
      ? { session_id: entry.session_id, workspace_id: entry.workspace_id } : null
    this.send(s, { t: 'ready', tools_digest: this.deps.tools().digest, hub_build: this.deps.hubBuild, skew_s: skew, session_hint: hint })
    this.status({ skew_s: skew })
  }

  private onSeatMessage(s: Stream, payload: Uint8Array): void {
    const seat = s.seat!
    const o = decodeJson(payload)
    switch (o?.t) {
      case 'call': {
        const m = parseCall(o)
        // §9.3 item 2: a call_ref with another lineage's prefix closes the stream.
        if (!m || callRefLineage(m.call_ref) !== seat.lineage) return this.closeStream(s)
        void this.runCall(s, seat, m)
        return
      }
      case 'cancel': {
        const m = parseCancel(o)
        if (!m || callRefLineage(m.call_ref) !== seat.lineage) return this.closeStream(s)
        try { this.deps.handlers.cancel(seat, m.call_ref) } catch { /* the forwarder only ledgers a cancel */ }
        return
      }
      case 'knocks': {
        const m = parseKnocks(o)
        if (!m) return this.closeStream(s)
        void this.runKnocks(s, seat, m)
        return
      }
      case 'tools_get': {
        if (!parseToolsGet(o)) return this.closeStream(s)
        const t = this.deps.tools()
        return this.send(s, { t: 'tools', digest: t.digest, list: t.list })
      }
      case 'tools_refused': {
        const m = parseToolsRefused(o)
        if (!m) return this.closeStream(s)
        // P51: the pipe kept its own list; hub status shows which list it refused and why.
        this.status({ refused_tools: `${seat.lineage}: ${m.digest.slice(0, 8)} ${m.reason}` })
        this.ledger({ event: 'tools_refused', device: seat.device, user: seat.user, lineage: seat.lineage, code: m.reason })
        return
      }
      default:
        return this.closeStream(s)
    }
  }

  /** The forwarder has the call once it is handed over (R18): from here, any failure is `unknown`, never a dropped answer. */
  private async runCall(s: Stream, seat: SeatRef, m: CallMsg): Promise<void> {
    let r: ResultMsg | 'close'
    try {
      r = await this.deps.handlers.call(seat, m)
    } catch {
      r = { t: 'result', call_ref: m.call_ref, outcome: 'unknown' }
    }
    if (s.phase !== 'ready') return // the stream went away meanwhile; the forwarder ledgered the result
    if (r === 'close') return this.closeStream(s)
    const payload = encodeMessage(r)
    // The forwarder checks the 4 MiB frame first; this guard keeps an oversized frame off the link whatever happens (§6.6).
    if (payload.byteLength > MAX_HUB_TO_PIPE) return this.send(s, { t: 'result', call_ref: m.call_ref, outcome: 'unknown' })
    this.mux.data(s.id, payload)
  }

  private async runKnocks(s: Stream, seat: SeatRef, m: KnocksMsg): Promise<void> {
    let r: HubKnockReportMsg
    try {
      r = await this.deps.handlers.knocks(seat, m)
    } catch {
      r = quietKnocks()
    }
    if (s.phase === 'ready') this.send(s, r)
  }

  /** A refused handshake: DATA refused{code}, then CLOSE (§5.4). */
  private refuse(s: Stream, code: RefusedCode, lineage?: string): void {
    this.send(s, { t: 'refused', code })
    const d = this.currentDevice()
    this.ledger({ event: 'attach_refused', device: d?.device, user: d?.user, lineage, code })
    this.closeStream(s)
  }

  private oversized(id: number): void {
    const s = this.streams.get(id)
    if (!s) return
    if (s.phase === 'attach' || s.phase === 'prove') return this.refuse(s, 'frame_too_large', s.attach?.lineage)
    this.closeStream(s)
  }

  /** The hub ends this stream: CLOSE toward the relay, which closes that pipe's connection. */
  private closeStream(s: Stream): void {
    if (s.phase === 'closed') return
    this.mux.close(s.id)
    this.finish(s)
  }

  /** A stream is over, from either side. A ready one that was not replaced detaches its lineage (its child's window starts). */
  private finish(s: Stream): void {
    if (s.phase === 'closed') return
    const wasReady = s.phase === 'ready'
    s.phase = 'closed'
    this.disarm(s)
    this.streams.delete(s.id)
    if (wasReady && !s.replaced && s.seat !== null && s.holder !== null) {
      this.deps.attachments.detach(s.seat.lineage, s.holder)
      this.deps.pool.detached(s.seat.lineage)
    }
  }

  private end(reason: string): void {
    if (this.ended) return
    this.ended = true
    if (this.pinger !== null) { clearInterval(this.pinger); this.pinger = null }
    for (const s of [...this.streams.values()]) this.finish(s)
    const d = this.currentDevice()
    this.ledger({ event: 'link_end', device: d?.device, user: d?.user, code: reason })
    try { this.deps.link.close() } catch { /* already gone */ }
    this.resolveDone()
  }

  private send(s: Stream, m: HubToPipe): void {
    if (s.phase === 'closed') return
    this.mux.data(s.id, encodeMessage(m))
  }

  private write(bytes: Uint8Array): void {
    if (this.ended) return
    try {
      this.deps.link.send(bytes)
    } catch {
      this.end('write_failed')
    }
  }

  private currentDevice(): DeviceFile | null {
    try { return this.deps.device() } catch { return null }
  }

  private ledger(f: LedgerFields): void {
    try { this.deps.ledger(f) } catch { /* the hub runs on without its ledger */ }
  }

  private status(s: Partial<DeviceStatus>): void {
    try { this.deps.status(s) } catch { /* status only */ }
  }
}
