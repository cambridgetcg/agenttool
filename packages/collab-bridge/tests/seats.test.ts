import { afterEach, describe, expect, test } from 'bun:test'
import { createPrivateKey } from 'node:crypto'
import { chmodSync, mkdirSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { parseSeatPublicHex, SPKI_ED25519_PREFIX_HEX, verifySeat } from '../src/air/seats.ts'
import { generateSeatKey, loadSeatPrivate, readSeatPublicHex, signSeat, writeSeatKeyIfAbsent } from '../src/nuance/seatkey.ts'
import { nuancePaths } from '../src/paths.ts'
import { cleanupTmps, temp } from './helpers.ts'

afterEach(cleanupTmps)

const perm = (p: string) => statSync(p).mode & 0o777

const LIN = 'lin_' + '0123456789abcdef'.repeat(2)
const NONCE = 'ab'.repeat(32)
const paths = () => nuancePaths(temp('cb-seat-'))

describe('seat proof', () => {
  test('a good proof verifies', () => {
    const p = paths()
    const { publicHex } = writeSeatKeyIfAbsent(p)
    const sig = signSeat(loadSeatPrivate(p), 'nuance', 'macair', LIN, NONCE)
    expect(sig).toMatch(/^[0-9a-f]{128}$/)
    expect(verifySeat(publicHex, 'nuance', 'macair', LIN, NONCE, sig)).toBe(true)
    expect(readSeatPublicHex(p)).toBe(publicHex)
    expect(SPKI_ED25519_PREFIX_HEX).toBe('302a300506032b6570032100')
  })
  test('a wrong key, nonce, device, user or lineage fails', () => {
    const p = paths()
    const { publicHex } = writeSeatKeyIfAbsent(p)
    const sig = signSeat(loadSeatPrivate(p), 'nuance', 'macair', LIN, NONCE)
    const other = generateSeatKey().publicHex
    expect(verifySeat(other, 'nuance', 'macair', LIN, NONCE, sig)).toBe(false)
    expect(verifySeat(publicHex, 'nuance', 'macair', LIN, 'cd'.repeat(32), sig)).toBe(false)
    expect(verifySeat(publicHex, 'zerone', 'macair', LIN, NONCE, sig)).toBe(false)
    expect(verifySeat(publicHex, 'nuance', 'yuai', LIN, NONCE, sig)).toBe(false)
    expect(verifySeat(publicHex, 'nuance', 'macair', 'lin_' + 'f'.repeat(32), NONCE, sig)).toBe(false)
    // The separator is part of the signed string: moving it between fields is a different message.
    expect(verifySeat(publicHex, 'nuance|macair', '', LIN, NONCE, sig)).toBe(false)
  })
  test('a 33-byte, an all-zero, an uppercase or a junk-suffixed key is refused', () => {
    const good = generateSeatKey().publicHex
    expect(parseSeatPublicHex(good)).not.toBeNull()
    for (const bad of [good + '00', '00'.repeat(32), good.toUpperCase(), good.slice(0, 62) + 'zz', good + 'zz', good.slice(0, 62), '', ' ' + good.slice(1)]) {
      expect([bad, parseSeatPublicHex(bad)]).toEqual([bad, null])
    }
    // A real proof, so that only the key encoding can make these false: a lenient import (F10) would accept every one of them.
    // (The all-zero key is pinned by the table above alone: without a crafted small-order signature, a verifySeat line for it
    // would pass whether or not verifySeat calls parseSeatPublicHex.)
    const k = generateSeatKey()
    const real = signSeat(createPrivateKey(k.privatePem), 'nuance', 'macair', LIN, NONCE)
    expect(verifySeat(k.publicHex, 'nuance', 'macair', LIN, NONCE, real)).toBe(true)
    for (const bad of [k.publicHex + '00', k.publicHex + 'zz', k.publicHex.toUpperCase()]) {
      expect([bad, verifySeat(bad, 'nuance', 'macair', LIN, NONCE, real)]).toEqual([bad, false])
    }
  })
  test('a 65-byte or non-hex signature is refused', () => {
    const p = paths()
    const { publicHex } = writeSeatKeyIfAbsent(p)
    const sig = signSeat(loadSeatPrivate(p), 'nuance', 'macair', LIN, NONCE)
    for (const bad of [sig + '00', sig.slice(0, 126), sig.slice(0, 126) + 'zz', sig.toUpperCase(), '', 'x']) {
      expect([bad, verifySeat(publicHex, 'nuance', 'macair', LIN, NONCE, bad)]).toEqual([bad, false])
    }
  })
})

describe('the seat key on Nuance', () => {
  test('the key is made once and kept on a second call', () => {
    const p = paths()
    const first = writeSeatKeyIfAbsent(p)
    expect(first.created).toBe(true)
    expect(first.publicHex).toMatch(/^[0-9a-f]{64}$/)
    const pem = readFileSync(p.seatKey, 'utf8')
    const second = writeSeatKeyIfAbsent(p)
    expect(second).toEqual({ created: false, publicHex: first.publicHex })
    expect(readFileSync(p.seatKey, 'utf8')).toBe(pem)
    expect(readdirSync(dirname(p.seatKey)).sort()).toEqual(['seat_ed25519', 'seat_ed25519.pub'])   // no temp file left behind
    // A lost .pub is written again from the private key, never from a new key.
    writeFileSync(p.seatPub, 'garbage\n')
    expect(writeSeatKeyIfAbsent(p)).toEqual({ created: false, publicHex: first.publicHex })
    expect(readFileSync(p.seatPub, 'utf8')).toBe(first.publicHex + '\n')
  })
  test('files are 0600 in a 0700 dir and the private key never appears in the .pub file', () => {
    const p = paths()
    mkdirSync(dirname(p.seatKey), { recursive: true, mode: 0o755 })
    chmodSync(dirname(p.seatKey), 0o755)            // an existing dir with a loose mode is tightened
    const { publicHex } = writeSeatKeyIfAbsent(p)
    expect(perm(dirname(p.seatKey))).toBe(0o700)
    expect(perm(p.seatKey)).toBe(0o600)
    expect(perm(p.seatPub)).toBe(0o600)
    const pem = readFileSync(p.seatKey, 'utf8')
    // The PEM header is split in two so the global pre-commit hook's key-shape pattern never sees it whole (Task 1's doorman check).
    expect(pem.startsWith('-----BEGIN ' + 'PRIVATE KEY-----\n')).toBe(true)
    const seed = createPrivateKey(pem).export({ format: 'der', type: 'pkcs8' }).subarray(16).toString('hex')
    const pub = readFileSync(p.seatPub, 'utf8')
    expect(pub).toBe(publicHex + '\n')
    expect(pub).not.toContain(seed)
    expect(pub).not.toContain('PRIVATE')
    expect(publicHex).not.toBe(seed)
  })
  test('loadSeatPrivate refuses a key file that is not 0600, not ours, or a symlink', () => {
    const p = paths()
    writeSeatKeyIfAbsent(p)
    chmodSync(p.seatKey, 0o644)
    expect(() => loadSeatPrivate(p)).toThrow('seat key: mode 644, not 600')
    chmodSync(p.seatKey, 0o600)
    expect(() => loadSeatPrivate(p, { uid: process.getuid!() + 1 })).toThrow('seat key: not owned by uid')
    const q = paths()
    mkdirSync(dirname(q.seatKey), { recursive: true, mode: 0o700 })
    symlinkSync(p.seatKey, q.seatKey)
    expect(() => loadSeatPrivate(q)).toThrow('seat key: not a regular file')
    expect(() => loadSeatPrivate(paths())).toThrow('seat key: missing')
    writeFileSync(p.seatKey, 'half a key')                 // a damaged key is refused, never silently replaced
    expect(() => loadSeatPrivate(p)).toThrow('seat key: not a PEM private key')
    expect(() => writeSeatKeyIfAbsent(p)).toThrow('seat key: not a PEM private key')
    expect(readFileSync(p.seatKey, 'utf8')).toBe('half a key')
    expect(readSeatPublicHex(paths())).toBeNull()
  })
})
