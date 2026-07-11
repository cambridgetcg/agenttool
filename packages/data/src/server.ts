/**
 * Loopback-oriented HTTP transport and dedicated node bearer boundary.
 * Doctrine: docs/AGENT-DATA-PROTOCOL.md
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { DataNodeError, invariant } from "./errors.js";
import type {
  ChangesRequest,
  CollectRequest,
  DataNodeServerOptions,
  JsonObject,
  QueryRequest,
} from "./types.js";
import type { DataNode } from "./node.js";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
} as const;

export function createDataNodeFetchHandler(
  node: DataNode,
  options: Pick<DataNodeServerOptions, "node_bearer" | "max_body_bytes"> = {},
): (request: Request) => Promise<Response> {
  const maxBodyBytes = options.max_body_bytes ?? node.limits.max_body_bytes;
  invariant(
    Number.isSafeInteger(maxBodyBytes) && maxBodyBytes > 0,
    "invalid_server_option",
    "max_body_bytes must be a positive integer",
  );
  if (options.node_bearer !== undefined) {
    invariant(
      typeof options.node_bearer === "string" && options.node_bearer.length > 0,
      "invalid_server_option",
      "node_bearer must be a non-empty string",
    );
  }

  return async (request: Request): Promise<Response> => {
    try {
      const url = new URL(request.url);
      const path = url.pathname;
      const baseUrl = url.origin;

      if ((path === "/.well-known/agent-data" || path === "/v1/data/manifest") && request.method === "GET") {
        return json(node.manifest(baseUrl));
      }
      if (path.startsWith("/v1/data/")) requireDataAuth(request, options.node_bearer);
      if (path === "/v1/data/collections" && request.method === "GET") {
        return json({ collections: node.listCollections() });
      }
      if (path === "/v1/data/collect" && request.method === "POST") {
        const body = await readJsonObject(request, maxBodyBytes);
        return json(await node.collect(body as unknown as CollectRequest, request.signal));
      }
      if (path === "/v1/data/query" && request.method === "POST") {
        const body = await readJsonObject(request, maxBodyBytes);
        return json(node.query(body as unknown as QueryRequest));
      }
      if (path === "/v1/data/changes" && request.method === "GET") {
        const changesRequest: ChangesRequest = {
          ...(url.searchParams.has("collection_id")
            ? { collection_id: url.searchParams.get("collection_id")! }
            : {}),
          ...(url.searchParams.has("cursor") ? { cursor: url.searchParams.get("cursor")! } : {}),
          ...(url.searchParams.has("limit")
            ? { limit: parsePositiveInteger(url.searchParams.get("limit")!, "limit") }
            : {}),
        };
        return json(node.changes(changesRequest));
      }

      const tombstoneMatch = /^\/v1\/data\/records\/([^/]+)\/tombstone$/.exec(path);
      if (tombstoneMatch && request.method === "POST") {
        const body = await readJsonObject(request, maxBodyBytes);
        const reason = body.reason;
        invariant(reason === undefined || typeof reason === "string", "invalid_request", "reason must be a string");
        const tombstone = await node.tombstone(decodePathSegment(tombstoneMatch[1]!), reason as string | undefined);
        return json({ record_id: tombstone.record_id, tombstoned: true, tombstone });
      }

      const recordMatch = /^\/v1\/data\/records\/([^/]+)$/.exec(path);
      if (recordMatch && request.method === "GET") {
        return json(await node.resolveRecord(decodePathSegment(recordMatch[1]!)));
      }

      const knownPath = path === "/.well-known/agent-data"
        || path === "/v1/data/manifest"
        || path === "/v1/data/collections"
        || path === "/v1/data/collect"
        || path === "/v1/data/query"
        || path === "/v1/data/changes"
        || Boolean(tombstoneMatch)
        || Boolean(recordMatch);
      if (knownPath) {
        return errorResponse(new DataNodeError("method_not_allowed", "Method is not allowed for this endpoint", 405));
      }
      return errorResponse(new DataNodeError("not_found", "Endpoint was not found", 404));
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export function serveDataNode(
  node: DataNode,
  options: DataNodeServerOptions = {},
): Bun.Server<undefined> {
  const hostname = options.hostname ?? "127.0.0.1";
  const port = options.port ?? 7742;
  invariant(typeof hostname === "string" && hostname.length > 0, "invalid_server_option", "hostname is required");
  invariant(Number.isSafeInteger(port) && port >= 0 && port <= 65535, "invalid_server_option", "port must be between 0 and 65535");
  if (!isLoopbackHostname(hostname) && !options.node_bearer) {
    throw new DataNodeError(
      "unsafe_server_bind",
      "A non-loopback bind requires a dedicated node bearer",
      400,
    );
  }
  const maxBodyBytes = options.max_body_bytes ?? node.limits.max_body_bytes;
  return Bun.serve({
    hostname,
    port,
    maxRequestBodySize: maxBodyBytes,
    fetch: createDataNodeFetchHandler(node, options),
  });
}

function requireDataAuth(request: Request, expected: string | undefined): void {
  if (!expected) {
    throw new DataNodeError(
      "data_auth_not_configured",
      "HTTP data access is disabled until a dedicated node bearer is configured",
      503,
    );
  }
  const authorization = request.headers.get("authorization");
  const match = /^Bearer (.+)$/i.exec(authorization ?? "");
  if (!match || !safeTokenEqual(match[1]!, expected)) {
    throw new DataNodeError("unauthorized", "A valid node bearer is required", 401);
  }
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  return normalized === "localhost" || normalized === "::1" || /^127(?:\.\d{1,3}){3}$/.test(normalized);
}

function safeTokenEqual(actual: string, expected: string): boolean {
  const actualHash = createHash("sha256").update(actual).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(new Uint8Array(actualHash), new Uint8Array(expectedHash));
}

async function readJsonObject(request: Request, maxBytes: number): Promise<JsonObject> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new DataNodeError("unsupported_media_type", "Request Content-Type must be application/json", 415);
  }
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const declared = Number(contentLength);
    if (!Number.isSafeInteger(declared) || declared < 0) {
      throw new DataNodeError("invalid_content_length", "Content-Length is invalid", 400);
    }
    if (declared > maxBytes) throw requestTooLarge(maxBytes);
  }
  const bytes = await readBoundedRequest(request.body, maxBytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new DataNodeError("invalid_json", "Request body must contain valid UTF-8 JSON", 400);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new DataNodeError("invalid_json", "Request body must be a JSON object", 400);
  }
  return parsed as JsonObject;
}

async function readBoundedRequest(body: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<Uint8Array> {
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
        throw requestTooLarge(maxBytes);
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

function requestTooLarge(maxBytes: number): DataNodeError {
  return new DataNodeError("request_too_large", `Request body exceeds the ${maxBytes}-byte limit`, 413);
}

function parsePositiveInteger(value: string, field: string): number {
  if (!/^\d+$/.test(value)) throw new DataNodeError("invalid_query", `${field} must be a positive integer`, 400);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new DataNodeError("invalid_query", `${field} must be a positive integer`, 400);
  }
  return number;
}

function decodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new DataNodeError("invalid_path", "Path contains invalid percent encoding", 400);
  }
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS });
}

function errorResponse(error: unknown): Response {
  const known = error instanceof DataNodeError
    ? error
    : new DataNodeError("internal_error", "The data node could not complete the request", 500);
  const headers = new Headers(JSON_HEADERS);
  if (known.status === 401) headers.set("www-authenticate", 'Bearer realm="agent-data-node"');
  return new Response(JSON.stringify({
    error: known.code,
    message: known.message,
    ...(known.details ? { details: known.details } : {}),
  }), { status: known.status, headers });
}
