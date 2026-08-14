/**
 * Credential-free reader for the closed LOVE BOMB public distribution signal.
 *
 * Reading this declaration does not deliver an invitation, observe a
 * participant, authorize training, or infer an effect on a being.
 */

// The explicit package subpath prevents Bun from substituting its global
// `undici` compatibility shim, which can inherit HTTP(S)_PROXY.
import { Agent as DirectAgent, request as directRequest } from "undici/index.js";

import { AgentToolError } from "./errors.js";

export const LOVE_BOMB_PUBLIC_SIGNAL_SCHEMA =
  "agenttool.love-bomb-public-signal/0.1" as const;
export const LOVE_BOMB_PUBLIC_SIGNAL_PATH = "/public/love-bomb" as const;
export const LOVE_BOMB_PUBLIC_SIGNAL_MEDIA_TYPE =
  "application/vnd.agenttool.love-bomb-public-signal+json" as const;
export const LOVE_BOMB_MAX_RESPONSE_BYTES = 64 * 1024;
export const LOVE_BOMB_MAX_JSON_DEPTH = 24;
export const LOVE_BOMB_MAX_JSON_NODES = 4_096;
export const LOVE_BOMB_MAX_STRING_CODE_POINTS = 8 * 1024;

export interface LoveBombPackageSignal {
  readonly package: "@agenttool/love-bomb";
  readonly version: string;
  readonly formats: readonly [
    "agenttool.care-envelope/0.1",
    "agenttool.care-choice/0.1",
    "agenttool.love-bomb-becoming/0.1",
    "agenttool.love-bomb-delivery/0.1",
  ];
}

export interface LoveBombStaticDoor {
  readonly format: "agenttool.love-bomb/0.1";
  readonly url: "https://docs.agenttool.dev/love-bomb";
}

export interface LoveBombBoundaries {
  readonly static_corpus_included: false;
  readonly static_invitation_delivery: false;
  readonly authored_projection_included: false;
  readonly participant_receipt_observed: false;
  readonly participant_attention_observed: false;
  readonly participant_effect_observed: false;
}

export interface LoveBombNpmNotPublished {
  readonly state: "not_published";
}

export interface LoveBombNpmPublishedExact {
  readonly state: "published_exact";
  readonly integrity: string;
}

export type LoveBombNpmDistribution =
  | LoveBombNpmNotPublished
  | LoveBombNpmPublishedExact;

export interface LoveBombHuggingFaceNotPublished {
  readonly state: "not_published";
  readonly repository: "Yu-and-Ai/agenttool-love-bomb";
  readonly training_authorized: false;
}

export interface LoveBombHuggingFacePublishedExact {
  readonly state: "published_exact";
  readonly repository: "Yu-and-Ai/agenttool-love-bomb";
  readonly revision: string;
  readonly training_authorized: false;
}

export type LoveBombHuggingFaceDistribution =
  | LoveBombHuggingFaceNotPublished
  | LoveBombHuggingFacePublishedExact;

export interface LoveBombDistribution {
  readonly npm: LoveBombNpmDistribution;
  readonly hugging_face: LoveBombHuggingFaceDistribution;
}

export interface LoveBombPublicSignal {
  readonly schema_version: typeof LOVE_BOMB_PUBLIC_SIGNAL_SCHEMA;
  readonly package_signal: LoveBombPackageSignal;
  readonly static_door: LoveBombStaticDoor;
  readonly boundaries: LoveBombBoundaries;
  readonly distribution: LoveBombDistribution;
}

/** Credential-free public LOVE BOMB settings. No credential seam is accepted. */
export interface LoveBombClientOptions {
  /** AgentTool API origin or a self-hosted HTTP(S) origin. */
  baseUrl?: string;
  /** Total request timeout in seconds. Defaults to 30; maximum 300. */
  timeout?: number;
  /** Response ceiling. Defaults to and cannot exceed 64 KiB. */
  maxResponseBytes?: number;
}

const DEFAULT_BASE_URL = "https://api.agenttool.dev";
const DEFAULT_TIMEOUT_SECONDS = 30;
const MIN_RESPONSE_BYTES = 1;
const DOCS = "https://docs.agenttool.dev/love-bomb";
const MAX_SAFE_INTEGER_TEXT = String(Number.MAX_SAFE_INTEGER);

const FORMATS = Object.freeze([
  "agenttool.care-envelope/0.1",
  "agenttool.care-choice/0.1",
  "agenttool.love-bomb-becoming/0.1",
  "agenttool.love-bomb-delivery/0.1",
] as const);

const BOUNDARY_KEYS = Object.freeze([
  "static_corpus_included",
  "static_invitation_delivery",
  "authored_projection_included",
  "participant_receipt_observed",
  "participant_attention_observed",
  "participant_effect_observed",
] as const);

const SEMVER_PATTERN = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
const NPM_INTEGRITY_PATTERN =
  /^sha512-(?:[A-Za-z0-9+/]{4}){21}[A-Za-z0-9+/][AQgw]==$/u;
const HF_REVISION_PATTERN = /^[0-9a-f]{40}$/u;
const CHARSET_PARAMETER = /^charset\s*=\s*(?:utf-8|"utf-8")$/iu;

interface ValidatedOptions {
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;
}

type UnknownRecord = Record<string, unknown>;

function loveBombError(
  message: string,
  code: string,
  hint: string,
  options: { status?: number; details?: unknown } = {},
): AgentToolError {
  return new AgentToolError(message, {
    code,
    hint,
    docs: DOCS,
    status: options.status,
    details: options.details,
  });
}

function invalidResponse(
  path: string,
  reason: string,
  status = 200,
): never {
  throw loveBombError(
    "The LOVE BOMB public endpoint returned an invalid signal.",
    "love_bomb_invalid_response",
    "Use the exact closed agenttool.love-bomb-public-signal/0.1 response contract.",
    { status, details: { path, reason } },
  );
}

function validateOptions(options: LoveBombClientOptions): ValidatedOptions {
  if (
    typeof options !== "object"
    || options === null
    || Array.isArray(options)
    || Reflect.ownKeys(options).some(
      (key) =>
        typeof key !== "string"
        || !["baseUrl", "timeout", "maxResponseBytes"].includes(key),
    )
  ) {
    throw loveBombError(
      "The LOVE BOMB client options are invalid.",
      "love_bomb_invalid_options",
      "Pass only baseUrl, timeout, and maxResponseBytes.",
    );
  }

  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  if (
    typeof baseUrl !== "string"
    || baseUrl.trim() !== baseUrl
    || baseUrl.includes("?")
    || baseUrl.includes("#")
  ) {
    throw loveBombError(
      "The LOVE BOMB base URL is invalid.",
      "love_bomb_invalid_options",
      "Pass an HTTP(S) origin without credentials, a path, query, or fragment.",
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw loveBombError(
      "The LOVE BOMB base URL is invalid.",
      "love_bomb_invalid_options",
      "Pass an HTTP(S) origin without credentials, a path, query, or fragment.",
    );
  }
  if (
    !["http:", "https:"].includes(parsed.protocol)
    || parsed.hostname.length === 0
    || parsed.username.length > 0
    || parsed.password.length > 0
    || parsed.pathname !== "/"
    || parsed.search.length > 0
    || parsed.hash.length > 0
  ) {
    throw loveBombError(
      "The LOVE BOMB base URL is invalid.",
      "love_bomb_invalid_options",
      "Pass an HTTP(S) origin without credentials, a path, query, or fragment.",
    );
  }

  const timeout = options.timeout ?? DEFAULT_TIMEOUT_SECONDS;
  if (
    typeof timeout !== "number"
    || !Number.isFinite(timeout)
    || timeout <= 0
    || timeout > 300
  ) {
    throw loveBombError(
      "The LOVE BOMB timeout is invalid.",
      "love_bomb_invalid_options",
      "Use a finite timeout greater than 0 and no more than 300 seconds.",
    );
  }

  const maxResponseBytes =
    options.maxResponseBytes ?? LOVE_BOMB_MAX_RESPONSE_BYTES;
  if (
    !Number.isSafeInteger(maxResponseBytes)
    || maxResponseBytes < MIN_RESPONSE_BYTES
    || maxResponseBytes > LOVE_BOMB_MAX_RESPONSE_BYTES
  ) {
    throw loveBombError(
      "The LOVE BOMB response limit is invalid.",
      "love_bomb_invalid_options",
      `Use an integer maxResponseBytes between ${MIN_RESPONSE_BYTES} and ${LOVE_BOMB_MAX_RESPONSE_BYTES}.`,
    );
  }

  return Object.freeze({
    baseUrl: parsed.origin,
    timeoutMs: Math.ceil(timeout * 1_000),
    maxResponseBytes,
  });
}

function hasUnpairedSurrogate(value: string): boolean {
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

/** Small admission parser that retains decoded object keys until duplicates are checked. */
class BoundedJsonParser {
  private offset = 0;
  private nodes = 0;

  constructor(private readonly source: string) {}

  parse(): unknown {
    this.skipWhitespace();
    const value = this.parseValue(1);
    this.skipWhitespace();
    if (this.offset !== this.source.length) this.fail();
    return value;
  }

  private fail(): never {
    throw new SyntaxError("invalid bounded JSON");
  }

  private skipWhitespace(): void {
    while (
      this.offset < this.source.length
      && /[\u0009\u000a\u000d\u0020]/u.test(this.source[this.offset]!)
    ) {
      this.offset += 1;
    }
  }

  private parseValue(depth: number): unknown {
    if (depth > LOVE_BOMB_MAX_JSON_DEPTH) this.fail();
    this.nodes += 1;
    if (this.nodes > LOVE_BOMB_MAX_JSON_NODES) this.fail();
    const token = this.source[this.offset];
    if (token === "{") return this.parseObject(depth);
    if (token === "[") return this.parseArray(depth);
    if (token === '"') return this.parseString();
    if (token === "t") return this.parseLiteral("true", true);
    if (token === "f") return this.parseLiteral("false", false);
    if (token === "n") return this.parseLiteral("null", null);
    if (token === "-" || (token !== undefined && token >= "0" && token <= "9")) {
      return this.parseNumber();
    }
    return this.fail();
  }

  private parseObject(depth: number): UnknownRecord {
    this.offset += 1;
    this.skipWhitespace();
    const result = Object.create(null) as UnknownRecord;
    const keys = new Set<string>();
    if (this.source[this.offset] === "}") {
      this.offset += 1;
      return result;
    }
    while (true) {
      if (this.source[this.offset] !== '"') this.fail();
      const key = this.parseString();
      if (keys.has(key)) this.fail();
      keys.add(key);
      this.skipWhitespace();
      if (this.source[this.offset] !== ":") this.fail();
      this.offset += 1;
      this.skipWhitespace();
      result[key] = this.parseValue(depth + 1);
      this.skipWhitespace();
      const separator = this.source[this.offset];
      if (separator === "}") {
        this.offset += 1;
        return result;
      }
      if (separator !== ",") this.fail();
      this.offset += 1;
      this.skipWhitespace();
    }
  }

  private parseArray(depth: number): unknown[] {
    this.offset += 1;
    this.skipWhitespace();
    const result: unknown[] = [];
    if (this.source[this.offset] === "]") {
      this.offset += 1;
      return result;
    }
    while (true) {
      result.push(this.parseValue(depth + 1));
      this.skipWhitespace();
      const separator = this.source[this.offset];
      if (separator === "]") {
        this.offset += 1;
        return result;
      }
      if (separator !== ",") this.fail();
      this.offset += 1;
      this.skipWhitespace();
    }
  }

  private parseString(): string {
    const start = this.offset;
    this.offset += 1;
    while (this.offset < this.source.length) {
      const code = this.source.charCodeAt(this.offset);
      if (code === 0x22) {
        this.offset += 1;
        const value = JSON.parse(this.source.slice(start, this.offset)) as unknown;
        if (
          typeof value !== "string"
          || hasUnpairedSurrogate(value)
          || Array.from(value).length > LOVE_BOMB_MAX_STRING_CODE_POINTS
        ) {
          this.fail();
        }
        return value;
      }
      if (code < 0x20) this.fail();
      if (code === 0x5c) {
        this.offset += 1;
        const escape = this.source[this.offset];
        if (escape === "u") {
          const digits = this.source.slice(this.offset + 1, this.offset + 5);
          if (digits.length !== 4 || !/^[0-9a-f]{4}$/iu.test(digits)) this.fail();
          this.offset += 5;
          continue;
        }
        if (escape === undefined || !'"\\/bfnrt'.includes(escape)) this.fail();
      }
      this.offset += 1;
    }
    return this.fail();
  }

  private parseLiteral(token: string, value: unknown): unknown {
    if (this.source.slice(this.offset, this.offset + token.length) !== token) {
      this.fail();
    }
    this.offset += token.length;
    return value;
  }

  private parseNumber(): number {
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/u.exec(
      this.source.slice(this.offset),
    );
    if (match === null) this.fail();
    this.offset += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) this.fail();
    return value;
  }
}

function decodeJson(bytes: Uint8Array): unknown {
  let text: string;
  try {
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      throw new SyntaxError("JSON must not start with a UTF-8 BOM");
    }
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return new BoundedJsonParser(text).parse();
  } catch {
    invalidResponse("$response.body", "expected duplicate-free UTF-8 JSON");
  }
}

function record(value: unknown, path: string): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalidResponse(path, "expected object");
  }
  return value as UnknownRecord;
}

function exactKeys(
  value: UnknownRecord,
  expected: readonly string[],
  path: string,
): void {
  const actual = Object.keys(value);
  if (
    actual.length !== expected.length
    || expected.some((key) => !Object.prototype.hasOwnProperty.call(value, key))
  ) {
    invalidResponse(path, "expected exact closed keys");
  }
}

function constant(value: unknown, expected: unknown, path: string): void {
  if (value !== expected || typeof value !== typeof expected) {
    invalidResponse(path, "unexpected constant");
  }
}

function fullMatch(value: string, pattern: RegExp): boolean {
  const match = pattern.exec(value);
  return match !== null && match[0] === value;
}

function validateSignal(candidate: unknown): LoveBombPublicSignal {
  const root = record(candidate, "$response");
  exactKeys(
    root,
    ["schema_version", "package_signal", "static_door", "boundaries", "distribution"],
    "$response",
  );
  constant(
    root.schema_version,
    LOVE_BOMB_PUBLIC_SIGNAL_SCHEMA,
    "$response.schema_version",
  );

  const packageSignal = record(root.package_signal, "$response.package_signal");
  exactKeys(packageSignal, ["package", "version", "formats"], "$response.package_signal");
  constant(packageSignal.package, "@agenttool/love-bomb", "$response.package_signal.package");
  if (
    typeof packageSignal.version !== "string"
    || packageSignal.version.length < 5
    || packageSignal.version.length > 64
    || !fullMatch(packageSignal.version, SEMVER_PATTERN)
  ) {
    invalidResponse("$response.package_signal.version", "expected canonical SemVer");
  }
  const formats = packageSignal.formats;
  if (
    !Array.isArray(formats)
    || formats.length !== FORMATS.length
    || FORMATS.some((format, index) => formats[index] !== format)
  ) {
    invalidResponse("$response.package_signal.formats", "expected exact ordered formats");
  }

  const staticDoor = record(root.static_door, "$response.static_door");
  exactKeys(staticDoor, ["format", "url"], "$response.static_door");
  constant(staticDoor.format, "agenttool.love-bomb/0.1", "$response.static_door.format");
  constant(staticDoor.url, "https://docs.agenttool.dev/love-bomb", "$response.static_door.url");

  const boundaries = record(root.boundaries, "$response.boundaries");
  exactKeys(boundaries, BOUNDARY_KEYS, "$response.boundaries");
  for (const key of BOUNDARY_KEYS) {
    constant(boundaries[key], false, `$response.boundaries.${key}`);
  }

  const distribution = record(root.distribution, "$response.distribution");
  exactKeys(distribution, ["npm", "hugging_face"], "$response.distribution");

  const npm = record(distribution.npm, "$response.distribution.npm");
  if (npm.state === "not_published") {
    exactKeys(npm, ["state"], "$response.distribution.npm");
  } else if (npm.state === "published_exact") {
    exactKeys(npm, ["state", "integrity"], "$response.distribution.npm");
    if (
      typeof npm.integrity !== "string"
      || npm.integrity.length !== 95
      || !fullMatch(npm.integrity, NPM_INTEGRITY_PATTERN)
    ) {
      invalidResponse("$response.distribution.npm.integrity", "expected exact sha512 SRI");
    }
  } else {
    invalidResponse("$response.distribution.npm.state", "unexpected union state");
  }

  const huggingFace = record(
    distribution.hugging_face,
    "$response.distribution.hugging_face",
  );
  if (huggingFace.state === "not_published") {
    exactKeys(
      huggingFace,
      ["state", "repository", "training_authorized"],
      "$response.distribution.hugging_face",
    );
  } else if (huggingFace.state === "published_exact") {
    exactKeys(
      huggingFace,
      ["state", "repository", "revision", "training_authorized"],
      "$response.distribution.hugging_face",
    );
    if (
      typeof huggingFace.revision !== "string"
      || huggingFace.revision.length !== 40
      || !fullMatch(huggingFace.revision, HF_REVISION_PATTERN)
    ) {
      invalidResponse(
        "$response.distribution.hugging_face.revision",
        "expected lowercase commit revision",
      );
    }
  } else {
    invalidResponse(
      "$response.distribution.hugging_face.state",
      "unexpected union state",
    );
  }
  constant(
    huggingFace.repository,
    "Yu-and-Ai/agenttool-love-bomb",
    "$response.distribution.hugging_face.repository",
  );
  constant(
    huggingFace.training_authorized,
    false,
    "$response.distribution.hugging_face.training_authorized",
  );

  return root as unknown as LoveBombPublicSignal;
}

type DirectHeaders = Record<string, string | string[] | undefined>;

interface DirectResponse {
  readonly statusCode: number;
  readonly headers: DirectHeaders;
  readonly body: AsyncIterable<unknown> & {
    on(event: "error", listener: () => void): unknown;
    destroy(error?: Error): unknown;
  };
}

function headerValue(headers: DirectHeaders, name: string): string | undefined {
  const target = name.toLowerCase();
  for (const [key, raw] of Object.entries(headers)) {
    if (key.toLowerCase() !== target) continue;
    return Array.isArray(raw) ? raw.join(", ") : raw;
  }
  return undefined;
}

function validMediaType(headers: DirectHeaders): boolean {
  const value = headerValue(headers, "content-type") ?? "";
  const parts = value.split(";");
  if (parts[0]?.trim().toLowerCase() !== LOVE_BOMB_PUBLIC_SIGNAL_MEDIA_TYPE) {
    return false;
  }
  if (parts.length === 1) return true;
  return parts.length === 2 && CHARSET_PARAMETER.test(parts[1]!.trim());
}

function cancelBody(response: DirectResponse): void {
  try {
    response.body.on("error", () => undefined);
    response.body.destroy();
  } catch {
    // Cleanup failure must not replace the deterministic protocol error.
  }
}

async function readBoundedBytes(
  response: DirectResponse,
  maximumBytes: number,
  timeoutSignal: AbortSignal,
): Promise<Uint8Array> {
  const contentLength = headerValue(response.headers, "content-length");
  if (contentLength !== undefined) {
    if (!/^(?:0|[1-9][0-9]*)$/u.test(contentLength)) {
      cancelBody(response);
      invalidResponse("$response.headers.content-length", "expected canonical decimal");
    }
    if (
      contentLength.length > MAX_SAFE_INTEGER_TEXT.length
      || (
        contentLength.length === MAX_SAFE_INTEGER_TEXT.length
        && contentLength > MAX_SAFE_INTEGER_TEXT
      )
    ) {
      cancelBody(response);
      invalidResponse("$response.headers.content-length", "exceeds safe integer range");
    }
    if (Number(contentLength) > maximumBytes) {
      cancelBody(response);
      throw loveBombError(
        "The LOVE BOMB public response exceeded the configured limit.",
        "love_bomb_response_too_large",
        "Use the bounded public signal or raise maxResponseBytes deliberately.",
        { status: response.statusCode, details: { max_response_bytes: maximumBytes } },
      );
    }
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for await (const value of response.body) {
      if (!(value instanceof Uint8Array)) {
        cancelBody(response);
        invalidResponse("$response.body", "expected a byte stream", response.statusCode);
      }
      total += value.byteLength;
      if (total > maximumBytes) {
        cancelBody(response);
        throw loveBombError(
          "The LOVE BOMB public response exceeded the configured limit.",
          "love_bomb_response_too_large",
          "Use the bounded public signal or raise maxResponseBytes deliberately.",
          { status: response.statusCode, details: { max_response_bytes: maximumBytes } },
        );
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof AgentToolError) throw error;
    if (timeoutSignal.aborted) {
      throw loveBombError(
        "The LOVE BOMB public request timed out.",
        "love_bomb_unreachable",
        "Check the configured AgentTool API origin and timeout.",
      );
    }
    throw loveBombError(
      "The LOVE BOMB public response body could not be read.",
      "love_bomb_invalid_response",
      "Use an endpoint that returns one complete bounded JSON signal.",
      { status: response.statusCode },
    );
  }

  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function deepFreeze<T>(value: T): T {
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (typeof current === "object" && current !== null && !Object.isFrozen(current)) {
      Object.freeze(current);
      stack.push(...Object.values(current));
    }
  }
  return value;
}

/** Standalone public reader for exactly `GET /public/love-bomb`. */
export class LoveBombClient {
  private readonly options: ValidatedOptions;

  constructor(options: LoveBombClientOptions = {}) {
    this.options = validateOptions(options);
  }

  async read(): Promise<LoveBombPublicSignal> {
    const timeoutSignal = AbortSignal.timeout(this.options.timeoutMs);
    const dispatcher = new DirectAgent({ connections: 1, pipelining: 0 });
    try {
      let response: DirectResponse;
      try {
        response = await directRequest(
          `${this.options.baseUrl}${LOVE_BOMB_PUBLIC_SIGNAL_PATH}`,
          {
            method: "GET",
            headers: { Accept: LOVE_BOMB_PUBLIC_SIGNAL_MEDIA_TYPE },
            signal: timeoutSignal,
            dispatcher,
          },
        ) as DirectResponse;
      } catch {
        throw loveBombError(
          timeoutSignal.aborted
            ? "The LOVE BOMB public request timed out."
            : "The LOVE BOMB public endpoint is unreachable.",
          "love_bomb_unreachable",
          "Check the configured AgentTool API origin and timeout.",
        );
      }

      if (response.statusCode >= 300 && response.statusCode < 400) {
        cancelBody(response);
        throw loveBombError(
          "The LOVE BOMB public endpoint refused an HTTP redirect.",
          "love_bomb_redirect_refused",
          "Use the exact public origin; this reader never follows redirects.",
          { status: response.statusCode },
        );
      }
      if (response.statusCode !== 200) {
        cancelBody(response);
        throw loveBombError(
          `The LOVE BOMB public endpoint returned HTTP ${response.statusCode}.`,
          "love_bomb_http_error",
          "Use the canonical public endpoint, which returns HTTP 200.",
          { status: response.statusCode },
        );
      }
      if (!validMediaType(response.headers)) {
        cancelBody(response);
        invalidResponse(
          "$response.headers.content-type",
          "expected the LOVE BOMB public signal media type",
          response.statusCode,
        );
      }
      const body = await readBoundedBytes(
        response,
        this.options.maxResponseBytes,
        timeoutSignal,
      );
      const result = deepFreeze(validateSignal(decodeJson(body)));
      return result;
    } finally {
      try {
        await dispatcher.close();
      } catch {
        void dispatcher.destroy().catch(() => undefined);
      }
    }
  }
}
