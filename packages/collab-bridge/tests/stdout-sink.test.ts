import { describe, expect, test } from 'bun:test'
import { drainSink } from '../src/nuance/main.ts'

type Cb = (err?: Error | null) => void

/** A stand-in for process.stdout: it records each write with its callback, and the test fires the callback or an 'error' event by hand. */
function fakeStream() {
  const writes: Array<{ b: Uint8Array | string; cb: Cb }> = []
  const handlers: Array<(e: unknown) => void> = []
  let throwing = false
  return {
    writes,
    throwOnWrite() { throwing = true },
    write(b: Uint8Array | string, cb?: Cb) {
      if (throwing) throw new Error('write blew up')
      writes.push({ b, cb: cb ?? (() => {}) })
      return false
    },
    on(_event: 'error', fn: (e: unknown) => void) { handlers.push(fn) },
    emitError(e: unknown) { for (const h of handlers) h(e) },
    listeners: () => handlers.length,
  }
}

/** Whether a promise has settled after a short wait. */
async function settled(p: Promise<unknown>): Promise<boolean> {
  let s = false
  void p.then(() => { s = true })
  await Bun.sleep(10)
  return s
}

const epipe = () => Object.assign(new Error('write EPIPE'), { code: 'EPIPE' })

describe('drainSink: the Nuance entry\'s stdout (Task 24 review)', () => {
  test('a write settles only when its callback fires, so a caller that awaits it feels the reader\'s pace', async () => {
    const s = fakeStream()
    const sink = drainSink(s)
    const p = sink.write(new Uint8Array([1, 2, 3]))
    expect(s.writes).toHaveLength(1)
    expect(await settled(p)).toBe(false)
    s.writes[0]!.cb()
    expect(await settled(p)).toBe(true)
    expect(sink.closed).toBe(false)
  })

  test('a callback error closes the sink: waiting writes settle, and later writes never reach the stream', async () => {
    const s = fakeStream()
    const sink = drainSink(s)
    const first = sink.write('a')
    const second = sink.write('b')
    s.writes[0]!.cb(epipe())
    expect(await settled(first)).toBe(true)
    expect(await settled(second)).toBe(true)
    expect(sink.closed).toBe(true)
    await sink.write('c')
    await sink.write(new Uint8Array([9]))
    expect(s.writes).toHaveLength(2)
  })

  test('an error event closes the sink the same way, and the listener is attached when the sink is made', async () => {
    const s = fakeStream()
    const sink = drainSink(s)
    expect(s.listeners()).toBe(1)
    const p = sink.write('a')
    s.emitError(epipe())
    expect(await settled(p)).toBe(true)
    expect(sink.closed).toBe(true)
    await sink.write('b')
    expect(s.writes).toHaveLength(1)
  })

  test('a write that throws neither throws out of the sink nor leaves it open', async () => {
    const s = fakeStream()
    const sink = drainSink(s)
    s.throwOnWrite()
    await sink.write('a')
    expect(sink.closed).toBe(true)
  })

  test('an empty write is skipped: it does not reach the stream and does not stand in for the last real write', async () => {
    const s = fakeStream()
    const sink = drainSink(s)
    const real = sink.write('payload')
    await sink.write('')
    await sink.write(new Uint8Array(0))
    expect(s.writes).toHaveLength(1)
    const flushed = sink.flush(5_000)
    expect(await settled(flushed)).toBe(false)   // still waiting for the real write
    s.writes[0]!.cb()
    expect(await settled(flushed)).toBe(true)
    expect(await settled(real)).toBe(true)
  })

  test('flush gives up after its cap when a callback never fires', async () => {
    const s = fakeStream()
    const sink = drainSink(s)
    void sink.write('stuck')
    const t0 = Date.now()
    await sink.flush(60)
    const waited = Date.now() - t0
    expect(waited).toBeGreaterThanOrEqual(50)
    expect(waited).toBeLessThan(2_000)
  })

  test('flush on a sink that never wrote, or whose last write is delivered, returns at once', async () => {
    const s = fakeStream()
    const sink = drainSink(s)
    const t0 = Date.now()
    await sink.flush(5_000)
    const p = sink.write('x')
    s.writes[0]!.cb()
    await p
    await sink.flush(5_000)
    expect(Date.now() - t0).toBeLessThan(1_000)
  })
})
