export const MAX_JSON_BODY_BYTES = 100_000;
export const MAX_JSON_BODY_CHUNKS = 256;
export const JSON_BODY_READ_TIMEOUT_MS = 2_000;
export const MAX_MALWARE_BYTES = 65_536;

export class MirrorBodyError extends Error {
  constructor(
    readonly code:
      | "body_too_large"
      | "body_too_fragmented"
      | "body_read_timeout"
      | "invalid_json"
      | "invalid_base64",
  ) {
    super(code);
    this.name = "MirrorBodyError";
  }
}

export async function readBoundedJson(
  request: Request,
  limit = MAX_JSON_BODY_BYTES,
  timeoutMs = JSON_BODY_READ_TIMEOUT_MS,
): Promise<unknown> {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_JSON_BODY_BYTES) {
    throw new RangeError(`body limit must be an integer from 1 to ${MAX_JSON_BODY_BYTES}`);
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5_000) {
    throw new RangeError("body timeout must be an integer from 1 to 5000 milliseconds");
  }
  const declared = request.headers.get("content-length");
  if (declared !== null && /^\d+$/.test(declared) && Number(declared) > limit) {
    throw new MirrorBodyError("body_too_large");
  }
  if (!request.body) return {};

  const reader = request.body.getReader();
  const bytes = new Uint8Array(limit);
  let total = 0;
  let chunks = 0;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const abortSignals = [request.signal, timeoutSignal];
  let rejectOnAbort: ((reason: MirrorBodyError) => void) | undefined;
  let abortError: MirrorBodyError | undefined;
  const onAbort = () => {
    abortError ??= new MirrorBodyError("body_read_timeout");
    rejectOnAbort?.(abortError);
    void reader.cancel().catch(() => undefined);
  };
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectOnAbort = reject;
    for (const signal of abortSignals) {
      signal.addEventListener("abort", onAbort, { once: true });
    }
    if (abortSignals.some((signal) => signal.aborted)) onAbort();
  });

  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (abortError) throw abortError;
      if (done) break;
      chunks += 1;
      if (chunks > MAX_JSON_BODY_CHUNKS) {
        void reader.cancel().catch(() => undefined);
        throw new MirrorBodyError("body_too_fragmented");
      }
      if (total + value.byteLength > limit) {
        void reader.cancel().catch(() => undefined);
        throw new MirrorBodyError("body_too_large");
      }
      bytes.set(value, total);
      total += value.byteLength;
    }
    if (abortError) throw abortError;
  } catch (error) {
    if (error instanceof MirrorBodyError) throw error;
    throw new MirrorBodyError("invalid_json");
  } finally {
    for (const signal of abortSignals) {
      signal.removeEventListener("abort", onAbort);
    }
    rejectOnAbort = undefined;
  }

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(0, total),
    );
    return text.length === 0 ? {} : JSON.parse(text);
  } catch {
    throw new MirrorBodyError("invalid_json");
  }
}

export function decodeBoundedBase64(value: string): Uint8Array {
  const maxEncodedChars = 87_384;
  if (
    value.length === 0 ||
    value.length > maxEncodedChars ||
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    throw new MirrorBodyError("invalid_base64");
  }

  const bytes = Buffer.from(value, "base64");
  if (bytes.byteLength > MAX_MALWARE_BYTES) {
    throw new MirrorBodyError("body_too_large");
  }
  // Exact round-trip rejects aliases and non-zero unused pad bits.
  if (bytes.toString("base64") !== value) {
    throw new MirrorBodyError("invalid_base64");
  }
  return bytes;
}
