// The seat key on Nuance (spec §6.1 Seat, §5.4 prove; R5; P34). Made once by `install write`, kept across reinstalls, and
// never sent anywhere: the Air learns only the public half, through `hello` over the pinned channel at pin-device.
import { createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto'
import { chmodSync, closeSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { seatMessage } from '../link/messages.ts'
import type { NuancePaths } from '../paths.ts'

export interface SeatKeyPair { publicHex: string; privatePem: string }

/** The raw 32-byte public key is the SPKI DER minus its fixed 12-byte prefix (air-env §4). */
function publicHexOf(key: KeyObject): string {
  const pub = key.type === 'public' ? key : createPublicKey(key)     // Bun refuses createPublicKey on a public KeyObject
  return pub.export({ format: 'der', type: 'spki' }).subarray(12, 44).toString('hex')
}

export function generateSeatKey(): SeatKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  return { publicHex: publicHexOf(publicKey), privatePem: privateKey.export({ format: 'pem', type: 'pkcs8' }) as string }
}

function privateDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  chmodSync(dir, 0o700)            // the mode applies only to a new dir
}

function fsyncDir(dir: string): void {
  const fd = openSync(dir, 'r')
  try { fsyncSync(fd) } finally { closeSync(fd) }
}

/** Write a new file exclusively (O_EXCL, 0600): it never replaces anything, so a key that exists is never overwritten. */
function createExclusive(path: string, data: string): void {
  const fd = openSync(path, 'wx', 0o600)
  try { writeSync(fd, Buffer.from(data)); fsyncSync(fd) } finally { closeSync(fd) }
  chmodSync(path, 0o600)
}

const tempName = (path: string) => join(dirname(path), `.${basename(path)}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`)

/** Replace a file through a fresh temp name and a rename, so a reader sees the old or the new bytes, never half. */
function replaceFile(path: string, data: string): void {
  const tmp = tempName(path)
  createExclusive(tmp, data)
  renameSync(tmp, path)
}

/**
 * Create a file only when it is absent, complete or not at all: the bytes go to a temp name first, then link(2) puts them
 * in place, which fails with EEXIST when the name exists, so an existing key is never replaced and a crash never leaves half.
 */
function createOnce(path: string, data: string): void {
  const tmp = tempName(path)
  createExclusive(tmp, data)
  try { linkSync(tmp, path) } finally { unlinkSync(tmp) }
}

/**
 * Makes seat_ed25519 (PKCS8 PEM) only when it is absent, then (re)writes seat_ed25519.pub from it when the .pub is missing or
 * says anything else: the private key is the authority, the .pub only its published half. Both 0600, in a 0700 dir.
 */
export function writeSeatKeyIfAbsent(paths: NuancePaths): { created: boolean; publicHex: string } {
  privateDir(dirname(paths.seatKey))
  let created = false
  try {
    createOnce(paths.seatKey, generateSeatKey().privatePem)
    created = true
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
  }
  const publicHex = publicHexOf(loadSeatPrivate(paths))
  if (readSeatPublicHex(paths) !== publicHex) replaceFile(paths.seatPub, publicHex + '\n')
  fsyncDir(dirname(paths.seatKey))
  return { created, publicHex }
}

export function readSeatPublicHex(paths: NuancePaths): string | null {
  let text: string
  try { text = readFileSync(paths.seatPub, 'utf8') } catch { return null }
  return /^[0-9a-f]{64}\n$/.test(text) ? text.slice(0, 64) : null
}

/** Refuses a key file that is a link, not mode 0600 or not owned by this uid: another process may have put it there. */
export function loadSeatPrivate(paths: NuancePaths, o: { uid?: number } = {}): KeyObject {
  const uid = o.uid ?? process.getuid!()
  let st
  try { st = lstatSync(paths.seatKey) } catch { throw new Error('seat key: missing') }
  if (!st.isFile()) throw new Error('seat key: not a regular file')
  if ((st.mode & 0o777) !== 0o600) throw new Error(`seat key: mode ${(st.mode & 0o777).toString(8)}, not 600`)
  if (st.uid !== uid) throw new Error('seat key: not owned by uid ' + uid)
  let key: KeyObject
  try { key = createPrivateKey({ key: readFileSync(paths.seatKey, 'utf8'), format: 'pem' }) } catch { throw new Error('seat key: not a PEM private key') }
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('seat key: not ed25519')
  return key
}

/** ed25519 over `collab-bridge-seat/1|<device>|<user>|<lineage>|<nonce>`, as 128 hex. */
export function signSeat(priv: KeyObject, device: string, user: string, lineage: string, nonce: string): string {
  return sign(null, Buffer.from(seatMessage(device, user, lineage, nonce), 'utf8'), priv).toString('hex')
}
