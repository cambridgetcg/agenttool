import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, lstatSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { LedgerFields } from '../src/ledger.ts'
import { encodeFrame, FRAME_HEADER_BYTES, FRAME_TYPE, FrameDecoder, PreambleScanner, preambleOf, type Frame, type FrameType } from '../src/link/frame.ts'
import { decodeJson, MAX_HUB_TO_PIPE, MAX_PIPE_TO_HUB } from '../src/link/messages.ts'
import { readRelayStatus, RELAY_START_REFUSED, runRelay, type RelayTimers } from '../src/nuance/relay.ts'
import { nuancePaths, type NuancePaths } from '../src/paths.ts'
import { cleanupTmps, modeOf, shortSockRoot, temp } from './helpers.ts'

const NONCE = '0123456789abcdef0123456789abcdef'
const { OPEN, DATA, CLOSE, PING, PONG } = FRAME_TYPE
const enc = new TextEncoder()
const dec = new TextDecoder()

/** A temp Nuance home whose sockets sit under a short root (K46: $TMPDIR alone is 49 characters). */
function nuance(sockRoot: string = shortSockRoot()): NuancePaths {
  const home = temp('cb-relay-')
  return nuancePaths(home, { HOME: home, COLLAB_BRIDGE_HOME_OVERRIDE: home, COLLAB_BRIDGE_SOCK_ROOT: sockRoot, COLLAB_BRIDGE_SUMMON_DROPIN: join(home, 'dropin') })
}

/** Interval timers the test fires by hand, so no test waits 5, 20 or 45 real seconds. */
function handTimers(): RelayTimers & { fire(): void; count(): number } {
  const live = new Map<number, () => void>()
  let n = 0
  return {
    setInterval(fn) { live.set(++n, fn); return n },
    clearInterval(h) { live.delete(h as number) },
    fire() { for (const fn of [...live.values()]) fn() },
    count: () => live.size,
  }
}

/** The 9-byte header of a frame that declares `len` payload bytes, for the size limits. */
function header(len: number, type: FrameType, stream: number): Uint8Array {
  const h = new Uint8Array(FRAME_HEADER_BYTES)
  const v = new DataView(h.buffer)
  v.setUint32(0, len)
  v.setUint8(4, type)
  v.setUint32(5, stream)
  return h
}

/** The hub's end of the ssh channel: what the relay writes (decoded after its preamble), and frames to send it. */
function hubEnd() {
  let ctl!: ReadableStreamDefaultController<Uint8Array>
  const stdin = new ReadableStream<Uint8Array>({ start(c) { ctl = c } })
  const scanner = new PreambleScanner(NONCE)
  const decoder = new FrameDecoder(MAX_PIPE_TO_HUB)
  const chunks: Uint8Array[] = []
  const frames: Frame[] = []
  let found = false
  return {
    stdin, chunks, frames,
    write(bytes: Uint8Array) {
      chunks.push(bytes.slice())
      let rest = bytes
      if (!found) {
        const s = scanner.push(bytes)
        if (s.state !== 'found') return
        found = true
        rest = s.rest
      }
      frames.push(...decoder.push(rest))
    },
    send(type: FrameType, stream: number, payload?: Uint8Array) { ctl.enqueue(encodeFrame(type, stream, payload)) },
    raw(bytes: Uint8Array) { ctl.enqueue(bytes) },
    end() { try { ctl.close() } catch { /* already closed or cancelled */ } },
    preambleSeen: () => found,
    of: (type: FrameType, stream?: number) => frames.filter((f) => f.type === type && (stream === undefined || f.stream === stream)),
  }
}

/** A pipe's end of a local connection to run/hub.sock: frames in, frames out, and whether the relay closed it. */
function localClient(path: string) {
  const decoder = new FrameDecoder(MAX_HUB_TO_PIPE)
  const frames: Frame[] = []
  let closed = false
  let sock: { write(b: Uint8Array): number; end(): void } | null = null
  const ready = Bun.connect({ unix: path, socket: {
    data(_s, d) { frames.push(...decoder.push(d)) },
    close() { closed = true },
    error() { closed = true },
  } }).then((s) => { sock = s })
  return {
    ready, frames,
    isClosed: () => closed,
    send(type: FrameType, payload?: Uint8Array) { sock!.write(encodeFrame(type, 0, payload)) },
    raw(bytes: Uint8Array) { sock!.write(bytes) },
    end() { sock?.end() },
    messages: () => frames.filter((f) => f.type === DATA).map((f) => decodeJson(f.payload)),
  }
}

async function until<T>(f: () => T | null | undefined | false, ms = 3000): Promise<T> {
  const end = Date.now() + ms
  for (;;) {
    const v = f()
    if (v) return v
    if (Date.now() > end) throw new Error('until: timed out')
    await Bun.sleep(5)
  }
}

const running: Array<{ hub: ReturnType<typeof hubEnd>; done: Promise<number> }> = []

async function startRelay(o: { paths?: NuancePaths; clock?: { t: number } } = {}) {
  const paths = o.paths ?? nuance()
  const clock = o.clock ?? { t: 1_000_000 }
  const hub = hubEnd()
  const timers = handTimers()
  const ledger: LedgerFields[] = []
  let settled = false
  const done = runRelay({ paths, nonce: NONCE, stdin: hub.stdin, write: (b) => hub.write(b), mono: () => clock.t,
    ledger: (f) => { ledger.push(f) }, timers, staleMs: 20_000, exitMs: 45_000, inodeCheckMs: 5_000 })
  done.then(() => { settled = true })
  running.push({ hub, done })
  await until(() => hub.preambleSeen())
  return { paths, clock, hub, timers, ledger, done, settled: () => settled }
}

afterEach(async () => {
  for (const r of running.splice(0)) { r.hub.end(); await r.done }
  cleanupTmps()
})

describe('relay', () => {
  test('writes the preamble before any frame', async () => {
    const r = await startRelay()
    expect(dec.decode(r.hub.chunks[0])).toBe(preambleOf(NONCE))
    const c = localClient(r.paths.hubSock)
    await c.ready
    await until(() => r.hub.of(OPEN).length === 1)
    expect(r.hub.frames.map((f) => [f.type, f.stream])).toEqual([[OPEN, 1]])
  })

  test('binds a fresh name, renames it into place, 0600 in a 0700 dir', async () => {
    const paths = nuance()
    mkdirSync(paths.run, { recursive: true, mode: 0o700 })
    writeFileSync(`${paths.hubSock}.${process.pid}`, 'left by an earlier relay that had this pid')
    const r = await startRelay({ paths })
    expect(lstatSync(paths.hubSock).isSocket()).toBe(true)
    expect(modeOf(paths.hubSock)).toBe(0o600)
    expect(modeOf(paths.run)).toBe(0o700)
    expect(readdirSync(paths.run).filter((n) => n.startsWith('hub.sock.'))).toEqual([])
    expect(readRelayStatus(paths)).toEqual({ pid: process.pid, started_mono: 1_000_000, last_ping_mono: null, streams: 0 })
    expect(modeOf(paths.relayStatus)).toBe(0o600)
    expect(r.ledger).toEqual([{ event: 'relay', outcome: 'start' }])
  })

  test('each local connection is a new stream id, never reused', async () => {
    const r = await startRelay()
    for (let i = 1; i <= 3; i++) {
      const c = localClient(r.paths.hubSock)
      await c.ready
      await until(() => r.hub.of(OPEN).length === i)
      c.end()
      await until(() => r.hub.of(CLOSE).length === i)
    }
    expect(r.hub.of(OPEN).map((f) => f.stream)).toEqual([1, 2, 3])
    expect(r.hub.of(CLOSE).map((f) => f.stream)).toEqual([1, 2, 3])
  })

  test('DATA crosses unchanged both ways, including bytes that are not JSON', async () => {
    const r = await startRelay()
    const c = localClient(r.paths.hubSock)
    await c.ready
    await until(() => r.hub.of(OPEN).length === 1)
    const up = new Uint8Array([0, 255, 10, 13, 0x7b, 0xc3])
    c.send(DATA, up)
    const got = await until(() => r.hub.of(DATA, 1)[0])
    expect(Array.from(got.payload)).toEqual(Array.from(up))
    const down = new Uint8Array([0xff, 0xfe, 0, 1])
    r.hub.send(DATA, 1, down)
    const back = await until(() => c.frames.find((f) => f.type === DATA))
    expect(back.stream).toBe(0)
    expect(Array.from(back.payload)).toEqual(Array.from(down))
  })

  test('copies each PING to every local connection and answers PONG', async () => {
    const r = await startRelay()
    const a = localClient(r.paths.hubSock)
    await a.ready
    await until(() => r.hub.of(OPEN).length === 1)
    const b = localClient(r.paths.hubSock)
    await b.ready
    await until(() => r.hub.of(OPEN).length === 2)
    r.clock.t += 15_000
    r.hub.send(PING, 0)
    await until(() => r.hub.of(PONG).length === 1)
    await until(() => a.frames.some((f) => f.type === PING) && b.frames.some((f) => f.type === PING))
    expect(a.frames.filter((f) => f.type === PING).map((f) => f.stream)).toEqual([0])
    expect(readRelayStatus(r.paths)).toEqual({ pid: process.pid, started_mono: 1_000_000, last_ping_mono: 1_015_000, streams: 2 })
  })

  test('refuses a new local connection with hub_away once the last PING is over 20 s old', async () => {
    const r = await startRelay()
    r.hub.send(PING, 0)
    await until(() => r.hub.of(PONG).length === 1)
    r.clock.t += 20_000
    const fresh = localClient(r.paths.hubSock)
    await fresh.ready
    await until(() => r.hub.of(OPEN).length === 1)
    r.clock.t += 1
    const late = localClient(r.paths.hubSock)
    await late.ready
    await until(() => late.isClosed())
    expect(late.frames.map((f) => [f.type, f.stream])).toEqual([[DATA, 0], [CLOSE, 0]])
    expect(late.messages()).toEqual([{ t: 'refused', code: 'hub_away' }])
    expect(r.hub.of(OPEN).length).toBe(1)
  })

  test('until the first PING, the relay counts from its own start', async () => {
    const r = await startRelay()
    r.clock.t += 20_001
    const c = localClient(r.paths.hubSock)
    await c.ready
    await until(() => c.isClosed())
    expect(c.messages()).toEqual([{ t: 'refused', code: 'hub_away' }])
    expect(r.hub.of(OPEN)).toEqual([])
  })

  test('exits after 45 s without a PING', async () => {
    const r = await startRelay()
    r.clock.t += 40_000
    r.hub.send(PING, 0)
    await until(() => r.hub.of(PONG).length === 1)
    r.clock.t += 45_000
    r.timers.fire()
    await Bun.sleep(20)
    expect(r.settled()).toBe(false)
    r.clock.t += 1
    r.timers.fire()
    expect(await r.done).toBe(0)
    expect(r.ledger.at(-1)).toEqual({ event: 'relay', outcome: 'exit', code: 'no_ping', ms: 85_001 })
    expect(existsSync(r.paths.hubSock)).toBe(false)
    expect(readRelayStatus(r.paths)).toBeNull()
    expect(r.timers.count()).toBe(0)
  })

  test('a newer relay replaces the socket; the older sends relay_replaced and exits, and the newer one still accepts connections', async () => {
    const paths = nuance()
    const a = await startRelay({ paths })
    const ca = localClient(paths.hubSock)
    await ca.ready
    await until(() => a.hub.of(OPEN).length === 1)
    const b = await startRelay({ paths, clock: { t: 2_000_000 } })
    a.timers.fire()
    expect(await a.done).toBe(0)
    expect(a.hub.of(DATA, 0).map((f) => decodeJson(f.payload))).toEqual([{ t: 'relay_replaced' }])
    expect(a.ledger.at(-1)).toMatchObject({ event: 'relay', outcome: 'exit', code: 'relay_replaced' })
    await until(() => ca.isClosed())
    expect(lstatSync(paths.hubSock).isSocket()).toBe(true)
    expect(readRelayStatus(paths)?.started_mono).toBe(2_000_000)
    const cb = localClient(paths.hubSock)
    await cb.ready
    await until(() => b.hub.of(OPEN).length === 1)
    b.timers.fire()
    expect(b.settled()).toBe(false)
  })

  test('a stale hub.sock left by a SIGKILLed relay does not stop a new relay', async () => {
    const paths = nuance()
    mkdirSync(paths.run, { recursive: true, mode: 0o700 })
    const killed = Bun.spawnSync([process.execPath, '--no-env-file', '--config=/dev/null', '-e',
      `Bun.listen({ unix: ${JSON.stringify(paths.hubSock)}, socket: { data() {} } }); process.kill(process.pid, 'SIGKILL')`],
    { env: { PATH: '/usr/bin:/bin' } })
    expect(killed.signalCode).toBe('SIGKILL')
    expect(lstatSync(paths.hubSock).isSocket()).toBe(true)
    const r = await startRelay({ paths })
    const c = localClient(paths.hubSock)
    await c.ready
    await until(() => r.hub.of(OPEN).length === 1)
  })

  test('a local frame over 2 MiB closes that connection only', async () => {
    const r = await startRelay()
    const big = localClient(r.paths.hubSock)
    await big.ready
    await until(() => r.hub.of(OPEN).length === 1)
    const other = localClient(r.paths.hubSock)
    await other.ready
    await until(() => r.hub.of(OPEN).length === 2)
    big.raw(header(MAX_PIPE_TO_HUB + 1, DATA, 0))
    await until(() => big.isClosed())
    expect(big.frames.map((f) => f.type)).toEqual([CLOSE])
    expect(r.hub.of(CLOSE).map((f) => f.stream)).toEqual([1])
    other.send(DATA, enc.encode('still here'))
    const got = await until(() => r.hub.of(DATA, 2)[0])
    expect(dec.decode(got.payload)).toBe('still here')
  })

  test('a hub frame over 4 MiB closes that stream only', async () => {
    const r = await startRelay()
    const one = localClient(r.paths.hubSock)
    await one.ready
    await until(() => r.hub.of(OPEN).length === 1)
    const two = localClient(r.paths.hubSock)
    await two.ready
    await until(() => r.hub.of(OPEN).length === 2)
    r.hub.raw(header(MAX_HUB_TO_PIPE + 1, DATA, 1))
    r.hub.raw(new Uint8Array(MAX_HUB_TO_PIPE + 1))
    await until(() => one.isClosed())
    expect(r.hub.of(CLOSE).map((f) => f.stream)).toEqual([1])
    r.hub.send(DATA, 2, enc.encode('after'))
    const got = await until(() => two.frames.find((f) => f.type === DATA))
    expect(dec.decode(got.payload)).toBe('after')
  })

  test('a socket path over 103 bytes refuses to start', async () => {
    const root = join(shortSockRoot(), 'r'.repeat(100))
    const paths = nuance(root)
    const hub = hubEnd()
    const ledger: LedgerFields[] = []
    const errs: string[] = []
    const code = await runRelay({ paths, nonce: NONCE, stdin: hub.stdin, write: (b) => hub.write(b), mono: () => 5,
      ledger: (f) => { ledger.push(f) }, timers: handTimers(), stderr: { write: (s) => { errs.push(s) } } })
    expect(code).toBe(RELAY_START_REFUSED)
    expect(RELAY_START_REFUSED).toBe(64)
    expect(hub.chunks).toEqual([])
    expect(ledger).toEqual([{ event: 'relay', outcome: 'refused', code: 'socket_path_too_long' }])
    expect(errs.length).toBe(1)
    expect(existsSync(root)).toBe(false)
  })

  test('the ledger has content-free start and exit lines only', async () => {
    const r = await startRelay()
    const c = localClient(r.paths.hubSock)
    await c.ready
    await until(() => r.hub.of(OPEN).length === 1)
    c.send(DATA, enc.encode('{"t":"call","name":"collab_report_append","arguments":{"body":"cdc-7f3a"}}'))
    await until(() => r.hub.of(DATA, 1).length === 1)
    r.hub.send(DATA, 1, enc.encode('{"t":"result","note":"cdc-7f3a"}'))
    await until(() => c.frames.some((f) => f.type === DATA))
    r.clock.t += 1_234
    r.hub.end()
    expect(await r.done).toBe(0)
    expect(r.ledger).toEqual([{ event: 'relay', outcome: 'start' }, { event: 'relay', outcome: 'exit', code: 'stdin_eof', ms: 1_234 }])
    expect(JSON.stringify(r.ledger)).not.toContain('cdc-7f3a')
    expect(existsSync(r.paths.hubSock)).toBe(false)
    await until(() => c.isClosed())
  })

  test('readRelayStatus is null for a missing or malformed file', () => {
    const paths = nuance()
    expect(readRelayStatus(paths)).toBeNull()
    mkdirSync(paths.run, { recursive: true, mode: 0o700 })
    for (const bad of ['not json', '{"pid":1,"started_mono":1,"last_ping_mono":null,"streams":0}',
      '{"pid":500,"started_mono":-1,"last_ping_mono":null,"streams":0}', '{"pid":500,"started_mono":1,"last_ping_mono":"x","streams":0}']) {
      writeFileSync(paths.relayStatus, bad)
      expect(readRelayStatus(paths)).toBeNull()
    }
  })
})
