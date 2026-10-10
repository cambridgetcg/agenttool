import { describe, expect, test } from 'bun:test'
import {
  CLOCK_SKEW_MS, ID_RE, MAX_PROMPT_BYTES, checkTiming, newRequestId, validateRequest,
} from '../src/request.ts'
import { canonicalJson } from '../src/json.ts'
import { sampleRequest } from './helpers.ts'

describe('newRequestId', () => {
  test('is smn_ + 32 lowercase hex with a UUIDv7 version nibble', () => {
    const id = newRequestId(1_791_600_000_000)
    expect(id).toMatch(ID_RE)
    expect(id[4 + 12]).toBe('7')
  })
  test('sorts by time', () => {
    expect(newRequestId(1000) < newRequestId(2000)).toBe(true)
  })
})

describe('validateRequest', () => {
  test('accepts a well-formed request', () => {
    const r = validateRequest(JSON.stringify(sampleRequest()))
    expect(r.ok).toBe(true)
  })
  test('refuses unknown fields (closed schema)', () => {
    const r = validateRequest(JSON.stringify({ ...sampleRequest(), shell: 'ls' }))
    expect(r).toMatchObject({ ok: false, reason: 'malformed' })
  })
  test('refuses non-JSON and non-objects', () => {
    expect(validateRequest('nope')).toMatchObject({ ok: false, reason: 'malformed' })
    expect(validateRequest('[1]')).toMatchObject({ ok: false, reason: 'malformed' })
  })
  test('refuses mode live in Phase 0', () => {
    expect(validateRequest(JSON.stringify(sampleRequest({ mode: 'live' as never })))).toMatchObject({ ok: false, reason: 'malformed' })
  })
  test('refuses a bad id, device, cwd, access or timeout', () => {
    for (const over of [
      { id: 'smn_../../etc' }, { from_device: 'Air' }, { cwd: 'relative/path' }, { cwd: '~/x\u0007' },
      { access: 'admin' }, { timeout_s: 0 }, { timeout_s: 1.5 }, { model: 'son net' },
    ]) {
      expect(validateRequest(JSON.stringify(sampleRequest(over as never)))).toMatchObject({ ok: false, reason: 'malformed' })
    }
  })
  test('refuses impossible calendar dates in issued_at and expires_at', () => {
    for (const over of [{ issued_at: '2026-02-31T00:00:00Z' }, { expires_at: '2026-02-29T00:00:00Z' }, { expires_at: '2026-04-31T12:00:00.5Z' }]) {
      expect(validateRequest(JSON.stringify(sampleRequest(over as never)))).toMatchObject({ ok: false, reason: 'malformed' })
    }
    expect(validateRequest(JSON.stringify(sampleRequest({ expires_at: '2028-02-29T00:00:00Z' } as never))).ok).toBe(true)
  })
  test('refuses control characters in cwd and label, including tab, LF and CR', () => {
    for (const over of [{ cwd: '~/x\n' }, { cwd: '~/x\t' }, { cwd: '~/x\r' }, { label: 'a\nb' }, { label: 'a\tb' }]) {
      expect(validateRequest(JSON.stringify(sampleRequest(over as never)))).toMatchObject({ ok: false, reason: 'malformed' })
    }
  })
  test('decides the prompt limit by UTF-8 bytes (multibyte)', () => {
    const cjk = '愛'.repeat(Math.floor(MAX_PROMPT_BYTES / 3)) // 3 bytes each
    const atLimit = cjk + 'a'.repeat(MAX_PROMPT_BYTES - Buffer.byteLength(cjk))
    expect(Buffer.byteLength(atLimit)).toBe(MAX_PROMPT_BYTES)
    expect(validateRequest(JSON.stringify(sampleRequest({ prompt: atLimit }))).ok).toBe(true)
    expect(validateRequest(JSON.stringify(sampleRequest({ prompt: atLimit + 'a' })))).toMatchObject({ ok: false, reason: 'too_large' })
  })
  test('refuses a raw request over 160 KiB before parsing', () => {
    expect(validateRequest('x'.repeat(160 * 1024 + 1))).toMatchObject({ ok: false, reason: 'too_large' })
  })
})

describe('checkTiming', () => {
  test('admits a fresh request and clamps the timeout', () => {
    const r = sampleRequest({ timeout_s: 86_400 })
    const t = checkTiming(r, Date.parse(r.issued_at), 1800)
    expect(t).toMatchObject({ ok: true, timeoutS: 1800 })
  })
  test('refuses an expired request', () => {
    const r = sampleRequest()
    const t = checkTiming(r, Date.parse(r.expires_at) + CLOCK_SKEW_MS + 1, 1800)
    expect(t).toMatchObject({ ok: false, reason: 'expired' })
  })
  test('refuses a request issued too far in the future (clock)', () => {
    const r = sampleRequest()
    const t = checkTiming(r, Date.parse(r.issued_at) - CLOCK_SKEW_MS - 1, 1800)
    expect(t).toMatchObject({ ok: false, reason: 'clock' })
  })
  test('clamps admission to 24 h', () => {
    const now = Date.now()
    const r = sampleRequest({ issued_at: new Date(now).toISOString(), expires_at: new Date(now + 72 * 3_600_000).toISOString() })
    const t = checkTiming(r, now + 25 * 3_600_000 + CLOCK_SKEW_MS, 1800)
    expect(t).toMatchObject({ ok: false, reason: 'expired' })
  })
})

describe('canonicalJson', () => {
  test('sorts keys recursively and drops undefined', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { y: 1, x: 2 }], c: undefined } })).toBe('{"a":{"d":[2,{"x":2,"y":1}]},"b":1}')
  })
})
