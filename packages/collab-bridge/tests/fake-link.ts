// An in-process stand-in for the relay and the hub on one unix socket, for the pipe's tests (Tasks 29–32). It speaks the
// local framing of spec §5.4 (stream 0, DATA and CLOSE frames, plus the relay's copied PINGs), answers each stream's
// handshake by a policy set with accept(), and records every message a pipe sends. Like the real relay (P17), it listens
// through listenPrivate's replace mode (a fresh name renamed over sockPath), so stopping an old listener never unlinks a
// newer one's socket, and it writes through the relay's Outbox, so a partial write loses nothing.
import { existsSync, lstatSync, unlinkSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { dirname } from 'node:path'
import { encodeFrame, FRAME_TYPE, FrameDecoder } from '../src/link/frame.ts'
import { decodeJson, encodeMessage, MAX_PIPE_TO_HUB, type ReadyMsg, type RefusedCode } from '../src/link/messages.ts'
import { listenPrivate, Outbox } from '../src/nuance/unix.ts'

export interface FakeLink {
  sockPath: string
  /** Every message pipes sent, oldest first, across connections. */
  frames(): Array<{ t: string; [k: string]: unknown }>
  /** Sets how attaches are answered from now on, held ones included; until the first call every handshake is held. */
  accept(o?: { refuse?: RefusedCode; ready?: Partial<ReadyMsg> }): void
  /** A copied PING (stream 0) to every live connection. */
  ping(): void
  /** One DATA message to the newest ready connection (else the newest live one). */
  send(m: object): void
  /** Ends every live connection, as when the relay exits or the hub closes the stream. */
  dropConnection(): void
  /** A newer relay takes the path: a new listener renamed over sockPath, and the old one's connections end. */
  replaceSocket(): void
  close(): Promise<void>
  /** How many connections were accepted so far, closed ones included. */
  connections(): number
}

type Policy = { refuse?: RefusedCode; ready?: Partial<ReadyMsg> }
interface Conn { out: Outbox; phase: 'attach' | 'held' | 'challenged' | 'ready' | 'closed'; decoder: FrameDecoder }
type Listener = { stop(closeActive?: boolean): void }

export async function makeFakeLink(sockPath: string): Promise<FakeLink> {
  const received: Array<{ t: string; [k: string]: unknown }> = []
  const conns: Conn[] = []
  let total = 0
  let policy: Policy | null = null

  const sendBytes = (c: Conn, bytes: Uint8Array) => { if (c.phase !== 'closed') c.out.push(bytes) }
  const sendMsg = (c: Conn, m: object) => sendBytes(c, encodeFrame(FRAME_TYPE.DATA, 0, encodeMessage(m as { t: string })))
  /** Like the relay (P18): what was sent before, the CLOSE frame of a refusal included, goes out first, then the socket ends. */
  const end = (c: Conn) => { if (c.phase !== 'closed') { c.phase = 'closed'; try { c.out.endWhenFlushed() } catch { /* gone */ } } }
  const refuse = (c: Conn, code: RefusedCode) => { sendMsg(c, { t: 'refused', code }); sendBytes(c, encodeFrame(FRAME_TYPE.CLOSE, 0)); end(c) }

  const answerAttach = (c: Conn) => {
    if (policy === null) { c.phase = 'held'; return }
    if (policy.refuse !== undefined && policy.refuse !== 'seat_proof_failed') return refuse(c, policy.refuse)
    sendMsg(c, { t: 'challenge', nonce: randomBytes(32).toString('hex') })
    c.phase = 'challenged'
  }
  const answerProve = (c: Conn) => {
    if (policy === null) return
    if (policy.refuse === 'seat_proof_failed') return refuse(c, 'seat_proof_failed') // a proof is refused after it is seen
    sendMsg(c, { t: 'ready', tools_digest: '0'.repeat(64), hub_build: '00000000', skew_s: 0, session_hint: null, ...policy.ready })
    c.phase = 'ready'
  }

  // A newer listener binds the same <sockPath>.<pid> name: the rename has already moved the older one's name away, and
  // replaceSocket() stops the older listener only after the newer one is in place.
  const listen = (): Listener => listenPrivate<Conn>(sockPath, {
    open(s) {
      s.data = { out: new Outbox(s), phase: 'attach', decoder: new FrameDecoder(MAX_PIPE_TO_HUB) }
      conns.push(s.data)
      total++
    },
    data(s, chunk) {
      const c = s.data
      let frames
      try { frames = c.decoder.push(chunk) } catch { return end(c) }
      for (const f of frames) {
        if (f.type === FRAME_TYPE.CLOSE) return end(c)
        if (f.type !== FRAME_TYPE.DATA) continue
        const m = decodeJson(f.payload)
        if (!m) continue
        received.push(m as { t: string })
        if (m.t === 'attach' && c.phase === 'attach') answerAttach(c)
        else if (m.t === 'prove' && c.phase === 'challenged') answerProve(c)
      }
    },
    drain(s) { s.data.out.drain() },
    close(s) { if (s.data) s.data.phase = 'closed' },
    error() { /* close follows */ },
  }, { replace: true }).server

  let listener = listen()
  const live = () => conns.filter((c) => c.phase !== 'closed')

  return {
    sockPath,
    frames: () => received.map((m) => ({ ...m })),
    accept(o = {}) {
      policy = o
      for (const c of live()) if (c.phase === 'held') answerAttach(c)
    },
    ping() { for (const c of live()) sendBytes(c, encodeFrame(FRAME_TYPE.PING, 0)) },
    send(m) {
      const all = live()
      const target = [...all].reverse().find((c) => c.phase === 'ready') ?? all[all.length - 1]
      if (!target) throw new Error('fake link: no live connection to send to')
      sendMsg(target, m)
    },
    dropConnection() { for (const c of live()) end(c) },
    replaceSocket() {
      const old = listener
      listener = listen()
      for (const c of live()) end(c)
      old.stop(true)
    },
    async close() {
      for (const c of live()) end(c)
      listener.stop(true)
      try { if (existsSync(sockPath) && lstatSync(sockPath).isSocket()) unlinkSync(sockPath) } catch { /* gone */ }
    },
    connections: () => total,
  }
}

/** A socket file whose listener died by SIGKILL, so nothing listens on it (F8): what a crashed relay or pipe leaves. */
export async function makeStaleSocket(path: string): Promise<void> {
  const p = Bun.spawn([process.execPath, '--no-env-file', '--config=/dev/null', '-e',
    `Bun.listen({ unix: ${JSON.stringify(path)}, socket: { data() {} } }); process.kill(process.pid, 'SIGKILL')`],
  { cwd: '/', env: { PATH: '/usr/bin:/bin', HOME: dirname(path) }, stdout: 'ignore', stderr: 'ignore' })
  await p.exited
  if (!lstatSync(path).isSocket()) throw new Error('makeStaleSocket: no socket file was left behind')
}
