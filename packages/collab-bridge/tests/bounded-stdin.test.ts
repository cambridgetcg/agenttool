import { describe, expect, test } from 'bun:test'
import { readBoundedStdin } from '../src/bounded-stdin.ts'

// Summon's three tests (packages/summon/tests/gatekeeper.test.ts:73-90), unchanged.
describe('readBoundedStdin', () => {
  test('stops at the limit', async () => {
    const big = new Blob(['x'.repeat(2000)]).stream()
    expect(await readBoundedStdin(big, 1000)).toMatchObject({ tooLarge: true })
    expect(await readBoundedStdin(new Blob(['hello']).stream(), 1000)).toEqual({ text: 'hello', tooLarge: false })
  })
  test('the limit counts bytes: exactly max is read, one more is too large', async () => {
    expect(await readBoundedStdin(new Blob(['x'.repeat(1000)]).stream(), 1000)).toMatchObject({ tooLarge: false })
    expect(await readBoundedStdin(new Blob(['x'.repeat(1001)]).stream(), 1000)).toMatchObject({ tooLarge: true })
    expect(await readBoundedStdin(new Blob(['語'.repeat(334)]).stream(), 1000)).toMatchObject({ tooLarge: true }) // 1002 bytes, 334 chars
  })
  test('reassembles chunks, including a multibyte character split across them', async () => {
    const bytes = new TextEncoder().encode('a語b')
    const split = new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(bytes.slice(0, 2)); c.enqueue(bytes.slice(2)); c.close() },
    })
    expect(await readBoundedStdin(split, 1000)).toEqual({ text: 'a語b', tooLarge: false })
  })
})
