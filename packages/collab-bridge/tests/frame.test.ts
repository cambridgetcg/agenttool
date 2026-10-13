import { describe, expect, test } from 'bun:test'
import {
  encodeFrame, FRAME_HEADER_BYTES, FRAME_TYPE, FrameDecoder, FrameMalformed, FrameTooLarge, preambleOf, PreambleScanner,
  type Frame, type FrameType,
} from '../src/link/frame.ts'

const enc = new TextEncoder()
const bytes = (s: string) => enc.encode(s)
const NONCE = '0123456789abcdef0123456789abcdef'
const OTHER = 'fedcba9876543210fedcba9876543210'

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0))
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.byteLength }
  return out
}
// A frame header with any type, stream and declared length, for frames encodeFrame would never write.
function rawHeader(len: number, type: number, stream: number): Uint8Array {
  const h = new Uint8Array(FRAME_HEADER_BYTES)
  const v = new DataView(h.buffer)
  v.setUint32(0, len)
  v.setUint8(4, type)
  v.setUint32(5, stream)
  return h
}
const plain = (f: Frame) => ({ type: f.type, stream: f.stream, payload: Array.from(f.payload) })

describe('frames', () => {
  test('the header is u32 length, u8 type, u32 stream, all big-endian', () => {
    const f = encodeFrame(FRAME_TYPE.DATA, 0x01020304, bytes('hi'))
    expect(Array.from(f)).toEqual([0, 0, 0, 2, 2, 1, 2, 3, 4, 0x68, 0x69])
    expect(FRAME_HEADER_BYTES).toBe(9)
    expect(Array.from(encodeFrame(FRAME_TYPE.PING, 0))).toEqual([0, 0, 0, 0, 4, 0, 0, 0, 0])
  })

  test('round-trips every type, split at every byte boundary', () => {
    const frames: Array<[FrameType, number, Uint8Array]> = [
      [FRAME_TYPE.OPEN, 1, new Uint8Array(0)],
      [FRAME_TYPE.DATA, 1, bytes('{"t":"call","s":"ü\u2028"}')],
      [FRAME_TYPE.CLOSE, 1, new Uint8Array(0)],
      [FRAME_TYPE.PING, 0, new Uint8Array(0)],
      [FRAME_TYPE.PONG, 0, new Uint8Array(0)],
      [FRAME_TYPE.DATA, 0, bytes('{"t":"relay_replaced"}')],
      [FRAME_TYPE.DATA, 0xffffffff, new Uint8Array([0, 255, 10, 13])],
    ]
    const want = frames.map(([type, stream, payload]) => ({ type, stream, payload: Array.from(payload) }))
    const wire = concat(...frames.map(([type, stream, payload]) => encodeFrame(type, stream, payload)))
    for (let cut = 0; cut <= wire.byteLength; cut++) {
      const d = new FrameDecoder(1024)
      const got = [...d.push(wire.subarray(0, cut)), ...d.push(wire.subarray(cut))]
      expect(got.map(plain)).toEqual(want)
    }
    const d = new FrameDecoder(1024)
    const oneByOne: Frame[] = []
    for (let i = 0; i < wire.byteLength; i++) oneByOne.push(...d.push(wire.subarray(i, i + 1)))
    expect(oneByOne.map(plain)).toEqual(want)
  })

  test('decoded payloads are copies that outlive the chunk', () => {
    const wire = encodeFrame(FRAME_TYPE.DATA, 3, bytes('abc'))
    const [f] = new FrameDecoder(16).push(wire)
    wire.fill(0)
    expect(new TextDecoder().decode(f!.payload)).toBe('abc')
  })

  test('a payload of exactly the limit passes', () => {
    const [f] = new FrameDecoder(4).push(encodeFrame(FRAME_TYPE.DATA, 1, bytes('abcd')))
    expect(f!.payload.byteLength).toBe(4)
  })

  test('refuses a declared length over the limit before buffering it', () => {
    const d = new FrameDecoder(16)
    let err: unknown
    try { d.push(rawHeader(0x40000000, FRAME_TYPE.DATA, 7)) } catch (e) { err = e }
    expect(err).toBeInstanceOf(FrameTooLarge)
    const e = err as FrameTooLarge
    expect([e.declared, e.max, e.stream, e.frames.length]).toEqual([0x40000000, 16, 7, 0])
  })

  test('the oversized payload is skipped and decoding goes on after it, with no frame of the chunk lost', () => {
    const d = new FrameDecoder(16)
    const before = encodeFrame(FRAME_TYPE.DATA, 1, bytes('before'))
    const after = encodeFrame(FRAME_TYPE.DATA, 2, bytes('after'))
    let err: unknown
    try { d.push(concat(before, rawHeader(32, FRAME_TYPE.DATA, 9), new Uint8Array(20))) } catch (e) { err = e }
    expect(err).toBeInstanceOf(FrameTooLarge)
    expect((err as FrameTooLarge).frames.map((f) => [f.stream, new TextDecoder().decode(f.payload)])).toEqual([[1, 'before']])
    expect((err as FrameTooLarge).stream).toBe(9)
    // the last 12 bytes of the skipped payload, then a good frame, in the next chunk
    const got = d.push(concat(new Uint8Array(12), after))
    expect(got.map((f) => [f.stream, new TextDecoder().decode(f.payload)])).toEqual([[2, 'after']])
  })

  test('a chunk with good frames on both sides of an oversized one throws once, carrying both', () => {
    const d = new FrameDecoder(8)
    const wire = concat(encodeFrame(FRAME_TYPE.DATA, 1, bytes('a')), rawHeader(9, FRAME_TYPE.DATA, 2), new Uint8Array(9),
      encodeFrame(FRAME_TYPE.DATA, 3, bytes('c')))
    let err: unknown
    try { d.push(wire) } catch (e) { err = e }
    expect((err as FrameTooLarge).frames.map((f) => f.stream)).toEqual([1, 3])
    expect(d.push(encodeFrame(FRAME_TYPE.CLOSE, 3)).map((f) => f.type)).toEqual([FRAME_TYPE.CLOSE])
  })

  test('refuses an unknown type and a PING off stream 0', () => {
    for (const bad of [rawHeader(0, 0, 1), rawHeader(0, 6, 1), rawHeader(0, FRAME_TYPE.PING, 1), rawHeader(0, FRAME_TYPE.PONG, 2)]) {
      const d = new FrameDecoder(16)
      const good = encodeFrame(FRAME_TYPE.DATA, 1, bytes('x'))
      let err: unknown
      try { d.push(concat(good, bad)) } catch (e) { err = e }
      expect(err).toBeInstanceOf(FrameMalformed)
      expect((err as FrameMalformed).frames.map((f) => f.stream)).toEqual([1])
      // the byte stream can no longer be trusted: every later push refuses too
      expect(() => d.push(encodeFrame(FRAME_TYPE.PING, 0))).toThrow(FrameMalformed)
    }
  })

  test('encodeFrame refuses what the decoder would refuse', () => {
    expect(() => encodeFrame(6 as FrameType, 1)).toThrow(FrameMalformed)
    expect(() => encodeFrame(FRAME_TYPE.PING, 1)).toThrow(FrameMalformed)
    expect(() => encodeFrame(FRAME_TYPE.PONG, 1)).toThrow(FrameMalformed)
    expect(() => encodeFrame(FRAME_TYPE.DATA, -1)).toThrow(FrameMalformed)
    expect(() => encodeFrame(FRAME_TYPE.DATA, 0x100000000)).toThrow(FrameMalformed)
    expect(() => encodeFrame(FRAME_TYPE.DATA, 1.5)).toThrow(FrameMalformed)
  })
})

describe('preamble', () => {
  test('the preamble is a newline, COLLAB-BRIDGE/1, the nonce and a newline', () => {
    expect(preambleOf(NONCE)).toBe(`\nCOLLAB-BRIDGE/1 ${NONCE}\n`)
    expect(() => preambleOf('ABCDEF0123456789ABCDEF0123456789')).toThrow()
    expect(() => new PreambleScanner('short')).toThrow()
  })

  test('the preamble is found after zshenv junk and the rest is kept', () => {
    const s = new PreambleScanner(NONCE)
    const frame = encodeFrame(FRAME_TYPE.PING, 0)
    const r = s.push(concat(bytes('Last login: Tue\nwelcome to zsh\n'), bytes(preambleOf(NONCE)), frame))
    expect(r.state).toBe('found')
    expect(Array.from((r as { rest: Uint8Array }).rest)).toEqual(Array.from(frame))
    // after the preamble every byte is passed through as rest
    const later = s.push(bytes('more'))
    expect(later.state).toBe('found')
    expect(new TextDecoder().decode((later as { rest: Uint8Array }).rest)).toBe('more')
  })

  test('the preamble split across chunks is found', () => {
    const wire = concat(bytes('junk\n'), bytes(preambleOf(NONCE)), bytes('tail'))
    for (let cut = 0; cut <= wire.byteLength; cut++) {
      const s = new PreambleScanner(NONCE)
      const scans = [s.push(wire.subarray(0, cut)), s.push(wire.subarray(cut))]
      expect(scans[1]!.state).toBe('found')
      const rests = scans.flatMap((r) => (r.state === 'found' ? [r.rest] : []))
      expect(new TextDecoder().decode(concat(...rests))).toBe('tail')
    }
  })

  test('64 KiB without the preamble overflows', () => {
    const waiting = new PreambleScanner(NONCE).push(new Uint8Array(65535).fill(0x7a))
    expect(waiting).toEqual({ state: 'waiting', seen: 65535 })
    const s = new PreambleScanner(NONCE)
    expect(s.push(new Uint8Array(65535).fill(0x7a)).state).toBe('waiting')
    expect(s.push(bytes('z'))).toEqual({ state: 'overflow', seen: 65536 })
    // overflow is final, even if the preamble comes later
    expect(s.push(bytes(preambleOf(NONCE))).state).toBe('overflow')
  })

  test('the noise count does not depend on chunking: 64 KiB of noise then the preamble in one chunk overflows', () => {
    const at65535 = new PreambleScanner(NONCE).push(concat(new Uint8Array(65535).fill(0x7a), bytes(preambleOf(NONCE))))
    expect(at65535.state).toBe('found')
    const at65536 = new PreambleScanner(NONCE).push(concat(new Uint8Array(65536).fill(0x7a), bytes(preambleOf(NONCE))))
    expect(at65536.state).toBe('overflow')
  })

  test('a partial preamble at the 64 KiB mark is not noise yet', () => {
    const pre = bytes(preambleOf(NONCE))
    const s = new PreambleScanner(NONCE)
    // 65530 noise bytes and the first 10 bytes of the preamble: 65540 bytes seen, 65530 of them noise
    expect(s.push(concat(new Uint8Array(65530).fill(0x7a), pre.subarray(0, 10))).state).toBe('waiting')
    expect(s.push(pre.subarray(10)).state).toBe('found')
  })

  test('a different nonce is not the preamble', () => {
    const s = new PreambleScanner(NONCE)
    expect(s.push(bytes(`junk${preambleOf(OTHER)}`)).state).toBe('waiting')
    expect(s.push(bytes(preambleOf(NONCE))).state).toBe('found')
  })

  test('a custom limit applies', () => {
    expect(new PreambleScanner(NONCE, 4).push(bytes('zzzz')).state).toBe('overflow')
    expect(new PreambleScanner(NONCE, 4).push(bytes('zzz')).state).toBe('waiting')
  })
})
