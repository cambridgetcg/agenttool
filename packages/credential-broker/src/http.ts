import { createHash } from "node:crypto";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { AgentCredError } from "./errors.js";
import type { ReservedGrant } from "./grants.js";
import { isPublicAddress, systemResolver } from "./network.js";
import { pathWithinPrefix } from "./policy.js";
import type {
  BrokerHttpRequest,
  BrokerHttpResponse,
  CredentialMaterial,
  CredentialSource,
  HostResolver,
} from "./types.js";

const FORBIDDEN_REQUEST_HEADERS = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "host",
  "connection",
  "content-length",
  "transfer-encoding",
  "upgrade",
  "te",
  "trailer",
  "expect",
  "forwarded",
  "via",
  "accept-encoding",
]);

const ALLOWED_REQUEST_HEADERS = new Set([
  "accept",
  "accept-language",
  "content-type",
  "user-agent",
  "x-agenttool-authority-sequence",
  "x-agenttool-authority-signature",
  "x-agenttool-authority-timestamp",
  "x-agenttool-client",
  "x-agent-id",
  "x-agent-protocol",
  "x-agent-welcome",
  "x-request-id",
  "idempotency-key",
  "mcp-protocol-version",
  "payment-signature",
]);

const ALLOWED_RESPONSE_HEADERS = new Set([
  "content-type",
  "cache-control",
  "etag",
  "last-modified",
  "link",
  "payment-required",
  "payment-response",
  "retry-after",
  "x-credits-balance",
  "x-payment-required",
  "x-payment-response",
  "x-request-id",
  "x-wake-profile",
  "ratelimit-limit",
  "ratelimit-remaining",
  "ratelimit-reset",
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "x-ratelimit-reset",
]);

// The 64 KiB control frame must still hold a maximally sized, base64-encoded
// response body. Bound the JSON-encoded allowlisted header map separately.
const MAX_RESPONSE_HEADERS_JSON_BYTES = 12 * 1024;

export interface OutboundHttpRequest {
  url: URL;
  method: BrokerHttpRequest["method"];
  headers: Record<string, string>;
  body: Buffer;
  pinnedAddress: { address: string; family: 4 | 6 };
  timeoutMs: number;
  maxResponseBytes: number;
  signal?: AbortSignal;
}

export interface OutboundHttpResponse {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}

export interface OutboundTransport {
  send(request: OutboundHttpRequest): Promise<OutboundHttpResponse>;
}

export interface NodeHttpsTransportOptions {
  /** Explicit CA bundle replacing Node's defaults. Omit to use the system trust store. */
  ca?: string | Buffer | readonly (string | Buffer)[];
}

export class NodeHttpsTransport implements OutboundTransport {
  readonly #ca: string | Buffer | (string | Buffer)[] | undefined;

  constructor(options: NodeHttpsTransportOptions = {}) {
    const ca = options.ca;
    this.#ca = ca === undefined || typeof ca === "string" || Buffer.isBuffer(ca) ? ca : [...ca];
  }

  async send(input: OutboundHttpRequest): Promise<OutboundHttpResponse> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let deadline: ReturnType<typeof setTimeout> | undefined;
      let req: ReturnType<typeof httpsRequest> | undefined;
      const chunks: Buffer[] = [];
      const clearDeadline = (): void => {
        if (deadline !== undefined) {
          clearTimeout(deadline);
          deadline = undefined;
        }
      };
      const fail = (error: AgentCredError): void => {
        if (settled) return;
        settled = true;
        clearDeadline();
        if (req && !req.destroyed) req.destroy();
        for (const chunk of chunks) chunk.fill(0);
        chunks.length = 0;
        reject(error);
      };
      const tlsHostname = input.url.hostname.replace(/^\[|\]$/g, "");
      req = httpsRequest(
        input.url,
        {
          method: input.method,
          headers: input.headers,
          // Never let the process-wide Agent reuse a socket selected by a
          // different lookup callback. Each use gets a fresh connection to
          // the address that was validated and pinned for this request.
          agent: false,
          family: input.pinnedAddress.family,
          rejectUnauthorized: true,
          ...(this.#ca !== undefined ? { ca: this.#ca } : {}),
          ...(isIP(tlsHostname) === 0 ? { servername: tlsHostname } : {}),
          ...(input.signal ? { signal: input.signal } : {}),
          lookup: (_hostname, _options, callback) => {
            callback(null, input.pinnedAddress.address, input.pinnedAddress.family);
          },
        },
        (response) => {
          const status = response.statusCode ?? 0;
          if (status >= 300 && status < 400) {
            // Do not drain an attacker-controlled redirect body: it may never
            // end and would outlive the broker's in-flight accounting.
            response.destroy();
            fail(new AgentCredError("scope_denied", "Redirect responses are not followed."));
            return;
          }
          const encoding = response.headers["content-encoding"];
          if (encoding && encoding !== "identity") {
            // Compression is outside this bounded profile. Tear down the
            // socket so an infinite encoded body cannot continue in the
            // background after this promise rejects.
            response.destroy();
            fail(new AgentCredError("request_failed", "Compressed responses are not accepted."));
            return;
          }
          const declaredLength = Number(response.headers["content-length"] ?? 0);
          if (Number.isFinite(declaredLength) && declaredLength > input.maxResponseBytes) {
            response.destroy();
            fail(new AgentCredError("response_too_large", "Response exceeds the grant limit."));
            return;
          }
          let size = 0;
          response.on("data", (chunk: Buffer) => {
            size += chunk.byteLength;
            if (size > input.maxResponseBytes) {
              response.destroy();
              fail(new AgentCredError("response_too_large", "Response exceeds the grant limit."));
              return;
            }
            chunks.push(Buffer.from(chunk));
          });
          response.once("error", () => fail(new AgentCredError("request_failed", "Upstream response failed.")));
          response.once("end", () => {
            if (settled) return;
            settled = true;
            clearDeadline();
            const headers: Record<string, string> = {};
            for (const [name, value] of Object.entries(response.headers)) {
              if (value === undefined) continue;
              headers[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
            }
            const body = Buffer.concat(chunks);
            for (const item of chunks) item.fill(0);
            resolve({ status, headers, body });
          });
        },
      );
      deadline = setTimeout(() => {
        fail(new AgentCredError("request_failed", "Upstream request timed out."));
      }, input.timeoutMs);
      deadline.unref?.();
      try {
        req.setTimeout(input.timeoutMs, () => {
          fail(new AgentCredError("request_failed", "Upstream request timed out."));
        });
        req.once("error", () => fail(new AgentCredError("request_failed", "Upstream request failed.")));
        if (input.body.byteLength > 0) req.write(input.body);
        req.end();
      } catch {
        fail(new AgentCredError("request_failed", "Upstream request failed."));
      }
    });
  }
}

function strictBase64(input: string | undefined): Buffer {
  if (input === undefined) return Buffer.alloc(0);
  if (input.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input)) {
    throw new AgentCredError("invalid_request", "Request body is not canonical base64.");
  }
  const value = Buffer.from(input, "base64");
  if (value.toString("base64") !== input) {
    value.fill(0);
    throw new AgentCredError("invalid_request", "Request body is not canonical base64.");
  }
  return value;
}

function requestsEventStream(headers: Record<string, string>): boolean {
  return (headers.accept ?? "")
    .split(",")
    .some((item) => item.trim().split(";", 1)[0]?.toLowerCase() === "text/event-stream");
}

export function validateBrokerHttpRequest(
  grant: Pick<ReservedGrant, "request">,
  request: BrokerHttpRequest,
): void {
  const url = normalizeTarget(request.url);
  const scope = grant.request.scope;
  if (
    url.origin !== scope.origin ||
    !scope.methods.includes(request.method) ||
    !scope.pathPrefixes.some((prefix) => pathWithinPrefix(url.pathname, prefix)) ||
    [...url.searchParams.keys()].some((name) => !(scope.queryNames ?? []).includes(name))
  ) {
    throw new AgentCredError("scope_denied", "HTTP request is outside the granted scope.");
  }
  const mutating = !["GET", "HEAD"].includes(request.method);
  if (mutating && !request.idempotencyKey) {
    throw new AgentCredError("invalid_request", "State-changing requests require an idempotency key.");
  }
  if (
    request.idempotencyKey !== undefined &&
    (typeof request.idempotencyKey !== "string" ||
      request.idempotencyKey.length > 256 ||
      /[\0\r\n]/.test(request.idempotencyKey))
  ) {
    throw new AgentCredError("invalid_request", "Idempotency key is not a valid header value.");
  }
  const body = strictBase64(request.bodyBase64);
  try {
    if (
      body.byteLength > (scope.maxRequestBytes ?? 0) ||
      (["GET", "HEAD"].includes(request.method) && body.byteLength > 0)
    ) {
      throw new AgentCredError("scope_denied", "Request body exceeds the granted boundary.");
    }
    const headers = validateHeaders(request.headers);
    if (requestsEventStream(headers)) {
      throw new AgentCredError("unsupported", "Streaming responses are not supported by agentcred/0.1.");
    }
    const agentId = headers["x-agent-id"];
    if (
      agentId !== undefined &&
      !(scope.headerValues?.["x-agent-id"] ?? []).includes(agentId)
    ) {
      throw new AgentCredError("scope_denied", "Authority-sensitive header value is not granted.");
    }
    if (
      headers["payment-signature"] !== undefined &&
      scope.allowPaymentSignature !== true
    ) {
      throw new AgentCredError("scope_denied", "PAYMENT-SIGNATURE is not granted.");
    }
    if (
      headers["idempotency-key"] !== undefined &&
      headers["idempotency-key"] !== request.idempotencyKey
    ) {
      throw new AgentCredError("invalid_request", "Idempotency key fields do not match.");
    }
  } finally {
    body.fill(0);
  }
}

function normalizeTarget(raw: string): URL {
  if (raw.includes("\\") || /[\0\r\n]/.test(raw) || /%(?:00|25|2e|2f|5c)/i.test(raw)) {
    throw new AgentCredError("scope_denied", "Target URL is outside the strict canonical profile.");
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AgentCredError("invalid_request", "Target is not a valid URL.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash || url.hostname.endsWith(".")) {
    throw new AgentCredError("scope_denied", "Target URL is not allowed.");
  }
  return url;
}

function validateHeaders(input: Record<string, string> | undefined): Record<string, string> {
  const output: Record<string, string> = {};
  const seen = new Set<string>();
  for (const [rawName, value] of Object.entries(input ?? {})) {
    const name = rawName.toLowerCase();
    if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(name) || /[\0\r\n]/.test(value)) {
      throw new AgentCredError("invalid_request", "Request contains an invalid header.");
    }
    if (
      seen.has(name) ||
      FORBIDDEN_REQUEST_HEADERS.has(name) ||
      name.startsWith("x-forwarded-") ||
      !ALLOWED_REQUEST_HEADERS.has(name)
    ) {
      throw new AgentCredError("scope_denied", "Request header is not allowed.");
    }
    seen.add(name);
    output[name] = value;
  }
  output["accept-encoding"] = "identity";
  return output;
}

export function validateCredentialAuth(auth: CredentialMaterial["auth"]): void {
  if (!auth || !["bearer", "header"].includes(auth.kind)) {
    throw new AgentCredError("backend_unavailable", "Credential auth mapping is invalid.");
  }
  if (
    auth.prefix !== undefined &&
    (typeof auth.prefix !== "string" || auth.prefix.length > 1024 || /[\0\r\n]/.test(auth.prefix))
  ) {
    throw new AgentCredError("backend_unavailable", "Credential auth mapping is invalid.");
  }
  if (auth.kind === "bearer") {
    if (auth.headerName !== undefined) {
      throw new AgentCredError("backend_unavailable", "Credential auth mapping is invalid.");
    }
    return;
  }
  const name = auth.headerName?.toLowerCase();
  if (
    !name ||
    !/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(name) ||
    FORBIDDEN_REQUEST_HEADERS.has(name) ||
    ALLOWED_REQUEST_HEADERS.has(name) ||
    name.startsWith("x-forwarded-")
  ) {
    throw new AgentCredError("backend_unavailable", "Credential auth mapping is invalid.");
  }
}

function injectCredential(headers: Record<string, string>, material: CredentialMaterial): Buffer {
  validateCredentialAuth(material.auth);
  const secret = Buffer.from(material.value);
  const value = secret.toString("utf8");
  const canonical = Buffer.from(value, "utf8");
  const isCanonicalUtf8 = canonical.equals(secret);
  canonical.fill(0);
  // Node serializes request-header strings through a single-byte wire path.
  // Requiring printable ASCII prevents a valid non-ASCII UTF-8 credential
  // from changing bytes between injection and exact-byte redaction.
  const isPrintableAscii = secret.every((byte) => byte >= 0x20 && byte <= 0x7e);
  if (!isCanonicalUtf8 || !isPrintableAscii || !value) {
    secret.fill(0);
    throw new AgentCredError("backend_unavailable", "Credential backend returned an invalid value.");
  }
  if (material.auth.kind === "bearer") {
    const headerValue = `${material.auth.prefix ?? "Bearer "}${value}`;
    if (Buffer.byteLength(headerValue) > 16 * 1024) {
      secret.fill(0);
      throw new AgentCredError("backend_unavailable", "Credential auth mapping is invalid.");
    }
    headers.authorization = headerValue;
    return secret;
  }
  const name = material.auth.headerName!.toLowerCase();
  const headerValue = `${material.auth.prefix ?? ""}${value}`;
  if (Buffer.byteLength(headerValue) > 16 * 1024) {
    secret.fill(0);
    throw new AgentCredError("backend_unavailable", "Credential auth mapping is invalid.");
  }
  headers[name] = headerValue;
  return secret;
}

function replaceAllBytes(input: Buffer, needle: Buffer): { output: Buffer; count: number } {
  if (needle.byteLength === 0) return { output: Buffer.from(input), count: 0 };
  const replacement = Buffer.from("[REDACTED]", "utf8");
  const pieces: Buffer[] = [];
  let start = 0;
  let count = 0;
  for (;;) {
    const index = input.indexOf(needle, start);
    if (index < 0) break;
    pieces.push(input.subarray(start, index), replacement);
    start = index + needle.length;
    count += 1;
  }
  pieces.push(input.subarray(start));
  const output = Buffer.concat(pieces);
  replacement.fill(0);
  return { output, count };
}

async function resolvePinned(
  url: URL,
  allowPrivateNetwork: boolean,
  resolver: HostResolver,
  signal?: AbortSignal,
): Promise<{ address: string; family: 4 | 6 }> {
  if (signal?.aborted) {
    throw new AgentCredError("request_failed", "Credentialed operation was cancelled.");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  let answers: ReadonlyArray<{ address: string; family: 4 | 6 }>;
  const family = isIP(hostname);
  if (family === 4 || family === 6) {
    answers = [{ address: hostname, family }];
  } else {
    try {
      answers = await resolver.resolve(hostname, signal);
    } catch {
      throw new AgentCredError("network_denied", "Target DNS resolution failed.");
    }
  }
  if (signal?.aborted) {
    throw new AgentCredError("request_failed", "Credentialed operation was cancelled.");
  }
  if (answers.length === 0 || (!allowPrivateNetwork && answers.some(({ address }) => !isPublicAddress(address)))) {
    throw new AgentCredError("network_denied", "Target resolves outside the allowed network boundary.");
  }
  return answers[0]!;
}

export interface BrokerHttpDependencies {
  credentials: CredentialSource;
  resolver?: HostResolver;
  transport?: OutboundTransport;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export async function performBrokerHttp(
  grant: ReservedGrant,
  request: BrokerHttpRequest,
  auditId: string,
  dependencies: BrokerHttpDependencies,
): Promise<BrokerHttpResponse> {
  const url = normalizeTarget(request.url);
  const scope = grant.request.scope;
  validateBrokerHttpRequest(grant, request);
  const body = strictBase64(request.bodyBase64);
  let headers: Record<string, string>;
  let pinnedAddress: { address: string; family: 4 | 6 };
  try {
    if (body.byteLength > (scope.maxRequestBytes ?? 0) || (["GET", "HEAD"].includes(request.method) && body.byteLength > 0)) {
      throw new AgentCredError("scope_denied", "Request body exceeds the granted boundary.");
    }
    headers = validateHeaders(request.headers);
    if (request.idempotencyKey) headers["idempotency-key"] = request.idempotencyKey;
    pinnedAddress = await resolvePinned(
      url,
      scope.allowPrivateNetwork ?? false,
      dependencies.resolver ?? systemResolver,
      dependencies.signal,
    );
  } catch (error) {
    body.fill(0);
    throw error;
  }

  try {
    return await dependencies.credentials.withCredential(grant.request.credential, async (material) => {
      const secret = injectCredential(headers, material);
      try {
        const response = await (dependencies.transport ?? new NodeHttpsTransport()).send({
          url,
          method: request.method,
          headers,
          body,
          pinnedAddress,
          timeoutMs: dependencies.timeoutMs ?? 30_000,
          maxResponseBytes: scope.maxResponseBytes ?? 0,
          signal: dependencies.signal,
        });
        if (response.status >= 300 && response.status < 400) {
          response.body.fill(0);
          throw new AgentCredError("scope_denied", "Redirect responses are not followed.");
        }
        if (response.body.byteLength > (scope.maxResponseBytes ?? 0)) {
          response.body.fill(0);
          throw new AgentCredError("response_too_large", "Response exceeds the grant limit.");
        }
        const redacted = replaceAllBytes(response.body, secret);
        response.body.fill(0);
        const safeHeaders: Record<string, string> = {};
        let headerRedactions = 0;
        try {
          if (redacted.output.byteLength > (scope.maxResponseBytes ?? 0)) {
            throw new AgentCredError(
              "response_too_large",
              "Redacted response exceeds the grant limit.",
            );
          }
          for (const [name, value] of Object.entries(response.headers)) {
            const normalized = name.toLowerCase();
            if (!ALLOWED_RESPONSE_HEADERS.has(normalized)) continue;
            const rawHeader = Buffer.from(value, "utf8");
            try {
              const item = replaceAllBytes(rawHeader, secret);
              safeHeaders[normalized] = item.output.toString("utf8");
              headerRedactions += item.count;
              item.output.fill(0);
            } finally {
              rawHeader.fill(0);
            }
          }
          if (
            Buffer.byteLength(JSON.stringify(safeHeaders), "utf8") >
            MAX_RESPONSE_HEADERS_JSON_BYTES
          ) {
            throw new AgentCredError(
              "response_too_large",
              "Response headers exceed the broker limit.",
            );
          }
          return {
            status: response.status,
            headers: safeHeaders,
            bodyBase64: redacted.output.toString("base64"),
            auditId,
            redactions: redacted.count + headerRedactions,
          } satisfies BrokerHttpResponse;
        } finally {
          redacted.output.fill(0);
        }
      } finally {
        secret.fill(0);
        for (const name of Object.keys(headers)) headers[name] = "";
      }
    }, dependencies.signal);
  } finally {
    body.fill(0);
  }
}

export function hashTargetPath(pathname: string): string {
  return createHash("sha256").update(pathname).digest("hex");
}
