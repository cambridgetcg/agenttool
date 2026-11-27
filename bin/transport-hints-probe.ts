/**
 * Web-seed range probe for transport-hints/v1 (docs/specs/TRANSPORT-HINTS-0.1-DRAFT.md,
 * section 7.4), kept for work that lists hosts and records dated observations.
 * It sends ranged GETs for the first byte and for one range inside the file,
 * with Accept-Encoding: identity, and requires for each: 206 Partial Content,
 * exactly `Content-Range: bytes <first>-<last>/<size>`, no Content-Encoding
 * other than `identity`, and a body of exactly the range's length. It follows
 * redirects itself, one request at a time, so that it can count them, refuse a
 * non-HTTPS target and apply the caller's egress check at every hop.
 *
 * It also classifies failures purely from standard request responses and thrown
 * errors (read-only diagnostics, zero raw sockets or packet manipulation) and
 * formats dated hints-index observation records that keep direct observations,
 * bounded interpretations, and unobserved vantage fields ("unknown") separate.
 *
 * It takes the request function as a parameter and has no default: nothing here
 * opens a connection by itself. Its tests inject fake handlers
 * (bin/tests/transport-hints.test.ts and bin/tests/transport-hints-probe.test.ts);
 * no code in this repository calls it against the network.
 */

export interface ProbeHeaders {
  get(name: string): string | null;
}

export interface ProbeResponse {
  readonly status: number;
  readonly headers: ProbeHeaders;
  readonly body?: ReadableStream<Uint8Array> | null;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface ProbeRequestInit {
  readonly method: "GET";
  readonly headers: Readonly<Record<string, string>>;
  readonly redirect: "manual";
}

export type ProbeFetch = (url: string, init: ProbeRequestInit) => Promise<ProbeResponse>;

export interface ProbeOptions {
  /** The web seed: the full HTTPS URL of the one file. */
  readonly url: string;
  /** The subject's exact size from the descriptor. */
  readonly size: number;
  /** The request function; the probe never chooses one itself. */
  readonly fetch: ProbeFetch;
  /** Redirect hops allowed per request; the draft allows at most one. */
  readonly maxRedirects?: number;
  /** The caller's egress policy, applied to the first URL and to every redirect target. */
  readonly allowUrl?: (url: URL) => boolean;
  /** Bytes requested inside the file (default 1,024). */
  readonly midRangeLength?: number;
}

/**
 * Read-only, standard-socket failure categories derived solely from HTTP
 * responses, egress checks, and thrown request errors.
 */
export type ProbeDiagnosticCategory =
  | "ok"
  | "invalid_url"
  | "egress_refused"
  | "redirect_missing_location"
  | "redirect_limit"
  | "http_legal_block"
  | "http_auth_or_forbidden"
  | "http_not_found"
  | "origin_not_range_capable"
  | "content_encoded"
  | "body_length_mismatch"
  | "http_server_error"
  | "http_unexpected_status"
  | "dns_error"
  | "tls_error"
  | "connection_reset"
  | "connection_refused_or_timeout"
  | "transport_error";

export type ProbeInterpretationClass =
  | "verified_range_ok"
  | "origin_or_policy_behavior"
  | "possible_path_or_middlebox_interference"
  | "inconclusive";

export interface RangeCheck {
  readonly first: number;
  readonly last: number;
  readonly ok: boolean;
  readonly category: ProbeDiagnosticCategory;
  readonly status: number | null;
  readonly contentRange: string | null;
  readonly contentEncoding: string | null;
  readonly bodyBytes: number | null;
  readonly redirects: number;
  readonly finalUrl: string;
  readonly errorName: string | null;
  readonly errorCode: string | null;
  readonly problems: readonly string[];
}

export interface ProbeResult {
  readonly url: string;
  readonly size: number;
  readonly ok: boolean;
  readonly category: ProbeDiagnosticCategory;
  /** The largest number of redirects any range request followed. */
  readonly redirects: number;
  readonly ranges: readonly RangeCheck[];
}

export interface ProbeVantageInput {
  readonly tool?: string;
  readonly egress_ip?: string;
  readonly dns_resolver?: string;
  readonly proxy?: string;
  readonly tls_path?: string;
  readonly note?: string;
}

export interface ProbeVantageRecord {
  readonly tool: string;
  readonly egress_ip: string;
  readonly dns_resolver: string;
  readonly proxy: string;
  readonly tls_path: string;
  readonly note?: string;
}

export interface HintsIndexWebSeedObservation {
  readonly url: string;
  readonly final_url: string;
  readonly ok: boolean;
  readonly category: ProbeDiagnosticCategory;
  readonly redirects: number;
  readonly statuses: readonly (number | null)[];
  readonly error_codes: readonly string[];
  readonly interpretation: {
    readonly class: ProbeInterpretationClass;
    readonly note: string;
  };
}

export interface HintsIndexProbeObservation {
  readonly at: string;
  readonly by: string;
  readonly vantage: ProbeVantageRecord;
  readonly limits: string;
  readonly web_seeds: readonly HintsIndexWebSeedObservation[];
}

export interface BuildProbeObservationOptions {
  /** UTC date (YYYY-MM-DD) or timestamp (YYYY-MM-DDTHH:MM:SSZ). */
  readonly at: string;
  /** Non-empty observer label (1..200 chars), e.g. a probe job name. */
  readonly by: string;
  /** Optional explicitly observed vantage facts; omitted fields default to "unknown". */
  readonly vantage?: ProbeVantageInput;
  /** Optional explicit limits note appended to the default single-vantage limit. */
  readonly limits?: string;
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const ISO_DATE_RE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/u;
const ISO_DATETIME_RE = /^([0-9]{4}-[0-9]{2}-[0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})Z$/u;

const DNS_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "EAI_NODATA",
  "EAI_NONAME",
  "EAI_FAIL",
  "EAI_FAMILY",
  "EAI_SERVICE",
  "EAI_SOCKTYPE",
]);

const TLS_CODES = new Set([
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "CERT_REVOKED",
  "CERT_UNTRUSTED",
  "CERT_SIGNATURE_FAILURE",
  "HOSTNAME_MISMATCH",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "ERR_TLS_HANDSHAKE_TIMEOUT",
  "ERR_TLS_INVALID_PROTOCOL_VERSION",
  "ERR_SSL_WRONG_VERSION_NUMBER",
  "ERR_SSL_PROTOCOL_ERROR",
]);

const RESET_CODES = new Set([
  "ECONNRESET",
  "EPIPE",
  "ECONNABORTED",
  "ERR_SOCKET_CLOSED",
  "ERR_STREAM_PREMATURE_CLOSE",
  "UND_ERR_SOCKET",
]);

const TIMEOUT_OR_REFUSED_CODES = new Set([
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "EHOSTDOWN",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
]);

const DEFAULT_OBSERVATION_LIMIT =
  "Single-vantage standard-request observation; cannot by itself distinguish middlebox interference from origin, CDN, or local resolver faults.";

function isValidIsoDate(text: string): boolean {
  const match = ISO_DATE_RE.exec(text);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!;
  return day <= days;
}

function isValidIsoDateTime(text: string): boolean {
  const match = ISO_DATETIME_RE.exec(text);
  if (!match || !isValidIsoDate(match[1]!)) return false;
  return Number(match[2]) <= 23 && Number(match[3]) <= 59 && Number(match[4]) <= 59;
}

function sanitizeToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, 64);
}

interface ExtractedErrorInfo {
  readonly name: string | null;
  readonly code: string | null;
  readonly messages: readonly string[];
  readonly codes: readonly string[];
  readonly names: readonly string[];
}

function extractErrorInfo(error: unknown): ExtractedErrorInfo {
  const names: string[] = [];
  const codes: string[] = [];
  const messages: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current !== null && current !== undefined && !seen.has(current); depth += 1) {
    seen.add(current);
    if (typeof current === "object") {
      const rec = current as Record<string, unknown>;
      const name = sanitizeToken(rec.name);
      if (name) names.push(name);
      const code = sanitizeToken(rec.code);
      if (code) codes.push(code);
      if (typeof rec.message === "string" && rec.message.trim().length > 0) {
        messages.push(rec.message.trim());
      }
      current = rec.cause;
    } else if (typeof current === "string" && current.trim().length > 0) {
      messages.push(current.trim());
      break;
    } else {
      break;
    }
  }
  return {
    name: names[0] ?? null,
    code: codes[0] ?? null,
    messages,
    codes,
    names,
  };
}

/**
 * Classify a thrown error from an injected request handler into a bounded
 * read-only transport category without opening sockets or inspecting raw packets.
 */
export function classifyProbeError(error: unknown): {
  readonly category: "dns_error" | "tls_error" | "connection_reset" | "connection_refused_or_timeout" | "transport_error";
  readonly errorName: string | null;
  readonly errorCode: string | null;
} {
  const info = extractErrorInfo(error);
  const upperCodes = info.codes.map((c) => c.toUpperCase());
  const joinedMessages = info.messages.join(" | ").toLowerCase();

  for (const code of upperCodes) {
    if (DNS_CODES.has(code) || code.startsWith("ERR_DNS_")) {
      return { category: "dns_error", errorName: info.name, errorCode: code };
    }
  }
  for (const code of upperCodes) {
    if (TLS_CODES.has(code) || code.startsWith("ERR_TLS_") || code.startsWith("ERR_SSL_") || code.startsWith("CERT_")) {
      return { category: "tls_error", errorName: info.name, errorCode: code };
    }
  }
  for (const code of upperCodes) {
    if (RESET_CODES.has(code)) {
      return { category: "connection_reset", errorName: info.name, errorCode: code };
    }
  }
  for (const code of upperCodes) {
    if (TIMEOUT_OR_REFUSED_CODES.has(code)) {
      return { category: "connection_refused_or_timeout", errorName: info.name, errorCode: code };
    }
  }
  for (const name of info.names) {
    if (name === "AbortError" || name === "TimeoutError") {
      return { category: "connection_refused_or_timeout", errorName: info.name, errorCode: info.code };
    }
  }

  if (/\b(?:getaddrinfo|enotfound|eai_again|eai_nodata|dns\s+(?:lookup|resolution))\b/u.test(joinedMessages)) {
    return { category: "dns_error", errorName: info.name, errorCode: info.code };
  }
  if (/\b(?:tls|ssl|certificate|x509|self[- ]signed|alpn|handshake\s+failure|bad\s+record\s+mac)\b/u.test(joinedMessages)) {
    return { category: "tls_error", errorName: info.name, errorCode: info.code };
  }
  if (/\b(?:econnreset|connection\s+reset|socket\s+hang\s+up|unexpected\s+eof|epipe)\b/u.test(joinedMessages)) {
    return { category: "connection_reset", errorName: info.name, errorCode: info.code };
  }
  if (/\b(?:econnrefused|connection\s+refused|etimedout|timed?\s*out|enetunreach|ehostunreach)\b/u.test(joinedMessages)) {
    return { category: "connection_refused_or_timeout", errorName: info.name, errorCode: info.code };
  }
  return { category: "transport_error", errorName: info.name, errorCode: info.code };
}

/**
 * Separate bounded interpretation from direct probe observations so single-vantage
 * results never overclaim censorship or remote fault causes.
 */
export function interpretProbeCategory(category: ProbeDiagnosticCategory): {
  readonly class: ProbeInterpretationClass;
  readonly note: string;
} {
  switch (category) {
    case "ok":
      return {
        class: "verified_range_ok",
        note: "Observed 206 Partial Content with exact Content-Range, identity encoding, and exact body lengths from this vantage.",
      };
    case "origin_not_range_capable":
      return {
        class: "origin_or_policy_behavior",
        note: "Origin answered over HTTPS without compliant 206 byte-range framing (e.g. 200 OK static host or mismatched Content-Range).",
      };
    case "content_encoded":
      return {
        class: "origin_or_policy_behavior",
        note: "Origin or intermediary applied a Content-Encoding other than identity despite Accept-Encoding: identity.",
      };
    case "body_length_mismatch":
      return {
        class: "origin_or_policy_behavior",
        note: "HTTP 206 response body length did not match the requested byte range.",
      };
    case "egress_refused":
      return {
        class: "origin_or_policy_behavior",
        note: "Refused locally by caller egress policy (e.g. non-HTTPS scheme, credentials, or disallowed host/address).",
      };
    case "invalid_url":
    case "redirect_missing_location":
    case "redirect_limit":
    case "http_auth_or_forbidden":
    case "http_not_found":
      return {
        class: "origin_or_policy_behavior",
        note: "Observed URL, redirect, authorization, or missing-object response at the target origin.",
      };
    case "http_legal_block":
      return {
        class: "possible_path_or_middlebox_interference",
        note: "Observed HTTP 451 (Unavailable For Legal Reasons); may reflect origin geoblocking or an intermediary block page.",
      };
    case "dns_error":
      return {
        class: "possible_path_or_middlebox_interference",
        note: "DNS resolution failed from this vantage; could be domain misconfiguration, local resolver failure, or DNS filtering.",
      };
    case "tls_error":
      return {
        class: "possible_path_or_middlebox_interference",
        note: "TLS verification or handshake failed; could be an expired/misconfigured origin certificate or an untrusted intermediary.",
      };
    case "connection_reset":
      return {
        class: "possible_path_or_middlebox_interference",
        note: "Connection was reset or closed unexpectedly; consistent with either transient origin/edge drops or path/SNI reset interference.",
      };
    case "connection_refused_or_timeout":
    case "http_server_error":
    case "http_unexpected_status":
    case "transport_error":
      return {
        class: "inconclusive",
        note: "Request did not complete cleanly from this vantage; distinguish transient outage from path blocking only with corroborating vantages.",
      };
  }
}

/** The ranges the probe asks for: the first byte, then one range around the middle. */
export function probeRanges(size: number, midRangeLength = 1024): Array<[number, number]> {
  if (!Number.isSafeInteger(size) || size < 1) throw new Error("size must be a positive integer");
  if (!Number.isSafeInteger(midRangeLength) || midRangeLength < 1) throw new Error("midRangeLength must be a positive integer");
  const first = Math.floor(size / 2);
  const mid: [number, number] = [first, Math.min(first + midRangeLength - 1, size - 1)];
  return mid[0] === 0 ? [[0, 0]] : [[0, 0], mid];
}

function defaultAllow(url: URL): boolean {
  return url.protocol === "https:" && url.username === "" && url.password === "";
}

async function readCapped(response: ProbeResponse, cap: number): Promise<number | null> {
  const reader = response.body?.getReader();
  if (!reader) {
    const length = (await response.arrayBuffer()).byteLength;
    return length > cap ? null : length;
  }
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) return total;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel();
      return null;
    }
  }
}

async function discard(response: ProbeResponse): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // A body that cannot be cancelled is left to the request implementation.
  }
}

function classifyHttpFailure(
  status: number,
  badContentRange: boolean,
  badContentEncoding: boolean,
  badBodyLength: boolean,
): ProbeDiagnosticCategory {
  if (status === 451) return "http_legal_block";
  if (status === 401 || status === 403 || status === 407) return "http_auth_or_forbidden";
  if (status === 404 || status === 410) return "http_not_found";
  if (status === 200 || status === 416) return "origin_not_range_capable";
  if (status >= 500 && status <= 599) return "http_server_error";
  if (status !== 206) return "http_unexpected_status";
  if (badContentEncoding) return "content_encoded";
  if (badContentRange) return "origin_not_range_capable";
  if (badBodyLength) return "body_length_mismatch";
  return "ok";
}

async function checkRange(options: ProbeOptions, first: number, last: number): Promise<RangeCheck> {
  const allow = options.allowUrl ?? defaultAllow;
  const maxRedirects = options.maxRedirects ?? 1;
  const problems: string[] = [];
  let url = options.url;
  let redirects = 0;
  const result = (fields: Partial<RangeCheck> & { readonly category: ProbeDiagnosticCategory }): RangeCheck => ({
    first,
    last,
    ok: false,
    status: null,
    contentRange: null,
    contentEncoding: null,
    bodyBytes: null,
    redirects,
    finalUrl: url,
    errorName: null,
    errorCode: null,
    ...fields,
    problems,
  });
  while (true) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      problems.push(`not a URL: ${url}`);
      return result({ category: "invalid_url" });
    }
    if (!allow(parsed)) {
      problems.push(`refused by the egress policy: ${url}`);
      return result({ category: "egress_refused" });
    }
    let response: ProbeResponse;
    try {
      response = await options.fetch(url, {
        method: "GET",
        headers: { Range: `bytes=${first}-${last}`, "Accept-Encoding": "identity" },
        redirect: "manual",
      });
    } catch (error) {
      const classified = classifyProbeError(error);
      problems.push(`request failed: ${error instanceof Error ? error.message : String(error)}`);
      return result({
        category: classified.category,
        errorName: classified.errorName,
        errorCode: classified.errorCode,
      });
    }
    if (REDIRECTS.has(response.status)) {
      const location = response.headers.get("location");
      await discard(response);
      if (!location) {
        problems.push(`redirect ${response.status} without a Location header`);
        return result({ category: "redirect_missing_location", status: response.status });
      }
      redirects += 1;
      if (redirects > maxRedirects) {
        problems.push(`more than ${maxRedirects} redirect(s)`);
        return result({ category: "redirect_limit", status: response.status });
      }
      try {
        url = new URL(location, url).href;
      } catch {
        problems.push(`invalid redirect Location: ${location}`);
        return result({ category: "invalid_url", status: response.status });
      }
      continue;
    }
    const contentRange = response.headers.get("content-range");
    const contentEncoding = response.headers.get("content-encoding");
    const expectedRange = `bytes ${first}-${last}/${options.size}`;
    const badStatus = response.status !== 206;
    const badContentRange = contentRange !== expectedRange;
    const badContentEncoding = contentEncoding !== null && contentEncoding.trim().toLowerCase() !== "identity";
    if (badStatus) problems.push(`status ${response.status}, not 206 Partial Content`);
    if (badContentRange) problems.push(`Content-Range is ${contentRange ?? "absent"}, not '${expectedRange}'`);
    if (badContentEncoding) {
      problems.push(`Content-Encoding is '${contentEncoding}'`);
    }
    let bodyBytes: number | null = null;
    let badBodyLength = false;
    if (problems.length === 0) {
      bodyBytes = await readCapped(response, last - first + 1);
      if (bodyBytes !== last - first + 1) {
        badBodyLength = true;
        problems.push(`the body is not exactly ${last - first + 1} bytes`);
      }
    } else {
      await discard(response);
    }
    const category = classifyHttpFailure(response.status, badContentRange, badContentEncoding, badBodyLength);
    return result({
      ok: problems.length === 0,
      category,
      status: response.status,
      contentRange,
      contentEncoding,
      bodyBytes,
    });
  }
}

/** Probe one web seed. The result is a dated observation's raw material, never a guarantee. */
export async function probeWebSeed(options: ProbeOptions): Promise<ProbeResult> {
  if (typeof options.fetch !== "function") throw new Error("probeWebSeed needs an explicit fetch function");
  const ranges: RangeCheck[] = [];
  for (const [first, last] of probeRanges(options.size, options.midRangeLength)) {
    ranges.push(await checkRange(options, first, last));
  }
  const firstFailure = ranges.find((range) => !range.ok);
  return {
    url: options.url,
    size: options.size,
    ok: firstFailure === undefined,
    category: firstFailure ? firstFailure.category : "ok",
    redirects: Math.max(...ranges.map((range) => range.redirects)),
    ranges,
  };
}

/**
 * Format one or more ProbeResults into a schema-valid hints-index observation
 * record (docs/specs/transport-hints-v1.schema.json $defs.observation).
 * Follows Xenia's "The observer is also observed" discipline: unobserved vantage
 * fields stay "unknown", and direct observations stay separate from interpretation.
 */
export function buildProbeObservation(
  results: readonly ProbeResult[],
  options: BuildProbeObservationOptions,
): HintsIndexProbeObservation {
  if (!Array.isArray(results) || results.length < 1) {
    throw new Error("buildProbeObservation requires at least one ProbeResult");
  }
  if (!isValidIsoDate(options.at) && !isValidIsoDateTime(options.at)) {
    throw new Error(`at '${options.at}' must be a valid YYYY-MM-DD date or YYYY-MM-DDTHH:MM:SSZ UTC timestamp`);
  }
  const by = options.by.trim();
  if (by.length < 1 || by.length > 200) {
    throw new Error("by must be a non-empty string of at most 200 characters");
  }

  const v = options.vantage;
  const vantage: ProbeVantageRecord = {
    tool: v?.tool?.trim() || "transport-hints-probe/v1",
    egress_ip: v?.egress_ip?.trim() || "unknown",
    dns_resolver: v?.dns_resolver?.trim() || "unknown",
    proxy: v?.proxy?.trim() || "unknown",
    tls_path: v?.tls_path?.trim() || "unknown",
    ...(v?.note?.trim() ? { note: v.note.trim().slice(0, 300) } : {}),
  };

  const web_seeds: HintsIndexWebSeedObservation[] = results.map((res: ProbeResult) => {
    const lastRange = res.ranges[res.ranges.length - 1];
    const errorCodes: string[] = [
      ...new Set(res.ranges.map((r: RangeCheck) => r.errorCode).filter((c: string | null): c is string => c !== null)),
    ];
    return {
      url: res.url,
      final_url: lastRange ? lastRange.finalUrl : res.url,
      ok: res.ok,
      category: res.category,
      redirects: res.redirects,
      statuses: res.ranges.map((r: RangeCheck) => r.status),
      error_codes: errorCodes,
      interpretation: interpretProbeCategory(res.category),
    };
  });

  const extraLimits = options.limits?.trim();
  return {
    at: options.at,
    by,
    vantage,
    limits: extraLimits ? `${DEFAULT_OBSERVATION_LIMIT} ${extraLimits}` : DEFAULT_OBSERVATION_LIMIT,
    web_seeds,
  };
}
