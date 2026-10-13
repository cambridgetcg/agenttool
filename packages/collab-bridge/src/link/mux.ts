// Stream ids and a thin frame writer/reader for one link (spec §5.3, §5.4). The relay numbers each local connection
// from 1 upward and never reuses an id within a link; stream 0 carries PING, PONG and the relay's own notes.
import { encodeFrame, FRAME_TYPE, FrameDecoder, type Frame } from './frame.ts'

const LAST_STREAM_ID = 0xffffffff

export class StreamIds {
  private last = 0
  next(): number {
    if (this.last >= LAST_STREAM_ID) throw new Error('stream ids exhausted on this link')
    this.last += 1
    return this.last
  }
}

/** One side of a link. It keeps no stream table: which streams exist is the caller's business, so the same class
 *  serves the ssh link (streams from 1) and the local sockets (stream 0 only). */
export class Mux {
  private readonly ids = new StreamIds()
  private readonly decoder: FrameDecoder
  private readonly write: (bytes: Uint8Array) => void

  constructor(o: { write(bytes: Uint8Array): void; maxInbound: number }) {
    this.write = (bytes) => o.write(bytes)
    this.decoder = new FrameDecoder(o.maxInbound)
  }

  open(): number {
    const id = this.ids.next()
    this.write(encodeFrame(FRAME_TYPE.OPEN, id))
    return id
  }

  data(stream: number, payload: Uint8Array): void {
    this.write(encodeFrame(FRAME_TYPE.DATA, stream, payload))
  }

  close(stream: number): void {
    this.write(encodeFrame(FRAME_TYPE.CLOSE, stream))
  }

  ping(): void {
    this.write(encodeFrame(FRAME_TYPE.PING, 0))
  }

  pong(): void {
    this.write(encodeFrame(FRAME_TYPE.PONG, 0))
  }

  /** Decodes inbound bytes; FrameTooLarge and FrameMalformed propagate unchanged (with the good frames they carry). */
  feed(chunk: Uint8Array): Frame[] {
    return this.decoder.push(chunk)
  }
}
