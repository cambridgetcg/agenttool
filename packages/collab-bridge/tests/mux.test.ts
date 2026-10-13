import { describe, expect, test } from 'bun:test'
import { encodeFrame, FRAME_TYPE, FrameDecoder, FrameMalformed, FrameTooLarge } from '../src/link/frame.ts'
import { Mux, StreamIds } from '../src/link/mux.ts'

const enc = new TextEncoder()
const dec = new TextDecoder()

function recorder() {
  const writes: Uint8Array[] = []
  const joined = () => {
    const out = new Uint8Array(writes.reduce((n, w) => n + w.byteLength, 0))
    let at = 0
    for (const w of writes) { out.set(w, at); at += w.byteLength }
    return out
  }
  return { writes, joined, write: (b: Uint8Array) => { writes.push(b) } }
}

describe('stream ids', () => {
  test('stream ids start at 1 and are never reused', () => {
    const ids = new StreamIds()
    const seen = Array.from({ length: 1000 }, () => ids.next())
    expect(seen[0]).toBe(1)
    expect(seen[999]).toBe(1000)
    expect(new Set(seen).size).toBe(1000)
    expect(new StreamIds().next()).toBe(1)
  })
})

describe('mux', () => {
  test('a mux writes OPEN, DATA and CLOSE frames for its streams', () => {
    const r = recorder()
    const mux = new Mux({ write: r.write, maxInbound: 1024 })
    const a = mux.open()
    const b = mux.open()
    mux.data(a, enc.encode('{"t":"attach"}'))
    mux.data(b, enc.encode('{"t":"knocks"}'))
    mux.close(a)
    expect([a, b]).toEqual([1, 2])
    expect(r.writes.length).toBe(5)
    const frames = new FrameDecoder(1024).push(r.joined())
    expect(frames.map((f) => [f.type, f.stream, dec.decode(f.payload)])).toEqual([
      [FRAME_TYPE.OPEN, 1, ''],
      [FRAME_TYPE.OPEN, 2, ''],
      [FRAME_TYPE.DATA, 1, '{"t":"attach"}'],
      [FRAME_TYPE.DATA, 2, '{"t":"knocks"}'],
      [FRAME_TYPE.CLOSE, 1, ''],
    ])
  })

  test('ids from a closed stream are never handed out again', () => {
    const mux = new Mux({ write: () => {}, maxInbound: 16 })
    const first = mux.open()
    mux.close(first)
    expect(mux.open()).toBe(first + 1)
  })

  test('ping and pong go on stream 0, and DATA on stream 0 is allowed for local sockets', () => {
    const r = recorder()
    const mux = new Mux({ write: r.write, maxInbound: 16 })
    mux.ping()
    mux.pong()
    mux.data(0, enc.encode('{"t":"relay_replaced"}'))
    mux.close(0)
    const frames = new FrameDecoder(64).push(r.joined())
    expect(frames.map((f) => [f.type, f.stream])).toEqual([
      [FRAME_TYPE.PING, 0], [FRAME_TYPE.PONG, 0], [FRAME_TYPE.DATA, 0], [FRAME_TYPE.CLOSE, 0],
    ])
  })

  test('feed decodes with maxInbound and rethrows FrameTooLarge and FrameMalformed', () => {
    const mux = new Mux({ write: () => {}, maxInbound: 4 })
    expect(mux.feed(encodeFrame(FRAME_TYPE.DATA, 1, enc.encode('abcd'))).length).toBe(1)
    expect(() => mux.feed(encodeFrame(FRAME_TYPE.DATA, 1, enc.encode('abcde')))).toThrow(FrameTooLarge)
    const bad = new Mux({ write: () => {}, maxInbound: 4 })
    const header = new Uint8Array([0, 0, 0, 0, 9, 0, 0, 0, 1])
    expect(() => bad.feed(header)).toThrow(FrameMalformed)
  })

  test('writes nothing for a stream id encodeFrame refuses', () => {
    const r = recorder()
    const mux = new Mux({ write: r.write, maxInbound: 16 })
    expect(() => mux.data(-1, new Uint8Array(0))).toThrow(FrameMalformed)
    expect(r.writes.length).toBe(0)
  })
})
