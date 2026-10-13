// collab-bridge/1 framing (spec §5.4): `u32 len` (payload bytes), `u8 type`, `u32 stream`, then the payload, all
// big-endian. The same frames run on the ssh link (hub ↔ relay) and on the local sockets (pipe ↔ relay, tap ↔ pipe).
import { Buffer } from 'node:buffer'

export const FRAME_TYPE = { OPEN: 1, DATA: 2, CLOSE: 3, PING: 4, PONG: 5 } as const
export type FrameType = 1 | 2 | 3 | 4 | 5
export interface Frame { type: FrameType; stream: number; payload: Uint8Array }
export const FRAME_HEADER_BYTES = 9

const U32_MAX = 0xffffffff
const isFrameType = (t: number): t is FrameType => Number.isInteger(t) && t >= FRAME_TYPE.OPEN && t <= FRAME_TYPE.PONG
const isU32 = (n: number) => Number.isInteger(n) && n >= 0 && n <= U32_MAX

/** A header declared more payload than the reader accepts. The payload was never buffered: the decoder skips it.
 *  `stream` is that frame's stream (the first one, if one push met several); `frames` holds every good frame of the
 *  push that threw, in order, so nothing that arrived beside the oversized frame is lost. */
export class FrameTooLarge extends Error {
  override name = 'FrameTooLarge'
  constructor(readonly declared: number, readonly max: number, readonly stream: number = -1, readonly frames: Frame[] = []) {
    super(`frame payload of ${declared} bytes exceeds ${max}`)
  }
}

/** An unknown type, or a PING/PONG off stream 0. `frames` holds the good frames decoded before it in the same push. */
export class FrameMalformed extends Error {
  override name = 'FrameMalformed'
  constructor(message = 'malformed frame', readonly frames: Frame[] = []) {
    super(message)
  }
}

function checkHeader(type: number, stream: number): string | null {
  if (!isFrameType(type)) return `unknown frame type ${type}`
  if (!isU32(stream)) return `stream ${stream} is not a u32`
  if ((type === FRAME_TYPE.PING || type === FRAME_TYPE.PONG) && stream !== 0) return `type ${type} must use stream 0`
  return null
}

export function encodeFrame(type: FrameType, stream: number, payload: Uint8Array = new Uint8Array(0)): Uint8Array {
  const bad = checkHeader(type, stream)
  if (bad) throw new FrameMalformed(bad)
  if (payload.byteLength > U32_MAX) throw new FrameMalformed('payload too long for a u32 length')
  const out = new Uint8Array(FRAME_HEADER_BYTES + payload.byteLength)
  const view = new DataView(out.buffer)
  view.setUint32(0, payload.byteLength)
  view.setUint8(4, type)
  view.setUint32(5, stream)
  out.set(payload, FRAME_HEADER_BYTES)
  return out
}

/**
 * Turns a byte stream into frames. A header is checked as soon as its 9 bytes are in, before any of its payload is
 * buffered (§6.6): a declared length over `maxPayload` makes the decoder skip that many bytes, now or in later pushes,
 * and push throws FrameTooLarge once the whole chunk is processed. FrameMalformed is thrown at once and is final:
 * after it, the byte stream can no longer be trusted, so every later push refuses too.
 */
export class FrameDecoder {
  private readonly head = new Uint8Array(FRAME_HEADER_BYTES)
  private headLen = 0
  private current: { type: FrameType; stream: number; payload: Uint8Array; filled: number } | null = null
  private skip = 0
  private broken: string | null = null

  constructor(private readonly maxPayload: number) {}

  push(chunk: Uint8Array): Frame[] {
    if (this.broken !== null) throw new FrameMalformed(`decoder stopped earlier: ${this.broken}`)
    const frames: Frame[] = []
    let tooLarge: { declared: number; stream: number } | null = null
    let i = 0
    while (i < chunk.byteLength) {
      if (this.skip > 0) {
        const n = Math.min(this.skip, chunk.byteLength - i)
        this.skip -= n
        i += n
        continue
      }
      if (this.current === null) {
        const n = Math.min(FRAME_HEADER_BYTES - this.headLen, chunk.byteLength - i)
        this.head.set(chunk.subarray(i, i + n), this.headLen)
        this.headLen += n
        i += n
        if (this.headLen < FRAME_HEADER_BYTES) break
        this.headLen = 0
        const view = new DataView(this.head.buffer)
        const len = view.getUint32(0)
        const type = view.getUint8(4)
        const stream = view.getUint32(5)
        const bad = checkHeader(type, stream)
        if (bad) {
          this.broken = bad
          throw new FrameMalformed(bad, frames)
        }
        if (len > this.maxPayload) {
          if (tooLarge === null) tooLarge = { declared: len, stream }
          this.skip = len
          continue
        }
        this.current = { type: type as FrameType, stream, payload: new Uint8Array(len), filled: 0 }
      }
      // Reached in the same pass as a header, so a zero-length payload completes even when its header ended the chunk.
      const cur = this.current
      const n = Math.min(cur.payload.byteLength - cur.filled, chunk.byteLength - i)
      cur.payload.set(chunk.subarray(i, i + n), cur.filled)
      cur.filled += n
      i += n
      if (cur.filled === cur.payload.byteLength) {
        frames.push({ type: cur.type, stream: cur.stream, payload: cur.payload })
        this.current = null
      }
    }
    if (tooLarge !== null) throw new FrameTooLarge(tooLarge.declared, this.maxPayload, tooLarge.stream, frames)
    return frames
  }
}

const PREAMBLE_NONCE_RE = /^[0-9a-f]{32}$/
const DEFAULT_PREAMBLE_MAX = 64 * 1024

export function preambleOf(nonce: string): string {
  if (!PREAMBLE_NONCE_RE.test(nonce)) throw new Error('preamble nonce must be 32 lowercase hex characters')
  return `\nCOLLAB-BRIDGE/1 ${nonce}\n`
}

export type PreambleScan = { state: 'waiting'; seen: number } | { state: 'found'; rest: Uint8Array } | { state: 'overflow'; seen: number }

/**
 * Finds `\nCOLLAB-BRIDGE/1 <nonce>\n` in what ssh prints (spec §5.4): `~/.zshenv` output may come first. Only bytes
 * that can no longer begin the preamble count as noise, so the verdict does not depend on how the bytes were chunked;
 * `maxBytes` of noise (64 KiB) is `overflow`, which the dialer reports as login_shell_noise. After `found`, every
 * later push passes its chunk through as `rest`; `overflow` is final.
 */
export class PreambleScanner {
  private readonly pre: Buffer
  private tail: Uint8Array = new Uint8Array(0)
  private noise = 0
  private seen = 0
  private state: 'waiting' | 'found' | 'overflow' = 'waiting'

  constructor(nonce: string, private readonly maxBytes: number = DEFAULT_PREAMBLE_MAX) {
    this.pre = Buffer.from(preambleOf(nonce), 'utf8')
  }

  push(chunk: Uint8Array): PreambleScan {
    this.seen += chunk.byteLength
    if (this.state === 'found') return { state: 'found', rest: chunk.slice() }
    if (this.state === 'overflow') return { state: 'overflow', seen: this.seen }
    const data = Buffer.concat([this.tail, chunk])
    const at = data.indexOf(this.pre)
    if (at >= 0) {
      if (this.noise + at >= this.maxBytes) return this.overflow()
      this.state = 'found'
      return { state: 'found', rest: new Uint8Array(data.subarray(at + this.pre.byteLength)) }
    }
    const keep = this.prefixSuffix(data)
    this.noise += data.byteLength - keep
    this.tail = new Uint8Array(data.subarray(data.byteLength - keep))
    if (this.noise >= this.maxBytes) return this.overflow()
    return { state: 'waiting', seen: this.seen }
  }

  private overflow(): PreambleScan {
    this.state = 'overflow'
    this.tail = new Uint8Array(0)
    return { state: 'overflow', seen: this.seen }
  }

  // The length of the longest end of `data` that is a proper beginning of the preamble.
  private prefixSuffix(data: Buffer): number {
    for (let k = Math.min(this.pre.byteLength - 1, data.byteLength); k > 0; k--) {
      if (data.subarray(data.byteLength - k).equals(this.pre.subarray(0, k))) return k
    }
    return 0
  }
}
