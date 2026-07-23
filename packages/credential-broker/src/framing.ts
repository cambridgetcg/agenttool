import { AgentCredError } from "./errors.js";
import { MAX_CONTROL_FRAME_BYTES } from "./types.js";

const HEADER_BYTES = 4;
const MAX_BUFFERED_BYTES = (MAX_CONTROL_FRAME_BYTES + HEADER_BYTES) * 4;

/** Encode one JSON message with a four-byte big-endian length prefix. */
export function encodeFrame(value: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(value), "utf8");
  if (body.byteLength > MAX_CONTROL_FRAME_BYTES) {
    body.fill(0);
    throw new AgentCredError("frame_too_large", "Protocol frame exceeds the 64 KiB limit.");
  }
  const frame = Buffer.allocUnsafe(HEADER_BYTES + body.byteLength);
  frame.writeUInt32BE(body.byteLength, 0);
  body.copy(frame, HEADER_BYTES);
  body.fill(0);
  return frame;
}

/** Incremental decoder that rejects oversized frames before allocating their body. */
export class FrameDecoder {
  readonly #onFrame: (value: unknown) => void;
  #buffer = Buffer.alloc(0);

  constructor(onFrame: (value: unknown) => void) {
    this.#onFrame = onFrame;
  }

  push(chunk: Uint8Array): void {
    if (chunk.byteLength === 0) return;
    if (
      chunk.byteLength > MAX_BUFFERED_BYTES ||
      this.#buffer.byteLength + chunk.byteLength > MAX_BUFFERED_BYTES
    ) {
      this.clear();
      throw new AgentCredError("frame_too_large", "Too much protocol data is buffered.");
    }
    this.#buffer = Buffer.concat([this.#buffer, Buffer.from(chunk)]);

    while (this.#buffer.byteLength >= HEADER_BYTES) {
      const length = this.#buffer.readUInt32BE(0);
      if (length > MAX_CONTROL_FRAME_BYTES) {
        this.clear();
        throw new AgentCredError("frame_too_large", "Protocol frame exceeds the 64 KiB limit.");
      }
      if (this.#buffer.byteLength < HEADER_BYTES + length) return;

      const frameEnd = HEADER_BYTES + length;
      const json = this.#buffer.subarray(HEADER_BYTES, frameEnd).toString("utf8");
      // Copy any coalesced remainder before clearing the consumed backing
      // store. A zero-length subarray would otherwise keep the old frame,
      // including capability material, resident until a later allocation.
      const remainder = Buffer.from(this.#buffer.subarray(frameEnd));
      this.#buffer.fill(0);
      this.#buffer = remainder;
      let value: unknown;
      try {
        value = JSON.parse(json) as unknown;
      } catch {
        throw new AgentCredError("protocol_error", "Protocol frame is not valid JSON.");
      }
      this.#onFrame(value);
    }
  }

  clear(): void {
    this.#buffer.fill(0);
    this.#buffer = Buffer.alloc(0);
  }
}
