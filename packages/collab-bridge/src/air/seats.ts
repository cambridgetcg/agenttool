// The seat proof check on the Air (spec §6.1, §5.4 prove; R5; P19). Key import is lenient (air-env F10: 33 bytes import as
// 32, an all-zero key imports, hex decoding stops at junk), so the encoding is checked before node:crypto sees it.
import { createPublicKey, verify, type KeyObject } from 'node:crypto'
import { seatMessage, SIG_RE } from '../link/messages.ts'

export const SPKI_ED25519_PREFIX_HEX = '302a300506032b6570032100'
const SEAT_PUBLIC_RE = /^[0-9a-f]{64}$/

export function parseSeatPublicHex(hex: string): KeyObject | null {
  if (typeof hex !== 'string' || !SEAT_PUBLIC_RE.test(hex)) return null
  const raw = Buffer.from(hex, 'hex')
  if (raw.length !== 32 || raw.every((b) => b === 0)) return null
  try {
    const key = createPublicKey({ key: Buffer.concat([Buffer.from(SPKI_ED25519_PREFIX_HEX, 'hex'), raw]), format: 'der', type: 'spki' })
    return key.asymmetricKeyType === 'ed25519' ? key : null
  } catch {
    return null
  }
}

/** True only for a well-formed 128-hex signature by that key over the exact seat string. Never throws. */
export function verifySeat(publicHex: string, device: string, user: string, lineage: string, nonce: string, sigHex: string): boolean {
  if (typeof sigHex !== 'string' || !SIG_RE.test(sigHex)) return false
  const key = parseSeatPublicHex(publicHex)
  if (!key) return false
  try {
    return verify(null, Buffer.from(seatMessage(device, user, lineage, nonce), 'utf8'), key, Buffer.from(sigHex, 'hex'))
  } catch {
    return false
  }
}
