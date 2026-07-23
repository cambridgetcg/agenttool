/**
 * Bounded built-in collection adapters; collected content remains untrusted.
 * Doctrine: docs/AGENT-DATA-PROTOCOL.md
 */
import { open, type FileHandle } from "node:fs/promises";
import type { Stats } from "node:fs";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { cloneJsonObject, normalizeMediaType, sha256Hex } from "./canonical.js";
import { DataNodeError, invariant } from "./errors.js";
import type {
  CollectedItem,
  CollectorCapability,
  CollectorContext,
  CollectorOutput,
  JsonObject,
  ProvenanceActivity,
  RecordSignature,
  SourceAdapter,
} from "./types.js";

const DEFAULT_HTTP_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_HTTP_TIMEOUT_MS = 10_000;
const DEFAULT_HTTP_MAX_REDIRECTS = 3;

export class TextSourceAdapter implements SourceAdapter {
  readonly id = "text";
  readonly capability: CollectorCapability = {
    collector_id: this.id,
    description: "Collect caller-supplied UTF-8 text",
    input_schema: {
      type: "object",
      required: ["text"],
      properties: {
        text: { type: "string" },
        media_type: { type: "string" },
        source_uri: { type: "string" },
      },
    },
  };

  async collect(input: JsonObject, context: CollectorContext): Promise<CollectorOutput> {
    const text = stringField(input, "text", true)!;
    const bytes = new TextEncoder().encode(text);
    assertWithinLimit(bytes.byteLength, context.max_record_bytes);
    const sourceUri = stringField(input, "source_uri")
      ?? `urn:agent-data:text:sha256:${sha256Hex(bytes)}`;

    return {
      items: [{
        bytes,
        media_type: normalizeMediaType(stringField(input, "media_type") ?? "text/plain"),
        source: {
          uri: sourceUri,
          ...optionalStringProperty(input, "external_id"),
        },
        ...commonItemFields(input),
      }],
    };
  }
}

export class FileSourceAdapter implements SourceAdapter {
  readonly id = "file";
  readonly capability: CollectorCapability = {
    collector_id: this.id,
    description: "Collect one local regular file",
    input_schema: {
      type: "object",
      required: ["path"],
      properties: {
        path: { type: "string" },
        media_type: { type: "string" },
        source_uri: { type: "string" },
      },
    },
  };

  async collect(input: JsonObject, context: CollectorContext): Promise<CollectorOutput> {
    const path = resolve(stringField(input, "path", true)!);
    const handle = await open(path, "r");
    let info: Stats;
    let bytes: Uint8Array;
    try {
      info = await handle.stat();
      invariant(info.isFile(), "invalid_file", "path must identify a regular file");
      assertWithinLimit(info.size, context.max_record_bytes);
      bytes = await readBoundedFile(handle, context.max_record_bytes);
    } finally {
      await handle.close();
    }

    const userMetadata = objectField(input, "metadata");
    const metadata = {
      ...userMetadata,
      file_name: basename(path),
      file_size: bytes.byteLength,
      file_modified_at: info.mtime.toISOString(),
    };
    const common = commonItemFields(input);

    return {
      items: [{
        bytes,
        media_type: normalizeMediaType(stringField(input, "media_type") ?? inferFileMediaType(path)),
        source: {
          uri: stringField(input, "source_uri") ?? pathToFileURL(path).href,
          external_id: stringField(input, "external_id") ?? path,
        },
        ...common,
        metadata,
        observed_at: stringField(input, "observed_at") ?? info.mtime.toISOString(),
      }],
    };
  }
}

async function readBoundedFile(handle: FileHandle, maxBytes: number): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const capacity = Math.min(64 * 1024, maxBytes - size + 1);
    const buffer = new Uint8Array(capacity);
    const { bytesRead } = await handle.read(buffer, 0, capacity, null);
    if (bytesRead === 0) break;
    size += bytesRead;
    if (size > maxBytes) throw contentLimitError(maxBytes);
    chunks.push(buffer.slice(0, bytesRead));
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export interface HttpSourceAdapterOptions {
  max_bytes?: number;
  timeout_ms?: number;
  max_redirects?: number;
  /** Explicitly permit loopback, link-local, and private destinations. Default false. */
  allow_private_network?: boolean;
  fetch?: typeof globalThis.fetch;
}

export class HttpSourceAdapter implements SourceAdapter {
  readonly id = "http";
  readonly capability: CollectorCapability;
  private readonly maxBytes: number;
  private readonly timeoutMs: number;
  private readonly maxRedirects: number;
  private readonly allowPrivateNetwork: boolean;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(options: HttpSourceAdapterOptions = {}) {
    this.maxBytes = positiveInteger(options.max_bytes, DEFAULT_HTTP_MAX_BYTES, "max_bytes");
    this.timeoutMs = positiveInteger(options.timeout_ms, DEFAULT_HTTP_TIMEOUT_MS, "timeout_ms");
    this.maxRedirects = nonNegativeInteger(
      options.max_redirects,
      DEFAULT_HTTP_MAX_REDIRECTS,
      "max_redirects",
    );
    if (options.allow_private_network !== undefined && typeof options.allow_private_network !== "boolean") {
      throw new DataNodeError("invalid_option", "allow_private_network must be a boolean");
    }
    this.allowPrivateNetwork = options.allow_private_network ?? false;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.capability = {
      collector_id: this.id,
      description: "Collect one HTTP(S) resource with bounded redirects, time, and bytes",
      input_schema: {
        type: "object",
        required: ["url"],
        properties: {
          url: { type: "string", format: "uri" },
          headers: { type: "object" },
        },
      },
    };
  }

  async collect(input: JsonObject, context: CollectorContext): Promise<CollectorOutput> {
    const initialUrl = parseHttpUrl(stringField(input, "url", true)!);
    let headers = stringRecordField(input, "headers");
    const maxBytes = Math.min(this.maxBytes, context.max_record_bytes);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error("HTTP collection timed out")), this.timeoutMs);
    const onContextAbort = () => controller.abort(context.signal?.reason);
    context.signal?.addEventListener("abort", onContextAbort, { once: true });

    try {
      let url = initialUrl;
      let response: Response | undefined;
      for (let redirect = 0; redirect <= this.maxRedirects; redirect += 1) {
        await assertSafeHttpDestination(url, this.allowPrivateNetwork, controller.signal);
        response = await this.fetchImpl(url, {
          method: "GET",
          headers,
          redirect: "manual",
          signal: controller.signal,
        });
        if (!isRedirect(response.status)) break;
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location) {
          throw new DataNodeError("http_redirect_invalid", "HTTP redirect has no Location header", 502);
        }
        if (redirect === this.maxRedirects) {
          throw new DataNodeError("http_redirect_limit", "HTTP redirect limit exceeded", 422);
        }
        const redirectedUrl = parseHttpUrl(new URL(location, url).href);
        if (redirectedUrl.origin !== url.origin) {
          // Caller headers can contain source credentials under arbitrary
          // names. Never forward any of them across an origin boundary.
          headers = undefined;
        }
        url = redirectedUrl;
      }

      invariant(response, "http_collection_failed", "HTTP collector received no response", 502);
      if (!response.ok) {
        await response.body?.cancel();
        throw new DataNodeError(
          "http_status_error",
          `HTTP collector received status ${response.status}`,
          422,
        );
      }
      const contentLength = response.headers.get("content-length");
      if (contentLength && Number(contentLength) > maxBytes) {
        await response.body?.cancel();
        throw contentLimitError(maxBytes);
      }
      const bytes = await readBoundedBody(response.body, maxBytes);
      const mediaType = normalizeMediaType(response.headers.get("content-type") ?? "application/octet-stream");
      const lastModified = response.headers.get("last-modified");
      const common = commonItemFields(input);
      const metadata = {
        ...objectField(input, "metadata"),
        http_status: response.status,
        final_url: response.url || url.href,
        ...(response.headers.get("etag") ? { etag: response.headers.get("etag")! } : {}),
        ...(lastModified ? { last_modified: lastModified } : {}),
      };

      return {
        items: [{
          bytes,
          media_type: mediaType,
          source: {
            uri: response.url || url.href,
            ...optionalStringProperty(input, "external_id"),
          },
          ...common,
          metadata,
          ...(stringField(input, "observed_at")
            ? { observed_at: stringField(input, "observed_at")! }
            : validHttpDate(lastModified)
              ? { observed_at: new Date(lastModified!).toISOString() }
              : {}),
        }],
      };
    } catch (error) {
      if (error instanceof DataNodeError) throw error;
      if (controller.signal.aborted) {
        throw new DataNodeError("http_timeout", "HTTP collection was aborted or timed out", 422);
      }
      throw new DataNodeError(
        "http_collection_failed",
        error instanceof Error ? error.message : "HTTP collection failed",
        422,
      );
    } finally {
      clearTimeout(timeout);
      context.signal?.removeEventListener("abort", onContextAbort);
    }
  }
}

function commonItemFields(input: JsonObject): Omit<CollectedItem, "bytes" | "media_type" | "source"> {
  const observedAt = stringField(input, "observed_at");
  const supersedesId = stringField(input, "supersedes_id");
  const key = stringField(input, "key");
  const version = stringField(input, "version");
  return {
    metadata: objectField(input, "metadata"),
    ...(observedAt ? { observed_at: observedAt } : {}),
    ...(key ? { key } : {}),
    ...(version ? { version } : {}),
    ...(supersedesId ? { supersedes_id: supersedesId } : {}),
    ...provenanceField(input),
    ...signatureField(input),
  };
}

function provenanceField(input: JsonObject): { provenance?: ProvenanceActivity[] } {
  const value = input.provenance;
  if (value === undefined) return {};
  invariant(Array.isArray(value), "invalid_input", "provenance must be an array");
  const provenance = value.map((entry, index) => {
    invariant(entry && typeof entry === "object" && !Array.isArray(entry), "invalid_input", `provenance[${index}] must be an object`);
    const activity = stringField(entry as JsonObject, "activity", true)!;
    const at = stringField(entry as JsonObject, "at", true)!;
    const actor = stringField(entry as JsonObject, "actor");
    const inputIds = (entry as JsonObject).input_ids;
    if (inputIds !== undefined) {
      invariant(
        Array.isArray(inputIds) && inputIds.every((item) => typeof item === "string"),
        "invalid_input",
        `provenance[${index}].input_ids must be an array of strings`,
      );
    }
    return {
      activity,
      at,
      ...(actor ? { actor } : {}),
      ...(inputIds ? { input_ids: [...inputIds] as string[] } : {}),
    };
  });
  return { provenance };
}

function signatureField(input: JsonObject): { signature?: RecordSignature } {
  const value = input.signature;
  if (value === undefined) return {};
  invariant(value && typeof value === "object" && !Array.isArray(value), "invalid_input", "signature must be an object");
  const object = value as JsonObject;
  return {
    signature: {
      algorithm: stringField(object, "algorithm", true)!,
      signer: stringField(object, "signer", true)!,
      value: stringField(object, "value", true)!,
    },
  };
}

function stringField(input: JsonObject, key: string, required = false): string | undefined {
  const value = input[key];
  if (value === undefined && !required) return undefined;
  invariant(typeof value === "string" && value.length > 0, "invalid_input", `${key} must be a non-empty string`);
  return value;
}

function optionalStringProperty(input: JsonObject, key: string): { external_id?: string } {
  const value = stringField(input, key);
  return value ? { external_id: value } : {};
}

function objectField(input: JsonObject, key: string): JsonObject {
  return cloneJsonObject(input[key], key);
}

function stringRecordField(input: JsonObject, key: string): Record<string, string> | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  invariant(value && typeof value === "object" && !Array.isArray(value), "invalid_input", `${key} must be an object`);
  const result: Record<string, string> = {};
  for (const [header, headerValue] of Object.entries(value)) {
    invariant(typeof headerValue === "string", "invalid_input", `${key}.${header} must be a string`);
    result[header] = headerValue;
  }
  return result;
}

function parseHttpUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new DataNodeError("invalid_url", "url must be an absolute HTTP(S) URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new DataNodeError("invalid_url_scheme", "HTTP collector only permits http: and https: URLs");
  }
  if (url.username || url.password) {
    throw new DataNodeError("invalid_url_credentials", "Credentials are not permitted in collector URLs");
  }
  url.hash = "";
  return url;
}

async function assertSafeHttpDestination(
  url: URL,
  allowPrivateNetwork: boolean,
  signal: AbortSignal,
): Promise<void> {
  if (allowPrivateNetwork) return;
  const hostname = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) throw privateNetworkError();
  if (isIP(hostname)) {
    if (isPrivateOrReservedIp(hostname)) throw privateNetworkError();
    return;
  }
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await abortable(lookup(hostname, { all: true, verbatim: true }), signal);
  } catch {
    if (signal.aborted) throw signal.reason;
    throw new DataNodeError("http_dns_failed", "HTTP collector could not resolve the destination", 422);
  }
  if (!addresses.length || addresses.some((entry) => isPrivateOrReservedIp(entry.address))) {
    throw privateNetworkError();
  }
}

function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      cleanup();
      reject(signal.reason);
    };
    const cleanup = () => signal.removeEventListener("abort", abort);
    signal.addEventListener("abort", abort, { once: true });
    operation.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

function isPrivateOrReservedIp(address: string): boolean {
  const normalized = address.toLowerCase().split("%", 1)[0]!;
  if (isIP(normalized) === 4) {
    const parts = normalized.split(".").map(Number);
    return isPrivateOrReservedIpv4(parts[0]!, parts[1]!, parts[2]!, parts[3]!);
  }
  if (isIP(normalized) === 6) {
    const bytes = parseIpv6(normalized);
    if (!bytes) return true;
    if (bytes.every((byte) => byte === 0)) return true;
    if (bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1) return true;
    if ((bytes[0]! & 0xfe) === 0xfc) return true;
    if (bytes[0] === 0xfe && (bytes[1]! & 0xc0) === 0x80) return true;
    if (bytes[0] === 0xfe && (bytes[1]! & 0xc0) === 0xc0) return true;
    if (bytes[0] === 0xff) return true;
    if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) return true;

    const firstTenZero = bytes.slice(0, 10).every((byte) => byte === 0);
    if (firstTenZero && bytes[10] === 0xff && bytes[11] === 0xff) return true;

    const firstTwelveZero = bytes.slice(0, 12).every((byte) => byte === 0);
    if (firstTwelveZero && isPrivateOrReservedIpv4(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!)) {
      return true;
    }

    const nat64 = bytes[0] === 0x00
      && bytes[1] === 0x64
      && bytes[2] === 0xff
      && bytes[3] === 0x9b
      && bytes.slice(4, 12).every((byte) => byte === 0);
    if (nat64 && isPrivateOrReservedIpv4(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!)) {
      return true;
    }

    const sixToFour = bytes[0] === 0x20 && bytes[1] === 0x02;
    if (sixToFour && isPrivateOrReservedIpv4(bytes[2]!, bytes[3]!, bytes[4]!, bytes[5]!)) {
      return true;
    }
    return false;
  }
  return true;
}

function isPrivateOrReservedIpv4(a: number, b: number, c: number, _d: number): boolean {
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113)
    || a >= 224;
}

function parseIpv6(address: string): Uint8Array | null {
  let input = address;
  if (input.includes(".")) {
    const separator = input.lastIndexOf(":");
    const ipv4 = input.slice(separator + 1).split(".").map(Number);
    if (separator < 0 || ipv4.length !== 4 || ipv4.some((part) => part < 0 || part > 255)) return null;
    input = `${input.slice(0, separator)}:${((ipv4[0]! << 8) | ipv4[1]!).toString(16)}:${((ipv4[2]! << 8) | ipv4[3]!).toString(16)}`;
  }
  const halves = input.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1]!.split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const groups = [...left, ...Array.from({ length: missing }, () => "0"), ...right];
  if (groups.length !== 8) return null;
  const bytes = new Uint8Array(16);
  for (let index = 0; index < groups.length; index += 1) {
    if (!/^[a-f0-9]{1,4}$/.test(groups[index]!)) return null;
    const value = Number.parseInt(groups[index]!, 16);
    bytes[index * 2] = value >> 8;
    bytes[index * 2 + 1] = value & 0xff;
  }
  return bytes;
}

function privateNetworkError(): DataNodeError {
  return new DataNodeError(
    "http_private_network_blocked",
    "HTTP collector blocks loopback, private, link-local, and reserved destinations by default",
    422,
  );
}

async function readBoundedBody(body: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<Uint8Array> {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw contentLimitError(maxBytes);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function assertWithinLimit(size: number, maxBytes: number): void {
  if (size > maxBytes) throw contentLimitError(maxBytes);
}

function contentLimitError(maxBytes: number): DataNodeError {
  return new DataNodeError(
    "content_too_large",
    `Collected content exceeds the ${maxBytes}-byte limit`,
    413,
  );
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function validHttpDate(value: string | null): boolean {
  return value !== null && Number.isFinite(new Date(value).getTime());
}

function positiveInteger(value: number | undefined, fallback: number, field: string): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result <= 0) {
    throw new DataNodeError("invalid_option", `${field} must be a positive integer`);
  }
  return result;
}

function nonNegativeInteger(value: number | undefined, fallback: number, field: string): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new DataNodeError("invalid_option", `${field} must be a non-negative integer`);
  }
  return result;
}

function inferFileMediaType(path: string): string {
  const extension = path.toLowerCase().split(".").pop();
  const known: Record<string, string> = {
    txt: "text/plain",
    md: "text/markdown",
    markdown: "text/markdown",
    json: "application/json",
    jsonl: "application/x-ndjson",
    csv: "text/csv",
    html: "text/html",
    htm: "text/html",
    xml: "application/xml",
    yaml: "application/yaml",
    yml: "application/yaml",
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
  };
  return extension ? known[extension] ?? "application/octet-stream" : "application/octet-stream";
}
