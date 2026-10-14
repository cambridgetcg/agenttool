import { afterEach, describe, expect, setSystemTime, test } from 'bun:test'
import {
  actorStamp, AUTHORITY_PREFIX, completeLimitsStamp, roleNonce, rolePrefix, roleStamp, STAMP_RESERVE, takeoverNoteStamp,
} from '../src/air/stamp.ts'

afterEach(() => { setSystemTime() })

const OID = '1f2e3d4c5b6a79881f2e3d4c5b6a79881f2e3d4c'
const BASE = '0a1b2c3d4e5f60718293a4b5c6d7e8f901234567'
const NONCE = '0123456789abcdef'

describe('actor and role stamps', () => {
  test('the actor stamp is the spec example', () => {
    expect(actorStamp('nuance', 'macair', 'claude (Nuance account)', 'claude')).toBe('nuance/macair · self-declared: claude (Nuance account)')
    expect(actorStamp('nuance', 'macair', 'Yu\u202E\u{E0041}\u200B\u{E0100}', 'claude')).toBe('nuance/macair · self-declared: Yu')
  })

  test('the actor label is cut at 64 UTF-16 units without splitting a surrogate pair, and an empty label becomes the harness', () => {
    const head = 'nuance/macair · self-declared: '
    expect(actorStamp('nuance', 'macair', 'a'.repeat(70), 'claude')).toBe(head + 'a'.repeat(64))
    expect(actorStamp('nuance', 'macair', 'a'.repeat(63) + '\u{1F600}', 'claude')).toBe(head + 'a'.repeat(63))
    expect(actorStamp('nuance', 'macair', 'a'.repeat(62) + '\u{1F600}', 'claude')).toBe(head + 'a'.repeat(62) + '\u{1F600}')
    expect(actorStamp('nuance', 'macair', '', 'claude')).toBe(head + 'claude')
    expect(actorStamp('nuance', 'macair', '\u200B\u202E\u{E0041}', 'claude')).toBe(head + 'claude')
    expect(actorStamp('nuance', 'macair', '   ', 'claude')).toBe(head + 'claude')
  })

  test('the role stamp is the fixed prefix and the role after N1', () => {
    expect(rolePrefix('nuance', 'macair', NONCE, 'claude')).toBe('remote(nuance/macair; start=0123456789abcdef) self-declared: harness=claude; ')
    expect(roleStamp('nuance', 'macair', NONCE, 'claude', 'rev\u2066iewer\u{E0100}')).toBe(
      'remote(nuance/macair; start=0123456789abcdef) self-declared: harness=claude; reviewer')
    expect(roleStamp('nuance', 'macair', NONCE, 'claude', undefined)).toBe(rolePrefix('nuance', 'macair', NONCE, 'claude'))
  })

  test("the role stamp's nonce is found at its fixed position and a nonce in the free text is ignored", () => {
    const lookalike = 'x remote(nuance/macair; start=ffffffffffffffff) self-declared: harness=claude; '
    const role = roleStamp('nuance', 'macair', NONCE, 'claude', lookalike)
    expect(roleNonce(role, 'nuance', 'macair')).toBe(NONCE)
    // Collab trims what it stores, so an empty role ends in ';' there; the nonce is still read.
    expect(roleNonce(roleStamp('nuance', 'macair', NONCE, 'claude', '').trimEnd(), 'nuance', 'macair')).toBe(NONCE)
    expect(roleNonce(lookalike, 'nuance', 'macair')).toBeNull()
    expect(roleNonce(role, 'zerone', 'macair')).toBeNull()
    expect(roleNonce(roleStamp('nuance', 'macair', 'FFFFFFFFFFFFFFFF', 'claude', ''), 'nuance', 'macair')).toBeNull()
    expect(roleNonce('remote(nuance/macair; start=0123456789abcdef)', 'nuance', 'macair')).toBeNull()
    expect(roleNonce('implementer', 'nuance', 'macair')).toBeNull()
  })
})

describe('provenance stamps', () => {
  test('the complete stamp is exact with and without HEAD equals base and with no seat limits', () => {
    const head = `hub-observed: fetched ${OID} from nuance/macair via git-upload-pack v0; remote clean self-declared`
    expect(completeLimitsStamp({ oid: OID, device: 'nuance', user: 'macair', headEqualsBase: false, seatLimits: 'untested on Linux' }))
      .toBe(`${head}\nremote self-declared: untested on Linux`)
    expect(completeLimitsStamp({ oid: OID, device: 'nuance', user: 'macair', headEqualsBase: true, seatLimits: 'none' }))
      .toBe(`${head}; HEAD equals base\nremote self-declared: none`)
    expect(completeLimitsStamp({ oid: OID, device: 'nuance', user: 'macair', headEqualsBase: false, seatLimits: undefined })).toBe(head)
    expect(completeLimitsStamp({ oid: OID, device: 'nuance', user: 'macair', headEqualsBase: true, seatLimits: '' })).toBe(`${head}; HEAD equals base`)
  })

  test('the takeover stamp is exact', () => {
    expect(takeoverNoteStamp({ syncedOid: BASE, declaredHead: OID, seatNote: 'the Nuance session lost its lease during sleep' })).toBe(
      `hub-observed: mirror at ${BASE}, not refetched; device HEAD ${OID} self-declared\nthe Nuance session lost its lease during sleep`)
  })

  test('a stamp never contains a time', () => {
    const all = (): string[] => [
      actorStamp('nuance', 'macair', 'claude', 'claude'),
      roleStamp('nuance', 'macair', NONCE, 'claude', 'implementer'),
      completeLimitsStamp({ oid: OID, device: 'nuance', user: 'macair', headEqualsBase: true, seatLimits: 'x' }),
      takeoverNoteStamp({ syncedOid: BASE, declaredHead: OID, seatNote: 'y' }),
    ]
    setSystemTime(new Date('2026-10-13T10:00:00Z'))
    const first = all()
    setSystemTime(new Date('2031-01-01T23:59:59Z'))
    expect(all()).toEqual(first)
    for (const s of first) expect(s).not.toMatch(/\d{4}-\d{2}-\d{2}|\d{2}:\d{2}/)
  })

  test('every stamp fits the 256 reserved units at its longest', () => {
    const sha256Oid = 'f'.repeat(64)
    const device = 'd'.repeat(32)
    const user = 'u'.repeat(32)
    const complete = completeLimitsStamp({ oid: sha256Oid, device, user, headEqualsBase: true, seatLimits: 'x' })
    expect(complete.length - 'x'.length).toBeLessThanOrEqual(STAMP_RESERVE)
    const takeover = takeoverNoteStamp({ syncedOid: sha256Oid, declaredHead: sha256Oid, seatNote: 'y' })
    expect(takeover.length - 'y'.length).toBeLessThanOrEqual(STAMP_RESERVE)
    expect(AUTHORITY_PREFIX).toBe('remote self-declared: ')
    expect(AUTHORITY_PREFIX.length).toBe(22)
  })
})
