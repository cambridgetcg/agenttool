// Seat streams on the Air (Task 50; spec §5.3, §5.4, §6.1, §6.2, §6.6, §9.9, §12.2 Seats/Children/Link). Each test runs a
// LinkSession over an in-memory DeviceLink whose far end is a scripted relay: it opens streams, sends DATA and CLOSE frames
// as the real relay would (stream ids from 1, stream 0 for PONG and relay_replaced), and records every frame the hub sends.
import { afterEach, describe, expect, test } from 'bun:test'
import { createPrivateKey, type KeyObject } from 'node:crypto'
import { join } from 'node:path'
import type { DeviceFile } from '../src/air/devices.ts'
import { DialPolicy, type DeviceLink } from '../src/air/dialer.ts'
import { LineageStore, type LineageEntry } from '../src/air/lineages.ts'
import type { ChildPool } from '../src/air/pool.ts'
import type { DeviceStatus } from '../src/air/status.ts'
import { AttachTable, LinkSession, type LinkSessionDeps, type SeatHandlers, type SeatRef } from '../src/air/streams.ts'
import { AIR_LEDGER_KEYS, type LedgerFields } from '../src/ledger.ts'
import { encodeFrame, FRAME_TYPE, FrameDecoder, type Frame } from '../src/link/frame.ts'
import {
  decodeJson, encodeMessage, MAX_HUB_TO_PIPE, MAX_PIPE_TO_HUB, newLineage, type CallMsg, type HubKnockReportMsg, type KnocksMsg, type ResultMsg, type ToolsGetMsg,
} from '../src/link/messages.ts'
import { generateSeatKey, signSeat } from '../src/nuance/seatkey.ts'
import { cleanupTmps, temp } from './helpers.ts'

afterEach(cleanupTmps)

const NOW = new Date('2026-10-13T12:00:00.000Z')
const FOLDER = '/Users/macair/Projects/collab-trial'
const MIRROR_ID = '0123456789abcdef'
const DIGEST = 'a'.repeat(64)
const seat = generateSeatKey()
const SEAT_PRIV: KeyObject = createPrivateKey(seat.privatePem)
const OTHER_PRIV: KeyObject = createPrivateKey(generateSeatKey().privatePem)

function device(o: Partial<DeviceFile> = {}): DeviceFile {
  return {
    v: 1, device: 'nuance', user: 'macair', state: 'paired', host_alias: 'collab-nuance', seat_public: seat.publicHex,
    bundle_build: 'abcdef01', key_expiry: '20270111', trailer: 'Co-Authored-By: The Fable of the Eternal Universe <Yu@Ai-love.cc>',
    git: { path: '/Library/Developer/CommandLineTools/usr/bin/git', version: '2.39.5', sha256: 'b'.repeat(64), guard: true, apple: true },
    summon: { key_sha256: 'c'.repeat(64), dropin_stat: '1 2 3 0 600' },
    shares: [{ remote_realpath: FOLDER, remote_gitdir: `${FOLDER}/.git`, air_clone: '/Users/yuai/Projects/collab-trial', mirror_id: MIRROR_ID,
      mirror_worktree_id: null, workspace_id: 'ws_0123456789abcdef01234567', caps: { maxEntries: 10_000, maxTotalBytes: 64 << 20, maxBlobBytes: 16 << 20, maxChangedPaths: 128 } }],
    prepared_at: '2026-10-13T10:00:00.000Z', paired_at: '2026-10-13T11:00:00.000Z', ...o,
  }
}

function entry(lineage: string, o: Partial<LineageEntry> = {}): LineageEntry {
  return { lineage, device: 'nuance', user: 'macair', harness: 'claude', folder: FOLDER, state: 'pending', session_id: null,
    credential_path: null, past_sessions: [], mirror_id: MIRROR_ID, workspace_id: null, pending_start: null, parked: null,
    detached_since: null, created_at: NOW.toISOString(), ...o }
}

/** The relay end of the link: what the hub wrote, decoded, plus the frames a relay would send. */
interface Relay {
  link: DeviceLink
  sent: Frame[]                                         // every frame the hub wrote, oldest first
  events: string[]                                      // `data:<stream>:<t>`, `close:<stream>` and `link_closed`, in order
  messages(stream: number): Array<Record<string, unknown>>
  closes(stream: number): number
  open(stream: number): void
  data(stream: number, m: object | Uint8Array): void
  close(stream: number): void
  pong(): void
  raw(bytes: Uint8Array): void                          // bytes as they arrive off the wire, not framed by the helper
  drop(): void                                          // the relay side goes away: ssh exits and `closed` resolves
  closedByHub(): boolean
}

function relay(o: { autoPong?: boolean; failSend?: boolean } = {}): Relay {
  let onData: ((chunk: Uint8Array) => void) | null = null
  let shut = false
  let resolveClosed!: (v: { code: number | null; stderr: string }) => void
  const closed = new Promise<{ code: number | null; stderr: string }>((r) => { resolveClosed = r })
  const decoder = new FrameDecoder(MAX_HUB_TO_PIPE)
  const sent: Frame[] = []
  const events: string[] = []
  const toHub = (type: 1 | 2 | 3 | 4 | 5, stream: number, payload?: Uint8Array) => { if (!shut) onData?.(encodeFrame(type, stream, payload)) }
  const link: DeviceLink = {
    send(bytes) {
      if (shut || o.failSend) throw new Error('link closed')
      for (const f of decoder.push(bytes)) {
        sent.push(f)
        if (f.type === FRAME_TYPE.DATA) events.push(`data:${f.stream}:${String(decodeJson(f.payload)?.t)}`)
        if (f.type === FRAME_TYPE.CLOSE) events.push(`close:${f.stream}`)
        if (f.type === FRAME_TYPE.PING && o.autoPong) queueMicrotask(() => toHub(FRAME_TYPE.PONG, 0))
      }
    },
    onData(cb) { onData = cb },
    close() { if (!shut) { shut = true; events.push('link_closed'); resolveClosed({ code: 0, stderr: '' }) } },
    closed,
  }
  return {
    link, sent, events,
    messages: (stream) => sent.filter((f) => f.type === FRAME_TYPE.DATA && f.stream === stream).map((f) => decodeJson(f.payload)!),
    closes: (stream) => sent.filter((f) => f.type === FRAME_TYPE.CLOSE && f.stream === stream).length,
    open: (stream) => toHub(FRAME_TYPE.OPEN, stream),
    data: (stream, m) => toHub(FRAME_TYPE.DATA, stream, m instanceof Uint8Array ? m : encodeMessage(m as { t: string })),
    close: (stream) => toHub(FRAME_TYPE.CLOSE, stream),
    pong: () => toHub(FRAME_TYPE.PONG, 0),
    raw: (bytes) => { if (!shut) onData?.(bytes) },
    drop: () => { if (!shut) { shut = true; resolveClosed({ code: 255, stderr: '' }) } },
    closedByHub: () => shut,
  }
}

interface Rig {
  relay: Relay; session: LinkSession; store: LineageStore; attachments: AttachTable; pool: { live: number; attached: Set<string>; calls: string[][] }
  statuses: Array<Partial<DeviceStatus>>; ledger: LedgerFields[]; calls: Array<{ seat: SeatRef; m: CallMsg }>; cancels: string[]
  knocks: Array<{ seat: SeatRef; m: KnocksMsg }>; deps: LinkSessionDeps; run: Promise<void>
}

function rig(o: { dev?: () => DeviceFile; store?: LineageStore; attachments?: AttachTable; handlers?: Partial<SeatHandlers>;
  relay?: Relay; live?: number; deps?: Partial<LinkSessionDeps> } = {}): Rig {
  const r = o.relay ?? relay()
  const store = o.store ?? new LineageStore(join(temp('cb-streams-'), 'lineages.json'))
  store.load()                                         // a missing file is an empty store
  // `live` stands for children that run without an attached stream (starting, or inside their window); on top of that the
  // pool counts the device's store entries whose lineage is attached, as ChildPool.liveCount does.
  const pool = { live: o.live ?? 0, attached: new Set<string>(), calls: [] as string[][] }
  const fakePool = {
    liveCount: (d: string) => {
      pool.calls.push(['liveCount', d])
      return pool.live + store.all().filter((e) => e.device === d && pool.attached.has(e.lineage)).length
    },
    attached: (l: string) => { pool.calls.push(['attached', l]); pool.attached.add(l) },
    detached: (l: string) => { pool.calls.push(['detached', l]); pool.attached.delete(l) },
  } as unknown as ChildPool
  const statuses: Array<Partial<DeviceStatus>> = []
  const ledger: LedgerFields[] = []
  const calls: Rig['calls'] = []
  const cancels: string[] = []
  const knocks: Rig['knocks'] = []
  const handlers: SeatHandlers = {
    call: o.handlers?.call ?? (async (s, m) => { calls.push({ seat: s, m }); return { t: 'result', call_ref: m.call_ref, outcome: 'ok', result: { content: [{ type: 'text', text: 'ok' }] } } }),
    cancel: o.handlers?.cancel ?? ((_s, ref) => { cancels.push(ref) }),
    knocks: o.handlers?.knocks ?? (async (s, m) => { knocks.push({ seat: s, m }); return { t: 'knock_report', count: 1, origins: ['air'], seqs: [4] } }),
  }
  const attachments = o.attachments ?? new AttachTable()
  const deps: LinkSessionDeps = {
    link: r.link, device: o.dev ?? (() => device()), tools: () => ({ digest: DIGEST, list: [] }), hubBuild: '1234abcd',
    store, pool: fakePool, attachments, handlers, status: (s) => { statuses.push(s) }, onRelayReplaced: () => {},
    ledger: (f) => { ledger.push(f) }, mono: () => performance.now(), now: () => NOW, stepMs: 5_000, pingMs: 15_000, pongDropMs: 45_000,
    ...o.deps,
  }
  const session = new LinkSession(deps)
  const run = session.run()
  return { relay: r, session, store, attachments, pool, statuses, ledger, calls, cancels, knocks, deps, run }
}

function attachMsg(lineage: string, o: Record<string, unknown> = {}) {
  return { t: 'attach', v: 1, lineage, harness: 'claude', entrypoint: 'cli', folder: FOLDER, pipe_build: 'abcdef01',
    tools_digest: 'b'.repeat(64), clock: NOW.toISOString(), ...o }
}

/** The prove step: a signature by `key` over the challenge the hub sent on `stream`; returns the last message on the stream. */
function prove(r: Relay, stream: number, lineage: string, key: KeyObject = SEAT_PRIV) {
  const challenge = r.messages(stream).find((m) => m.t === 'challenge')
  if (challenge) r.data(stream, { t: 'prove', sig: signSeat(key, 'nuance', 'macair', lineage, challenge.nonce as string) })
  return r.messages(stream).at(-1)
}

/** OPEN, attach, then a prove signed by `key` over the challenge; returns the last message the hub sent on the stream. */
function handshake(r: Relay, stream: number, lineage: string, o: { key?: KeyObject; attach?: Record<string, unknown> } = {}) {
  r.open(stream)
  r.data(stream, attachMsg(lineage, o.attach))
  return prove(r, stream, lineage, o.key)
}

/** A DATA frame whose declared payload is one byte over the pipe → hub limit (§6.6); the payload bytes follow in full. */
const oversizedFrame = (stream: number) => encodeFrame(FRAME_TYPE.DATA, stream, new Uint8Array(MAX_PIPE_TO_HUB + 1))

/** A frame header with a type no peer sends (§5.4): the decoder cannot trust the byte stream after it. */
function malformedHeader(stream: number): Uint8Array {
  const h = new Uint8Array(9)
  new DataView(h.buffer).setUint8(4, 9)
  new DataView(h.buffer).setUint32(5, stream)
  return h
}

const linkEnds = (t: Rig) => t.ledger.filter((f) => f.event === 'link_end')

const until = async (cond: () => boolean, ms = 2000) => {
  const end = performance.now() + ms
  while (!cond()) {
    if (performance.now() > end) throw new Error('condition not met in time')
    await Bun.sleep(2)
  }
}

describe('the handshake', () => {
  test("attach, challenge, prove, ready with the lineage's session hint", async () => {
    const t = rig()
    const known = newLineage()
    t.store.upsert(entry(known, { state: 'live', session_id: 'session_1', credential_path: '/tmp/session_1.json', workspace_id: 'ws_1' }))
    const fresh = newLineage()
    t.relay.open(1)
    t.relay.data(1, attachMsg(known))
    const challenge = t.relay.messages(1)[0]!
    expect(challenge.t).toBe('challenge')
    expect(challenge.nonce).toMatch(/^[0-9a-f]{64}$/)
    t.relay.data(1, { t: 'prove', sig: signSeat(SEAT_PRIV, 'nuance', 'macair', known, challenge.nonce as string) })
    expect(t.relay.messages(1)[1]).toEqual({ t: 'ready', tools_digest: DIGEST, hub_build: '1234abcd', skew_s: 0, session_hint: { session_id: 'session_1', workspace_id: 'ws_1' } })
    // A brand-new lineage gets no hint, and the store records it as pending with the share's mirror, so its first call has an entry.
    expect(handshake(t.relay, 2, fresh)).toMatchObject({ t: 'ready', session_hint: null })
    expect(t.store.get(fresh)).toEqual(entry(fresh))
    expect(t.attachments.has(known) && t.attachments.has(fresh)).toBe(true)
    expect(t.pool.calls).toContainEqual(['attached', known])
    // The relay closes stream 1 (the pipe went away): the lineage detaches, and its 10-minute window starts.
    t.relay.close(1)
    expect(t.attachments.has(known)).toBe(false)
    expect(t.pool.calls).toContainEqual(['detached', known])
    t.session.close('test')
    await t.run
  })

  test('a wrong proof is refused seat_proof_failed and the stream closes', async () => {
    const t = rig()
    const lineage = newLineage()
    expect(handshake(t.relay, 1, lineage, { key: OTHER_PRIV })).toEqual({ t: 'refused', code: 'seat_proof_failed' })
    expect(t.relay.closes(1)).toBe(1)
    expect(t.attachments.has(lineage)).toBe(false)
    expect(t.store.get(lineage)).toBeUndefined() // nothing is written for an unproven seat
    expect(t.pool.calls.filter((c) => c[0] === 'attached')).toEqual([])
    t.session.close('test')
    await t.run
  })

  test('an attach over 2 KiB and a prove over 1 KiB are refused frame_too_large', async () => {
    const t = rig()
    t.relay.open(1)
    t.relay.data(1, attachMsg(newLineage(), { pad: 'x'.repeat(2048) }))
    expect(t.relay.messages(1)).toEqual([{ t: 'refused', code: 'frame_too_large' }])
    expect(t.relay.closes(1)).toBe(1)
    t.relay.open(2)
    t.relay.data(2, attachMsg(newLineage()))
    t.relay.data(2, { t: 'prove', sig: 'f'.repeat(128), pad: 'x'.repeat(1024) })
    expect(t.relay.messages(2).map((m) => m.t)).toEqual(['challenge', 'refused'])
    expect(t.relay.messages(2)[1]).toEqual({ t: 'refused', code: 'frame_too_large' })
    expect(t.relay.closes(2)).toBe(1)
    t.session.close('test')
    await t.run
  })

  test('a step past 5 s closes the stream', async () => {
    const t = rig({ deps: { stepMs: 30 } })            // 30 ms stands in for the 5 s step
    t.relay.open(1)                                    // no attach
    t.relay.open(2)
    t.relay.data(2, attachMsg(newLineage()))           // a challenge, then no prove
    await until(() => t.relay.closes(1) === 1 && t.relay.closes(2) === 1)
    expect(t.relay.messages(1)).toEqual([])
    expect(t.relay.messages(2).map((m) => m.t)).toEqual(['challenge'])
    t.session.close('test')
    await t.run
  })

  test('a call before ready closes the stream', async () => {
    const t = rig()
    const lineage = newLineage()
    const call = { t: 'call', call_ref: `${lineage}:0a0b0c0d:1`, name: 'collab_next', arguments: {}, timeout_ms: 60_000 }
    t.relay.open(1)
    t.relay.data(1, call)                              // before attach
    t.relay.open(2)
    t.relay.data(2, attachMsg(lineage))
    t.relay.data(2, call)                              // after attach, before prove
    expect(t.relay.closes(1)).toBe(1)
    expect(t.relay.closes(2)).toBe(1)
    expect(t.calls).toEqual([])
    t.session.close('test')
    await t.run
  })

  test('a tools_get or knocks before ready closes the stream and reaches no handler', async () => {
    // §5.4: "A `call`, `tools_get` or `knocks` before `ready` closes the stream."
    const t = rig()
    const lineage = newLineage()
    const early = [{ t: 'tools_get', digest: DIGEST }, { t: 'knocks', timeout_ms: 1800 }]
    early.forEach((m, i) => {                          // before attach: streams 1 and 2
      t.relay.open(1 + i)
      t.relay.data(1 + i, m)
    })
    early.forEach((m, i) => {                          // after attach, before prove: streams 3 and 4
      t.relay.open(3 + i)
      t.relay.data(3 + i, attachMsg(lineage))
      t.relay.data(3 + i, m)
    })
    await Bun.sleep(5)                                 // a wrongly dispatched knocks would answer after a microtask
    for (const n of [1, 2, 3, 4]) expect(t.relay.closes(n)).toBe(1)
    expect(t.relay.messages(1)).toEqual([])            // no tools list, no knock_report
    expect(t.relay.messages(2)).toEqual([])
    expect(t.relay.messages(3).map((m) => m.t)).toEqual(['challenge'])
    expect(t.relay.messages(4).map((m) => m.t)).toEqual(['challenge'])
    expect(t.knocks).toEqual([])
    expect(t.attachments.has(lineage)).toBe(false)
    expect(t.pool.calls.filter((c) => c[0] === 'attached')).toEqual([])
    t.session.close('test')
    await t.run
  })

  test('a folder that is not a device share is refused folder_not_shared', async () => {
    const t = rig()
    t.relay.open(1)
    t.relay.data(1, attachMsg(newLineage(), { folder: '/Users/macair/Projects/elsewhere' }))
    expect(t.relay.messages(1)).toEqual([{ t: 'refused', code: 'folder_not_shared' }])
    expect(t.relay.closes(1)).toBe(1)
    t.session.close('test')
    await t.run
  })

  test('a retired lineage is refused seat_session_ended', async () => {
    const t = rig()
    const lineage = newLineage()
    t.store.upsert(entry(lineage, { state: 'retired', past_sessions: ['session_old'], detached_since: '2026-10-01T00:00:00.000Z' }))
    t.relay.open(1)
    t.relay.data(1, attachMsg(lineage))
    expect(t.relay.messages(1)).toEqual([{ t: 'refused', code: 'seat_session_ended' }])
    expect(t.relay.closes(1)).toBe(1)
    t.session.close('test')
    await t.run
  })

  test('a ninth new lineage is lineage_cap, a reattach of a live one is not', async () => {
    const t = rig({ live: 8 })
    const known = newLineage()
    t.store.upsert(entry(known, { state: 'live', session_id: 'session_1', credential_path: '/tmp/session_1.json', workspace_id: 'ws_1' }))
    t.relay.open(1)
    t.relay.data(1, attachMsg(newLineage()))
    expect(t.relay.messages(1)).toEqual([{ t: 'refused', code: 'lineage_cap' }])
    expect(handshake(t.relay, 2, known)).toMatchObject({ t: 'ready' })
    t.session.close('test')
    await t.run
  })

  test('two new lineages that attach at 7 cannot both prove: the second is lineage_cap at prove (§6.6)', async () => {
    const t = rig({ live: 7 })                         // 7 live: the attach step lets any number of new lineages through
    const first = newLineage()
    const second = newLineage()
    t.relay.open(1)
    t.relay.data(1, attachMsg(first))
    t.relay.open(2)
    t.relay.data(2, attachMsg(second))
    expect(t.relay.messages(1).map((m) => m.t)).toEqual(['challenge'])
    expect(t.relay.messages(2).map((m) => m.t)).toEqual(['challenge'])
    expect(prove(t.relay, 1, first)).toMatchObject({ t: 'ready' })   // 7 live, then 8 with this one attached
    expect(prove(t.relay, 2, second)).toEqual({ t: 'refused', code: 'lineage_cap' })
    expect(t.relay.closes(2)).toBe(1)
    expect(t.store.get(first)).toBeDefined()
    expect(t.store.get(second)).toBeUndefined()        // no pending entry is written past the cap
    expect(t.attachments.has(second)).toBe(false)
    expect(t.pool.calls).not.toContainEqual(['attached', second])
    expect(t.pool.attached.size).toBe(1)
    expect(t.ledger.filter((f) => f.event === 'attach_refused')).toEqual([
      { event: 'attach_refused', device: 'nuance', user: 'macair', lineage: second, code: 'lineage_cap' },
    ])
    t.session.close('test')
    await t.run
  })

  test('a known lineage retired, or moved to another folder, between attach and prove is refused at prove', async () => {
    const t = rig()
    const retired = newLineage()
    const moved = newLineage()
    t.store.upsert(entry(retired))
    t.store.upsert(entry(moved))
    for (const [n, l] of [[1, retired], [2, moved]] as const) {
      t.relay.open(n)
      t.relay.data(n, attachMsg(l))
      expect(t.relay.messages(n).map((m) => m.t)).toEqual(['challenge'])   // both pass the attach checks
    }
    // Within the 5 s step another stream retires one lineage and a concurrent stream records the other for another folder.
    t.store.upsert(entry(retired, { state: 'retired', past_sessions: ['session_old'], detached_since: '2026-10-13T11:00:00.000Z' }))
    t.store.upsert(entry(moved, { folder: '/Users/macair/Projects/other' }))
    expect(prove(t.relay, 1, retired)).toEqual({ t: 'refused', code: 'seat_session_ended' })
    expect(prove(t.relay, 2, moved)).toEqual({ t: 'refused', code: 'folder_not_shared' })
    expect(t.relay.closes(1) + t.relay.closes(2)).toBe(2)
    expect(t.attachments.has(retired) || t.attachments.has(moved)).toBe(false)
    expect(t.pool.calls.filter((c) => c[0] === 'attached')).toEqual([])
    expect(t.store.get(moved)!.folder).toBe('/Users/macair/Projects/other')   // the refusal changed nothing in the store
    t.session.close('test')
    await t.run
  })

  test('a known lineage still proves at 8 live lineages: the cap is for new ones', async () => {
    const t = rig({ live: 8 })
    const known = newLineage()
    t.store.upsert(entry(known))
    expect(handshake(t.relay, 1, known)).toMatchObject({ t: 'ready' })
    expect(t.attachments.has(known)).toBe(true)
    t.relay.open(2)
    t.relay.data(2, attachMsg(newLineage()))
    expect(t.relay.messages(2)).toEqual([{ t: 'refused', code: 'lineage_cap' }])   // a new one is still refused
    t.session.close('test')
    await t.run
  })

  test('every refused handshake writes one attach_refused line with its code, and only ledger keys', async () => {
    let state: DeviceFile['state'] = 'paired'
    const t = rig({ dev: () => device({ state, seat_public: state === 'paired' ? seat.publicHex : null }) })
    const [pad, other, retired, foreign, impostor, bigProve, capped, away] = Array.from({ length: 8 }, () => newLineage())
    t.store.upsert(entry(retired!, { state: 'retired', past_sessions: ['session_old'], detached_since: '2026-10-01T00:00:00.000Z' }))
    t.store.upsert(entry(foreign!, { device: 'zerone', user: 'yu' }))
    t.relay.open(1)
    t.relay.data(1, attachMsg(pad!, { pad: 'x'.repeat(2048) }))                                   // too big: its lineage is never parsed
    t.relay.open(2)
    t.relay.data(2, attachMsg(other!, { folder: '/Users/macair/Projects/elsewhere' }))
    t.relay.open(3)
    t.relay.data(3, attachMsg(retired!))
    t.relay.open(4)
    t.relay.data(4, attachMsg(foreign!))
    expect(handshake(t.relay, 5, impostor!, { key: OTHER_PRIV })).toEqual({ t: 'refused', code: 'seat_proof_failed' })
    t.relay.open(6)
    t.relay.data(6, attachMsg(bigProve!))
    t.relay.data(6, { t: 'prove', sig: 'f'.repeat(128), pad: 'x'.repeat(1024) })
    t.pool.live = 8
    t.relay.open(7)
    t.relay.data(7, attachMsg(capped!))
    t.pool.live = 0
    state = 'unpaired'
    t.relay.open(8)
    t.relay.data(8, attachMsg(away!))
    const line = (lineage: string | undefined, code: string) => ({ event: 'attach_refused', device: 'nuance', user: 'macair', lineage, code })
    expect(t.ledger.filter((f) => f.event === 'attach_refused')).toEqual([
      line(undefined, 'frame_too_large'), line(other, 'folder_not_shared'), line(retired, 'seat_session_ended'), line(foreign, 'seat_proof_failed'),
      line(impostor, 'seat_proof_failed'), line(bigProve, 'frame_too_large'), line(capped, 'lineage_cap'), line(away, 'hub_away'),
    ])
    for (const f of t.ledger) for (const k of Object.keys(f)) expect(AIR_LEDGER_KEYS as readonly string[]).toContain(k)
    for (let n = 1; n <= 8; n++) expect(t.relay.closes(n)).toBe(1)
    t.session.close('test')
    await t.run
  })

  test('a lineage of another seat or another folder is refused', async () => {
    const t = rig()
    const foreign = newLineage()
    const moved = newLineage()
    t.store.upsert(entry(foreign, { device: 'zerone', user: 'yu' }))
    t.store.upsert(entry(moved, { folder: '/Users/macair/Projects/other' }))
    t.relay.open(1)
    t.relay.data(1, attachMsg(foreign))
    t.relay.open(2)
    t.relay.data(2, attachMsg(moved))
    expect(t.relay.messages(1)).toEqual([{ t: 'refused', code: 'seat_proof_failed' }])
    expect(t.relay.messages(2)).toEqual([{ t: 'refused', code: 'folder_not_shared' }])
    t.session.close('test')
    await t.run
  })

  test('the attach ledger line records the entrypoint label', async () => {
    const t = rig()
    const lineage = newLineage()
    handshake(t.relay, 1, lineage, { attach: { entrypoint: 'unknown' } })
    expect(t.ledger).toContainEqual({ event: 'attach', device: 'nuance', user: 'macair', lineage, code: 'unknown' })
    const keys = new Set(t.ledger.flatMap((f) => Object.keys(f)))
    for (const k of keys) expect(['event', 'device', 'user', 'lineage', 'code']).toContain(k)
    t.session.close('test')
    await t.run
  })

  test('ready carries the skew and a 61 s skew is written to the device status', async () => {
    const t = rig()
    const ready = handshake(t.relay, 1, newLineage(), { attach: { clock: new Date(NOW.getTime() - 61_000).toISOString() } })
    expect(ready).toMatchObject({ t: 'ready', skew_s: 61 })
    expect(t.statuses).toContainEqual({ skew_s: 61 })
    t.session.close('test')
    await t.run
  })
})

describe('one attach per lineage', () => {
  test('a second attach of one lineage sends hub_lost to the first', async () => {
    const t = rig()
    const lineage = newLineage()
    handshake(t.relay, 1, lineage)
    expect(handshake(t.relay, 2, lineage)).toMatchObject({ t: 'ready' })
    expect(t.relay.messages(1).at(-1)).toEqual({ t: 'notice', code: 'hub_lost' })
    expect(t.relay.closes(1)).toBe(1)
    // The newer stream still holds the lineage: the older one's end never detaches it.
    expect(t.attachments.has(lineage)).toBe(true)
    expect(t.pool.calls.filter((c) => c[0] === 'detached')).toEqual([])
    t.session.close('test')
    await t.run
  })

  test("a reattach on a new link keeps the lineage attached when the old link ends", async () => {
    // Review Focus 3: after a Wi-Fi drop the pipe re-attaches through a new relay, possibly before the hub has noticed
    // that the old link is dead; the old link's end must not start the lineage's detach window.
    const attachments = new AttachTable()
    const old = rig({ attachments })
    const lineage = newLineage()
    handshake(old.relay, 1, lineage)
    const fresh = rig({ attachments, store: old.store })
    expect(handshake(fresh.relay, 1, lineage)).toMatchObject({ t: 'ready' })
    old.relay.data(0, { t: 'relay_replaced' })
    await old.run
    expect(attachments.has(lineage)).toBe(true)
    expect(old.pool.calls.filter((c) => c[0] === 'detached')).toEqual([])
    fresh.session.close('test')
    await fresh.run
  })

  test('a hand-over whose notice to the older stream cannot be written ends the link with the lineage detached, not left counted as attached (Task 63 conformance-5-1)', async () => {
    const r = relay()
    const t = rig({ relay: r })
    const lineage = newLineage()
    expect(handshake(r, 3, lineage)).toMatchObject({ t: 'ready' })
    expect(t.pool.attached.has(lineage)).toBe(true)
    // The pipe reconnects as stream 5 while ssh's stdin is already gone: the notice to stream 3 cannot be written.
    const send = r.link.send
    r.link.send = (bytes) => { if (new TextDecoder().decode(bytes).includes('hub_lost')) throw new Error('ssh stdin is gone'); send(bytes) }
    handshake(r, 5, lineage)
    await t.run
    expect(linkEnds(t)).toEqual([{ event: 'link_end', device: 'nuance', user: 'macair', code: 'write_failed' }])
    // The session ended inside the hand-over: whatever the pool was told last must be that nothing holds the lineage.
    expect(t.attachments.has(lineage)).toBe(false)
    expect(t.pool.attached.has(lineage)).toBe(false)
    expect(t.pool.calls.filter((c) => c[1] === lineage).map((c) => c[0]).at(-1)).toBe('detached')
  })

  test('a newer attach on another link wins too, and the AttachTable keeps only the newest', () => {
    const table = new AttachTable()
    const closed: string[] = []
    const first = () => closed.push('first')
    const second = () => closed.push('second')
    table.attach('lin_x', first)
    table.attach('lin_x', second)
    expect(closed).toEqual(['first'])
    table.detach('lin_x', first)                       // a late detach of the loser changes nothing
    expect(table.has('lin_x')).toBe(true)
    table.detach('lin_x', second)
    expect(table.has('lin_x')).toBe(false)
  })
})

describe('after ready', () => {
  test('calls, cancels, knocks and tools_get reach their handlers and answer on the same stream', async () => {
    const t = rig()
    const lineage = newLineage()
    handshake(t.relay, 3, lineage)
    t.relay.data(3, { t: 'call', call_ref: `${lineage}:0a0b0c0d:1`, name: 'collab_next', arguments: { workspace_id: 'ws_1' }, timeout_ms: 60_000 })
    t.relay.data(3, { t: 'cancel', call_ref: `${lineage}:0a0b0c0d:1` })
    t.relay.data(3, { t: 'knocks', timeout_ms: 1800 })
    t.relay.data(3, { t: 'tools_get', digest: DIGEST })
    await until(() => t.relay.messages(3).filter((m) => m.t === 'result' || m.t === 'knock_report').length === 2)
    expect(t.calls).toHaveLength(1)
    expect(t.calls[0]!.seat).toEqual({ device: 'nuance', user: 'macair', lineage, harness: 'claude', entrypoint: 'cli', folder: FOLDER, stream: 3 })
    expect(t.cancels).toEqual([`${lineage}:0a0b0c0d:1`])
    expect(t.knocks[0]!.m).toEqual({ t: 'knocks', timeout_ms: 1800 })
    const out = t.relay.messages(3)
    expect(out).toContainEqual({ t: 'result', call_ref: `${lineage}:0a0b0c0d:1`, outcome: 'ok', result: { content: [{ type: 'text', text: 'ok' }] } })
    expect(out).toContainEqual({ t: 'knock_report', count: 1, origins: ['air'], seqs: [4] })
    expect(out).toContainEqual({ t: 'tools', digest: DIGEST, list: [] })
    t.session.close('test')
    await t.run
  })

  test('a handler that throws, or a result too large for one frame, answers unknown and never drops the call', async () => {
    const big: ResultMsg = { t: 'result', call_ref: '', outcome: 'ok', result: { content: [{ type: 'text', text: 'x'.repeat(MAX_HUB_TO_PIPE) }] } }
    const t = rig({ handlers: {
      call: async (_s, m) => { if (m.name === 'collab_task_list') return { ...big, call_ref: m.call_ref }; throw new Error('forwarder bug') },
      knocks: async (): Promise<HubKnockReportMsg> => { throw new Error('knock bug') },
    } })
    const lineage = newLineage()
    handshake(t.relay, 1, lineage)
    t.relay.data(1, { t: 'call', call_ref: `${lineage}:0a0b0c0d:1`, name: 'collab_next', arguments: {}, timeout_ms: 60_000 })
    t.relay.data(1, { t: 'call', call_ref: `${lineage}:0a0b0c0d:2`, name: 'collab_task_list', arguments: {}, timeout_ms: 60_000 })
    t.relay.data(1, { t: 'knocks', timeout_ms: 1800 })
    await until(() => t.relay.messages(1).filter((m) => m.t === 'result' || m.t === 'knock_report').length === 3)
    const out = t.relay.messages(1)
    expect(out).toContainEqual({ t: 'result', call_ref: `${lineage}:0a0b0c0d:1`, outcome: 'unknown' })
    expect(out).toContainEqual({ t: 'result', call_ref: `${lineage}:0a0b0c0d:2`, outcome: 'unknown' })
    expect(out).toContainEqual({ t: 'knock_report', count: 0, origins: [], seqs: [] })
    t.session.close('test')
    await t.run
  })

  test('a call_ref of another lineage closes the stream', async () => {
    const t = rig()
    const lineage = newLineage()
    handshake(t.relay, 1, lineage)
    t.relay.data(1, { t: 'call', call_ref: `${newLineage()}:0a0b0c0d:1`, name: 'collab_next', arguments: {}, timeout_ms: 60_000 })
    expect(t.relay.closes(1)).toBe(1)
    expect(t.calls).toEqual([])
    expect(t.pool.calls).toContainEqual(['detached', lineage])
    t.session.close('test')
    await t.run
  })

  test("a pipe's tools_refused shows in the device status", async () => {
    const t = rig()
    const lineage = newLineage()
    handshake(t.relay, 1, lineage)
    t.relay.data(1, { t: 'tools_refused', digest: 'f'.repeat(64), reason: 'digest_mismatch' })
    expect(t.statuses).toContainEqual({ refused_tools: `${lineage}: ffffffff digest_mismatch` })
    expect(t.ledger).toContainEqual({ event: 'tools_refused', device: 'nuance', user: 'macair', lineage, code: 'digest_mismatch' })
    expect(t.relay.closes(1)).toBe(0)
    t.session.close('test')
    await t.run
  })
})

describe('the link', () => {
  test('PINGs go out every 15 s and a link with no PONG for 45 s is dropped', async () => {
    // At a 1/1000 scale: PING every 15 ms, dropped after 45 ms without a PONG.
    const answered = rig({ relay: relay({ autoPong: true }), deps: { pingMs: 15, pongDropMs: 45 } })
    await Bun.sleep(160)
    expect(answered.relay.closedByHub()).toBe(false)
    expect(answered.relay.sent.filter((f) => f.type === FRAME_TYPE.PING).length).toBeGreaterThanOrEqual(5)
    answered.session.close('test')
    await answered.run
    const silent = rig({ deps: { pingMs: 15, pongDropMs: 45 } })
    const started = performance.now()
    await silent.run
    const took = performance.now() - started
    expect(took).toBeGreaterThanOrEqual(45)
    expect(took).toBeLessThan(1000)
    expect(silent.relay.closedByHub()).toBe(true)
    expect(silent.ledger).toContainEqual({ event: 'link_end', device: 'nuance', user: 'macair', code: 'no_pong' })
  })

  test('a link that goes silent after its last PONG is dropped pongDropMs after that PONG, not at the next PING tick (Task 63 relay-1-8)', async () => {
    // The PONG for a PING arrives a few ms after the PING, so the tick that lands exactly pongDropMs after the PING sees
    // slightly less than pongDropMs of silence and the drop used to wait one more PING period (P47: 45 s, not 60 s).
    // PING every 300 ms, drop after 120 ms of silence: the check on the PING tick alone would drop at about 300 ms.
    const t = rig({ deps: { pingMs: 300, pongDropMs: 120 } })
    const started = performance.now()
    await Bun.sleep(10)
    t.relay.pong()                                     // the one PONG; then the relay is silent and the connection stays open
    await t.run
    const took = performance.now() - started
    expect(took).toBeGreaterThanOrEqual(120)
    expect(took).toBeLessThan(220)
    expect(t.relay.closedByHub()).toBe(true)
    expect(t.relay.sent.filter((f) => f.type === FRAME_TYPE.PING)).toHaveLength(1) // dropped before the second PING tick
    expect(t.ledger).toContainEqual({ event: 'link_end', device: 'nuance', user: 'macair', code: 'no_pong' })
  })

  test('a PONG that keeps arriving postpones the silence timer: the link stays up past the first deadline and no timer outlives it (Task 63 relay-1-8)', async () => {
    const t = rig({ deps: { pingMs: 40, pongDropMs: 120 } })
    for (let i = 0; i < 8; i++) { await Bun.sleep(40); t.relay.pong() }   // 320 ms, well past the first 120 ms deadline
    expect(t.relay.closedByHub()).toBe(false)
    t.session.close('test')
    await t.run
    const closed = t.ledger.filter((f) => f.event === 'link_end')
    await Bun.sleep(200)                               // a timer left running would end the session again after the deadline
    expect(t.ledger.filter((f) => f.event === 'link_end')).toEqual(closed)
    expect(closed).toEqual([{ event: 'link_end', device: 'nuance', user: 'macair', code: 'test' }])
  })

  test('a 30-minute jump of the monotonic clock drops the link at the next tick', async () => {
    // Review Focus 4: mono counts sleep, so a Mac that slept with the link up drops it at once instead of trusting it.
    let jump = 0
    const t = rig({ relay: relay({ autoPong: true }), deps: { pingMs: 10, mono: () => performance.now() + jump } })
    await Bun.sleep(40)
    expect(t.relay.closedByHub()).toBe(false)
    jump = 30 * 60 * 1000
    await t.run
    expect(t.ledger).toContainEqual({ event: 'link_end', device: 'nuance', user: 'macair', code: 'no_pong' })
  })

  test('four successive LinkSessions on one device sharing one DialPolicy, each ending with relay_replaced, set relay_contested on the fourth', async () => {
    const policy = new DialPolicy({ mono: () => 1_000, now: () => NOW, rand: () => 0.5 })
    const statuses: Array<Partial<DeviceStatus>> = []
    const status = (s: Partial<DeviceStatus>) => { statuses.push(s) }
    for (let i = 1; i <= 4; i++) {
      const t = rig({ deps: { status, onRelayReplaced: () => { if (policy.noteRelayReplaced()) status({ relay_contested: true }) } } })
      handshake(t.relay, 1, newLineage())
      t.relay.data(0, { t: 'relay_replaced' })
      await t.run                                      // the relay exits right after sending it: the link is dropped
      expect(t.relay.closedByHub()).toBe(true)
      expect(statuses.filter((s) => s.relay_contested === true)).toHaveLength(i === 4 ? 1 : 0)
    }
  })

  test('close sends link_closing to every attached stream before the link closes', async () => {
    const t = rig()
    handshake(t.relay, 1, newLineage())
    handshake(t.relay, 2, newLineage())
    t.relay.open(3)                                    // still in its handshake: not attached, gets nothing
    t.session.close('hub_off')
    await t.run
    const closing = t.relay.events.filter((e) => e.endsWith(':notice') || e === 'link_closed')
    expect(closing).toEqual(['data:1:notice', 'data:2:notice', 'link_closed'])
    expect(t.relay.messages(1).at(-1)).toEqual({ t: 'notice', code: 'link_closing' })
    expect(t.relay.messages(3)).toEqual([])
  })

  test('notice sends collab_build_changed to every attached stream and keeps the link', async () => {
    const t = rig()
    handshake(t.relay, 1, newLineage())
    handshake(t.relay, 2, newLineage())
    t.relay.open(3)
    t.session.notice('collab_build_changed')
    expect(t.relay.messages(1).at(-1)).toEqual({ t: 'notice', code: 'collab_build_changed' })
    expect(t.relay.messages(2).at(-1)).toEqual({ t: 'notice', code: 'collab_build_changed' })
    expect(t.relay.messages(3)).toEqual([])
    expect(t.relay.closedByHub()).toBe(false)
    t.session.close('test')
    await t.run
  })

  test('an unpaired device refuses new attaches with hub_away and ends the session at the next tick', async () => {
    let state: DeviceFile['state'] = 'paired'
    const t = rig({ dev: () => device({ state, seat_public: state === 'paired' ? seat.publicHex : null }), deps: { pingMs: 20 } })
    handshake(t.relay, 1, newLineage())
    state = 'unpaired'
    t.relay.open(2)
    t.relay.data(2, attachMsg(newLineage()))
    expect(t.relay.messages(2)).toEqual([{ t: 'refused', code: 'hub_away' }])
    await t.run
    expect(t.relay.messages(1).at(-1)).toEqual({ t: 'notice', code: 'link_closing' })
    expect(t.relay.closedByHub()).toBe(true)
  })

  test('a first PING that cannot be written ends the link write_failed and leaves no interval running', async () => {
    const live = new Set<ReturnType<typeof setInterval>>()
    const realSet = globalThis.setInterval
    const realClear = globalThis.clearInterval
    globalThis.setInterval = ((...a: Parameters<typeof setInterval>) => { const h = realSet(...a); live.add(h); return h }) as typeof setInterval
    globalThis.clearInterval = ((h?: Parameters<typeof clearInterval>[0]) => { live.delete(h as ReturnType<typeof setInterval>); realClear(h) }) as typeof clearInterval
    try {
      const t = rig({ relay: relay({ failSend: true }) })
      await t.run
      expect(linkEnds(t)).toEqual([{ event: 'link_end', device: 'nuance', user: 'macair', code: 'write_failed' }])
      expect(t.relay.closedByHub()).toBe(true)
      expect(live.size).toBe(0)                        // an interval left here would tick every 15 s for the life of the hub
    } finally {
      for (const h of live) realClear(h)
      globalThis.setInterval = realSet
      globalThis.clearInterval = realClear
    }
  })

  test('the relay side dropping the link ends it link_closed and detaches every ready stream', async () => {
    const t = rig()
    const ready = newLineage()
    const waiting = newLineage()
    expect(handshake(t.relay, 1, ready)).toMatchObject({ t: 'ready' })
    t.relay.open(2)
    t.relay.data(2, attachMsg(waiting))                // still in its handshake: nothing to detach
    t.relay.drop()
    await t.run
    expect(linkEnds(t)).toEqual([{ event: 'link_end', device: 'nuance', user: 'macair', code: 'link_closed' }])
    expect(t.attachments.has(ready)).toBe(false)
    expect(t.pool.calls.filter((c) => c[0] === 'detached')).toEqual([['detached', ready]])
    expect(t.pool.attached.size).toBe(0)
  })

  test('a pool that throws while a stream detaches cannot stop the link from ending: every stream is detached, link_end is written and the link closes (Task 63 relay-1-2)', async () => {
    const t = rig()
    const first = newLineage()
    const second = newLineage()
    expect(handshake(t.relay, 1, first)).toMatchObject({ t: 'ready' })
    expect(handshake(t.relay, 3, second)).toMatchObject({ t: 'ready' })
    // pool.detached persists detached_since (writeFileDurable), which can fail with ENOSPC; stream 1 is finished first.
    const pool = t.deps.pool as unknown as { detached(l: string): void }
    const real = pool.detached
    const told: string[] = []
    pool.detached = (l) => { told.push(l); if (l === first) throw new Error('ENOSPC'); real(l) }
    const close = t.relay.link.close
    let closes = 0
    t.relay.link.close = () => { closes++; close() }
    const unhandled: unknown[] = []
    const note = (e: unknown) => { unhandled.push(e) }
    process.on('unhandledRejection', note)
    try {
      t.relay.drop()                                     // ssh exits: `closed` resolves and the session ends link_closed
      const ended = await Promise.race([t.run.then(() => 'ended'), Bun.sleep(1_000).then(() => 'hung')])
      expect(ended).toBe('ended')
      await Bun.sleep(20)
    } finally {
      process.off('unhandledRejection', note)
    }
    expect(unhandled).toEqual([])
    expect(linkEnds(t)).toEqual([{ event: 'link_end', device: 'nuance', user: 'macair', code: 'link_closed' }])
    expect(closes).toBe(1)
    expect(told).toEqual([first, second])                // the second stream was still detached after the first one threw
    expect(t.attachments.has(first)).toBe(false)
    expect(t.attachments.has(second)).toBe(false)
    expect(t.pool.attached.has(second)).toBe(false)
  })

  test('a dependency that throws while a frame is served ends the link session_error instead of escaping into the reader (Task 63 relay-1-1)', async () => {
    const t = rig({ deps: { tools: () => { throw new Error('boom') } } })     // asked for the ready message of a proven stream
    const lineage = newLineage()
    t.relay.open(1)
    t.relay.data(1, attachMsg(lineage))
    expect(() => prove(t.relay, 1, lineage)).not.toThrow()
    await t.run
    expect(linkEnds(t)).toEqual([{ event: 'link_end', device: 'nuance', user: 'macair', code: 'session_error' }])
    expect(t.relay.closedByHub()).toBe(true)
    // The stream that was marked ready on the way is not left holding its lineage, and no text of the error is recorded.
    expect(t.attachments.has(lineage)).toBe(false)
    expect(t.pool.attached.has(lineage)).toBe(false)
    expect(JSON.stringify(t.ledger)).not.toContain('boom')
  })

  test('a pool that cannot persist an attach refuses that stream hub_away; the link, the other streams and the pool stay right (Task 63 relay-1-1)', async () => {
    const t = rig()
    const first = newLineage()
    const second = newLineage()
    expect(handshake(t.relay, 1, first)).toMatchObject({ t: 'ready' })
    const pool = t.deps.pool as unknown as { attached(l: string): void }
    const real = pool.attached
    pool.attached = (l) => { if (l === second) { real(l); throw new Error('ENOSPC') } real(l) } // sets its flags, then fails to write
    expect(handshake(t.relay, 3, second)).toEqual({ t: 'refused', code: 'hub_away' })
    expect(t.relay.closes(3)).toBe(1)
    expect(t.attachments.has(second)).toBe(false)
    expect(t.pool.attached.has(second)).toBe(false)           // told detached again: no child counted for a stream nobody holds
    expect(t.ledger.filter((f) => f.event === 'attach_refused').at(-1)).toMatchObject({ lineage: second, code: 'hub_away' })
    // The link and the first stream carry on.
    expect(t.relay.closedByHub()).toBe(false)
    expect(t.attachments.has(first)).toBe(true)
    t.relay.data(1, { t: 'tools_get', digest: DIGEST })
    expect(t.relay.messages(1).at(-1)).toEqual({ t: 'tools', digest: DIGEST, list: [] })
    t.session.close('test')
    await t.run
  })

  test('relay_replaced, a close() reason and an unpaired device each write one link_end with their own code', async () => {
    const replaced = rig()
    replaced.relay.data(0, { t: 'relay_replaced' })
    await replaced.run
    expect(linkEnds(replaced)).toEqual([{ event: 'link_end', device: 'nuance', user: 'macair', code: 'relay_replaced' }])

    const closed = rig()
    closed.session.close('hub_off')
    closed.session.close('something_else')             // a second close changes nothing
    closed.session.notice('collab_build_changed')      // and neither does a notice after the end
    await closed.run
    expect(linkEnds(closed)).toEqual([{ event: 'link_end', device: 'nuance', user: 'macair', code: 'hub_off' }])

    let state: DeviceFile['state'] = 'paired'
    const unpaired = rig({ dev: () => device({ state, seat_public: state === 'paired' ? seat.publicHex : null }), deps: { pingMs: 10 } })
    state = 'unpaired'
    await unpaired.run
    expect(linkEnds(unpaired)).toEqual([{ event: 'link_end', device: 'nuance', user: 'macair', code: 'unpaired' }])
  })
})

describe('frames over the limit and malformed frames', () => {
  test('a frame over 2 MiB in the handshake is refused frame_too_large, and a later stream on the link still works', async () => {
    const t = rig()
    t.relay.open(1)
    t.relay.raw(oversizedFrame(1))
    expect(t.relay.messages(1)).toEqual([{ t: 'refused', code: 'frame_too_large' }])
    expect(t.relay.closes(1)).toBe(1)
    // The decoder skipped the payload and stays aligned on frame boundaries: the next stream completes its handshake.
    expect(handshake(t.relay, 2, newLineage())).toMatchObject({ t: 'ready' })
    expect(t.relay.closedByHub()).toBe(false)
    expect(linkEnds(t)).toEqual([])
    expect(t.ledger.filter((f) => f.event === 'attach_refused')).toEqual([
      { event: 'attach_refused', device: 'nuance', user: 'macair', lineage: undefined, code: 'frame_too_large' },
    ])
    t.session.close('test')
    await t.run
  })

  test('the same frame in three pieces is refused once, and the stream after it is read from the right byte', async () => {
    const t = rig()
    const bytes = oversizedFrame(1)
    t.relay.open(1)
    t.relay.raw(bytes.subarray(0, 4))                  // inside the 9-byte header
    expect(t.relay.messages(1)).toEqual([])
    t.relay.raw(bytes.subarray(4, 1 << 20))            // the header completes here, then 1 MiB of the payload
    expect(t.relay.messages(1)).toEqual([{ t: 'refused', code: 'frame_too_large' }])
    t.relay.raw(bytes.subarray(1 << 20))               // the rest of the payload is skipped without another answer
    expect(t.relay.messages(1)).toEqual([{ t: 'refused', code: 'frame_too_large' }])
    expect(t.relay.closes(1)).toBe(1)
    expect(handshake(t.relay, 2, newLineage())).toMatchObject({ t: 'ready' })
    expect(t.ledger.filter((f) => f.event === 'attach_refused')).toHaveLength(1)
    t.session.close('test')
    await t.run
  })

  test('the same frame on a ready stream closes only that stream and detaches its lineage', async () => {
    const t = rig()
    const big = newLineage()
    const other = newLineage()
    handshake(t.relay, 1, big)
    handshake(t.relay, 2, other)
    t.relay.raw(oversizedFrame(1))
    expect(t.relay.closes(1)).toBe(1)
    expect(t.relay.messages(1).at(-1)).toMatchObject({ t: 'ready' })   // no refused: ready streams are only closed
    expect(t.attachments.has(big)).toBe(false)
    expect(t.pool.calls.filter((c) => c[0] === 'detached')).toEqual([['detached', big]])
    expect(t.relay.closes(2)).toBe(0)
    expect(t.attachments.has(other)).toBe(true)
    t.relay.data(2, { t: 'tools_get', digest: DIGEST })
    expect(t.relay.messages(2).at(-1)).toEqual({ t: 'tools', digest: DIGEST, list: [] })
    expect(t.relay.closedByHub()).toBe(false)
    t.session.close('test')
    await t.run
  })

  test('a malformed frame ends the link malformed, after the good frames that came with it were served', async () => {
    const t = rig()
    const lineage = newLineage()
    handshake(t.relay, 1, lineage)
    const toolsGet: ToolsGetMsg = { t: 'tools_get', digest: DIGEST }
    const good = encodeFrame(FRAME_TYPE.DATA, 1, encodeMessage(toolsGet))
    const bad = malformedHeader(1)
    const both = new Uint8Array(good.byteLength + bad.byteLength)
    both.set(good)
    both.set(bad, good.byteLength)
    t.relay.raw(both)
    await t.run
    expect(linkEnds(t)).toEqual([{ event: 'link_end', device: 'nuance', user: 'macair', code: 'malformed' }])
    expect(t.relay.messages(1).at(-1)).toEqual({ t: 'tools', digest: DIGEST, list: [] })
    expect(t.relay.closedByHub()).toBe(true)
    expect(t.attachments.has(lineage)).toBe(false)
    expect(t.pool.calls).toContainEqual(['detached', lineage])
  })
})
