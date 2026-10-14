import { describe, expect, test } from 'bun:test'
import { CallRegistry } from '../src/air/calls.ts'

const A = `lin_${'a'.repeat(32)}`
const B = `lin_${'b'.repeat(32)}`

describe('CallRegistry', () => {
  test('a new call_ref is ok, a repeat is duplicate', () => {
    const r = new CallRegistry()
    expect(r.accept(A, `${A}:0000abcd:1`)).toBe('ok')
    expect(r.accept(A, `${A}:0000abcd:2`)).toBe('ok')
    expect(r.accept(A, `${A}:0000abcd:1`)).toBe('duplicate')
    // a respawned pipe has a new instance, so its seq 1 is a different call_ref
    expect(r.accept(A, `${A}:1234abcd:1`)).toBe('ok')
    expect(r.size()).toBe(3)
  })

  test("another lineage's prefix is foreign_prefix", () => {
    const r = new CallRegistry()
    expect(r.accept(A, `${B}:0000abcd:1`)).toBe('foreign_prefix')
    expect(r.size()).toBe(0)
    // and it is not recorded for the other lineage either
    expect(r.accept(B, `${B}:0000abcd:1`)).toBe('ok')
  })

  test('a malformed call_ref is refused', () => {
    const r = new CallRegistry()
    for (const bad of ['', 'x', `${A}:0000abcd`, `${A}:0000ABCD:1`, `${A}:0000abcd:01`, `${A}:0000abcd:-1`, `${A}:0000abcd:1:2`,
      ` ${A}:0000abcd:1`, `${A}:0000abcd:12345678901234567`, `lin_${'a'.repeat(31)}:0000abcd:1`]) {
      expect(r.accept(A, bad)).toBe('malformed')
    }
    expect(r.size()).toBe(0)
  })
})
