#!/usr/bin/env bun

/**
 * Consumer authority verifier, descriptor-set builder/checker, magnet deriver,
 * and hints-index invariant checker for transport-hints/v1
 * (docs/specs/TRANSPORT-HINTS-0.1-DRAFT.md, sections 4.2, 4.4, 6, 7.5, 8 and 9).
 *
 * Zero external dependencies: node: built-ins plus pure helpers from
 * ./build-transport-hints.ts. Like ./transport-hints-probe.ts, this module
 * holds no network transport of its own: verifyDescriptorAuthority requires an
 * explicit fetch function injected by the caller, applies the caller's egress
 * policy at every hop, follows redirects manually (or refuses redirects for
 * hf-resolve-etag), requires identity Content-Encoding, and caps response body
 * bytes.
 *
 * No BitTorrent wire protocol, DHT, tracker, or peer connection is implemented
 * or invoked. A torrent hash (pieces_root, btih, btmh) is never accepted in
 * place of subject.sha256 (draft section 9.4).
 *
 * CLI (offline file checks only):
 *   bin/transport-hints-verify.ts check-set <set.json> [--descriptor <desc.json> ...]
 *   bin/transport-hints-verify.ts check-index <index.json> [--descriptor <desc.json> ...] [--torrent <file.torrent> ...]
 *   bin/transport-hints-verify.ts check-index-chain <v1.json> <v2.json> ...
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import {
  PROTOCOL,
  SCHEMA_PATTERNS,
  assertProfileTorrent,
  assertTorrentName,
  assertUrlList,
  canonicalJson,
  compareBytes,
  descriptorProblems,
  isHttpsUrl,
  sha256Hex,
  type Authority,
} from "./build-transport-hints.ts";

export const DESCRIPTOR_SET_DOCUMENT_TYPE = "descriptor-set" as const;
export const HINTS_INDEX_DOCUMENT_TYPE = "hints-index" as const;

/** Draft section 9.1: a consumer SHOULD ignore a descriptor or descriptor set larger than 65,536 bytes. */
export const MAX_DESCRIPTOR_DOCUMENT_BYTES = 65_536;
/** Default ceiling on fetched authority record bodies (1 MiB). */
export const DEFAULT_MAX_AUTHORITY_BYTES = 1_048_576;
export const HARD_MAX_AUTHORITY_BYTES = 16_777_216;
export const MAX_JSON_DEPTH = 64;

export const DESCRIPTOR_SET_KEY_ORDER = {
  descriptorSet: ["protocol", "document_type", "set_id", "descriptors"],
  entry: ["subject_sha256", "descriptor_sha256"],
} as const;

const RE = {
  sha256Hex: new RegExp(SCHEMA_PATTERNS.sha256Hex, "u"),
  btih: /^[0-9a-f]{40}$/u,
  btmh: /^1220[0-9a-f]{64}$/u,
  httpsUrl: new RegExp(SCHEMA_PATTERNS.httpsUrl, "u"),
  webSeedEnd: new RegExp(SCHEMA_PATTERNS.webSeedEnd, "u"),
  bareFilename: new RegExp(SCHEMA_PATTERNS.bareFilename, "u"),
  torrentName: new RegExp(SCHEMA_PATTERNS.torrentName, "u"),
  spdxLicenseId: new RegExp(SCHEMA_PATTERNS.spdxLicenseId, "u"),
  jsonPointer: new RegExp(SCHEMA_PATTERNS.jsonPointer, "u"),
  hfResolveUrl: new RegExp(SCHEMA_PATTERNS.hfResolveUrl, "u"),
  hfCommitCapture: /^https:\/\/huggingface\.co\/(?:datasets\/)?[A-Za-z0-9](?:[A-Za-z0-9._-]{0,94}[A-Za-z0-9])?\/[A-Za-z0-9](?:[A-Za-z0-9._-]{0,94}[A-Za-z0-9])?\/resolve\/([0-9a-f]{40})\/[^/]/u,
  setId: /^[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$/u,
  replicaKind: /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u,
  isoDate: /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/u,
  isoDateTime: /^([0-9]{4}-[0-9]{2}-[0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})Z$/u,
  magnet: /^magnet:\?xt=urn:btih:([0-9a-f]{40})&xt=urn:btmh:(1220[0-9a-f]{64})&dn=([A-Za-z0-9._+-]{1,200})((?:&ws=[A-Za-z0-9._~%-]+)*)(?:&xs=([A-Za-z0-9._~%-]+))?$/u,
  sumsLine: /^([0-9A-Fa-f]{64}) [ *](.+)$/u,
} as const;

const encoder = new TextEncoder();
const fatalUtf8Decoder = new TextDecoder("utf-8", { fatal: true });
const utf8 = (text: string): Uint8Array => encoder.encode(text);

function setOwnProperty(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function isValidIsoDate(text: unknown): text is string {
  if (typeof text !== "string") return false;
  const match = RE.isoDate.exec(text);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!;
  return day <= daysInMonth;
}

export function isValidIsoDateTime(text: unknown): text is string {
  if (typeof text !== "string") return false;
  const match = RE.isoDateTime.exec(text);
  if (!match || !isValidIsoDate(match[1])) return false;
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  const second = Number(match[4]);
  return hour <= 23 && minute <= 59 && second <= 59;
}

// ---------------------------------------------------------------------------
// Strict I-JSON parser (RFC 8259 + RFC 7493: duplicate keys & lone surrogates fail)

export function parseStrictIJson(text: string, maxDepth = MAX_JSON_DEPTH): unknown {
  if (typeof text !== "string") throw new Error("I-JSON input must be a string");
  // Reject lone UTF-16 surrogates in the raw string before scanning.
  for (let k = 0; k < text.length; k += 1) {
    const code = text.charCodeAt(k);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = k + 1 < text.length ? text.charCodeAt(k + 1) : 0;
      if (next < 0xdc00 || next > 0xdfff) throw new Error(`I-JSON: lone high surrogate at index ${k}`);
      k += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new Error(`I-JSON: lone low surrogate at index ${k}`);
    }
  }

  let pos = 0;
  const skipWs = (): void => {
    while (pos < text.length) {
      const ch = text.charCodeAt(pos);
      if (ch === 0x20 || ch === 0x09 || ch === 0x0a || ch === 0x0d) pos += 1;
      else break;
    }
  };

  const readHex4 = (): number => {
    if (pos + 4 > text.length) throw new Error("I-JSON: truncated \\u escape");
    const slice = text.slice(pos, pos + 4);
    if (!/^[0-9A-Fa-f]{4}$/u.test(slice)) throw new Error(`I-JSON: invalid \\u${slice} escape`);
    pos += 4;
    return Number.parseInt(slice, 16);
  };

  const parseString = (): string => {
    if (text.charCodeAt(pos) !== 0x22) throw new Error(`I-JSON: expected '"' at ${pos}`);
    pos += 1;
    let out = "";
    let chunkStart = pos;
    while (pos < text.length) {
      const ch = text.charCodeAt(pos);
      if (ch === 0x22) {
        out += text.slice(chunkStart, pos);
        pos += 1;
        return out;
      }
      if (ch < 0x20) throw new Error(`I-JSON: unescaped control character 0x${ch.toString(16)} at ${pos}`);
      if (ch === 0x5c) {
        out += text.slice(chunkStart, pos);
        pos += 1;
        if (pos >= text.length) throw new Error("I-JSON: truncated escape sequence");
        const esc = text.charCodeAt(pos);
        pos += 1;
        switch (esc) {
          case 0x22: out += "\""; break;
          case 0x5c: out += "\\"; break;
          case 0x2f: out += "/"; break;
          case 0x62: out += "\b"; break;
          case 0x66: out += "\f"; break;
          case 0x6e: out += "\n"; break;
          case 0x72: out += "\r"; break;
          case 0x74: out += "\t"; break;
          case 0x75: {
            const unit = readHex4();
            if (unit >= 0xd800 && unit <= 0xdbff) {
              if (text.slice(pos, pos + 2) !== "\\u") {
                throw new Error("I-JSON: lone escaped high surrogate");
              }
              pos += 2;
              const low = readHex4();
              if (low < 0xdc00 || low > 0xdfff) {
                throw new Error("I-JSON: high surrogate not followed by low surrogate");
              }
              out += String.fromCharCode(unit, low);
            } else if (unit >= 0xdc00 && unit <= 0xdfff) {
              throw new Error("I-JSON: lone escaped low surrogate");
            } else {
              out += String.fromCharCode(unit);
            }
            break;
          }
          default:
            throw new Error(`I-JSON: invalid escape '\\${String.fromCharCode(esc)}' at ${pos - 1}`);
        }
        chunkStart = pos;
        continue;
      }
      pos += 1;
    }
    throw new Error("I-JSON: unterminated string");
  };

  const parseNumber = (): number => {
    const start = pos;
    if (text.charCodeAt(pos) === 0x2d) pos += 1;
    if (pos >= text.length) throw new Error("I-JSON: truncated number");
    const first = text.charCodeAt(pos);
    if (first === 0x30) {
      pos += 1;
      if (pos < text.length && text.charCodeAt(pos) >= 0x30 && text.charCodeAt(pos) <= 0x39) {
        throw new Error(`I-JSON: leading zero in number at ${start}`);
      }
    } else if (first >= 0x31 && first <= 0x39) {
      pos += 1;
      while (pos < text.length && text.charCodeAt(pos) >= 0x30 && text.charCodeAt(pos) <= 0x39) pos += 1;
    } else {
      throw new Error(`I-JSON: invalid number at ${start}`);
    }
    if (pos < text.length && text.charCodeAt(pos) === 0x2e) {
      pos += 1;
      if (pos >= text.length || text.charCodeAt(pos) < 0x30 || text.charCodeAt(pos) > 0x39) {
        throw new Error(`I-JSON: malformed fraction at ${start}`);
      }
      while (pos < text.length && text.charCodeAt(pos) >= 0x30 && text.charCodeAt(pos) <= 0x39) pos += 1;
    }
    if (pos < text.length && (text.charCodeAt(pos) === 0x65 || text.charCodeAt(pos) === 0x45)) {
      pos += 1;
      if (pos < text.length && (text.charCodeAt(pos) === 0x2b || text.charCodeAt(pos) === 0x2d)) pos += 1;
      if (pos >= text.length || text.charCodeAt(pos) < 0x30 || text.charCodeAt(pos) > 0x39) {
        throw new Error(`I-JSON: malformed exponent at ${start}`);
      }
      while (pos < text.length && text.charCodeAt(pos) >= 0x30 && text.charCodeAt(pos) <= 0x39) pos += 1;
    }
    const raw = text.slice(start, pos);
    const num = Number(raw);
    if (!Number.isFinite(num)) throw new Error(`I-JSON: number out of IEEE-754 range at ${start}`);
    return num;
  };

  const parseValue = (depth: number): unknown => {
    if (depth > maxDepth) throw new Error(`I-JSON: nesting exceeds maximum depth ${maxDepth}`);
    skipWs();
    if (pos >= text.length) throw new Error("I-JSON: unexpected end of input");
    const ch = text.charCodeAt(pos);
    if (ch === 0x22) return parseString();
    if (ch === 0x7b) {
      pos += 1;
      skipWs();
      const obj: Record<string, unknown> = {};
      const seenKeys = new Set<string>();
      if (pos < text.length && text.charCodeAt(pos) === 0x7d) {
        pos += 1;
        return obj;
      }
      while (true) {
        skipWs();
        if (pos >= text.length || text.charCodeAt(pos) !== 0x22) {
          throw new Error(`I-JSON: expected object member key at ${pos}`);
        }
        const key = parseString();
        if (seenKeys.has(key)) throw new Error(`I-JSON: duplicate object key '${key}'`);
        seenKeys.add(key);
        skipWs();
        if (pos >= text.length || text.charCodeAt(pos) !== 0x3a) {
          throw new Error(`I-JSON: expected ':' after key '${key}' at ${pos}`);
        }
        pos += 1;
        const val = parseValue(depth + 1);
        setOwnProperty(obj, key, val);
        skipWs();
        if (pos >= text.length) throw new Error("I-JSON: unterminated object");
        const sep = text.charCodeAt(pos);
        if (sep === 0x7d) {
          pos += 1;
          return obj;
        }
        if (sep !== 0x2c) throw new Error(`I-JSON: expected ',' or '}' at ${pos}`);
        pos += 1;
      }
    }
    if (ch === 0x5b) {
      pos += 1;
      skipWs();
      const arr: unknown[] = [];
      if (pos < text.length && text.charCodeAt(pos) === 0x5d) {
        pos += 1;
        return arr;
      }
      while (true) {
        arr.push(parseValue(depth + 1));
        skipWs();
        if (pos >= text.length) throw new Error("I-JSON: unterminated array");
        const sep = text.charCodeAt(pos);
        if (sep === 0x5d) {
          pos += 1;
          return arr;
        }
        if (sep !== 0x2c) throw new Error(`I-JSON: expected ',' or ']' at ${pos}`);
        pos += 1;
      }
    }
    if (text.startsWith("true", pos)) {
      pos += 4;
      return true;
    }
    if (text.startsWith("false", pos)) {
      pos += 5;
      return false;
    }
    if (text.startsWith("null", pos)) {
      pos += 4;
      return null;
    }
    if (ch === 0x2d || (ch >= 0x30 && ch <= 0x39)) return parseNumber();
    throw new Error(`I-JSON: unexpected character '${text[pos]!}' at ${pos}`);
  };

  const result = parseValue(0);
  skipWs();
  if (pos !== text.length) throw new Error(`I-JSON: trailing characters at ${pos}`);
  return result;
}

/** Resolve an RFC 6901 JSON Pointer against a parsed JSON value. */
export function resolveJsonPointer(
  root: unknown,
  pointer: string,
): { readonly found: true; readonly value: unknown } | { readonly found: false; readonly reason: string } {
  if (typeof pointer !== "string") return { found: false, reason: "pointer is not a string" };
  if (pointer === "") return { found: true, value: root };
  if (!pointer.startsWith("/")) return { found: false, reason: "RFC 6901 pointer must start with '/'" };
  const rawTokens = pointer.slice(1).split("/");
  let current: unknown = root;
  for (const raw of rawTokens) {
    if (!/^(?:[^~]|~[01])*$/u.test(raw)) {
      return { found: false, reason: `invalid RFC 6901 '~' escape in token '${raw}'` };
    }
    const token = raw.replace(/~1/gu, "/").replace(/~0/gu, "~");
    if (Array.isArray(current)) {
      if (!/^(?:0|[1-9][0-9]*)$/u.test(token)) {
        return { found: false, reason: `invalid array index '${token}'` };
      }
      const index = Number(token);
      if (!Number.isSafeInteger(index) || index >= current.length) {
        return { found: false, reason: `array index ${token} out of bounds` };
      }
      current = current[index];
    } else if (isPlainObject(current)) {
      if (!Object.hasOwn(current, token)) {
        return { found: false, reason: `missing property '${token}'` };
      }
      current = current[token];
    } else {
      return { found: false, reason: `cannot traverse '${token}' on non-container` };
    }
  }
  return { found: true, value: current };
}

// ---------------------------------------------------------------------------
// Authority verification & consumer acceptance (draft sections 4.2, 4.4 and 9)

export interface AuthorityHeaders {
  get(name: string): string | null;
}

export interface AuthorityResponse {
  readonly status: number;
  readonly headers: AuthorityHeaders;
  readonly body?: ReadableStream<Uint8Array> | null;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface AuthorityRequestInit {
  readonly method: "GET";
  readonly headers: Readonly<Record<string, string>>;
  readonly redirect: "manual";
}

export type AuthorityFetch = (url: string, init: AuthorityRequestInit) => Promise<AuthorityResponse>;

export interface VerifyAuthorityOptions {
  /** Injected transport; required whenever authority.kind !== 'none-prior'. */
  readonly fetch?: AuthorityFetch;
  /** Egress check applied to the initial authority URL and every redirect target. */
  readonly allowUrl?: (url: URL, hop: number) => boolean;
  /** Maximum redirect hops for JSON and sums-line authorities (default 1, max 5). Ignored for hf-resolve-etag (always 0). */
  readonly maxRedirects?: number;
  /** Maximum authority document body bytes (default 1 MiB, max 16 MiB). */
  readonly maxAuthorityBytes?: number;
  /** Maximum descriptor bytes accepted (default 65,536 per draft section 9.1). */
  readonly maxDescriptorBytes?: number;
  /** Whether none-prior descriptors are accepted (default false per draft section 4.2). */
  readonly allowNonePrior?: boolean;
}

export interface AuthorityVerificationResult {
  readonly ok: boolean;
  readonly kind: Authority["kind"] | null;
  readonly subject: { readonly filename: string; readonly size: number; readonly sha256: string } | null;
  readonly descriptorSha256: string | null;
  readonly redirects: number;
  readonly finalUrl: string | null;
  /** Validated HTTPS mirror URLs advertised by the authority record (e.g. love-package/v1). */
  readonly mirrors: readonly string[];
  readonly problems: readonly string[];
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const HF_RESOLVE_OK_STATUSES = new Set([200, 301, 302, 303, 307, 308]);

/** Default egress guard: HTTPS DNS host (no IPv4/IPv6 literal, no localhost/.local, no userinfo). */
export function defaultAuthorityAllowUrl(url: URL): boolean {
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.port !== "") return false;
  const host = url.hostname.toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false;
  if (host.startsWith("[") || host.endsWith("]") || host.includes(":")) return false;
  if (/^[0-9.]+$/u.test(host)) return false;
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(host);
}

async function cancelBody(response: AuthorityResponse): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Ignore un-cancellable mock streams.
  }
}

async function readCappedBytes(
  response: AuthorityResponse,
  cap: number,
): Promise<{ readonly ok: true; readonly bytes: Uint8Array } | { readonly ok: false; readonly problem: string }> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const trimmed = contentLength.trim();
    if (!/^(?:0|[1-9][0-9]*)$/u.test(trimmed)) {
      await cancelBody(response);
      return { ok: false, problem: `invalid Content-Length '${contentLength}'` };
    }
    const declared = Number(trimmed);
    if (!Number.isSafeInteger(declared) || declared > cap) {
      await cancelBody(response);
      return { ok: false, problem: `authority body Content-Length ${trimmed} exceeds ${cap}-byte ceiling` };
    }
  }
  const reader = response.body?.getReader();
  if (!reader) {
    const buf = new Uint8Array(await response.arrayBuffer());
    if (buf.byteLength > cap) {
      return { ok: false, problem: `authority body exceeds ${cap}-byte ceiling` };
    }
    return { ok: true, bytes: buf };
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel();
      return { ok: false, problem: `authority body exceeds ${cap}-byte ceiling` };
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes: out };
}

interface FetchedAuthority {
  readonly ok: boolean;
  readonly status: number | null;
  readonly headers: AuthorityHeaders | null;
  readonly bytes: Uint8Array | null;
  readonly redirects: number;
  readonly finalUrl: string;
  readonly problems: readonly string[];
}

async function fetchAuthority(
  initialUrl: string,
  options: {
    readonly fetch: AuthorityFetch;
    readonly allowUrl: (url: URL, hop: number) => boolean;
    readonly maxRedirects: number;
    readonly maxBytes: number;
    readonly followRedirects: boolean;
    readonly readBody: boolean;
  },
): Promise<FetchedAuthority> {
  const problems: string[] = [];
  let currentUrl = initialUrl;
  let redirects = 0;

  while (true) {
    let parsed: URL;
    try {
      parsed = new URL(currentUrl);
    } catch {
      problems.push(`invalid authority URL: ${currentUrl}`);
      return { ok: false, status: null, headers: null, bytes: null, redirects, finalUrl: currentUrl, problems };
    }
    if (!options.allowUrl(parsed, redirects)) {
      problems.push(`refused by egress policy at hop ${redirects}: ${currentUrl}`);
      return { ok: false, status: null, headers: null, bytes: null, redirects, finalUrl: currentUrl, problems };
    }
    let response: AuthorityResponse;
    try {
      response = await options.fetch(currentUrl, {
        method: "GET",
        headers: { "Accept-Encoding": "identity" },
        redirect: "manual",
      });
    } catch (error) {
      problems.push(`authority request failed: ${error instanceof Error ? error.message : String(error)}`);
      return { ok: false, status: null, headers: null, bytes: null, redirects, finalUrl: currentUrl, problems };
    }

    if (options.followRedirects && REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get("location");
      await cancelBody(response);
      if (!location) {
        problems.push(`redirect ${response.status} without a Location header`);
        return { ok: false, status: response.status, headers: null, bytes: null, redirects, finalUrl: currentUrl, problems };
      }
      redirects += 1;
      if (redirects > options.maxRedirects) {
        problems.push(`authority exceeded maximum redirects (${options.maxRedirects})`);
        return { ok: false, status: response.status, headers: null, bytes: null, redirects, finalUrl: currentUrl, problems };
      }
      try {
        currentUrl = new URL(location, currentUrl).href;
      } catch {
        problems.push(`invalid redirect Location: ${location}`);
        return { ok: false, status: response.status, headers: null, bytes: null, redirects, finalUrl: currentUrl, problems };
      }
      continue;
    }

    if (!options.readBody) {
      await cancelBody(response);
      return { ok: true, status: response.status, headers: response.headers, bytes: null, redirects, finalUrl: currentUrl, problems };
    }

    const contentEncoding = response.headers.get("content-encoding");
    if (contentEncoding !== null && contentEncoding.trim().toLowerCase() !== "identity") {
      await cancelBody(response);
      problems.push(`Content-Encoding '${contentEncoding}' is not identity`);
      return { ok: false, status: response.status, headers: response.headers, bytes: null, redirects, finalUrl: currentUrl, problems };
    }

    if (response.status !== 200) {
      await cancelBody(response);
      problems.push(`authority HTTP status ${response.status}, expected 200`);
      return { ok: false, status: response.status, headers: response.headers, bytes: null, redirects, finalUrl: currentUrl, problems };
    }

    const bodyRead = await readCappedBytes(response, options.maxBytes);
    if (!bodyRead.ok) {
      problems.push(bodyRead.problem);
      return { ok: false, status: response.status, headers: response.headers, bytes: null, redirects, finalUrl: currentUrl, problems };
    }
    return {
      ok: true,
      status: response.status,
      headers: response.headers,
      bytes: bodyRead.bytes,
      redirects,
      finalUrl: currentUrl,
      problems,
    };
  }
}

interface ParsedDescriptorShape {
  readonly subject: { readonly filename: string; readonly size: number; readonly sha256: string };
  readonly authority: Authority;
  readonly license: string;
  readonly bittorrent: {
    readonly profile: string;
    readonly name: string;
    readonly piece_length: number;
    readonly pieces_root: string;
    readonly btih: string;
    readonly btmh: string;
  };
}

/**
 * Verify a canonical artifact-descriptor against its upstream authority record
 * (draft sections 4.2, 4.4 rule 6, and 9.1-9.2).
 */
export async function verifyDescriptorAuthority(
  descriptorText: string,
  options: VerifyAuthorityOptions = {},
): Promise<AuthorityVerificationResult> {
  const maxDescriptorBytes = options.maxDescriptorBytes ?? MAX_DESCRIPTOR_DOCUMENT_BYTES;
  const maxRedirects = options.maxRedirects ?? 1;
  const maxAuthorityBytes = options.maxAuthorityBytes ?? DEFAULT_MAX_AUTHORITY_BYTES;
  const allowUrl = options.allowUrl ?? defaultAuthorityAllowUrl;

  if (!Number.isSafeInteger(maxDescriptorBytes) || maxDescriptorBytes < 1) {
    throw new Error("maxDescriptorBytes must be a positive integer");
  }
  if (!Number.isSafeInteger(maxRedirects) || maxRedirects < 0 || maxRedirects > 5) {
    throw new Error("maxRedirects must be an integer from 0 to 5");
  }
  if (!Number.isSafeInteger(maxAuthorityBytes) || maxAuthorityBytes < 1 || maxAuthorityBytes > HARD_MAX_AUTHORITY_BYTES) {
    throw new Error(`maxAuthorityBytes must be an integer from 1 to ${HARD_MAX_AUTHORITY_BYTES}`);
  }

  if (typeof descriptorText !== "string") {
    return {
      ok: false,
      kind: null,
      subject: null,
      descriptorSha256: null,
      redirects: 0,
      finalUrl: null,
      mirrors: [],
      problems: ["descriptor must be a string"],
    };
  }

  const descriptorBytes = utf8(descriptorText);
  if (descriptorBytes.byteLength > maxDescriptorBytes) {
    return {
      ok: false,
      kind: null,
      subject: null,
      descriptorSha256: null,
      redirects: 0,
      finalUrl: null,
      mirrors: [],
      problems: [`descriptor size ${descriptorBytes.byteLength} exceeds ${maxDescriptorBytes}-byte consumer limit`],
    };
  }

  let parsedUnknown: unknown;
  try {
    parsedUnknown = parseStrictIJson(descriptorText);
  } catch (error) {
    return {
      ok: false,
      kind: null,
      subject: null,
      descriptorSha256: null,
      redirects: 0,
      finalUrl: null,
      mirrors: [],
      problems: [error instanceof Error ? error.message : String(error)],
    };
  }

  const problems = descriptorProblems(descriptorText);
  if (problems.length > 0) {
    return {
      ok: false,
      kind: null,
      subject: null,
      descriptorSha256: null,
      redirects: 0,
      finalUrl: null,
      mirrors: [],
      problems,
    };
  }

  const descriptor = parsedUnknown as ParsedDescriptorShape;
  const descriptorSha256 = sha256Hex(descriptorBytes);
  const { subject, authority } = descriptor;

  if (authority.kind === "none-prior") {
    if (options.allowNonePrior === true) {
      return {
        ok: true,
        kind: "none-prior",
        subject,
        descriptorSha256,
        redirects: 0,
        finalUrl: null,
        mirrors: [],
        problems: [],
      };
    }
    return {
      ok: false,
      kind: "none-prior",
      subject,
      descriptorSha256,
      redirects: 0,
      finalUrl: null,
      mirrors: [],
      problems: ["none-prior descriptor refused: independent authority record required"],
    };
  }

  if (typeof options.fetch !== "function") {
    throw new Error("verifyDescriptorAuthority requires an explicit fetch function for network authority kinds");
  }

  if (authority.kind === "hf-resolve-etag") {
    const commitMatch = RE.hfCommitCapture.exec(authority.url);
    if (!commitMatch) {
      return {
        ok: false,
        kind: authority.kind,
        subject,
        descriptorSha256,
        redirects: 0,
        finalUrl: authority.url,
        mirrors: [],
        problems: ["hf-resolve-etag URL does not carry a 40-hex commit"],
      };
    }
    const expectedCommit = commitMatch[1]!;
    // Draft section 4.2: send request without following redirect and read headers
    // of the huggingface.co response only; CDN redirect target headers are never used.
    const fetched = await fetchAuthority(authority.url, {
      fetch: options.fetch,
      allowUrl,
      maxRedirects: 0,
      maxBytes: maxAuthorityBytes,
      followRedirects: false,
      readBody: false,
    });
    if (!fetched.ok || !fetched.headers || fetched.status === null) {
      return {
        ok: false,
        kind: authority.kind,
        subject,
        descriptorSha256,
        redirects: fetched.redirects,
        finalUrl: fetched.finalUrl,
        mirrors: [],
        problems: fetched.problems,
      };
    }
    const hfProblems: string[] = [];
    if (!HF_RESOLVE_OK_STATUSES.has(fetched.status)) {
      hfProblems.push(`hf-resolve-etag HTTP status ${fetched.status} is not a valid resolve response`);
    }
    const rawEtag = fetched.headers.get("x-linked-etag");
    if (rawEtag === null) {
      hfProblems.push("missing x-linked-etag header on huggingface.co response");
    } else {
      const unquoted = rawEtag.length >= 2 && rawEtag.startsWith("\"") && rawEtag.endsWith("\"")
        ? rawEtag.slice(1, -1)
        : rawEtag;
      if (!RE.sha256Hex.test(unquoted)) {
        hfProblems.push(`x-linked-etag '${rawEtag}' is not 64 lowercase hex characters`);
      } else if (unquoted !== subject.sha256) {
        hfProblems.push(`x-linked-etag ${unquoted} differs from subject.sha256 ${subject.sha256}`);
      }
    }
    const linkedSize = fetched.headers.get("x-linked-size");
    if (linkedSize !== null) {
      if (!/^[1-9][0-9]*$/u.test(linkedSize) || Number(linkedSize) !== subject.size) {
        hfProblems.push(`x-linked-size '${linkedSize}' differs from subject.size ${subject.size}`);
      }
    }
    const repoCommit = fetched.headers.get("x-repo-commit");
    if (repoCommit !== null && repoCommit !== expectedCommit) {
      hfProblems.push(`x-repo-commit '${repoCommit}' differs from pinned URL commit ${expectedCommit}`);
    }
    return {
      ok: hfProblems.length === 0,
      kind: authority.kind,
      subject,
      descriptorSha256,
      redirects: fetched.redirects,
      finalUrl: fetched.finalUrl,
      mirrors: [],
      problems: hfProblems,
    };
  }

  const fetched = await fetchAuthority(authority.url, {
    fetch: options.fetch,
    allowUrl,
    maxRedirects,
    maxBytes: maxAuthorityBytes,
    followRedirects: true,
    readBody: true,
  });
  if (!fetched.ok || !fetched.bytes) {
    return {
      ok: false,
      kind: authority.kind,
      subject,
      descriptorSha256,
      redirects: fetched.redirects,
      finalUrl: fetched.finalUrl,
      mirrors: [],
      problems: fetched.problems,
    };
  }

  let bodyText: string;
  try {
    bodyText = fatalUtf8Decoder.decode(fetched.bytes);
  } catch {
    return {
      ok: false,
      kind: authority.kind,
      subject,
      descriptorSha256,
      redirects: fetched.redirects,
      finalUrl: fetched.finalUrl,
      mirrors: [],
      problems: ["authority response is not valid UTF-8"],
    };
  }

  if (authority.kind === "sums-line") {
    const lines = bodyText.split("\n").map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
    const matches: string[] = [];
    for (const line of lines) {
      if (line.length === 0 || line.startsWith("\\")) continue;
      const m = RE.sumsLine.exec(line);
      if (m && m[2] === subject.filename) {
        matches.push(m[1]!.toLowerCase());
      }
    }
    const sumsProblems: string[] = [];
    if (matches.length === 0) {
      sumsProblems.push(`sums-line authority holds no matching line for '${subject.filename}'`);
    } else if (matches.length > 1) {
      sumsProblems.push(`sums-line authority holds ${matches.length} matching lines for '${subject.filename}', expected 1`);
    } else if (matches[0] !== subject.sha256) {
      sumsProblems.push(`sums-line digest ${matches[0]!} differs from subject.sha256 ${subject.sha256}`);
    }
    return {
      ok: sumsProblems.length === 0,
      kind: authority.kind,
      subject,
      descriptorSha256,
      redirects: fetched.redirects,
      finalUrl: fetched.finalUrl,
      mirrors: [],
      problems: sumsProblems,
    };
  }

  let doc: unknown;
  try {
    doc = parseStrictIJson(bodyText);
  } catch (error) {
    return {
      ok: false,
      kind: authority.kind,
      subject,
      descriptorSha256,
      redirects: fetched.redirects,
      finalUrl: fetched.finalUrl,
      mirrors: [],
      problems: [`authority document is not strict I-JSON: ${error instanceof Error ? error.message : String(error)}`],
    };
  }

  if (authority.kind === "json-pointer") {
    const resolved = resolveJsonPointer(doc, authority.pointer);
    if (!resolved.found) {
      return {
        ok: false,
        kind: authority.kind,
        subject,
        descriptorSha256,
        redirects: fetched.redirects,
        finalUrl: fetched.finalUrl,
        mirrors: [],
        problems: [`json-pointer '${authority.pointer}' did not resolve: ${resolved.reason}`],
      };
    }
    if (typeof resolved.value !== "string" || !RE.sha256Hex.test(resolved.value)) {
      return {
        ok: false,
        kind: authority.kind,
        subject,
        descriptorSha256,
        redirects: fetched.redirects,
        finalUrl: fetched.finalUrl,
        mirrors: [],
        problems: [`json-pointer '${authority.pointer}' value is not 64 lowercase hexadecimal characters`],
      };
    }
    if (resolved.value !== subject.sha256) {
      return {
        ok: false,
        kind: authority.kind,
        subject,
        descriptorSha256,
        redirects: fetched.redirects,
        finalUrl: fetched.finalUrl,
        mirrors: [],
        problems: [`json-pointer digest ${resolved.value} differs from subject.sha256 ${subject.sha256}`],
      };
    }
    return {
      ok: true,
      kind: authority.kind,
      subject,
      descriptorSha256,
      redirects: fetched.redirects,
      finalUrl: fetched.finalUrl,
      mirrors: [],
      problems: [],
    };
  }

  // authority.kind === "love-package/v1" (draft sections 4.2 and 4.4 rule 6)
  const loveProblems: string[] = [];
  const mirrors: string[] = [];
  if (!isPlainObject(doc)) {
    loveProblems.push("love-package/v1 authority is not a JSON object");
  } else {
    if (doc.protocol !== "love-package/v1") loveProblems.push(`manifest protocol is '${String(doc.protocol)}', not 'love-package/v1'`);
    if (doc.document_type !== "package-manifest") {
      loveProblems.push(`manifest document_type is '${String(doc.document_type)}', not 'package-manifest'`);
    }
    if (typeof doc.name !== "string" || doc.name.length < 1) loveProblems.push("manifest name is missing or invalid");
    if (typeof doc.version !== "string" || doc.version.length < 1) loveProblems.push("manifest version is missing or invalid");
    if (doc.license === null) {
      loveProblems.push("manifest license is null; a manifest without a license cannot be the authority of a descriptor");
    } else if (typeof doc.license !== "string" || doc.license !== descriptor.license) {
      loveProblems.push(`manifest license '${String(doc.license)}' differs from descriptor license '${descriptor.license}'`);
    }
    const artifact = doc.artifact;
    if (!isPlainObject(artifact)) {
      loveProblems.push("manifest artifact is not an object");
    } else {
      if (artifact.sha256 !== subject.sha256) {
        loveProblems.push(`manifest /artifact/sha256 '${String(artifact.sha256)}' differs from subject.sha256 '${subject.sha256}'`);
      }
      if (artifact.size !== subject.size) {
        loveProblems.push(`manifest /artifact/size '${String(artifact.size)}' differs from subject.size ${subject.size}`);
      }
      if (artifact.filename !== subject.filename) {
        loveProblems.push(`manifest /artifact/filename '${String(artifact.filename)}' differs from subject.filename '${subject.filename}'`);
      }
      if (!Array.isArray(artifact.mirrors) || artifact.mirrors.length < 1) {
        loveProblems.push("manifest /artifact/mirrors must be a non-empty array");
      } else {
        const seenMirrors = new Set<string>();
        for (const item of artifact.mirrors) {
          if (!isPlainObject(item) || typeof item.url !== "string") {
            loveProblems.push("manifest mirror entry must hold a string url");
            continue;
          }
          let mirrorUrl: URL;
          try {
            mirrorUrl = new URL(item.url);
          } catch {
            loveProblems.push(`manifest mirror URL is invalid: ${item.url}`);
            continue;
          }
          if (!isHttpsUrl(item.url)) {
            loveProblems.push(`manifest mirror URL breaks section 4.1 HTTPS URL rule: ${item.url}`);
            continue;
          }
          if (!allowUrl(mirrorUrl, 0)) {
            loveProblems.push(`manifest mirror URL refused by egress policy: ${item.url}`);
            continue;
          }
          if (seenMirrors.has(item.url)) {
            loveProblems.push(`duplicate manifest mirror URL: ${item.url}`);
            continue;
          }
          seenMirrors.add(item.url);
          mirrors.push(item.url);
        }
      }
    }
  }

  return {
    ok: loveProblems.length === 0,
    kind: authority.kind,
    subject,
    descriptorSha256,
    redirects: fetched.redirects,
    finalUrl: fetched.finalUrl,
    mirrors: loveProblems.length === 0 ? mirrors : [],
    problems: loveProblems,
  };
}

// ---------------------------------------------------------------------------
// Consumer Rule section 9.4: accept bytes ONLY on exact size and SHA-256

export interface SubjectByteVerification {
  readonly accepted: boolean;
  readonly actualSize: number;
  readonly actualSha256: string | null;
  readonly problems: readonly string[];
}

export function verifySubjectBytes(
  expected: { readonly size: number; readonly sha256: string },
  bytes: Uint8Array,
): SubjectByteVerification {
  if (!Number.isSafeInteger(expected.size) || expected.size < 1) {
    throw new Error("expected.size must be an integer from 1 to 2^53 - 1");
  }
  if (typeof expected.sha256 !== "string" || !RE.sha256Hex.test(expected.sha256)) {
    throw new Error("expected.sha256 must be 64 lowercase hexadecimal characters");
  }
  const actualSha256 = sha256Hex(bytes);
  const problems: string[] = [];
  if (bytes.byteLength !== expected.size) {
    problems.push(`byte count ${bytes.byteLength} differs from expected subject.size ${expected.size}`);
  }
  if (actualSha256 !== expected.sha256) {
    problems.push(`SHA-256 ${actualSha256} differs from expected subject.sha256 ${expected.sha256}`);
  }
  return {
    accepted: problems.length === 0,
    actualSize: bytes.byteLength,
    actualSha256,
    problems,
  };
}

export async function verifySubjectChunks(
  expected: { readonly size: number; readonly sha256: string },
  chunks: AsyncIterable<Uint8Array>,
): Promise<SubjectByteVerification> {
  if (!Number.isSafeInteger(expected.size) || expected.size < 1) {
    throw new Error("expected.size must be an integer from 1 to 2^53 - 1");
  }
  if (typeof expected.sha256 !== "string" || !RE.sha256Hex.test(expected.sha256)) {
    throw new Error("expected.sha256 must be 64 lowercase hexadecimal characters");
  }
  const hash = createHash("sha256");
  let actualSize = 0;
  for await (const chunk of chunks) {
    if (!(chunk instanceof Uint8Array)) throw new Error("subject stream must yield Uint8Array chunks");
    actualSize += chunk.byteLength;
    if (actualSize > expected.size) {
      return {
        accepted: false,
        actualSize,
        actualSha256: null,
        problems: [`stream exceeded expected subject.size ${expected.size} (stopped at ${actualSize} bytes)`],
      };
    }
    hash.update(chunk);
  }
  const actualSha256 = hash.digest("hex");
  const problems: string[] = [];
  if (actualSize !== expected.size) {
    problems.push(`byte count ${actualSize} differs from expected subject.size ${expected.size}`);
  }
  if (actualSha256 !== expected.sha256) {
    problems.push(`SHA-256 ${actualSha256} differs from expected subject.sha256 ${expected.sha256}`);
  }
  return {
    accepted: problems.length === 0,
    actualSize,
    actualSha256,
    problems,
  };
}

// ---------------------------------------------------------------------------
// Descriptor set (draft section 6)

export interface DescriptorSetEntry {
  readonly subject_sha256: string;
  readonly descriptor_sha256: string;
}

export function buildDescriptorSet(
  setId: string,
  entries: readonly DescriptorSetEntry[],
): { readonly text: string; readonly sha256: string } {
  if (typeof setId !== "string" || setId.length < 1 || setId.length > 64 || !RE.setId.test(setId)) {
    throw new Error(`set_id '${String(setId)}' breaks the rule of draft section 6`);
  }
  if (!Array.isArray(entries) || entries.length < 1) {
    throw new Error("descriptors must hold at least one entry");
  }
  const normalized = entries.map((entry, i) => {
    if (!isPlainObject(entry)) throw new Error(`descriptors[${i}] must be an object`);
    if (typeof entry.subject_sha256 !== "string" || !RE.sha256Hex.test(entry.subject_sha256)) {
      throw new Error(`descriptors[${i}].subject_sha256 must be 64 lowercase hexadecimal characters`);
    }
    if (typeof entry.descriptor_sha256 !== "string" || !RE.sha256Hex.test(entry.descriptor_sha256)) {
      throw new Error(`descriptors[${i}].descriptor_sha256 must be 64 lowercase hexadecimal characters`);
    }
    return { subject_sha256: entry.subject_sha256, descriptor_sha256: entry.descriptor_sha256 };
  });
  normalized.sort((a, b) => compareBytes(utf8(a.subject_sha256), utf8(b.subject_sha256)));
  for (let i = 1; i < normalized.length; i += 1) {
    if (normalized[i - 1]!.subject_sha256 === normalized[i]!.subject_sha256) {
      throw new Error(`duplicate subject_sha256 '${normalized[i]!.subject_sha256}' in descriptor-set`);
    }
  }
  const text = canonicalJson({
    protocol: PROTOCOL,
    document_type: DESCRIPTOR_SET_DOCUMENT_TYPE,
    set_id: setId,
    descriptors: normalized,
  });
  if (utf8(text).byteLength > MAX_DESCRIPTOR_DOCUMENT_BYTES) {
    throw new Error(`descriptor-set exceeds ${MAX_DESCRIPTOR_DOCUMENT_BYTES}-byte limit`);
  }
  const problems = descriptorSetProblems(text);
  if (problems.length > 0) throw new Error(`internal: descriptor-set breaks its own rules: ${problems.join("; ")}`);
  return { text, sha256: sha256Hex(text) };
}

export function buildDescriptorSetFromTexts(
  setId: string,
  descriptorTexts: readonly string[],
): { readonly text: string; readonly sha256: string } {
  if (!Array.isArray(descriptorTexts) || descriptorTexts.length < 1) {
    throw new Error("at least one descriptor text is required");
  }
  const entries: DescriptorSetEntry[] = descriptorTexts.map((descText, i) => {
    const problems = descriptorProblems(descText);
    if (problems.length > 0) {
      throw new Error(`descriptor[${i}] is invalid: ${problems.join("; ")}`);
    }
    const parsed = JSON.parse(descText) as { subject: { sha256: string } };
    return {
      subject_sha256: parsed.subject.sha256,
      descriptor_sha256: sha256Hex(descText),
    };
  });
  return buildDescriptorSet(setId, entries);
}

function keyOrderCheck(value: unknown, expected: readonly string[], label: string): string[] {
  if (!isPlainObject(value)) return [`${label} is not an object`];
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every((key, i) => key === expected[i])
    ? []
    : [`${label} keys are ${keys.join(", ")}; expected ${expected.join(", ")} in that order`];
}

export function descriptorSetProblems(
  text: string,
  options: {
    readonly maxBytes?: number;
    /** Optional map of descriptor_sha256 -> canonical descriptor text for cross-checking. */
    readonly descriptorsBySha256?: ReadonlyMap<string, string>;
  } = {},
): string[] {
  const maxBytes = options.maxBytes ?? MAX_DESCRIPTOR_DOCUMENT_BYTES;
  if (typeof text !== "string") return ["descriptor-set must be a string"];
  if (utf8(text).byteLength > maxBytes) {
    return [`descriptor-set exceeds ${maxBytes}-byte consumer limit`];
  }
  const problems: string[] = [];
  if (!/^[\x20-\x7e\n]*$/u.test(text) || text.includes("\\")) {
    problems.push("the text is not printable ASCII without escapes");
  }
  let parsed: unknown;
  try {
    parsed = parseStrictIJson(text);
  } catch (error) {
    return [...problems, error instanceof Error ? error.message : String(error)];
  }
  if (!isPlainObject(parsed)) return [...problems, "descriptor-set is not an object"];
  if (canonicalJson(parsed) !== text) {
    problems.push("the bytes are not in the one serialisation of draft section 5");
  }
  problems.push(...keyOrderCheck(parsed, DESCRIPTOR_SET_KEY_ORDER.descriptorSet, "descriptor-set"));
  if (parsed.protocol !== PROTOCOL) problems.push(`protocol is '${String(parsed.protocol)}', not '${PROTOCOL}'`);
  if (parsed.document_type !== DESCRIPTOR_SET_DOCUMENT_TYPE) {
    problems.push(`document_type is '${String(parsed.document_type)}', not '${DESCRIPTOR_SET_DOCUMENT_TYPE}'`);
  }
  if (typeof parsed.set_id !== "string" || parsed.set_id.length < 1 || parsed.set_id.length > 64 || !RE.setId.test(parsed.set_id)) {
    problems.push("set_id breaks the rule of draft section 6");
  }
  if (!Array.isArray(parsed.descriptors) || parsed.descriptors.length < 1) {
    problems.push("descriptors must be a non-empty array");
    return problems;
  }
  let previousSubject: string | null = null;
  parsed.descriptors.forEach((item, i) => {
    problems.push(...keyOrderCheck(item, DESCRIPTOR_SET_KEY_ORDER.entry, `descriptors[${i}]`));
    if (!isPlainObject(item)) return;
    const sub = item.subject_sha256;
    const desc = item.descriptor_sha256;
    if (typeof sub !== "string" || !RE.sha256Hex.test(sub)) {
      problems.push(`descriptors[${i}].subject_sha256 is not 64 lowercase hex`);
    } else {
      if (previousSubject !== null && compareBytes(utf8(previousSubject), utf8(sub)) >= 0) {
        problems.push("descriptors must be sorted strictly ascending by subject_sha256 with one entry per subject");
      }
      previousSubject = sub;
    }
    if (typeof desc !== "string" || !RE.sha256Hex.test(desc)) {
      problems.push(`descriptors[${i}].descriptor_sha256 is not 64 lowercase hex`);
    } else if (options.descriptorsBySha256) {
      const descText = options.descriptorsBySha256.get(desc);
      if (descText === undefined) {
        problems.push(`descriptors[${i}].descriptor_sha256 ${desc} was not provided in descriptorsBySha256`);
      } else {
        const descProblems = descriptorProblems(descText);
        if (descProblems.length > 0) {
          problems.push(`descriptors[${i}] linked descriptor is invalid: ${descProblems.join("; ")}`);
        } else if (sha256Hex(descText) !== desc) {
          problems.push(`descriptors[${i}] linked descriptor text does not hash to ${desc}`);
        } else {
          const descObj = JSON.parse(descText) as { subject: { sha256: string } };
          if (descObj.subject.sha256 !== sub) {
            problems.push(`descriptors[${i}].subject_sha256 ${String(sub)} differs from linked descriptor subject.sha256 ${descObj.subject.sha256}`);
          }
        }
      }
    }
  });
  return problems;
}

// ---------------------------------------------------------------------------
// Magnet derivation (draft section 7.5) & hints-index verification (section 8)

export function percentEncodeMagnetUrl(url: string): string {
  const bytes = utf8(url);
  let out = "";
  for (const byte of bytes) {
    const isUnreserved =
      (byte >= 0x41 && byte <= 0x5a) || // A-Z
      (byte >= 0x61 && byte <= 0x7a) || // a-z
      (byte >= 0x30 && byte <= 0x39) || // 0-9
      byte === 0x2d || // -
      byte === 0x2e || // .
      byte === 0x5f || // _
      byte === 0x7e;   // ~
    out += isUnreserved ? String.fromCharCode(byte) : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

export interface MagnetInput {
  readonly btih: string;
  readonly btmh: string;
  readonly name: string;
  readonly urlList: readonly string[];
  readonly torrentUrl?: string;
}

/** Build the derived magnet link of draft section 7.5 (never carries tr=). */
export function deriveMagnetLink(input: MagnetInput): string {
  if (typeof input.btih !== "string" || !RE.btih.test(input.btih)) {
    throw new Error("btih must be 40 lowercase hexadecimal characters");
  }
  if (typeof input.btmh !== "string" || !RE.btmh.test(input.btmh)) {
    throw new Error("btmh must be '1220' followed by 64 lowercase hexadecimal characters");
  }
  assertTorrentName(input.name);
  assertUrlList(input.urlList);
  if (input.torrentUrl !== undefined && !isHttpsUrl(input.torrentUrl)) {
    throw new Error("torrentUrl breaks the URL rule of draft section 4.1");
  }
  const ws = input.urlList.map((seed) => `&ws=${percentEncodeMagnetUrl(seed)}`).join("");
  const xs = input.torrentUrl === undefined ? "" : `&xs=${percentEncodeMagnetUrl(input.torrentUrl)}`;
  const magnet = `magnet:?xt=urn:btih:${input.btih}&xt=urn:btmh:${input.btmh}&dn=${input.name}${ws}${xs}`;
  if (magnet.length > 8192) throw new Error("magnet link exceeds 8,192-character schema ceiling");
  return magnet;
}

export type IndexEntryStatus = "listed" | "unmaintained" | "withdrawn" | "superseded";

/**
 * Draft section 8.2: an entry whose status is 'listed' but whose promise_until
 * is before the reader's current UTC date MUST be read as 'unmaintained'.
 */
export function effectiveEntryStatus(
  entry: { readonly status: IndexEntryStatus; readonly promise_until?: string },
  readerUtcDate: string,
): IndexEntryStatus {
  if (!isValidIsoDate(readerUtcDate)) {
    throw new Error(`readerUtcDate '${readerUtcDate}' is not a valid YYYY-MM-DD date`);
  }
  if (entry.status === "listed") {
    if (typeof entry.promise_until !== "string" || !isValidIsoDate(entry.promise_until)) {
      throw new Error("a listed entry requires a valid YYYY-MM-DD promise_until");
    }
    if (entry.promise_until < readerUtcDate) return "unmaintained";
  }
  return entry.status;
}

export interface HintsIndexContext {
  /** Optional map of descriptor_sha256 -> canonical descriptor text (enables section 8.3 rules 3 and 5). */
  readonly descriptorsBySha256?: ReadonlyMap<string, string>;
  /** Optional map of torrent.sha256 -> raw .torrent bytes (enables section 8.3 rule 4). */
  readonly torrentsBySha256?: ReadonlyMap<string, Uint8Array>;
}

function checkNoSignatureDeep(value: unknown, path: string, problems: string[]): void {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      checkNoSignatureDeep(value[i], `${path}[${i}]`, problems);
    }
    return;
  }
  if (!isPlainObject(value)) return;
  for (const key of Object.keys(value)) {
    if (key === "signature") {
      problems.push(`${path} must not carry a field named 'signature' (draft section 8.1)`);
    }
    checkNoSignatureDeep(value[key], `${path}.${key}`, problems);
  }
}

function checkUniqueBoundedStrings(
  value: unknown,
  label: string,
  maxLen: number,
  problems: string[],
): void {
  if (!Array.isArray(value)) {
    problems.push(`${label} must be an array`);
    return;
  }
  const seen = new Set<string>();
  value.forEach((item, i) => {
    if (typeof item !== "string" || item.length < 1 || item.length > maxLen) {
      problems.push(`${label}[${i}] must be a string of 1 to ${maxLen} characters`);
      return;
    }
    if (seen.has(item)) problems.push(`${label} holds duplicate entry '${item}'`);
    seen.add(item);
  });
}

function decodeMagnetComponent(encoded: string): string | null {
  if (!/^(?:[A-Za-z0-9._~-]|%[0-9A-F]{2})+$/u.test(encoded)) return null;
  try {
    const bytes: number[] = [];
    for (let i = 0; i < encoded.length; i += 1) {
      if (encoded[i] === "%") {
        bytes.push(Number.parseInt(encoded.slice(i + 1, i + 3), 16));
        i += 2;
      } else {
        bytes.push(encoded.charCodeAt(i));
      }
    }
    const decoded = fatalUtf8Decoder.decode(new Uint8Array(bytes));
    return percentEncodeMagnetUrl(decoded) === encoded ? decoded : null;
  } catch {
    return null;
  }
}

/**
 * Validate a hints-index JSON document against section 8.1 schema rules and all
 * single-document cross-entry rules of section 8.3 (rules 1-6).
 */
export function hintsIndexProblems(indexText: string, context: HintsIndexContext = {}): string[] {
  if (typeof indexText !== "string") return ["hints-index must be a string"];
  let root: unknown;
  try {
    root = parseStrictIJson(indexText);
  } catch (error) {
    return [`hints-index is not strict I-JSON: ${error instanceof Error ? error.message : String(error)}`];
  }
  if (!isPlainObject(root)) return ["hints-index must be a JSON object"];

  const problems: string[] = [];
  checkNoSignatureDeep(root, "hints-index", problems);

  if (root.protocol !== PROTOCOL) problems.push(`protocol is '${String(root.protocol)}', not '${PROTOCOL}'`);
  if (root.document_type !== HINTS_INDEX_DOCUMENT_TYPE) {
    problems.push(`document_type is '${String(root.document_type)}', not '${HINTS_INDEX_DOCUMENT_TYPE}'`);
  }
  const version = root.version;
  if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 1) {
    problems.push("version must be an integer >= 1");
  } else if (version === 1) {
    if (root.previous_sha256 !== null) problems.push("previous_sha256 must be null for version 1");
  } else if (typeof root.previous_sha256 !== "string" || !RE.sha256Hex.test(root.previous_sha256)) {
    problems.push("previous_sha256 must be 64 lowercase hex characters for version > 1");
  }

  if (!Array.isArray(root.entries)) {
    problems.push("entries must be an array");
    return problems;
  }

  const nameOwner = new Map<string, string>();
  const activeCountBySubject = new Map<string, number>();
  const allDescriptorSha256s = new Set<string>();
  const seenDescriptorSha256s = new Set<string>();

  for (const rawEntry of root.entries) {
    if (isPlainObject(rawEntry) && typeof rawEntry.descriptor_sha256 === "string" && RE.sha256Hex.test(rawEntry.descriptor_sha256)) {
      if (seenDescriptorSha256s.has(rawEntry.descriptor_sha256)) {
        problems.push(`duplicate entry for descriptor_sha256 ${rawEntry.descriptor_sha256}`);
      }
      seenDescriptorSha256s.add(rawEntry.descriptor_sha256);
      allDescriptorSha256s.add(rawEntry.descriptor_sha256);
    }
  }

  root.entries.forEach((rawEntry, idx) => {
    const label = `entries[${idx}]`;
    if (!isPlainObject(rawEntry)) {
      problems.push(`${label} must be an object`);
      return;
    }

    const subjectSha = rawEntry.subject_sha256;
    const name = rawEntry.name;
    const descSha = rawEntry.descriptor_sha256;
    const status = rawEntry.status;

    const validSubject = typeof subjectSha === "string" && RE.sha256Hex.test(subjectSha);
    if (!validSubject) problems.push(`${label}.subject_sha256 is not 64 lowercase hex`);

    let validName = false;
    if (typeof name !== "string") {
      problems.push(`${label}.name must be a string`);
    } else {
      try {
        assertTorrentName(name);
        validName = true;
      } catch (error) {
        problems.push(`${label}.name: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const validDescSha = typeof descSha === "string" && RE.sha256Hex.test(descSha);
    if (!validDescSha) problems.push(`${label}.descriptor_sha256 is not 64 lowercase hex`);

    const validStatus = status === "listed" || status === "unmaintained" || status === "withdrawn" || status === "superseded";
    if (!validStatus) {
      problems.push(`${label}.status '${String(status)}' is not listed, unmaintained, withdrawn or superseded`);
    }

    // Rule 8.3.1: One name belongs to one subject_sha256 across all entries and statuses.
    if (validName && validSubject) {
      const existingSubject = nameOwner.get(name as string);
      if (existingSubject !== undefined && existingSubject !== subjectSha) {
        problems.push(`rule 8.3.1: name '${name as string}' is bound to both ${existingSubject} and ${subjectSha as string}`);
      } else {
        nameOwner.set(name as string, subjectSha as string);
      }
    }

    // Rule 8.3.2: At most one entry per subject_sha256 is listed or unmaintained.
    if (validSubject && (status === "listed" || status === "unmaintained")) {
      const nextCount = (activeCountBySubject.get(subjectSha as string) ?? 0) + 1;
      activeCountBySubject.set(subjectSha as string, nextCount);
      if (nextCount > 1) {
        problems.push(`rule 8.3.2: subject_sha256 ${subjectSha as string} has more than one listed or unmaintained entry`);
      }
    }

    // Status-conditional required fields (section 8.1)
    if (status === "listed") {
      for (const req of ["descriptor_url", "clearance_sha256", "irreversibility_notice_sha256", "promise_until", "torrent"]) {
        if (!Object.hasOwn(rawEntry, req)) problems.push(`${label} (listed) is missing required field '${req}'`);
      }
    } else if (status === "withdrawn") {
      for (const req of ["withdrawn_at", "stopped", "cannot_stop"]) {
        if (!Object.hasOwn(rawEntry, req)) problems.push(`${label} (withdrawn) is missing required field '${req}'`);
      }
    } else if (status === "superseded") {
      for (const req of ["superseded_at", "superseded_by", "stopped", "cannot_stop"]) {
        if (!Object.hasOwn(rawEntry, req)) problems.push(`${label} (superseded) is missing required field '${req}'`);
      }
    }

    // Optional / conditional field validation
    if (Object.hasOwn(rawEntry, "descriptor_url") && !isHttpsUrl(rawEntry.descriptor_url)) {
      problems.push(`${label}.descriptor_url breaks section 4.1 URL rule`);
    }
    if (Object.hasOwn(rawEntry, "clearance_sha256") && (typeof rawEntry.clearance_sha256 !== "string" || !RE.sha256Hex.test(rawEntry.clearance_sha256))) {
      problems.push(`${label}.clearance_sha256 is not 64 lowercase hex`);
    }
    if (
      Object.hasOwn(rawEntry, "irreversibility_notice_sha256") &&
      (typeof rawEntry.irreversibility_notice_sha256 !== "string" || !RE.sha256Hex.test(rawEntry.irreversibility_notice_sha256))
    ) {
      problems.push(`${label}.irreversibility_notice_sha256 is not 64 lowercase hex`);
    }
    if (Object.hasOwn(rawEntry, "promise_until") && !isValidIsoDate(rawEntry.promise_until)) {
      problems.push(`${label}.promise_until is not a valid YYYY-MM-DD date`);
    }
    if (Object.hasOwn(rawEntry, "withdrawn_at") && !isValidIsoDate(rawEntry.withdrawn_at)) {
      problems.push(`${label}.withdrawn_at is not a valid YYYY-MM-DD date`);
    }
    if (Object.hasOwn(rawEntry, "superseded_at") && !isValidIsoDate(rawEntry.superseded_at)) {
      problems.push(`${label}.superseded_at is not a valid YYYY-MM-DD date`);
    }
    if (Object.hasOwn(rawEntry, "stopped")) checkUniqueBoundedStrings(rawEntry.stopped, `${label}.stopped`, 200, problems);
    if (Object.hasOwn(rawEntry, "cannot_stop")) checkUniqueBoundedStrings(rawEntry.cannot_stop, `${label}.cannot_stop`, 200, problems);

    // Rule 8.3.6: superseded_by names descriptor_sha256 of another entry in the same index.
    if (Object.hasOwn(rawEntry, "superseded_by")) {
      if (typeof rawEntry.superseded_by !== "string" || !RE.sha256Hex.test(rawEntry.superseded_by)) {
        problems.push(`${label}.superseded_by is not 64 lowercase hex`);
      } else if (validDescSha && rawEntry.superseded_by === descSha) {
        problems.push(`rule 8.3.6: ${label}.superseded_by cannot name its own descriptor_sha256`);
      } else if (!allDescriptorSha256s.has(rawEntry.superseded_by)) {
        problems.push(`rule 8.3.6: ${label}.superseded_by ${rawEntry.superseded_by} does not name another entry in this index`);
      }
    }

    let validTorrentField: { readonly url: string; readonly sha256: string; readonly url_list: readonly string[] } | null = null;
    if (Object.hasOwn(rawEntry, "torrent")) {
      const t = rawEntry.torrent;
      if (!isPlainObject(t)) {
        problems.push(`${label}.torrent must be an object`);
      } else {
        const okUrl = isHttpsUrl(t.url);
        if (!okUrl) problems.push(`${label}.torrent.url breaks section 4.1 URL rule`);
        const okSha = typeof t.sha256 === "string" && RE.sha256Hex.test(t.sha256);
        if (!okSha) problems.push(`${label}.torrent.sha256 is not 64 lowercase hex`);
        let okList = false;
        if (!Array.isArray(t.url_list)) {
          problems.push(`${label}.torrent.url_list must be an array`);
        } else {
          try {
            const list = t.url_list.map((u) => (typeof u === "string" ? u : ""));
            assertUrlList(list);
            okList = true;
          } catch (error) {
            problems.push(`${label}.torrent.url_list: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
        if (okUrl && okSha && okList) {
          validTorrentField = { url: t.url as string, sha256: t.sha256 as string, url_list: t.url_list as string[] };
        }
      }
    }

    if (Object.hasOwn(rawEntry, "none_prior")) {
      const np = rawEntry.none_prior;
      if (!isPlainObject(np)) {
        problems.push(`${label}.none_prior must be an object`);
      } else {
        if (!isValidIsoDateTime(np.hashed_at)) {
          problems.push(`${label}.none_prior.hashed_at is not a valid YYYY-MM-DDTHH:MM:SSZ UTC timestamp`);
        }
      }
    }

    if (Object.hasOwn(rawEntry, "observations")) {
      if (!Array.isArray(rawEntry.observations)) {
        problems.push(`${label}.observations must be an array`);
      } else {
        rawEntry.observations.forEach((obs, oi) => {
          const obsLabel = `${label}.observations[${oi}]`;
          if (!isPlainObject(obs)) {
            problems.push(`${obsLabel} must be an object`);
            return;
          }
          if (!isValidIsoDate(obs.at) && !isValidIsoDateTime(obs.at)) {
            problems.push(`${obsLabel}.at must be a valid YYYY-MM-DD date or YYYY-MM-DDTHH:MM:SSZ timestamp`);
          }
          if (typeof obs.by !== "string" || obs.by.length < 1 || obs.by.length > 200) {
            problems.push(`${obsLabel}.by must be a string of 1 to 200 characters`);
          }
        });
      }
    }

    if (Object.hasOwn(rawEntry, "other_replicas")) {
      if (!Array.isArray(rawEntry.other_replicas)) {
        problems.push(`${label}.other_replicas must be an array`);
      } else {
        rawEntry.other_replicas.forEach((rep, ri) => {
          const repLabel = `${label}.other_replicas[${ri}]`;
          if (!isPlainObject(rep)) {
            problems.push(`${repLabel} must be an object`);
            return;
          }
          if (typeof rep.kind !== "string" || !RE.replicaKind.test(rep.kind)) {
            problems.push(`${repLabel}.kind breaks the replica kind pattern`);
          }
          if (Object.hasOwn(rep, "holds_bytes") && typeof rep.holds_bytes !== "boolean") {
            problems.push(`${repLabel}.holds_bytes must be a boolean`);
          }
          if (Object.hasOwn(rep, "recall") && (typeof rep.recall !== "string" || rep.recall.length < 1 || rep.recall.length > 200)) {
            problems.push(`${repLabel}.recall must be a string of 1 to 200 characters`);
          }
        });
      }
    }

    // Linked descriptor checks (Rule 8.3.3 & 8.3.5)
    let linkedDescriptor: ParsedDescriptorShape | null = null;
    if (validDescSha && context.descriptorsBySha256) {
      const descText = context.descriptorsBySha256.get(descSha as string);
      if (descText === undefined) {
        problems.push(`${label}: descriptor_sha256 ${descSha as string} missing from descriptorsBySha256`);
      } else {
        const descProblems = descriptorProblems(descText);
        if (descProblems.length > 0) {
          problems.push(`${label}: linked descriptor is invalid: ${descProblems.join("; ")}`);
        } else if (sha256Hex(descText) !== descSha) {
          problems.push(`${label}: linked descriptor text does not hash to ${descSha as string}`);
        } else {
          linkedDescriptor = JSON.parse(descText) as ParsedDescriptorShape;
          if (validSubject && linkedDescriptor.subject.sha256 !== subjectSha) {
            problems.push(`${label}.subject_sha256 differs from linked descriptor subject.sha256`);
          }
          if (validName && linkedDescriptor.bittorrent.name !== name) {
            problems.push(`${label}.name differs from linked descriptor bittorrent.name`);
          }
          // Rule 8.3.3: none_prior is present iff authority.kind === 'none-prior'
          const hasNonePrior = Object.hasOwn(rawEntry, "none_prior");
          const isNonePriorAuth = linkedDescriptor.authority.kind === "none-prior";
          if (hasNonePrior !== isNonePriorAuth) {
            problems.push(
              `rule 8.3.3: ${label}.none_prior presence (${String(hasNonePrior)}) disagrees with authority.kind '${linkedDescriptor.authority.kind}'`,
            );
          }
        }
      }
    }

    // Rule 8.3.4: torrent.url_list equals the url-list inside the .torrent whose SHA-256 is torrent.sha256
    if (validTorrentField && context.torrentsBySha256) {
      const torrentBytes = context.torrentsBySha256.get(validTorrentField.sha256);
      if (torrentBytes === undefined) {
        problems.push(`${label}: torrent.sha256 ${validTorrentField.sha256} missing from torrentsBySha256`);
      } else {
        if (sha256Hex(torrentBytes) !== validTorrentField.sha256) {
          problems.push(`rule 8.3.4: ${label} .torrent bytes do not hash to ${validTorrentField.sha256}`);
        } else {
          try {
            const profileTorrent = assertProfileTorrent(torrentBytes);
            if (
              profileTorrent.urlList.length !== validTorrentField.url_list.length ||
              profileTorrent.urlList.some((u, i) => u !== validTorrentField!.url_list[i])
            ) {
              problems.push(`rule 8.3.4: ${label}.torrent.url_list differs from the url-list inside the .torrent`);
            }
            if (validName && profileTorrent.name !== name) {
              problems.push(`${label}: .torrent info.name '${profileTorrent.name}' differs from entry name '${name as string}'`);
            }
            if (linkedDescriptor) {
              if (profileTorrent.btih !== linkedDescriptor.bittorrent.btih) {
                problems.push(`${label}: .torrent btih differs from linked descriptor`);
              }
              if (profileTorrent.btmh !== linkedDescriptor.bittorrent.btmh) {
                problems.push(`${label}: .torrent btmh differs from linked descriptor`);
              }
            }
          } catch (error) {
            problems.push(`rule 8.3.4: ${label} .torrent fails profile check: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
    }

    // Rule 8.3.5: magnet agrees with descriptor's btih, btmh and name and with torrent fields
    if (Object.hasOwn(rawEntry, "magnet")) {
      if (typeof rawEntry.magnet !== "string" || rawEntry.magnet.length > 8192) {
        problems.push(`${label}.magnet must be a string of at most 8,192 characters`);
      } else {
        if (rawEntry.magnet.includes("&tr=") || rawEntry.magnet.includes("?tr=")) {
          problems.push(`rule 8.3.5: ${label}.magnet must never carry a tracker ('tr=') parameter`);
        }
        const m = RE.magnet.exec(rawEntry.magnet);
        if (!m) {
          problems.push(`${label}.magnet breaks the magnet pattern of draft section 7.5`);
        } else {
          const [, mBtih, mBtmh, mDn, mWsGroup, mXs] = m;
          if (validName && mDn !== name) {
            problems.push(`rule 8.3.5: ${label}.magnet dn='${mDn!}' differs from entry name '${name as string}'`);
          }
          if (linkedDescriptor) {
            if (mBtih !== linkedDescriptor.bittorrent.btih) {
              problems.push(`rule 8.3.5: ${label}.magnet btih differs from linked descriptor`);
            }
            if (mBtmh !== linkedDescriptor.bittorrent.btmh) {
              problems.push(`rule 8.3.5: ${label}.magnet btmh differs from linked descriptor`);
            }
          }
          const wsEncoded = mWsGroup ? mWsGroup.slice(4).split("&ws=").filter((s) => s.length > 0) : [];
          const wsDecoded = wsEncoded.map(decodeMagnetComponent);
          if (wsDecoded.some((u) => u === null || !isHttpsUrl(u) || !RE.webSeedEnd.test(u))) {
            problems.push(`rule 8.3.5: ${label}.magnet carries an invalid or non-canonical ws= web seed`);
          } else {
            const seenWs = new Set<string>();
            for (const u of wsDecoded) {
              if (u !== null && seenWs.has(u)) {
                problems.push(`rule 8.3.5: ${label}.magnet carries duplicate ws= web seed '${u}'`);
              } else if (u !== null) {
                seenWs.add(u);
              }
            }
          }
          if (mXs !== undefined) {
            const xsDecoded = decodeMagnetComponent(mXs);
            if (xsDecoded === null || !isHttpsUrl(xsDecoded)) {
              problems.push(`rule 8.3.5: ${label}.magnet carries an invalid or non-canonical xs= URL`);
            }
          }
          if (validTorrentField) {
            if (
              wsDecoded.some((u) => u === null) ||
              wsDecoded.length !== validTorrentField.url_list.length ||
              wsDecoded.some((u, i) => u !== validTorrentField!.url_list[i])
            ) {
              problems.push(`rule 8.3.5: ${label}.magnet ws= parameters do not match torrent.url_list in order`);
            }
            if (mXs === undefined || decodeMagnetComponent(mXs) !== validTorrentField.url) {
              problems.push(`rule 8.3.5: ${label}.magnet xs= parameter does not match torrent.url`);
            }
            if (linkedDescriptor) {
              const expectedMagnet = deriveMagnetLink({
                btih: linkedDescriptor.bittorrent.btih,
                btmh: linkedDescriptor.bittorrent.btmh,
                name: linkedDescriptor.bittorrent.name,
                urlList: validTorrentField.url_list,
                torrentUrl: validTorrentField.url,
              });
              if (rawEntry.magnet !== expectedMagnet) {
                problems.push(`rule 8.3.5: ${label}.magnet differs from canonical section 7.5 magnet spelling`);
              }
            }
          }
        }
      }
    }
  });

  return problems;
}

export interface VerifyIndexChainOptions extends HintsIndexContext {
  /** Allow the chain slice to begin at a version > 1 (default false). */
  readonly allowPartialStart?: boolean;
}

/**
 * Verify an ordered sequence of served hints-index versions (exact bytes or
 * UTF-8 text) against section 8.1 and all cross-version rules of section 8.3
 * (rules 1, 7 and 8: permanent name->subject_sha256 binding, entry retention,
 * monotonic +1 versions, and previous_sha256 over exact served bytes).
 */
export function verifyHintsIndexChain(
  versions: ReadonlyArray<Uint8Array | string>,
  options: VerifyIndexChainOptions = {},
): string[] {
  if (!Array.isArray(versions) || versions.length < 1) {
    return ["index chain must contain at least one version"];
  }
  const problems: string[] = [];
  const globalNameOwner = new Map<string, { readonly subjectSha256: string; readonly version: number }>();
  const priorDescriptors = new Map<string, { readonly subjectSha256: string; readonly name: string; readonly firstVersion: number }>();

  let prevVersionNum: number | null = null;
  let prevExactSha256: string | null = null;

  versions.forEach((raw, idx) => {
    const stepLabel = `chain[${idx}]`;
    const rawBytes = typeof raw === "string" ? utf8(raw) : raw;
    const currentExactSha256 = sha256Hex(rawBytes);
    let text: string;
    try {
      text = typeof raw === "string" ? raw : fatalUtf8Decoder.decode(rawBytes);
    } catch {
      problems.push(`${stepLabel} is not valid UTF-8`);
      prevVersionNum = null;
      prevExactSha256 = currentExactSha256;
      return;
    }

    const singleProblems = hintsIndexProblems(text, options);
    for (const p of singleProblems) problems.push(`${stepLabel}: ${p}`);

    let parsed: unknown;
    try {
      parsed = parseStrictIJson(text);
    } catch {
      prevVersionNum = null;
      prevExactSha256 = currentExactSha256;
      return;
    }
    if (!isPlainObject(parsed)) {
      prevVersionNum = null;
      prevExactSha256 = currentExactSha256;
      return;
    }

    const version =
      typeof parsed.version === "number" && Number.isSafeInteger(parsed.version) && parsed.version >= 1
        ? parsed.version
        : null;

    if (idx === 0) {
      if (!options.allowPartialStart && version !== null && version !== 1) {
        problems.push(`${stepLabel}: chain must start at version 1, found version ${version}`);
      }
    } else {
      if (prevVersionNum !== null && version !== null && version !== prevVersionNum + 1) {
        problems.push(`rule 8.1: ${stepLabel} version ${version} does not increment ${prevVersionNum} by 1`);
      }
      if (prevExactSha256 !== null && parsed.previous_sha256 !== prevExactSha256) {
        problems.push(
          `rule 8.3.8: ${stepLabel}.previous_sha256 ${String(parsed.previous_sha256)} differs from previous version exact SHA-256 ${prevExactSha256}`,
        );
      }
    }

    if (Array.isArray(parsed.entries)) {
      const currentDescriptors = new Set<string>();
      const versionLabel = version ?? idx + 1;
      for (const rawEntry of parsed.entries) {
        if (!isPlainObject(rawEntry)) continue;
        const name = typeof rawEntry.name === "string" && rawEntry.name.length > 0 ? rawEntry.name : null;
        const subjectSha =
          typeof rawEntry.subject_sha256 === "string" && RE.sha256Hex.test(rawEntry.subject_sha256)
            ? rawEntry.subject_sha256
            : null;
        const descSha =
          typeof rawEntry.descriptor_sha256 === "string" && RE.sha256Hex.test(rawEntry.descriptor_sha256)
            ? rawEntry.descriptor_sha256
            : null;

        if (name !== null && subjectSha !== null) {
          const priorName = globalNameOwner.get(name);
          if (priorName && priorName.subjectSha256 !== subjectSha) {
            problems.push(
              `rule 8.3.1: ${stepLabel} reuses name '${name}' for ${subjectSha}; version ${priorName.version} bound it to ${priorName.subjectSha256}`,
            );
          } else if (!priorName) {
            globalNameOwner.set(name, { subjectSha256: subjectSha, version: versionLabel });
          }
        }

        if (descSha !== null) {
          currentDescriptors.add(descSha);
          if (name !== null && subjectSha !== null) {
            const priorDesc = priorDescriptors.get(descSha);
            if (priorDesc) {
              if (priorDesc.subjectSha256 !== subjectSha || priorDesc.name !== name) {
                problems.push(
                  `rule 8.3.7: ${stepLabel} mutated immutable identity fields of descriptor_sha256 ${descSha} from version ${priorDesc.firstVersion}`,
                );
              }
            } else {
              priorDescriptors.set(descSha, { subjectSha256: subjectSha, name, firstVersion: versionLabel });
            }
          }
        }
      }

      // Rule 8.3.7: entries once published stay recorded in the index (moving to withdrawn/superseded, never dropped).
      for (const [descSha, meta] of priorDescriptors.entries()) {
        if (!currentDescriptors.has(descSha)) {
          problems.push(
            `rule 8.3.7: ${stepLabel} (version ${versionLabel}) dropped descriptor_sha256 ${descSha} first listed in version ${meta.firstVersion}`,
          );
        }
      }
    }

    prevVersionNum = version;
    prevExactSha256 = currentExactSha256;
  });

  return problems;
}

// ---------------------------------------------------------------------------
// Offline CLI

async function loadDescriptorsMap(paths: readonly string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const path of paths) {
    const text = await readFile(path, "utf8");
    map.set(sha256Hex(text), text);
  }
  return map;
}

async function loadTorrentsMap(paths: readonly string[]): Promise<Map<string, Uint8Array>> {
  const map = new Map<string, Uint8Array>();
  for (const path of paths) {
    const bytes = new Uint8Array(await readFile(path));
    map.set(sha256Hex(bytes), bytes);
  }
  return map;
}

async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === "check-set") {
    const { values, positionals } = parseArgs({
      args: [...rest],
      strict: true,
      allowPositionals: true,
      options: { descriptor: { type: "string", multiple: true } },
    });
    if (positionals.length !== 1) {
      console.error("usage: check-set <set.json> [--descriptor <desc.json> ...]");
      return 2;
    }
    const text = await readFile(positionals[0]!, "utf8");
    const descriptorsBySha256 = values.descriptor?.length ? await loadDescriptorsMap(values.descriptor) : undefined;
    const problems = descriptorSetProblems(text, descriptorsBySha256 ? { descriptorsBySha256 } : {});
    for (const p of problems) console.error(p);
    if (problems.length === 0) process.stdout.write(`descriptor-set ok: ${sha256Hex(text)}\n`);
    return problems.length === 0 ? 0 : 1;
  }

  if (command === "check-index") {
    const { values, positionals } = parseArgs({
      args: [...rest],
      strict: true,
      allowPositionals: true,
      options: {
        descriptor: { type: "string", multiple: true },
        torrent: { type: "string", multiple: true },
      },
    });
    if (positionals.length !== 1) {
      console.error("usage: check-index <index.json> [--descriptor <desc.json> ...] [--torrent <file.torrent> ...]");
      return 2;
    }
    const text = await readFile(positionals[0]!, "utf8");
    const descriptorsBySha256 = values.descriptor?.length ? await loadDescriptorsMap(values.descriptor) : undefined;
    const torrentsBySha256 = values.torrent?.length ? await loadTorrentsMap(values.torrent) : undefined;
    const problems = hintsIndexProblems(text, {
      ...(descriptorsBySha256 ? { descriptorsBySha256 } : {}),
      ...(torrentsBySha256 ? { torrentsBySha256 } : {}),
    });
    for (const p of problems) console.error(p);
    if (problems.length === 0) process.stdout.write(`hints-index ok: ${sha256Hex(text)}\n`);
    return problems.length === 0 ? 0 : 1;
  }

  if (command === "check-index-chain") {
    const { values, positionals } = parseArgs({
      args: [...rest],
      strict: true,
      allowPositionals: true,
      options: {
        descriptor: { type: "string", multiple: true },
        torrent: { type: "string", multiple: true },
        "allow-partial-start": { type: "boolean" },
      },
    });
    if (positionals.length < 1) {
      console.error("usage: check-index-chain <v1.json> [<v2.json> ...] [--descriptor <desc.json> ...] [--torrent <file.torrent> ...]");
      return 2;
    }
    const versions = await Promise.all(positionals.map(async (p) => new Uint8Array(await readFile(p))));
    const descriptorsBySha256 = values.descriptor?.length ? await loadDescriptorsMap(values.descriptor) : undefined;
    const torrentsBySha256 = values.torrent?.length ? await loadTorrentsMap(values.torrent) : undefined;
    const problems = verifyHintsIndexChain(versions, {
      allowPartialStart: Boolean(values["allow-partial-start"]),
      ...(descriptorsBySha256 ? { descriptorsBySha256 } : {}),
      ...(torrentsBySha256 ? { torrentsBySha256 } : {}),
    });
    for (const p of problems) console.error(p);
    if (problems.length === 0) process.stdout.write(`hints-index chain ok (${versions.length} version(s))\n`);
    return problems.length === 0 ? 0 : 1;
  }

  console.error("usage: bin/transport-hints-verify.ts check-set|check-index|check-index-chain ...");
  return 2;
}

if (import.meta.main) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(`transport-hints-verify: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    },
  );
}
