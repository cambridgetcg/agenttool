// The Nuance relay (C3, spec §5.3). The gate execs it for `relay 1 <nonce>`, so its stdin and stdout are the one ssh
// channel to the Air's hub. It listens on run/hub.sock for this Mac's pipes, gives each local connection its own stream
// on the link (ids from 1, never reused), copies every hub PING to every pipe so each knows how fresh the link is, and
// moves frames both ways. It never parses MCP: the frame size limits of §6.6 are the only thing it checks.
import type { SocketHandler } from 'bun'
import { chmodSync, lstatSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs'
import type { LedgerFields } from '../ledger.ts'
import { encodeFrame, FRAME_TYPE, FrameDecoder, FrameMalformed, FrameTooLarge, preambleOf, type Frame } from '../link/frame.ts'
import { Mux } from '../link/mux.ts'
import { encodeMessage, MAX_HUB_TO_PIPE, MAX_PIPE_TO_HUB, type RefusedMsg, type RelayReplacedMsg } from '../link/messages.ts'
import { writeFileDurable } from '../native.ts'
import { MAX_SOCKET_PATH_BYTES, socketPathOk, type NuancePaths } from '../paths.ts'
import { TIMING } from '../timing.ts'
import { listenPrivate, Outbox } from './unix.ts'

export interface RelayTimers { setInterval(fn: () => void, ms: number): unknown; clearInterval(h: unknown): void }
export interface RelayDeps { paths: NuancePaths; nonce: string; stdin: ReadableStream<Uint8Array>; write(bytes: Uint8Array): void;
  mono(): number; ledger(f: LedgerFields): void; timers?: RelayTimers; staleMs?: number; exitMs?: number; inodeCheckMs?: number;
  flushMs?: number; stderr?: { write(s: string): void }
  /** A test seam: runs after the inode check found hub.sock missing and before the relay listens again, where another relay's rename can land. */
  beforeRelisten?(): void }
export interface RelayStatusFile { pid: number; started_mono: number; last_ping_mono: number | null; streams: number }

/** A relay that cannot listen exits like a refused gate command, before its preamble, so the dialer says needs Yu: config (§5.4). */
export const RELAY_START_REFUSED = 64

const realTimers: RelayTimers = {
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
}

/** How long an exiting relay waits for its pipes to take what is still queued for them before it closes their sockets. */
const FLUSH_MS = 2_000

const HUB_AWAY: RefusedMsg = { t: 'refused', code: 'hub_away' }
const REPLACED: RelayReplacedMsg = { t: 'relay_replaced' }

const isMono = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0

/** run/relay.json, written at start and on every PING; `collab-bridge status` reads it (its readings are CLOCK_MONOTONIC, system-wide). */
export function readRelayStatus(paths: NuancePaths): RelayStatusFile | null {
  let o: unknown
  try { o = JSON.parse(readFileSync(paths.relayStatus, 'utf8')) } catch { return null }
  if (typeof o !== 'object' || o === null || Array.isArray(o)) return null
  const { pid, started_mono, last_ping_mono, streams } = o as Record<string, unknown>
  if (!Number.isSafeInteger(pid) || (pid as number) < 2 || !isMono(started_mono)) return null
  if (last_ping_mono !== null && !isMono(last_ping_mono)) return null
  if (!Number.isSafeInteger(streams) || (streams as number) < 0) return null
  return { pid: pid as number, started_mono, last_ping_mono, streams: streams as number }
}

function inodeOf(path: string): bigint | null {
  try { return lstatSync(path, { bigint: true }).ino } catch { return null }
}

interface Conn { id: number; out: Outbox; decoder: FrameDecoder }

export async function runRelay(deps: RelayDeps): Promise<number> {
  const { paths } = deps
  const staleMs = deps.staleMs ?? TIMING.staleMs
  const exitMs = deps.exitMs ?? TIMING.relayExitMs
  const flushMs = deps.flushMs ?? FLUSH_MS
  const inodeCheckMs = deps.inodeCheckMs ?? TIMING.inodeCheckMs
  const timers = deps.timers ?? realTimers
  const started = deps.mono()
  const note = (f: LedgerFields) => { try { deps.ledger(f) } catch { /* the relay runs without its ledger */ } }
  const say = (line: string) => { try { deps.stderr?.write(`collab-bridge relay: ${line}\n`) } catch { /* nothing more to do */ } }
  const refuse = (code: string, line: string): number => {
    note({ event: 'relay', outcome: 'refused', code })
    say(line)
    return RELAY_START_REFUSED
  }

  // listenPrivate binds a name only this process uses, then renames it over hub.sock: listening on a path that exists
  // fails with EADDRINUSE, and a socket file outlives SIGKILL (F8), so a stale hub.sock never stops a new relay (Review
  // Focus 5, P17). The name it binds is checked here, so a long path refuses with this relay's own code (P16).
  const fresh = `${paths.hubSock}.${process.pid}`
  if (!socketPathOk(fresh)) return refuse('socket_path_too_long', `${fresh} is longer than ${MAX_SOCKET_PATH_BYTES} bytes (K46)`)

  const conns = new Map<number, Conn>()
  const live = new Set<{ terminate(): void }>()   // every local socket not yet closed, the ones that are only draining included
  let flushed: (() => void) | null = null
  const sockGone = (sock: { terminate(): void }) => {
    live.delete(sock)
    if (live.size === 0) flushed?.()
  }
  let lastPing: number | null = null
  let finished = false
  let resolveDone!: (code: number) => void
  const done = new Promise<number>((r) => { resolveDone = r })
  const mux = new Mux({ write: (b) => deps.write(b), maxInbound: MAX_HUB_TO_PIPE })
  const lastHeard = () => lastPing ?? started   // until the first PING, the hub has just dialled: count from the start

  const closeConn = (c: Conn, o: { hub: boolean; local: boolean }) => {
    if (conns.get(c.id) !== c) return
    conns.delete(c.id)
    if (o.hub) mux.close(c.id)
    if (o.local) c.out.push(encodeFrame(FRAME_TYPE.CLOSE, 0))
    c.out.endWhenFlushed()
  }

  /** A pipe speaks on stream 0 only; the relay renumbers its frames to the connection's stream toward the hub. */
  const fromPipe = (c: Conn, f: Frame) => {
    if (conns.get(c.id) !== c) return
    if (f.stream !== 0) return closeConn(c, { hub: true, local: true })
    if (f.type === FRAME_TYPE.DATA) mux.data(c.id, f.payload)
    else if (f.type === FRAME_TYPE.CLOSE) closeConn(c, { hub: true, local: false })
    // OPEN, PING and PONG from a pipe mean nothing here.
  }

  const fromHub = (f: Frame) => {
    if (f.type === FRAME_TYPE.PING) {
      lastPing = deps.mono()
      mux.pong()
      const copy = encodeFrame(FRAME_TYPE.PING, 0)
      for (const c of conns.values()) c.out.push(copy)
      writeStatus()
      return
    }
    const c = f.stream === 0 ? undefined : conns.get(f.stream)
    if (!c) return   // a stream that is already closed, or the hub's stream 0 (it opens no streams and sends no PONG)
    if (f.type === FRAME_TYPE.DATA) c.out.push(encodeFrame(FRAME_TYPE.DATA, 0, f.payload))
    else if (f.type === FRAME_TYPE.CLOSE) closeConn(c, { hub: false, local: true })
  }

  /**
   * run/relay.json names a relay of this boot that started after this one. Every relay writes it at its start, so it holds the
   * newest relay's; a reading ahead of the clock was written under an earlier boot (Task 63 relay-2-3) and names nobody.
   * Such a relay owns hub.sock, and this one must neither take it back nor overwrite its status (Task 63 new-relisten-takeback).
   */
  const newerRelay = (): boolean => {
    const s = readRelayStatus(paths)
    return s !== null && s.started_mono > started && s.started_mono <= deps.mono()
  }

  const writeStatus = () => {
    if (newerRelay()) return
    const s: RelayStatusFile = { pid: process.pid, started_mono: started, last_ping_mono: lastPing, streams: conns.size }
    try { writeFileDurable(paths.relayStatus, JSON.stringify(s) + '\n', 0o600) } catch { /* status only */ }
  }

  const handlers: SocketHandler<Conn | null> = {
    open(sock) {
      live.add(sock)
      const c: Conn = { id: 0, out: new Outbox(sock), decoder: new FrameDecoder(MAX_PIPE_TO_HUB) }
      sock.data = c
      if (finished) { sock.end(); return }
      if (deps.mono() - lastHeard() > staleMs) {
        // §5.3: no new call goes into a stale link. The pipe answers its agent hub_away, a definite "not sent".
        c.out.push(encodeFrame(FRAME_TYPE.DATA, 0, encodeMessage(HUB_AWAY)))
        c.out.push(encodeFrame(FRAME_TYPE.CLOSE, 0))
        c.out.endWhenFlushed()
        return
      }
      c.id = mux.open()
      conns.set(c.id, c)
    },
    data(sock, chunk) {
      const c = sock.data
      if (!c || conns.get(c.id) !== c) return
      let frames: Frame[]
      try {
        frames = c.decoder.push(chunk)
      } catch (e) {
        // Over 2 MiB, or not a frame at all: forward what came before it, then close this connection only (§6.6).
        if (!(e instanceof FrameTooLarge) && !(e instanceof FrameMalformed)) throw e
        for (const f of e.frames) fromPipe(c, f)
        return closeConn(c, { hub: true, local: true })
      }
      for (const f of frames) fromPipe(c, f)
    },
    drain(sock) { sock.data?.out.drain() },
    close(sock) {
      if (sock.data) closeConn(sock.data, { hub: true, local: false })
      sockGone(sock)
    },
    error(sock) {
      if (sock.data) closeConn(sock.data, { hub: true, local: false })
      sockGone(sock)
    },
  }

  /**
   * Listens on a name of this process's own and renames it over hub.sock (P17): the start of a relay replaces whatever is
   * there. A relay that listens again takes the path only while nothing is there (onlyIfAbsent), so it cannot overwrite the
   * socket of a relay that started in the instant between its check and its listen.
   */
  const bind = (o: { onlyIfAbsent?: boolean } = {}) => {
    mkdirSync(paths.run, { recursive: true, mode: 0o700 })
    chmodSync(paths.run, 0o700)   // a mode passed to mkdir applies only to a new dir, and the umask cuts it
    return listenPrivate<Conn | null>(paths.hubSock, handlers, { replace: true, ...o })
  }

  let server: { stop(closeActiveConnections?: boolean): void }
  let ours: bigint | null
  try {
    const l = bind()
    server = l.server
    ours = l.ino
  } catch (e) {
    return refuse('bind_failed', `cannot listen on ${paths.hubSock}: ${e instanceof Error ? e.message : String(e)}`)
  }

  deps.write(new TextEncoder().encode(preambleOf(deps.nonce)))
  note({ event: 'relay', outcome: 'start' })
  writeStatus()
  const reader = deps.stdin.getReader()

  const finish = (reason: string, code: number) => {
    if (finished) return
    finished = true
    timers.clearInterval(liveness)
    timers.clearInterval(inodeCheck)
    for (const c of conns.values()) { c.out.push(encodeFrame(FRAME_TYPE.CLOSE, 0)); c.out.endWhenFlushed() }
    conns.clear()
    // Stop accepting, but leave the open sockets alone: a result or CLOSE frame may still wait in a pipe's Outbox (a unix
    // socket takes about 8 KiB per write), and closing the socket now would cut it off, so the pipe would answer
    // hub_outcome_unknown for a call whose answer had reached this relay (Task 63 relay-2-1). stop() unlinks only the name
    // it bound, which the rename already moved.
    server.stop(false)
    // Check, then unlink: a newer relay's rename can land between the two and lose its socket. That relay's inode check sees
    // hub.sock missing and listens again, so the cost is one detour of at most inodeCheckMs, not a dropped link.
    if (ours !== null && inodeOf(paths.hubSock) === ours) { try { unlinkSync(paths.hubSock) } catch { /* gone */ } }
    const s = readRelayStatus(paths)
    if (s && s.pid === process.pid && s.started_mono === started) { try { unlinkSync(paths.relayStatus) } catch { /* gone */ } }
    note({ event: 'relay', outcome: 'exit', code: reason, ms: Math.max(0, Math.round(deps.mono() - started)) })
    reader.cancel().catch(() => { /* already closed */ })
    // Done once every pipe has taken what was queued and closed its end, or after flushMs: a pipe that never reads must not
    // keep an exiting relay (and the ssh channel behind it) up. Then whatever is left is closed.
    let settled = false
    let cap: ReturnType<typeof setTimeout> | null = null
    const settle = () => {
      if (settled) return
      settled = true
      if (cap !== null) clearTimeout(cap)
      // Close what is left socket by socket. server.stop(true) would not: finish() stopped this listener already, and a
      // second stop returns at once, and after a re-listen the sockets of the first listener are not its own (Task 63
      // new-settle-stop). A socket still here has not taken what was queued for it; it goes without, as a cap is meant to.
      for (const sock of [...live]) { try { sock.terminate() } catch { /* already closed */ } }
      live.clear()
      resolveDone(code)
    }
    if (live.size === 0) return settle()
    flushed = settle
    cap = setTimeout(settle, flushMs)
  }

  const liveness = timers.setInterval(() => {
    if (!finished && deps.mono() - lastHeard() > exitMs) finish('no_ping', 0)
  }, Math.max(1, Math.min(1000, Math.floor(exitMs / 45))))

  const inodeCheck = timers.setInterval(() => {
    if (finished) return
    const now = inodeOf(paths.hubSock)
    if (now === ours) return
    if (now === null && !newerRelay()) {
      // hub.sock is gone, and nobody's socket stands in its place: not "replaced" (§5.3), so the hub must not count a
      // contest. An older relay's exit can delete it in the instant this one's rename lands (it checks, then unlinks), and
      // anything else may too. Listen again: the pipes already connected stay, the ones that tried meanwhile read the
      // missing socket as away (P12) and retry (Task 63 relay-2-2, conformance-8-3). If that fails, this relay is no use.
      // Two limits (Task 63 new-relisten-takeback): when relay.json names a relay that started after this one, hub.sock is
      // that relay's to listen on again, so this one is the replaced relay and falls through to say so; and the listen takes
      // the path only while it is still absent, so a relay whose rename lands first keeps it, and this one is replaced too.
      try {
        deps.beforeRelisten?.()
        const old = server
        const l = bind({ onlyIfAbsent: true })
        server = l.server
        ours = l.ino
        old.stop(false)   // its name moved with the first rename; its open sockets go on
        return
      } catch {
        // The listen failed: because something is at hub.sock now (a relay's socket put there since the check, EEXIST), which
        // makes this relay the replaced one, or because it could not listen at all, which leaves it no use.
        if (inodeOf(paths.hubSock) === null) return finish('socket_gone', 0)
      }
    }
    // A newer relay put its own socket in place (§5.3): tell this link's hub, which counts these for relay_contested (T5).
    mux.data(0, encodeMessage(REPLACED))
    finish('relay_replaced', 0)
  }, inodeCheckMs)

  void (async () => {
    try {
      for (;;) {
        const { done: eof, value } = await reader.read()
        if (finished) return
        if (eof) return finish('stdin_eof', 0)
        if (!value || value.byteLength === 0) continue
        let frames: Frame[]
        try {
          frames = mux.feed(value)
        } catch (e) {
          if (e instanceof FrameTooLarge) {
            // Over 4 MiB from the hub: the decoder skips that payload; close that one stream (§6.6).
            for (const f of e.frames) fromHub(f)
            const c = conns.get(e.stream)
            if (c) closeConn(c, { hub: true, local: true })
            continue
          }
          if (e instanceof FrameMalformed) {
            for (const f of e.frames) fromHub(f)
            return finish('hub_malformed', 1)
          }
          throw e
        }
        for (const f of frames) fromHub(f)
      }
    } catch {
      finish('stdin_error', 0)
    }
  })()

  return done
}
