import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { lstatSync } from 'node:fs'
import { join } from 'node:path'
import { cleanupTmps, shortSockRoot } from './helpers.ts'
import { makeFakeLink, makeStaleSocket, type FakeLink } from './fake-link.ts'
import { encodeFrame, FRAME_TYPE, FrameDecoder } from '../src/link/frame.ts'
import { decodeJson, encodeMessage, MAX_PIPE_TO_HUB } from '../src/link/messages.ts'
import type { AttachMsg, CallMsg, HubKnockReportMsg, NoticeMsg, ReadyMsg, RefusedCode, ResultMsg, ToolsMsg } from '../src/link/messages.ts'
import { LinkClient, type Connect, type LinkClientDeps } from '../src/nuance/link-client.ts'

const fakes: FakeLink[] = []
const clients: LinkClient[] = []
afterEach(async () => {
  for (const c of clients.splice(0)) c.stop()
  for (const f of fakes.splice(0)) await f.close()
  cleanupTmps()
})

// `satisfies` keeps the literal types, so the fake's recorded frames compare with these directly.
const ATTACH = { t: 'attach', v: 1, lineage: 'lin_' + '1'.repeat(32), harness: 'claude', entrypoint: 'cli',
  folder: '/Users/macair/Projects/collab-trial', pipe_build: '1a2b3c4d', tools_digest: 'ab'.repeat(32), clock: '2026-10-13T12:00:00.000Z' } satisfies AttachMsg
const CALL = { t: 'call', call_ref: `${ATTACH.lineage}:0000000a:1`, name: 'collab_next', arguments: { workspace_id: 'ws_x' }, timeout_ms: 60_000 } satisfies CallMsg
const sha512 = (s: string) => createHash('sha512').update(s).digest('hex')

async function until(cond: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error('condition not met in time')
    await Bun.sleep(5)
  }
}

/** Timers that only record what was asked; a test fires them by their delay. */
function fakeTimers() {
  let next = 1
  const pending = new Map<number, { fn: () => void; ms: number }>()
  return {
    timers: {
      setTimeout: (fn: () => void, ms: number) => { const id = next++; pending.set(id, { fn, ms }); return id },
      clearTimeout: (h: unknown) => { pending.delete(h as number) },
    },
    delays: () => [...pending.values()].map((p) => p.ms),
    fire(ms: number) {
      for (const [id, p] of pending) if (p.ms === ms) { pending.delete(id); p.fn(); return }
      throw new Error(`no timer of ${ms} ms (pending: ${[...pending.values()].map((p) => p.ms).join(', ')})`)
    },
  }
}

/**
 * An injected connect that answers like a hub, in memory, so a test decides what a write does. onWrite sees every message
 * the client writes, before the answer: it may throw (a write that throws) or call h.close() (a write that drops the link).
 */
function scriptedConnect(onWrite: (m: { t: string }, h: { data(b: Uint8Array): void; close(): void }) => void) {
  let dials = 0
  let ends = 0
  const connect: Connect = async (_path, h) => {
    dials++
    const decoder = new FrameDecoder(MAX_PIPE_TO_HUB)
    const answer = (m: object) => queueMicrotask(() => h.data(encodeFrame(FRAME_TYPE.DATA, 0, encodeMessage(m as { t: string }))))
    return {
      write(bytes) {
        for (const f of decoder.push(bytes)) {
          const m = decodeJson(f.payload)
          if (!m || typeof m.t !== 'string') continue
          onWrite({ t: m.t }, h)
          if (m.t === 'attach') answer({ t: 'challenge', nonce: 'c'.repeat(64) })
          else if (m.t === 'prove') answer({ t: 'ready', tools_digest: '0'.repeat(64), hub_build: '00000000', skew_s: 0, session_hint: null })
        }
      },
      end() { ends++ },
    }
  }
  return { connect, dials: () => dials, ends: () => ends }
}

function rig(sockPath: string, o: Partial<LinkClientDeps> = {}) {
  const readies: ReadyMsg[] = []
  const refusals: Array<RefusedCode | 'unparsable'> = []
  const notices: NoticeMsg[] = []
  const results: ResultMsg[] = []
  const tools: ToolsMsg[] = []
  const knocks: HubKnockReportMsg[] = []
  const signed: string[] = []
  let lost = 0
  let now = 0
  const ft = fakeTimers()
  const client = new LinkClient({
    sockPath,
    attach: () => ATTACH,
    sign: (nonce) => { signed.push(nonce); return sha512(nonce) },
    mono: () => now,
    rand: () => 0.5,
    hostAlive: () => true,
    on: {
      ready: (r) => { readies.push(r) }, result: (r) => { results.push(r) }, tools: (t) => { tools.push(t) },
      knockReport: (k) => { knocks.push(k) }, notice: (n) => { notices.push(n) }, refused: (c) => { refusals.push(c) }, lost: () => { lost++ },
    },
    timers: ft.timers,
    ...o,
  })
  clients.push(client)
  return { client, readies, refusals, notices, results, tools, knocks, signed, ft, lost: () => lost, setNow: (t: number) => { now = t } }
}

async function linked(o: Partial<LinkClientDeps> = {}, ready: Partial<ReadyMsg> = {}) {
  const sock = join(shortSockRoot(), 'hub.sock')
  const fake = await makeFakeLink(sock)
  fakes.push(fake)
  fake.accept({ ready })
  const r = rig(sock, o)
  r.client.start()
  await until(() => r.readies.length === 1)
  return { ...r, fake, sock }
}

describe('the link client', () => {
  test('attaches, proves and becomes ready', async () => {
    const r = await linked({}, { session_hint: { session_id: 'ses_1', workspace_id: 'ws_1' } })
    expect(r.client.state()).toBe('ready')
    expect(r.client.fresh()).toBe(true)
    expect(r.client.lastRefused()).toBeNull()
    expect(r.readies).toEqual([{ t: 'ready', tools_digest: '0'.repeat(64), hub_build: '00000000', skew_s: 0, session_hint: { session_id: 'ses_1', workspace_id: 'ws_1' } }])
    expect(r.signed).toHaveLength(1)
    expect(r.signed[0]).toMatch(/^[0-9a-f]{64}$/)
    expect(r.fake.frames()).toEqual([ATTACH, { t: 'prove', sig: sha512(r.signed[0]!) }])
    expect(r.ft.delays()).toEqual([]) // both step deadlines were cleared
    expect(r.client.send(CALL)).toBe('written')
    await until(() => r.fake.frames().length === 3)
    expect(r.fake.frames()[2]).toEqual(CALL)
    r.fake.send({ t: 'result', call_ref: CALL.call_ref, outcome: 'ok', result: { content: [{ type: 'text', text: '{}' }] } })
    r.fake.send({ t: 'tools', digest: 'cd'.repeat(32), list: [] })
    r.fake.send({ t: 'knock_report', count: 1, origins: ['air'], seqs: [7] })
    await until(() => r.knocks.length === 1)
    expect(r.results).toEqual([{ t: 'result', call_ref: CALL.call_ref, outcome: 'ok', result: { content: [{ type: 'text', text: '{}' }] } }])
    expect(r.tools).toEqual([{ t: 'tools', digest: 'cd'.repeat(32), list: [] }])
    expect(r.knocks).toEqual([{ t: 'knock_report', count: 1, origins: ['air'], seqs: [7] }])
  })

  test('a large call is written whole across backpressure', async () => {
    const r = await linked()
    const big = { ...CALL, arguments: { workspace_id: 'ws_x', body: 'x'.repeat(1_500_000) } }
    expect(r.client.send(big)).toBe('written') // far more than one write of a unix socket takes
    await until(() => r.fake.frames().some((f) => f.t === 'call'), 5000)
    expect(r.fake.frames().find((f) => f.t === 'call')).toEqual(big)
  }, 10_000)

  test('an attach over 2 KiB is refused locally with frame_too_large', async () => {
    const sock = join(shortSockRoot(), 'hub.sock')
    const fake = await makeFakeLink(sock)
    fakes.push(fake)
    fake.accept()
    const r = rig(sock, { attach: () => ({ ...ATTACH, folder: '/' + 'a'.repeat(3000) }) })
    r.client.start()
    expect(r.client.state()).toBe('stopped')
    expect(r.client.lastRefused()).toBe('frame_too_large')
    expect(r.refusals).toEqual(['frame_too_large'])
    await Bun.sleep(50)
    expect(fake.connections()).toBe(0)
    expect(r.ft.delays()).toEqual([])
  })

  test('sends nothing but attach and prove before ready', async () => {
    const sock = join(shortSockRoot(), 'hub.sock')
    const fake = await makeFakeLink(sock) // no accept(): every handshake is held
    fakes.push(fake)
    const r = rig(sock)
    r.client.start()
    await until(() => fake.frames().length === 1)
    expect(r.client.state()).toBe('connecting')
    expect(r.client.send(CALL)).toBe('not_ready')
    expect(r.client.send({ t: 'knocks', timeout_ms: 1800 })).toBe('not_ready')
    fake.send({ t: 'challenge', nonce: 'c'.repeat(64) })
    await until(() => fake.frames().length === 2)
    expect(r.client.send({ t: 'tools_get', digest: 'ab'.repeat(32) })).toBe('not_ready')
    await Bun.sleep(50)
    expect(fake.frames()).toEqual([ATTACH, { t: 'prove', sig: sha512('c'.repeat(64)) }])
    expect(r.signed).toEqual(['c'.repeat(64)])
  })

  test('a handshake step past 5 s closes and redials', async () => {
    const sock = join(shortSockRoot(), 'hub.sock')
    const fake = await makeFakeLink(sock)
    fakes.push(fake)
    const r = rig(sock)
    r.client.start()
    await until(() => fake.frames().length === 1)
    expect(r.ft.delays()).toEqual([5000]) // the step deadline (§5.4)
    r.ft.fire(5000)
    expect(r.client.state()).toBe('detached')
    expect(r.ft.delays()).toEqual([2000]) // rand 0.5: exactly the reattach interval
    fake.accept()
    r.ft.fire(2000)
    await until(() => r.readies.length === 1)
    expect(fake.connections()).toBe(2)
    expect(r.lost()).toBe(0) // it was never ready, so nothing was lost
  })

  test('copied PINGs keep it fresh; 20 s without one is stale and send is not_ready', async () => {
    const r = await linked()
    r.setNow(15_000)
    r.fake.ping()
    r.fake.send({ t: 'notice', code: 'collab_build_changed' }) // frames arrive in order: once this is seen, the PING was too
    await until(() => r.notices.length === 1)
    r.setNow(35_000)
    expect(r.client.fresh()).toBe(true) // exactly 20 s after the copied PING
    r.setNow(35_001)
    expect(r.client.fresh()).toBe(false)
    expect(r.client.state()).toBe('ready') // the socket is up; it is only stale
    expect(r.client.send(CALL)).toBe('not_ready')
    r.fake.ping()
    r.fake.send({ t: 'notice', code: 'collab_build_changed' })
    await until(() => r.notices.length === 2)
    expect(r.client.fresh()).toBe(true)
    expect(r.client.send(CALL)).toBe('written')
    await until(() => r.fake.frames().some((f) => f.t === 'call'))
    expect(r.fake.frames().filter((f) => f.t === 'call')).toHaveLength(1)
  })

  test('a 30-minute jump of the monotonic clock makes it stale at once', async () => {
    const r = await linked()
    r.setNow(30 * 60 * 1000) // the Mac slept; CLOCK_MONOTONIC counted it (Review Focus 4)
    expect(r.client.fresh()).toBe(false)
    expect(r.client.send(CALL)).toBe('not_ready')
  })

  test('after the relay drops it, it redials within 2 s ±20% and re-attaches the same lineage', async () => {
    const draws = [0, 0.999999]
    let i = 0
    const r = await linked({ rand: () => draws[i++ % 2]! })
    r.fake.dropConnection()
    await until(() => r.client.state() === 'detached')
    expect(r.lost()).toBe(1)
    expect(r.ft.delays()).toEqual([1600]) // 2000 × (0.8 + 0.4 × 0)
    r.ft.fire(1600)
    await until(() => r.readies.length === 2)
    r.fake.replaceSocket() // a newer relay took the path; the old relay's connections end
    await until(() => r.client.state() === 'detached')
    expect(r.ft.delays()).toEqual([2400]) // 2000 × (0.8 + 0.4 × 0.999999), rounded
    r.ft.fire(2400)
    await until(() => r.readies.length === 3)
    expect(r.fake.connections()).toBe(3)
    const attaches = r.fake.frames().filter((f) => f.t === 'attach')
    expect(attaches.map((a) => a.lineage)).toEqual([ATTACH.lineage, ATTACH.lineage, ATTACH.lineage])
    expect(r.lost()).toBe(2)
  })

  test('no redial once the host is gone', async () => {
    let alive = true
    const r = await linked({ hostAlive: () => alive })
    alive = false
    r.fake.dropConnection()
    await until(() => r.client.state() === 'detached')
    expect(r.ft.delays()).toEqual([])
  })

  test('a stale socket file and a missing socket are both just detached', async () => {
    const root = shortSockRoot()
    const stale = join(root, 'stale.sock')
    await makeStaleSocket(stale)
    expect(lstatSync(stale).isSocket()).toBe(true)
    for (const path of [stale, join(root, 'missing.sock')]) {
      const r = rig(path)
      r.client.start()
      await until(() => r.ft.delays().length === 1)
      expect(r.client.state()).toBe('detached')
      expect(r.client.lastRefused()).toBeNull()
      expect(r.ft.delays()).toEqual([2000])
      expect(r.lost()).toBe(0)
      r.client.stop()
      expect(r.ft.delays()).toEqual([])
    }
  }, 10_000)

  test('lineage_cap keeps redialing, seat_session_ended stops', async () => {
    const sock = join(shortSockRoot(), 'hub.sock')
    const fake = await makeFakeLink(sock)
    fakes.push(fake)
    fake.accept({ refuse: 'lineage_cap' })
    const r = rig(sock)
    r.client.start()
    await until(() => r.refusals.length === 1)
    expect(r.client.state()).toBe('detached')
    expect(r.client.lastRefused()).toBe('lineage_cap')
    expect(r.ft.delays()).toEqual([2000])
    fake.accept({ refuse: 'seat_session_ended' })
    r.ft.fire(2000)
    await until(() => r.refusals.length === 2)
    expect(r.refusals).toEqual(['lineage_cap', 'seat_session_ended'])
    expect(r.client.state()).toBe('stopped')
    expect(r.client.lastRefused()).toBe('seat_session_ended')
    expect(r.ft.delays()).toEqual([])
  })

  test('hub_away redials; folder_not_shared, frame_too_large and seat_proof_failed stop', async () => {
    for (const [code, redials] of [['hub_away', true], ['folder_not_shared', false], ['frame_too_large', false], ['seat_proof_failed', false]] as const) {
      const sock = join(shortSockRoot(), 'hub.sock')
      const fake = await makeFakeLink(sock)
      fakes.push(fake)
      fake.accept({ refuse: code })
      const r = rig(sock)
      r.client.start()
      await until(() => r.refusals.length === 1)
      expect(r.refusals).toEqual([code])
      expect(r.client.lastRefused()).toBe(code)
      expect(r.client.state()).toBe(redials ? 'detached' : 'stopped')
      expect(r.ft.delays()).toEqual(redials ? [2000] : [])
    }
  })

  test('hub_lost stops it', async () => {
    const r = await linked()
    r.fake.send({ t: 'notice', code: 'hub_lost' })
    await until(() => r.client.state() === 'stopped')
    expect(r.notices).toEqual([{ t: 'notice', code: 'hub_lost' }])
    expect(r.lost()).toBe(1)
    expect(r.ft.delays()).toEqual([])
    expect(r.client.send(CALL)).toBe('not_ready')
  })

  test('link_closing detaches it and it reattaches when the hub returns', async () => {
    const r = await linked()
    r.fake.send({ t: 'notice', code: 'link_closing' })
    await until(() => r.client.state() === 'detached')
    expect(r.notices).toEqual([{ t: 'notice', code: 'link_closing' }])
    expect(r.lost()).toBe(1)
    expect(r.ft.delays()).toEqual([2000])
    r.ft.fire(2000)
    await until(() => r.readies.length === 2)
    expect(r.client.state()).toBe('ready')
  })

  test('a refusal code is kept until the next ready and cleared by it', async () => {
    const sock = join(shortSockRoot(), 'hub.sock')
    const fake = await makeFakeLink(sock)
    fakes.push(fake)
    fake.accept({ refuse: 'hub_away' })
    const r = rig(sock)
    r.client.start()
    await until(() => r.refusals.length === 1)
    expect(r.client.lastRefused()).toBe('hub_away')
    fake.accept()
    r.ft.fire(2000)
    await until(() => r.readies.length === 1)
    expect(r.client.lastRefused()).toBeNull()
  })

  test('a socket path over 103 bytes is never dialed', () => {
    let dials = 0
    const r = rig('/tmp/' + 'x'.repeat(120) + '.sock', { connect: async () => { dials++; throw new Error('never dialled') } })
    r.client.start()
    expect(r.client.state()).toBe('stopped')
    expect(r.client.lastRefused()).toBe('socket_path_too_long')
    expect(dials).toBe(0)
    expect(r.ft.delays()).toEqual([])
  })

  test('stop closes the link and never redials', async () => {
    const r = await linked()
    r.client.stop()
    expect(r.client.state()).toBe('stopped')
    expect(r.client.send(CALL)).toBe('not_ready')
    expect(r.ft.delays()).toEqual([])
    expect(r.lost()).toBe(0) // stopping is the pipe's own act; it answers its own calls
  })

  test('a write that drops the link is still written: send cannot tell, state() and lost() do (§9.3 item 3)', async () => {
    const sc = scriptedConnect((m, h) => { if (m.t === 'call') h.close() }) // bunConnect's flush seeing the socket gone, inside the write
    const r = rig('/tmp/never-dialled.sock', { connect: sc.connect })
    r.client.start()
    await until(() => r.readies.length === 1)
    expect(r.client.send(CALL)).toBe('written') // handed to the stream: it may have reached the hub, so the caller must not resend
    expect(r.client.state()).not.toBe('ready') // the pipe settles that call unknown from this (Task 30)
    expect(r.client.fresh()).toBe(false)
    expect(r.lost()).toBe(1)
    expect(r.ft.delays()).toEqual([2000])
    await Bun.sleep(20)
    expect(r.lost()).toBe(1) // once, and nothing of the old connection stirs afterwards
  })

  test('a write that throws during attach is a loss like any other: torn down and redialled, nothing unhandled', async () => {
    const sc = scriptedConnect((m) => { if (m.t === 'attach') throw new Error('EPIPE') })
    const r = rig('/tmp/never-dialled.sock', { connect: sc.connect })
    r.client.start()
    await until(() => r.ft.delays().length === 1)
    expect(r.client.state()).toBe('detached')
    expect(r.ft.delays()).toEqual([2000]) // the redial alone: no handshake step is armed for a connection that is gone
    expect(sc.ends()).toBe(1)
    expect(r.lost()).toBe(0) // it never reached ready
    expect(r.client.lastRefused()).toBeNull()
    r.ft.fire(2000)
    await until(() => sc.dials() === 2) // the host lives, so it dials again
  })

  test('a write that throws during prove is a loss like any other: torn down and redialled, nothing unhandled', async () => {
    const sc = scriptedConnect((m) => { if (m.t === 'prove') throw new Error('EPIPE') })
    const r = rig('/tmp/never-dialled.sock', { connect: sc.connect })
    r.client.start()
    await until(() => r.ft.delays().join() === '2000') // the attach step deadline was cleared by the teardown
    expect(r.client.state()).toBe('detached')
    expect(sc.ends()).toBe(1)
    expect(r.lost()).toBe(0)
    r.ft.fire(2000)
    await until(() => sc.dials() === 2)
  })

  test('a refusal it cannot parse stops it for good and shows as unparsable', async () => {
    const sock = join(shortSockRoot(), 'hub.sock')
    const fake = await makeFakeLink(sock)
    fakes.push(fake)
    fake.accept({ refuse: 'a_code_from_a_newer_hub' as RefusedCode }) // refused, CLOSE and the end of the socket, as a hub would
    const r = rig(sock)
    r.client.start()
    await until(() => r.refusals.length === 1)
    expect(r.refusals).toEqual(['unparsable'])
    expect(r.client.lastRefused()).toBe('unparsable')
    expect(r.client.state()).toBe('stopped')
    expect(r.ft.delays()).toEqual([]) // no redial, and the CLOSE that followed did not start one
    expect(r.lost()).toBe(0)
    await Bun.sleep(50)
    expect(fake.connections()).toBe(1) // no further dial
    expect(r.client.send(CALL)).toBe('not_ready')
  })

  test('a refusal without a code on a ready link also stops it, and the loss is reported once', async () => {
    const r = await linked()
    r.fake.send({ t: 'refused' })
    await until(() => r.client.state() === 'stopped')
    expect(r.refusals).toEqual(['unparsable'])
    expect(r.client.lastRefused()).toBe('unparsable')
    expect(r.lost()).toBe(1)
    expect(r.ft.delays()).toEqual([])
    await Bun.sleep(50)
    expect(r.fake.connections()).toBe(1)
    expect(r.lost()).toBe(1)
  })
})
