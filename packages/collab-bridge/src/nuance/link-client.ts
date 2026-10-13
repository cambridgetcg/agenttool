// The pipe's link (spec §5.4, §9.4, §9.6): one local connection to the relay's run/hub.sock, which the relay turns into
// this lineage's stream to the hub. It runs the handshake (attach, challenge, prove, then ready or refused), takes the
// relay's copied PINGs as the only measure of freshness, and while detached redials every 2 s ±20% as long as its host
// lives (P40), so a link heals on its own and never waits for the agent's next call (Review Focus 3). Every connect
// error is just "detached" (Bun reports them all as ENOENT, F2, P12); every age is on the caller's monotonic clock,
// which counts sleep (Review Focus 4). It never resends anything: what to answer for a call that was in flight when a
// link went away is the pipe's business (lost()).
import { encodeFrame, FRAME_TYPE, FrameDecoder, type Frame } from '../link/frame.ts'
import {
  decodeJson, encodeMessage, MAX_ATTACH_BYTES, MAX_HUB_TO_PIPE, parseChallenge, parseHubKnockReport, parseNotice, parseReady,
  parseRefused, parseResult, parseTools,
  type AttachMsg, type CallMsg, type CancelMsg, type HubKnockReportMsg, type KnocksMsg, type NoticeMsg, type ProveMsg, type ReadyMsg,
  type RefusedCode, type ResultMsg, type ToolsGetMsg, type ToolsMsg, type ToolsRefusedMsg,
} from '../link/messages.ts'
import { socketPathOk } from '../paths.ts'
import { scaled, TIMING } from '../timing.ts'
import { Outbox } from './unix.ts'

export type LinkState = 'detached' | 'connecting' | 'ready' | 'stopped'
export interface LinkSocket { write(bytes: Uint8Array): void; end(): void }
export type Connect = (path: string, h: { data(b: Uint8Array): void; close(): void }) => Promise<LinkSocket>

/**
 * Bun.connect on a unix socket. Any failure rejects (P12). Bun's socket.write takes only what the kernel accepts, so the
 * rest waits in an Outbox (Task 23) for drain, in order; close() is called once, when the peer or the kernel ends the
 * connection (a write of -1 included), never after our own end(), which drops whatever still waits.
 */
export const bunConnect: Connect = async (path, h) => {
  let closed = false
  let out: Outbox | null = null
  const gone = () => {
    if (closed) return
    closed = true
    out?.clear()
    h.close()
  }
  const sock = await Bun.connect({
    unix: path,
    socket: {
      data(_s, chunk) { if (!closed) h.data(chunk) },
      drain() { out?.drain() },
      end() { gone() },
      close() { gone() },
      error() { gone() },
    },
  })
  const box = new Outbox(sock, { onDead: gone })
  out = box
  return {
    write(bytes) { if (!closed) box.push(bytes) },
    end() {
      if (closed) return
      closed = true // our own end: no close() callback (P18: nothing waits for a reply after it)
      box.clear()
      sock.end()
    },
  }
}

export interface LinkHandlers {
  ready(r: ReadyMsg): void
  result(r: ResultMsg): void
  tools(t: ToolsMsg): void
  knockReport(k: HubKnockReportMsg): void
  notice(n: NoticeMsg): void
  refused(code: RefusedCode): void
  /** A link that was ready went away (a drop, CLOSE, hub_lost, link_closing). Once per ready link; never on stop(). */
  lost(): void
}

export interface LinkClientDeps {
  sockPath: string
  attach(): AttachMsg
  sign(nonce: string): string
  mono(): number
  rand(): number
  hostAlive(): boolean
  on: LinkHandlers
  connect?: Connect
  timers?: { setTimeout(fn: () => void, ms: number): unknown; clearTimeout(h: unknown): void }
  reattachMs?: number
  staleMs?: number
  stepMs?: number
}

/** Refusals the hub may answer differently later: keep redialing. Every other code stops redialing and is kept (§9.2). */
const REDIAL_AFTER: ReadonlySet<RefusedCode> = new Set<RefusedCode>(['hub_away', 'lineage_cap'])
const JITTER = 0.2

export class LinkClient {
  private st: LinkState = 'detached'
  private conn = 0 // bumped by every dial and every teardown, so callbacks of an older connection do nothing
  private sock: LinkSocket | null = null
  private phase: 'challenge' | 'ready_wait' | 'ready' = 'challenge'
  private stepTimer: unknown = null
  private redialTimer: unknown = null
  private lastFresh = 0
  private refused: RefusedCode | 'socket_path_too_long' | null = null
  private readonly timers: NonNullable<LinkClientDeps['timers']>
  private readonly connect: Connect
  private readonly reattachMs: number
  private readonly staleMs: number
  private readonly stepMs: number

  constructor(private readonly deps: LinkClientDeps) {
    this.timers = deps.timers ?? { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) }
    this.connect = deps.connect ?? bunConnect
    this.reattachMs = deps.reattachMs ?? scaled(TIMING.reattachMs)
    this.staleMs = deps.staleMs ?? scaled(TIMING.staleMs)
    this.stepMs = deps.stepMs ?? scaled(TIMING.handshakeStepMs)
  }

  /** Connects now; afterwards it redials on its own while detached and the host lives. */
  start(): void {
    if (this.st !== 'detached' || this.sock !== null || this.redialTimer !== null) return
    this.dial()
  }

  /** Closes the link for good. lost() is not called: the pipe is stopping and answers its own calls. */
  stop(): void {
    this.st = 'stopped'
    if (this.redialTimer !== null) { this.timers.clearTimeout(this.redialTimer); this.redialTimer = null }
    this.teardown()
  }

  state(): LinkState {
    return this.st
  }

  /** Ready, and the last copied PING (or the ready itself) is at most staleMs old on the monotonic clock (§9.4). */
  fresh(): boolean {
    return this.st === 'ready' && this.deps.mono() - this.lastFresh <= this.staleMs
  }

  /** Writes one message on the stream; a stale or unready link takes nothing (§9.4: no new call into a stale link). */
  send(m: CallMsg | CancelMsg | ToolsGetMsg | ToolsRefusedMsg | KnocksMsg): 'written' | 'not_ready' {
    if (!this.fresh() || this.sock === null) return 'not_ready'
    try {
      this.sock.write(encodeFrame(FRAME_TYPE.DATA, 0, encodeMessage(m)))
    } catch {
      this.dropped()
      return 'not_ready'
    }
    return 'written'
  }

  /** The latest refusal since the last ready (P29: a refusal reaches the agent as its own code or as hub_away). */
  lastRefused(): RefusedCode | 'socket_path_too_long' | null {
    return this.refused
  }

  private dial(): void {
    if (this.st === 'stopped') return
    if (!socketPathOk(this.deps.sockPath)) { // Bun would bind or dial a longer path silently (F7, P16)
      this.refused = 'socket_path_too_long'
      this.st = 'stopped'
      return
    }
    const attach = encodeMessage(this.deps.attach())
    if (attach.byteLength > MAX_ATTACH_BYTES) { // checked before connecting, the same code the hub would give (§5.4)
      this.refused = 'frame_too_large'
      this.st = 'stopped'
      this.deps.on.refused('frame_too_large')
      return
    }
    const conn = ++this.conn
    this.st = 'connecting'
    this.phase = 'challenge'
    const decoder = new FrameDecoder(MAX_HUB_TO_PIPE)
    this.connect(this.deps.sockPath, {
      data: (b) => { if (conn === this.conn) this.onBytes(b, decoder) },
      close: () => { if (conn === this.conn) this.dropped() },
    }).then((sock) => {
      if (conn !== this.conn) return sock.end() // stopped or torn down while connecting
      this.sock = sock
      sock.write(encodeFrame(FRAME_TYPE.DATA, 0, attach))
      this.armStep()
    }, () => {
      if (conn === this.conn) this.dropped()
    })
  }

  private onBytes(b: Uint8Array, decoder: FrameDecoder): void {
    let frames: Frame[]
    try {
      frames = decoder.push(b)
    } catch {
      return this.dropped() // an oversized or malformed frame: this stream can no longer be trusted
    }
    const conn = this.conn
    for (const f of frames) {
      if (conn !== this.conn) return
      this.onFrame(f)
    }
  }

  private onFrame(f: Frame): void {
    if (f.type === FRAME_TYPE.PING) { this.lastFresh = this.deps.mono(); return } // the relay's copy of the hub's PING
    if (f.type === FRAME_TYPE.CLOSE) return this.dropped()
    if (f.type !== FRAME_TYPE.DATA) return
    const o = decodeJson(f.payload)
    if (!o) return
    if (o.t === 'refused') {
      const r = parseRefused(o)
      if (r) this.refuse(r.code)
      return
    }
    if (this.phase === 'challenge') {
      const c = parseChallenge(o)
      if (c && this.sock) {
        const prove: ProveMsg = { t: 'prove', sig: this.deps.sign(c.nonce) }
        this.sock.write(encodeFrame(FRAME_TYPE.DATA, 0, encodeMessage(prove)))
        this.phase = 'ready_wait'
        this.armStep()
      }
      return
    }
    if (this.phase === 'ready_wait') {
      const r = parseReady(o)
      if (r) {
        this.clearStep()
        this.phase = 'ready'
        this.st = 'ready'
        this.refused = null
        this.lastFresh = this.deps.mono()
        this.deps.on.ready(r)
      }
      return
    }
    switch (o.t) {
      case 'result': { const m = parseResult(o); if (m) this.deps.on.result(m); return }
      case 'tools': { const m = parseTools(o); if (m) this.deps.on.tools(m); return }
      case 'knock_report': { const m = parseHubKnockReport(o); if (m) this.deps.on.knockReport(m); return }
      case 'notice': { const m = parseNotice(o); if (m) this.onNotice(m); return }
    }
  }

  private onNotice(n: NoticeMsg): void {
    this.deps.on.notice(n)
    if (n.code === 'hub_lost') { // a newer connection of this lineage won (§6.2): this one never redials
      const wasReady = this.teardown()
      this.st = 'stopped'
      if (wasReady) this.deps.on.lost()
    } else if (n.code === 'link_closing') {
      this.dropped() // the hub is stopping (§5.4): like a drop, redial until it is back
    }
  }

  private refuse(code: RefusedCode): void {
    const wasReady = this.teardown()
    this.refused = code
    const redial = REDIAL_AFTER.has(code) && this.st !== 'stopped'
    this.st = redial ? 'detached' : 'stopped'
    this.deps.on.refused(code)
    if (wasReady) this.deps.on.lost()
    if (redial) this.scheduleRedial()
  }

  /** The connection went away or failed: detached, then a redial. */
  private dropped(): void {
    const wasReady = this.teardown()
    if (this.st === 'stopped') return
    this.st = 'detached'
    if (wasReady) this.deps.on.lost()
    this.scheduleRedial()
  }

  /** Ends the current connection whatever its phase; returns whether it was ready. Leaves the state to the caller. */
  private teardown(): boolean {
    const wasReady = this.st === 'ready'
    this.conn++
    this.clearStep()
    const s = this.sock
    this.sock = null
    if (s) try { s.end() } catch { /* already gone */ }
    return wasReady
  }

  private scheduleRedial(): void {
    if (this.st !== 'detached' || this.redialTimer !== null || !this.deps.hostAlive()) return
    const delay = Math.max(1, Math.round(this.reattachMs * (1 - JITTER + 2 * JITTER * this.deps.rand())))
    this.redialTimer = this.timers.setTimeout(() => {
      this.redialTimer = null
      if (this.st === 'detached' && this.deps.hostAlive()) this.dial()
    }, delay)
  }

  private armStep(): void {
    this.clearStep()
    const conn = this.conn
    this.stepTimer = this.timers.setTimeout(() => {
      this.stepTimer = null
      if (conn === this.conn) this.dropped() // a handshake step past its 5 s deadline (§5.4)
    }, this.stepMs)
  }

  private clearStep(): void {
    if (this.stepTimer !== null) { this.timers.clearTimeout(this.stepTimer); this.stepTimer = null }
  }
}
