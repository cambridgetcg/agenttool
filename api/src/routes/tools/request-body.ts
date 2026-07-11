/** Bounded JSON request reader for the static tool routes.
 *
 * Content-Length is an early refusal hint, not the only boundary: streamed
 * and chunked requests are counted while they are read. The caller still
 * owns schema validation and maps ordinary JSON failures to its validation
 * response.
 */

export const SCRAPE_MAX_JSON_REQUEST_BYTES = 32 * 1024;
// Covers the document route's 1,400,000-character schema envelope plus MIME
// metadata and a small amount of JSON framing/whitespace.
export const DOCUMENT_MAX_JSON_REQUEST_BYTES = 1_400_000 + 4 * 1024;

export class StaticToolRequestBodyTooLargeError extends Error {
  readonly maxBytes: number;

  constructor(maxBytes: number) {
    super("request_body_too_large");
    this.name = "StaticToolRequestBodyTooLargeError";
    this.maxBytes = maxBytes;
  }
}

function assertMaximum(maxBytes: number): void {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error("static_tool_invalid_request_body_limit");
  }
}

function declaredLengthExceeds(request: Request, maxBytes: number): boolean {
  const value = request.headers.get("content-length")?.trim();
  if (!value || !/^[0-9]+$/u.test(value)) return false;
  return BigInt(value) > BigInt(maxBytes);
}

async function cancelBody(body: ReadableStream<Uint8Array> | null): Promise<void> {
  if (!body) return;
  try {
    await body.cancel();
  } catch {
    // Refusal must not depend on whether the client transport acknowledges
    // cancellation after declaring an oversized request.
  }
}

export async function readBoundedJson(
  request: Request,
  maxBytes: number,
): Promise<unknown> {
  assertMaximum(maxBytes);
  if (declaredLengthExceeds(request, maxBytes)) {
    await cancelBody(request.body);
    throw new StaticToolRequestBodyTooLargeError(maxBytes);
  }

  if (!request.body) return JSON.parse("") as unknown;

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength > maxBytes - totalBytes) {
        try {
          await reader.cancel();
        } catch {
          // The stable 413 does not depend on transport cancellation.
        }
        throw new StaticToolRequestBodyTooLargeError(maxBytes);
      }
      chunks.push(value);
      totalBytes += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

export function requestBodyTooLargeBody(maxBytes: number) {
  return {
    error: "request_body_too_large",
    message: `The JSON request body exceeds this route's ${maxBytes}-byte limit.`,
    max_bytes: maxBytes,
    docs: "https://docs.agenttool.dev/tools",
  } as const;
}
