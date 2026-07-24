import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";

import { copyBytes, utf8Encoder } from "./bytes.js";
import { assertCidMatches, digestFromCid, type Cid } from "./cid.js";
import {
  InvalidInputError,
  LimitExceededError,
  StoreError,
} from "./errors.js";
import {
  DEFAULT_STORE_READ_LIMIT,
  type BlockStore,
  type BlockWriteResult,
  type StoreOperationOptions,
} from "./stores.js";

const AWS_ALGORITHM = "AWS4-HMAC-SHA256";
const AWS_REQUEST_TERMINATOR = "aws4_request";
const AWS_SERVICE = "s3";
const EMPTY_PAYLOAD_SHA256 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const MAX_S3_OBJECT_KEY_BYTES = 1_024;
const ADDS_CID_TEXT_BYTES = 59;
const MAX_PREFIX_BYTES =
  MAX_S3_OBJECT_KEY_BYTES - 1 - ADDS_CID_TEXT_BYTES;
const MAX_PREFIX_COMPONENT_BYTES = 255;
const MAX_S3_ERROR_BODY_BYTES = 16 * 1_024;
// Bound stream-fragment amplification independently of the byte limit. At the
// default 64 MiB read limit this still permits 16,384 chunks (4 KiB average),
// while counting empty chunks closes the zero-byte liveness bypass.
const MAX_S3_RESPONSE_CHUNKS = 16 * 1_024;
const S3_ERROR_FIELDS = new Set([
  "Code",
  "Message",
  "Key",
  "RequestId",
  "HostId",
  "Resource",
  "BucketName",
  "Endpoint",
]);

export interface S3CompatibleBlockStoreOptions {
  /**
   * Canonical path-style bucket endpoint, for example
   * `https://objects.example.test/evidence-bucket`.
   */
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  /** Optional canonical object-key prefix without a leading or trailing slash. */
  prefix?: string;
  fetch?: typeof globalThis.fetch;
  now?: () => Date | string | number;
  /**
   * Test-only escape for an exact loopback HTTP endpoint. It does not make
   * loopback transport confidential or turn the process into a network sandbox.
   */
  allowInsecureLoopbackHttpForTests?: boolean;
}

interface SigningInstant {
  amzDate: string;
  dateStamp: string;
}

interface SignedRequest {
  headers: Headers;
  url: string;
}

function failInput(message: string): never {
  throw new InvalidInputError(message);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason ?? new Error("S3-compatible block-store operation aborted.");
  }
}

function validateMaxBytes(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    failInput("maxBytes must be a non-negative safe integer.");
  }
  return value;
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname
    .toLowerCase()
    .replace(/^\[|\]$/gu, "")
    .replace(/\.$/u, "");
  if (normalized === "localhost" || normalized === "::1") return true;
  const match = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(normalized);
  return match !== null && match.slice(1).every((part) => Number(part) <= 255);
}

function normalizeEndpoint(
  input: string,
  allowInsecureLoopbackHttpForTests: boolean,
): URL {
  if (typeof input !== "string" || input.length === 0 || input.length > 2_048) {
    failInput("S3-compatible endpoint must be a bounded canonical URL.");
  }
  let endpoint: URL;
  try {
    endpoint = new URL(input);
  } catch {
    failInput("S3-compatible endpoint must be a bounded canonical URL.");
  }
  if (
    endpoint.username !== ""
    || endpoint.password !== ""
    || endpoint.search !== ""
    || endpoint.hash !== ""
  ) {
    failInput("S3-compatible endpoint must not contain userinfo, query, or fragment data.");
  }
  if (endpoint.protocol === "http:") {
    if (
      !allowInsecureLoopbackHttpForTests
      || !isLoopbackHostname(endpoint.hostname)
    ) {
      failInput("S3-compatible endpoints require HTTPS outside the explicit loopback test escape.");
    }
  } else if (endpoint.protocol !== "https:") {
    failInput("S3-compatible endpoints require HTTPS.");
  }
  if (!/^\/[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/u.test(endpoint.pathname)) {
    failInput("S3-compatible endpoint must contain exactly one canonical bucket path segment.");
  }
  const canonical = `${endpoint.origin}${endpoint.pathname}`;
  if (input !== canonical) {
    failInput("S3-compatible endpoint must use its canonical URL spelling.");
  }
  return endpoint;
}

function normalizePrefix(value: string | undefined): string {
  if (value === undefined || value === "") return "";
  if (
    typeof value !== "string"
    || utf8Encoder.encode(value).byteLength > MAX_PREFIX_BYTES
    || !/^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/u.test(value)
  ) {
    failInput("S3-compatible prefix must be a bounded canonical relative object-key path.");
  }
  for (const component of value.split("/")) {
    if (
      component === "."
      || component === ".."
      || utf8Encoder.encode(component).byteLength > MAX_PREFIX_COMPONENT_BYTES
    ) {
      failInput("S3-compatible prefix must be a bounded canonical relative object-key path.");
    }
  }
  return value;
}

function normalizeRegion(value: string): string {
  if (
    typeof value !== "string"
    || !/^[a-z0-9][a-z0-9-]{0,62}$/u.test(value)
  ) {
    failInput("S3-compatible region must be a bounded canonical signing region.");
  }
  return value;
}

function normalizeAccessKeyId(value: string): string {
  if (
    typeof value !== "string"
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/u.test(value)
  ) {
    failInput("S3-compatible accessKeyId is invalid.");
  }
  return value;
}

function normalizeSecretAccessKey(value: string): string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > 4_096
    || /[^\x21-\x7e]/u.test(value)
  ) {
    failInput("S3-compatible secretAccessKey is invalid.");
  }
  return value;
}

function normalizeSessionToken(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > 8_192
    || /[^\x21-\x7e]/u.test(value)
  ) {
    failInput("S3-compatible sessionToken is invalid.");
  }
  return value;
}

function hex(bytes: Uint8Array): string {
  let result = "";
  for (const byte of bytes) result += byte.toString(16).padStart(2, "0");
  return result;
}

function sha256Hex(bytes: Uint8Array): string {
  return hex(sha256(bytes));
}

function signingInstant(value: Date | string | number): SigningInstant {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime()) || date.getTime() < 0) {
    failInput("S3-compatible signing clock returned an invalid time.");
  }
  const numericYear = date.getUTCFullYear();
  if (!Number.isSafeInteger(numericYear) || numericYear < 0 || numericYear > 9_999) {
    failInput("S3-compatible signing clock returned an invalid time.");
  }
  const year = numericYear.toString().padStart(4, "0");
  const month = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = date.getUTCDate().toString().padStart(2, "0");
  const hour = date.getUTCHours().toString().padStart(2, "0");
  const minute = date.getUTCMinutes().toString().padStart(2, "0");
  const second = date.getUTCSeconds().toString().padStart(2, "0");
  const dateStamp = `${year}${month}${day}`;
  return {
    dateStamp,
    amzDate: `${dateStamp}T${hour}${minute}${second}Z`,
  };
}

function signatureFor(
  secretAccessKey: string,
  dateStamp: string,
  region: string,
  stringToSign: string,
): string {
  const rootKey = utf8Encoder.encode(`AWS4${secretAccessKey}`);
  const dateKey = hmac(sha256, rootKey, utf8Encoder.encode(dateStamp));
  const regionKey = hmac(sha256, dateKey, utf8Encoder.encode(region));
  const serviceKey = hmac(sha256, regionKey, utf8Encoder.encode(AWS_SERVICE));
  const signingKey = hmac(
    sha256,
    serviceKey,
    utf8Encoder.encode(AWS_REQUEST_TERMINATOR),
  );
  try {
    return hex(hmac(sha256, signingKey, utf8Encoder.encode(stringToSign)));
  } finally {
    rootKey.fill(0);
    dateKey.fill(0);
    regionKey.fill(0);
    serviceKey.fill(0);
    signingKey.fill(0);
  }
}

function sanitizedStoreError(message: string): StoreError {
  return new StoreError(message, []);
}

function discardBody(response: Response): void {
  try {
    const cancellation = response.body?.cancel();
    void cancellation?.catch(() => undefined);
  } catch {
    // Response metadata and provider errors never cross this boundary.
  }
}

function cancelReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): void {
  try {
    void reader.cancel().catch(() => undefined);
  } catch {
    // Cancellation is best-effort disposal and never gates caller progress.
  }
}

function contentLengthExceedsLimit(value: string | null, maxBytes: number): boolean {
  if (value === null || !/^[0-9]+$/u.test(value)) return false;
  if (value.length > 20) return true;
  try {
    return BigInt(value) > BigInt(maxBytes);
  } catch {
    return false;
  }
}

async function withAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
  onAbort?: () => void,
): Promise<T> {
  if (signal === undefined) return promise;
  throwIfAborted(signal);
  return new Promise<T>((resolve, reject) => {
    const aborted = () => {
      signal.removeEventListener("abort", aborted);
      try {
        onAbort?.();
      } finally {
        reject(signal.reason ?? new Error("S3-compatible block-store operation aborted."));
      }
    };
    signal.addEventListener("abort", aborted, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", aborted);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", aborted);
        reject(error);
      },
    );
  });
}

async function readBoundedBody(
  response: Response,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  if (contentLengthExceedsLimit(response.headers.get("content-length"), maxBytes)) {
    discardBody(response);
    throw new LimitExceededError("S3-compatible block exceeds maxBytes.");
  }
  if (response.body === null) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let chunkCount = 0;
  try {
    while (true) {
      throwIfAborted(signal);
      const result = await withAbort(
        reader.read(),
        signal,
        () => {
          cancelReader(reader);
        },
      );
      if (result.done) break;
      chunkCount += 1;
      if (chunkCount > MAX_S3_RESPONSE_CHUNKS) {
        throw sanitizedStoreError(
          "S3-compatible block response was too fragmented.",
        );
      }
      const chunk = result.value;
      if (!(chunk instanceof Uint8Array)) {
        throw sanitizedStoreError("S3-compatible block response could not be read.");
      }
      if (chunk.byteLength === 0) continue;
      if (chunk.byteLength > maxBytes - total) {
        cancelReader(reader);
        throw new LimitExceededError("S3-compatible block exceeds maxBytes.");
      }
      chunks.push(copyBytes(chunk));
      total += chunk.byteLength;
    }
  } catch (error) {
    cancelReader(reader);
    if (signal?.aborted) {
      throw signal.reason ?? error;
    }
    if (error instanceof LimitExceededError || error instanceof StoreError) {
      throw error;
    }
    throw sanitizedStoreError("S3-compatible block response could not be read.");
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // An abort may leave a provider stream's pending read settling after the
      // caller has already regained control. Cancellation was requested above.
    }
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function skipXmlWhitespace(source: string, offset: number): number {
  while (
    offset < source.length
    && (
      source[offset] === " "
      || source[offset] === "\t"
      || source[offset] === "\r"
      || source[offset] === "\n"
    )
  ) {
    offset += 1;
  }
  return offset;
}

/**
 * Parse a deliberately narrow, non-nesting subset of the ordinary S3 XML
 * error envelope. Rejecting an unfamiliar but valid extension is preferable
 * to treating a bucket/account/configuration failure as a missing ADDS Block.
 */
function parseS3ErrorCode(bytes: Uint8Array): string | null {
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  let offset = skipXmlWhitespace(source, 0);
  if (source.startsWith("<?xml", offset)) {
    const declaration = /^<\?xml[ \t]+version=(?:"1\.0"|'1\.0')(?:[ \t]+encoding=(?:"(?:UTF-8|utf-8)"|'(?:UTF-8|utf-8)'))?[ \t]*\?>/u
      .exec(source.slice(offset));
    if (declaration === null) return null;
    offset += declaration[0].length;
    offset = skipXmlWhitespace(source, offset);
  }
  if (!source.startsWith("<Error>", offset)) return null;
  offset += "<Error>".length;

  const seen = new Set<string>();
  let code: string | null = null;
  let elementIndex = 0;
  while (true) {
    offset = skipXmlWhitespace(source, offset);
    if (source.startsWith("</Error>", offset)) {
      offset += "</Error>".length;
      break;
    }
    const element = /^<([A-Za-z][A-Za-z0-9]*)>([^<]*)<\/\1>/u
      .exec(source.slice(offset));
    if (element === null) return null;
    const name = element[1]!;
    const text = element[2]!;
    if (
      !S3_ERROR_FIELDS.has(name)
      || seen.has(name)
      || /&|\]\]>|[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(text)
    ) {
      return null;
    }
    if (elementIndex === 0 && name !== "Code") return null;
    if (name === "Code") {
      if (!/^[A-Za-z][A-Za-z0-9]*$/u.test(text)) return null;
      code = text;
    }
    seen.add(name);
    elementIndex += 1;
    offset += element[0].length;
  }
  offset = skipXmlWhitespace(source, offset);
  if (offset !== source.length || code === null) return null;
  return code;
}

async function isExactMissingKeyResponse(
  response: Response,
  signal?: AbortSignal,
): Promise<boolean> {
  let bytes: Uint8Array;
  try {
    bytes = await readBoundedBody(
      response,
      MAX_S3_ERROR_BODY_BYTES,
      signal,
    );
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error;
    throw sanitizedStoreError("S3-compatible provider returned an invalid missing-block response.");
  }
  const code = parseS3ErrorCode(bytes);
  if (code === "NoSuchKey") return true;
  throw sanitizedStoreError("S3-compatible provider returned an invalid missing-block response.");
}

/**
 * Exact-CID S3-compatible storage using path-style bucket URLs and AWS SigV4.
 *
 * It neither reads credentials from the environment nor creates, lists, or
 * deletes buckets. A successful PUT is one provider acknowledgement, not
 * evidence of retention, future availability, or physical replication.
 */
export class S3CompatibleBlockStore implements BlockStore {
  readonly #endpoint: string;
  readonly #host: string;
  readonly #path: string;
  readonly #region: string;
  readonly #accessKeyId: string;
  readonly #secretAccessKey: string;
  readonly #sessionToken?: string;
  readonly #prefix: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #now: () => Date | string | number;

  constructor(options: S3CompatibleBlockStoreOptions) {
    if (options === null || typeof options !== "object") {
      failInput("S3-compatible block-store options are required.");
    }
    const allowInsecureLoopbackHttpForTests =
      options.allowInsecureLoopbackHttpForTests ?? false;
    if (typeof allowInsecureLoopbackHttpForTests !== "boolean") {
      failInput("allowInsecureLoopbackHttpForTests must be a boolean.");
    }
    const endpoint = normalizeEndpoint(
      options.endpoint,
      allowInsecureLoopbackHttpForTests,
    );
    if (options.fetch !== undefined && typeof options.fetch !== "function") {
      failInput("S3-compatible fetch must be a function.");
    }
    if (options.now !== undefined && typeof options.now !== "function") {
      failInput("S3-compatible now must be a function.");
    }
    this.#endpoint = `${endpoint.origin}${endpoint.pathname}`;
    this.#host = endpoint.host;
    this.#path = endpoint.pathname;
    this.#region = normalizeRegion(options.region);
    this.#accessKeyId = normalizeAccessKeyId(options.accessKeyId);
    this.#secretAccessKey = normalizeSecretAccessKey(options.secretAccessKey);
    this.#sessionToken = normalizeSessionToken(options.sessionToken);
    this.#prefix = normalizePrefix(options.prefix);
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#now = options.now ?? (() => new Date());
  }

  #objectUrl(cid: Cid): string {
    digestFromCid(cid);
    const key = this.#prefix === "" ? cid : `${this.#prefix}/${cid}`;
    return `${this.#endpoint}/${key}`;
  }

  #signedRequest(
    method: "GET" | "PUT",
    cid: Cid,
    payloadHash: string,
  ): SignedRequest {
    const url = this.#objectUrl(cid);
    let instant: SigningInstant;
    try {
      instant = signingInstant(this.#now());
    } catch (error) {
      if (error instanceof InvalidInputError) throw error;
      failInput("S3-compatible signing clock returned an invalid time.");
    }
    const canonicalUri =
      `${this.#path}/${this.#prefix === "" ? cid : `${this.#prefix}/${cid}`}`;
    const canonicalHeaders: Array<readonly [string, string]> = [
      ["host", this.#host],
      ["x-amz-content-sha256", payloadHash],
      ["x-amz-date", instant.amzDate],
    ];
    if (this.#sessionToken !== undefined) {
      canonicalHeaders.push(["x-amz-security-token", this.#sessionToken]);
    }
    canonicalHeaders.sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0
    );
    const signedHeaders = canonicalHeaders.map(([name]) => name).join(";");
    const canonicalHeaderText =
      canonicalHeaders.map(([name, value]) => `${name}:${value}\n`).join("");
    const canonicalRequest = [
      method,
      canonicalUri,
      "",
      canonicalHeaderText,
      signedHeaders,
      payloadHash,
    ].join("\n");
    const scope =
      `${instant.dateStamp}/${this.#region}/${AWS_SERVICE}/${AWS_REQUEST_TERMINATOR}`;
    const stringToSign = [
      AWS_ALGORITHM,
      instant.amzDate,
      scope,
      sha256Hex(utf8Encoder.encode(canonicalRequest)),
    ].join("\n");
    const signature = signatureFor(
      this.#secretAccessKey,
      instant.dateStamp,
      this.#region,
      stringToSign,
    );
    let headers: Headers;
    try {
      headers = new Headers();
      headers.set("authorization",
        `${AWS_ALGORITHM} Credential=${this.#accessKeyId}/${scope}, `
        + `SignedHeaders=${signedHeaders}, Signature=${signature}`);
      headers.set("x-amz-content-sha256", payloadHash);
      headers.set("x-amz-date", instant.amzDate);
      if (this.#sessionToken !== undefined) {
        headers.set("x-amz-security-token", this.#sessionToken);
      }
    } catch {
      throw sanitizedStoreError(
        "S3-compatible request headers could not be constructed.",
      );
    }
    return { headers, url };
  }

  async #send(
    input: string,
    init: RequestInit,
    signal?: AbortSignal,
  ): Promise<Response> {
    throwIfAborted(signal);
    try {
      return await withAbort(
        Promise.resolve(this.#fetch(input, init)),
        signal,
      );
    } catch (error) {
      if (signal?.aborted) {
        throw signal.reason ?? error;
      }
      throw sanitizedStoreError("S3-compatible provider request failed.");
    }
  }

  async get(
    cid: Cid,
    options: StoreOperationOptions = {},
  ): Promise<Uint8Array | null> {
    digestFromCid(cid);
    const maxBytes = validateMaxBytes(
      options.maxBytes ?? DEFAULT_STORE_READ_LIMIT,
    );
    throwIfAborted(options.signal);
    const signed = this.#signedRequest("GET", cid, EMPTY_PAYLOAD_SHA256);
    const response = await this.#send(signed.url, {
      method: "GET",
      headers: signed.headers,
      redirect: "manual",
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    }, options.signal);
    if (response.status === 404) {
      if (await isExactMissingKeyResponse(response, options.signal)) {
        return null;
      }
    }
    if (response.status >= 300 && response.status < 400) {
      discardBody(response);
      throw sanitizedStoreError("S3-compatible provider redirect refused.");
    }
    if (response.status < 200 || response.status >= 300) {
      discardBody(response);
      throw sanitizedStoreError("S3-compatible provider rejected the block read.");
    }
    const bytes = await readBoundedBody(response, maxBytes, options.signal);
    assertCidMatches(cid, bytes);
    return bytes;
  }

  async put(
    cid: Cid,
    bytes: Uint8Array,
    options: StoreOperationOptions = {},
  ): Promise<BlockWriteResult> {
    throwIfAborted(options.signal);
    digestFromCid(cid);
    if (!(bytes instanceof Uint8Array)) {
      failInput("S3-compatible block bytes must be a Uint8Array.");
    }
    const maxBytes = validateMaxBytes(
      options.maxBytes ?? DEFAULT_STORE_READ_LIMIT,
    );
    if (bytes.byteLength > maxBytes) {
      throw new LimitExceededError("S3-compatible block exceeds maxBytes.");
    }
    const snapshot = copyBytes(bytes);
    assertCidMatches(cid, snapshot);
    const signed = this.#signedRequest("PUT", cid, sha256Hex(snapshot));
    signed.headers.set("content-type", "application/octet-stream");
    const response = await this.#send(signed.url, {
      method: "PUT",
      headers: signed.headers,
      body: snapshot as BodyInit,
      redirect: "manual",
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    }, options.signal);
    if (response.status >= 300 && response.status < 400) {
      discardBody(response);
      throw sanitizedStoreError("S3-compatible provider redirect refused.");
    }
    if (response.status < 200 || response.status >= 300) {
      discardBody(response);
      throw sanitizedStoreError("S3-compatible provider rejected the block write.");
    }
    discardBody(response);
    return { attempted: 1, stored: 1, failed: 0 };
  }
}
