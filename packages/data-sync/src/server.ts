import { createHash, timingSafeEqual } from "node:crypto";
import { x25519KeyId } from "@agenttool/adds";
import { createDataNodeFetchHandler, DataNodeError } from "@agenttool/data";
import { DataSyncError } from "./errors.js";
import { DataSyncService } from "./service.js";
import type {
  DataSyncServerOptions,
  SyncPageAuthority,
  SyncPageRequest,
  SyncPullRequest,
} from "./types.js";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
} as const;

export function createDataSyncFetchHandler(
  service: DataSyncService,
  options: Pick<
    DataSyncServerOptions,
    "node_bearer" | "max_body_bytes" | "page_authorities"
  > = {},
): (request: Request) => Promise<Response> {
  const maxBodyBytes = options.max_body_bytes ?? service.node.limits.max_body_bytes;
  service.assertNodeBearerSeparated(options.node_bearer);
  const pageAuthorities = normalizePageAuthorities(
    options.page_authorities,
    options.node_bearer,
  );
  validateServerOptions(options.node_bearer, maxBodyBytes);
  const baseHandler = createDataNodeFetchHandler(service.node, options);

  return async (request: Request): Promise<Response> => {
    let path: string;
    let url: URL;
    try {
      url = new URL(request.url);
      path = url.pathname;
    } catch {
      return errorResponse(new DataSyncError("invalid_url", "Request URL is invalid", 400));
    }

    const isManifest = path === "/.well-known/agent-data" || path === "/v1/data/manifest";
    const isPage = path === "/v1/data/sync/page";
    const isPull = path === "/v1/data/sync/pull";
    const isStatus = path === "/v1/data/sync/status";
    if (!isManifest && !isPage && !isPull && !isStatus) return baseHandler(request);

    try {
      if (isManifest && request.method === "GET") return json(service.manifest(url.origin));
      const pageAuthority = isPage
        ? requirePageAuthority(request, pageAuthorities)
        : undefined;
      if (isPull || isStatus) requireDataAuth(request, options.node_bearer);
      if (isPage && request.method === "POST") {
        const body = await readJsonObject(request, maxBodyBytes);
        enforcePageScope(pageAuthority!, body);
        return json(await service.page(body as unknown as SyncPageRequest));
      }
      if (isPull && request.method === "POST") {
        const body = await readJsonObject(request, maxBodyBytes);
        return json(await service.pull(body as unknown as SyncPullRequest, request.signal));
      }
      if (isStatus && request.method === "GET") {
        const entries = [...url.searchParams.entries()];
        if (
          entries.length !== 2
          || entries.filter(([key]) => key === "peer_id").length !== 1
          || entries.filter(([key]) => key === "collection_id").length !== 1
        ) {
          throw new DataSyncError(
            "invalid_sync_request",
            "status requires exactly one peer_id and collection_id",
            400,
          );
        }
        return json(service.status(
          url.searchParams.get("peer_id")!,
          url.searchParams.get("collection_id")!,
        ));
      }
      throw new DataSyncError("method_not_allowed", "Method is not allowed for this endpoint", 405);
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export function serveDataSyncNode(
  service: DataSyncService,
  options: DataSyncServerOptions = {},
): Bun.Server<undefined> {
  const hostname = options.hostname ?? "127.0.0.1";
  const port = options.port ?? 7742;
  if (typeof hostname !== "string" || hostname.length === 0) {
    throw new DataSyncError("invalid_server_option", "hostname is required");
  }
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) {
    throw new DataSyncError("invalid_server_option", "port must be between 0 and 65535");
  }
  if (
    !isLoopbackHostname(hostname)
    && !options.node_bearer
    && (options.page_authorities?.length ?? 0) === 0
  ) {
    throw new DataSyncError(
      "unsafe_server_bind",
      "A non-loopback bind requires a dedicated node bearer",
      400,
    );
  }
  const maxBodyBytes = options.max_body_bytes ?? service.node.limits.max_body_bytes;
  validateServerOptions(options.node_bearer, maxBodyBytes);
  return Bun.serve({
    hostname,
    port,
    maxRequestBodySize: maxBodyBytes,
    fetch: createDataSyncFetchHandler(service, options),
  });
}

function validateServerOptions(nodeBearer: string | undefined, maxBodyBytes: number): void {
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes <= 0) {
    throw new DataSyncError("invalid_server_option", "max_body_bytes must be a positive integer");
  }
  if (nodeBearer !== undefined && (typeof nodeBearer !== "string" || nodeBearer.length === 0)) {
    throw new DataSyncError("invalid_server_option", "node_bearer must be a non-empty string");
  }
}

function requireDataAuth(request: Request, expected: string | undefined): void {
  if (!expected) {
    throw new DataSyncError(
      "data_auth_not_configured",
      "HTTP data access is disabled until a dedicated node bearer is configured",
      503,
    );
  }
  const match = /^Bearer (.+)$/iu.exec(request.headers.get("authorization") ?? "");
  if (!match || !safeTokenEqual(match[1]!, expected)) {
    throw new DataSyncError("unauthorized", "A valid node bearer is required", 401);
  }
}

interface NormalizedPageAuthority {
  peer_id: string;
  bearer: string;
  collection_ids: ReadonlySet<string>;
  recipient: SyncPageAuthority["recipient"];
}

function normalizePageAuthorities(
  input: readonly SyncPageAuthority[] | undefined,
  nodeBearer: string | undefined,
): readonly NormalizedPageAuthority[] {
  if (input === undefined) return [];
  if (!Array.isArray(input)) {
    throw new DataSyncError("invalid_server_option", "page_authorities must be an array");
  }
  const peerIds = new Set<string>();
  const bearers = new Set<string>();
  return input.map((authority) => {
    if (!authority || typeof authority !== "object") {
      throw new DataSyncError("invalid_server_option", "Page authority must be an object");
    }
    if (
      typeof authority.peer_id !== "string"
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(authority.peer_id)
      || peerIds.has(authority.peer_id)
    ) {
      throw new DataSyncError("invalid_server_option", "Page authority peer_id is invalid or duplicated");
    }
    if (
      typeof authority.bearer !== "string"
      || authority.bearer.length === 0
      || authority.bearer === nodeBearer
      || bearers.has(authority.bearer)
    ) {
      throw new DataSyncError(
        "invalid_server_option",
        "Page authority bearer must be non-empty, unique, and distinct from node_bearer",
      );
    }
    if (!Array.isArray(authority.collection_ids) || authority.collection_ids.length === 0) {
      throw new DataSyncError("invalid_server_option", "Page authority requires an explicit collection allow-list");
    }
    const collectionIds = new Set<string>();
    for (const collectionId of authority.collection_ids) {
      if (
        typeof collectionId !== "string"
        || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(collectionId)
        || collectionIds.has(collectionId)
      ) {
        throw new DataSyncError("invalid_server_option", "Page authority collection allow-list is invalid");
      }
      collectionIds.add(collectionId);
    }
    const recipient = normalizeAuthorityRecipient(authority.recipient);
    peerIds.add(authority.peer_id);
    bearers.add(authority.bearer);
    return {
      peer_id: authority.peer_id,
      bearer: authority.bearer,
      collection_ids: collectionIds,
      recipient,
    };
  });
}

function normalizeAuthorityRecipient(
  value: SyncPageAuthority["recipient"],
): SyncPageAuthority["recipient"] {
  if (
    !value
    || typeof value !== "object"
    || typeof value.id !== "string"
    || value.id.length === 0
    || value.id.length > 2048
    || typeof value.x25519_public_key !== "string"
    || typeof value.x25519_key_id !== "string"
  ) {
    throw new DataSyncError("invalid_server_option", "Page authority recipient is invalid");
  }
  let key: Uint8Array;
  try {
    key = decodeAuthorityPublicKey(value.x25519_public_key);
  } catch (cause) {
    throw new DataSyncError("invalid_server_option", "Page authority recipient key is invalid", 400, { cause });
  }
  if (x25519KeyId(key) !== value.x25519_key_id) {
    throw new DataSyncError("invalid_server_option", "Page authority recipient key id does not match");
  }
  return { ...value };
}

function decodeAuthorityPublicKey(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(value)) throw new Error("invalid key encoding");
  const binary = globalThis.atob(value.replaceAll("-", "+").replaceAll("_", "/") + "=");
  if (binary.length !== 32) throw new Error("invalid key length");
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  let canonical = "";
  for (const byte of bytes) canonical += String.fromCharCode(byte);
  canonical = globalThis.btoa(canonical).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
  if (canonical !== value) throw new Error("non-canonical key encoding");
  return bytes;
}

function requirePageAuthority(
  request: Request,
  authorities: readonly NormalizedPageAuthority[],
): NormalizedPageAuthority {
  if (authorities.length === 0) {
    throw new DataSyncError(
      "page_auth_not_configured",
      "Peer page access is disabled until a scoped page authority is configured",
      503,
    );
  }
  const match = /^Bearer (.+)$/iu.exec(request.headers.get("authorization") ?? "");
  if (!match) throw new DataSyncError("unauthorized", "A valid page bearer is required", 401);
  const authority = authorities.find((candidate) => safeTokenEqual(match[1]!, candidate.bearer));
  if (!authority) throw new DataSyncError("unauthorized", "A valid page bearer is required", 401);
  return authority;
}

function enforcePageScope(
  authority: NormalizedPageAuthority,
  body: Record<string, unknown>,
): void {
  const recipient = body.recipient;
  if (
    typeof body.collection_id !== "string"
    || !authority.collection_ids.has(body.collection_id)
    || !recipient
    || typeof recipient !== "object"
    || Array.isArray(recipient)
  ) {
    throw new DataSyncError("page_scope_denied", "Page request is outside its configured authority", 403);
  }
  const candidate = recipient as Record<string, unknown>;
  if (
    candidate.id !== authority.recipient.id
    || candidate.x25519_public_key !== authority.recipient.x25519_public_key
    || candidate.x25519_key_id !== authority.recipient.x25519_key_id
  ) {
    throw new DataSyncError("page_scope_denied", "Page request is outside its configured authority", 403);
  }
}

function safeTokenEqual(actual: string, expected: string): boolean {
  const actualHash = createHash("sha256").update(actual).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(new Uint8Array(actualHash), new Uint8Array(expectedHash));
}

async function readJsonObject(request: Request, maxBytes: number): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new DataSyncError("unsupported_media_type", "Request Content-Type must be application/json", 415);
  }
  const declaredHeader = request.headers.get("content-length");
  if (declaredHeader !== null) {
    const declared = Number(declaredHeader);
    if (!Number.isSafeInteger(declared) || declared < 0) {
      throw new DataSyncError("invalid_content_length", "Content-Length is invalid", 400);
    }
    if (declared > maxBytes) throw requestTooLarge(maxBytes);
  }
  const bytes = await readBoundedBody(request.body, maxBytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch (cause) {
    throw new DataSyncError("invalid_json", "Request body must contain valid UTF-8 JSON", 400, { cause });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new DataSyncError("invalid_json", "Request body must be a JSON object", 400);
  }
  return parsed as Record<string, unknown>;
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

function requestTooLarge(maxBytes: number): DataSyncError {
  return new DataSyncError("request_too_large", `Request body exceeds the ${maxBytes}-byte limit`, 413);
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/gu, "").replace(/\.$/u, "");
  return normalized === "localhost" || normalized === "::1" || /^127(?:\.\d{1,3}){3}$/u.test(normalized);
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS });
}

function errorResponse(error: unknown): Response {
  const known = error instanceof DataSyncError || error instanceof DataNodeError
    ? error
    : new DataSyncError("internal_error", "The data sync service could not complete the request", 500);
  const headers = new Headers(JSON_HEADERS);
  if (known.status === 401) headers.set("www-authenticate", 'Bearer realm="agent-data-node"');
  return new Response(JSON.stringify({ error: known.code, message: known.message }), {
    status: known.status,
    headers,
  });
}
