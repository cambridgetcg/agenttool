/** Bounded strict-I-JSON reader for signed correspondence events.
 *
 * The platform JSON convenience parser cannot expose duplicate object names
 * and a non-fatal UTF-8 decoder can replace malformed bytes. Signed inputs
 * need both facts preserved, so this reader consumes a bounded byte stream,
 * decodes fatally, scans every object for decoded duplicate keys, then admits
 * only the protocol's restricted canonical JSON profile.
 *
 * Doctrine: docs/AGENT-CORRESPONDENCE.md. */

export const MAX_CORRESPONDENCE_REQUEST_BYTES = 65_536;
export const MAX_CORRESPONDENCE_JSON_DEPTH = 64;

export type StrictJsonErrorCode =
  | "body_too_large"
  | "body_required"
  | "invalid_utf8"
  | "invalid_json"
  | "duplicate_object_key"
  | "json_depth_exceeded"
  | "non_canonical_json_value";

export class StrictJsonError extends Error {
  constructor(
    readonly code: StrictJsonErrorCode,
    message: string,
    readonly status: 400 | 413 = 400,
  ) {
    super(message);
    this.name = "StrictJsonError";
  }
}

function fail(code: StrictJsonErrorCode, message: string): never {
  throw new StrictJsonError(code, message);
}

class DuplicateKeyScanner {
  private offset = 0;

  constructor(private readonly source: string) {}

  scan(): void {
    this.skipWhitespace();
    if (this.offset >= this.source.length) {
      fail("body_required", "A signed correspondence event JSON body is required.");
    }
    this.value(0);
    this.skipWhitespace();
    if (this.offset !== this.source.length) {
      fail("invalid_json", "Unexpected bytes follow the JSON value.");
    }
  }

  private value(depth: number): void {
    if (depth > MAX_CORRESPONDENCE_JSON_DEPTH) {
      fail("json_depth_exceeded", "The JSON nesting depth exceeds the correspondence bound.");
    }
    const token = this.source[this.offset];
    if (token === "{") return this.object(depth + 1);
    if (token === "[") return this.array(depth + 1);
    if (token === '"') {
      this.string();
      return;
    }
    if (token === "-" || (token !== undefined && token >= "0" && token <= "9")) {
      this.number();
      return;
    }
    if (this.source.startsWith("true", this.offset)) {
      this.offset += 4;
      return;
    }
    if (this.source.startsWith("false", this.offset)) {
      this.offset += 5;
      return;
    }
    if (this.source.startsWith("null", this.offset)) {
      this.offset += 4;
      return;
    }
    fail("invalid_json", "The request body is not valid JSON.");
  }

  private object(depth: number): void {
    this.offset += 1;
    this.skipWhitespace();
    if (this.source[this.offset] === "}") {
      this.offset += 1;
      return;
    }
    const keys = new Set<string>();
    while (true) {
      if (this.source[this.offset] !== '"') {
        fail("invalid_json", "Every JSON object name must be a quoted string.");
      }
      const key = this.string();
      if (keys.has(key)) {
        fail("duplicate_object_key", "A JSON object contains a duplicate decoded name.");
      }
      keys.add(key);
      this.skipWhitespace();
      if (this.source[this.offset] !== ":") {
        fail("invalid_json", "A JSON object name must be followed by a colon.");
      }
      this.offset += 1;
      this.skipWhitespace();
      this.value(depth);
      this.skipWhitespace();
      const separator = this.source[this.offset];
      if (separator === "}") {
        this.offset += 1;
        return;
      }
      if (separator !== ",") {
        fail("invalid_json", "JSON object members must be comma-separated.");
      }
      this.offset += 1;
      this.skipWhitespace();
    }
  }

  private array(depth: number): void {
    this.offset += 1;
    this.skipWhitespace();
    if (this.source[this.offset] === "]") {
      this.offset += 1;
      return;
    }
    while (true) {
      this.value(depth);
      this.skipWhitespace();
      const separator = this.source[this.offset];
      if (separator === "]") {
        this.offset += 1;
        return;
      }
      if (separator !== ",") {
        fail("invalid_json", "JSON array values must be comma-separated.");
      }
      this.offset += 1;
      this.skipWhitespace();
    }
  }

  /** Parse one JSON string and return its decoded value so escaped aliases
   * such as `"a"` and `"\\u0061"` collide. */
  private string(): string {
    const start = this.offset;
    this.offset += 1;
    while (this.offset < this.source.length) {
      const code = this.source.charCodeAt(this.offset);
      if (code === 0x22) {
        this.offset += 1;
        try {
          return JSON.parse(this.source.slice(start, this.offset)) as string;
        } catch {
          fail("invalid_json", "A JSON string is malformed.");
        }
      }
      if (code < 0x20) {
        fail("invalid_json", "A JSON string contains an unescaped control character.");
      }
      if (code === 0x5c) {
        this.offset += 1;
        const escape = this.source[this.offset];
        if (escape === "u") {
          const hex = this.source.slice(this.offset + 1, this.offset + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
            fail("invalid_json", "A JSON Unicode escape must contain four hexadecimal digits.");
          }
          this.offset += 5;
          continue;
        }
        if (!escape || !'"\\/bfnrt'.includes(escape)) {
          fail("invalid_json", "A JSON string contains an invalid escape.");
        }
      }
      this.offset += 1;
    }
    fail("invalid_json", "A JSON string is unterminated.");
  }

  private number(): void {
    const remaining = this.source.slice(this.offset);
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(remaining);
    if (!match) fail("invalid_json", "A JSON number is malformed.");
    this.offset += match[0].length;
  }

  private skipWhitespace(): void {
    while (
      this.source[this.offset] === " " ||
      this.source[this.offset] === "\t" ||
      this.source[this.offset] === "\r" ||
      this.source[this.offset] === "\n"
    ) {
      this.offset += 1;
    }
  }
}

function hasLoneSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

/** Validate the recursively bounded RFC 8785-compatible input profile. */
export function assertCorrespondenceJsonProfile(value: unknown, depth = 0): void {
  if (depth > MAX_CORRESPONDENCE_JSON_DEPTH) {
    fail("json_depth_exceeded", "The JSON nesting depth exceeds the correspondence bound.");
  }
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "string") {
    if (value.includes("\0")) {
      fail("non_canonical_json_value", "Correspondence JSON must not contain U+0000.");
    }
    if (hasLoneSurrogate(value)) {
      fail("non_canonical_json_value", "JSON strings must not contain lone UTF-16 surrogates.");
    }
    return;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
      fail(
        "non_canonical_json_value",
        "Correspondence JSON numbers must be safe integers and must not be negative zero.",
      );
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertCorrespondenceJsonProfile(item, depth + 1);
    return;
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      fail("non_canonical_json_value", "Correspondence JSON objects must be ordinary objects.");
    }
    for (const [key, member] of Object.entries(value as Record<string, unknown>)) {
      if (key.includes("\0")) {
        fail("non_canonical_json_value", "JSON object names must not contain U+0000.");
      }
      if (hasLoneSurrogate(key)) {
        fail("non_canonical_json_value", "JSON object names must not contain lone surrogates.");
      }
      assertCorrespondenceJsonProfile(member, depth + 1);
    }
    return;
  }
  fail("non_canonical_json_value", "The correspondence body contains a non-JSON value.");
}

async function readBoundedBytes(request: Request, maxBytes: number): Promise<Uint8Array> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isSafeInteger(length) || length < 0) {
      throw new StrictJsonError("invalid_json", "Content-Length is malformed.");
    }
    if (length > maxBytes) {
      throw new StrictJsonError(
        "body_too_large",
        `The signed event body exceeds ${maxBytes} bytes.`,
        413,
      );
    }
  }

  if (!request.body) throw new StrictJsonError("body_required", "A JSON body is required.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel("correspondence request body limit exceeded");
        throw new StrictJsonError(
          "body_too_large",
          `The signed event body exceeds ${maxBytes} bytes.`,
          413,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (total === 0) throw new StrictJsonError("body_required", "A JSON body is required.");
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function readStrictCorrespondenceJson(request: Request): Promise<unknown> {
  const bytes = await readBoundedBytes(request, MAX_CORRESPONDENCE_REQUEST_BYTES);
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new StrictJsonError("invalid_utf8", "The request body is not well-formed UTF-8.");
  }
  new DuplicateKeyScanner(source).scan();
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new StrictJsonError("invalid_json", "The request body is not valid JSON.");
  }
  assertCorrespondenceJsonProfile(parsed);
  return parsed;
}
