/**
 * Thin client for a separately operated agent-data/v1 node.
 *
 * The data node is a distinct security boundary from api.agenttool.dev.
 * This client therefore owns its base URL, timeout, and optional bearer;
 * callers must never pass the AgentTool project bearer to it implicitly.
 *
 * Protocol: agent-data/v1
 */

import { AgentToolError } from "./errors.js";

export const AGENT_DATA_PROTOCOL = "agent-data/v1" as const;
export const AGENT_DATA_SYNC_PROTOCOL = "agent-data-sync/v1" as const;
export const AGENT_DATA_DISCOVERY_PATH = "/.well-known/agent-data" as const;

/** Connection settings for an independently configured data node. */
export interface DataNodeOptions {
  baseUrl: string;
  /** Optional data-node bearer. This is not the AgentTool API bearer. */
  token?: string;
  /** Request timeout in seconds. Defaults to 30. */
  timeout?: number;
}

/** Forward-compatible manifest returned by `GET /v1/data/manifest`. */
export interface DataManifest {
  protocol?: string;
  [key: string]: unknown;
}

/** Forward-compatible collection descriptor. */
export interface DataCollection {
  id?: string;
  collection_id?: string;
  [key: string]: unknown;
}

/** Forward-compatible collection-list response. */
export interface DataCollectionsResult {
  collections?: DataCollection[];
  [key: string]: unknown;
}

/** Input for one collector run. Wire keys intentionally stay snake_case. */
export interface DataCollectRequest {
  collection_id: string;
  collector_id: string;
  input: Record<string, unknown>;
  cursor?: string;
}

/** Forward-compatible collection result. */
export interface DataCollectResult {
  records?: DataRecord[];
  inserted?: number;
  existing?: number;
  cursor?: string;
  [key: string]: unknown;
}

/** Query a node-local index. Wire keys intentionally stay snake_case. */
export interface DataQueryRequest {
  collections?: string[];
  text?: string;
  where?: Record<string, unknown>;
  limit?: number;
  consistency?: "local";
}

/** Forward-compatible query response. */
export interface DataQueryResult {
  records?: DataQueryHit[];
  consistency?: "local";
  [key: string]: unknown;
}

/** One node-local query hit. Scores are node-specific relevance values. */
export interface DataQueryHit {
  record?: DataRecord;
  score?: number;
  [key: string]: unknown;
}

/** Forward-compatible record returned by the node. */
export interface DataRecord {
  id?: string;
  collection_id?: string;
  [key: string]: unknown;
}

/** Resolved content returned beside an immutable record envelope. */
export interface DataRecordContent {
  encoding?: "utf8" | "base64";
  data?: string;
  [key: string]: unknown;
}

/** Response from `GET /v1/data/records/:id`. */
export interface DataRecordResult {
  record?: DataRecord;
  content?: DataRecordContent;
  [key: string]: unknown;
}

/** Cursor options for the append-only changes feed. */
export interface DataChangesOptions {
  collection_id?: string;
  cursor?: string;
  limit?: number;
}

/** Forward-compatible changes response. */
export interface DataChangesResult {
  changes?: DataChange[];
  cursor?: string;
  has_more?: boolean;
  [key: string]: unknown;
}

/** Forward-compatible append-only record or tombstone event. */
export interface DataChange {
  id?: string;
  type?: "record.created" | "record.tombstoned";
  sequence?: number;
  collection_id?: string;
  record_id?: string;
  occurred_at?: string;
  record?: DataRecord;
  tombstone?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface DataTombstoneOptions {
  reason?: string;
}

/** Forward-compatible tombstone response. */
export interface DataTombstoneResult {
  record_id?: string;
  tombstoned?: boolean;
  [key: string]: unknown;
}

/** One bounded pull from a peer already configured on the local data node. */
export interface DataSyncPullRequest {
  peer_id: string;
  collection_id: string;
  limit?: number;
  max_pages?: number;
  max_plaintext_bytes?: number;
}

/** Select one locally configured peer/collection checkpoint. */
export interface DataSyncStatusRequest {
  peer_id: string;
  collection_id: string;
}

/** Sanitized local checkpoint metadata. Raw peer cursors are never exposed. */
export interface DataSyncStatus {
  protocol: typeof AGENT_DATA_SYNC_PROTOCOL;
  peer_id: string;
  collection_id: string;
  cursor_present: boolean;
  last_applied_at?: string;
  records_inserted: number;
  records_existing: number;
  tombstones_applied: number;
}

export type DataSyncStatusResult = DataSyncStatus;

/** Exact public result of a bounded agent-data-sync/v1 pull. */
export interface DataSyncPullResult {
  protocol: typeof AGENT_DATA_SYNC_PROTOCOL;
  peer_id: string;
  origin_node_id: string;
  collection_id: string;
  pages_applied: number;
  changes_applied: number;
  records_inserted: number;
  records_existing: number;
  tombstones_applied: number;
  has_more: boolean;
  status: DataSyncStatus;
}

type DataNodeRequest = (
  method: string,
  path: string,
  body?: unknown,
) => Promise<unknown>;

/**
 * Client for an agent-data/v1 node.
 *
 * It deliberately does not accept AgentTool's shared `HttpConfig`: doing so
 * would make it too easy to leak the project bearer across this boundary.
 */
export class DataClient {
  /** Explicit peer synchronization through this local node's authority. */
  readonly sync: DataSyncClient;
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;

  constructor(options: DataNodeOptions) {
    const baseUrl = options.baseUrl.trim().replace(/\/+$/, "");
    if (!baseUrl) {
      throw new AgentToolError("No agent data node URL provided.", {
        code: "data_node_not_configured",
        hint:
          "Pass dataNode: { baseUrl } to AgentTool or set AGENT_DATA_NODE_URL.",
      });
    }

    this.baseUrl = baseUrl;
    this.timeoutMs = (options.timeout ?? 30) * 1000;
    this.headers = {
      Accept: "application/json",
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    };
    // The sync sub-client deliberately reuses this local-node request path.
    // It has no peer URL, peer bearer, or independent transport of its own.
    this.sync = new DataSyncClient((method, path, body) =>
      this.request(method, path, body),
    );
  }

  /** Read the node's agent-data/v1 capability manifest. */
  async manifest(): Promise<DataManifest> {
    return this.request("GET", "/v1/data/manifest") as Promise<DataManifest>;
  }

  /** List collections visible to the configured data-node authority. */
  async collections(): Promise<DataCollectionsResult> {
    return this.request("GET", "/v1/data/collections") as Promise<DataCollectionsResult>;
  }

  /** Run a configured collector against a collection. */
  async collect(input: DataCollectRequest): Promise<DataCollectResult> {
    return this.request("POST", "/v1/data/collect", input) as Promise<DataCollectResult>;
  }

  /** Query local materialized indexes on the data node. */
  async query(input: DataQueryRequest = {}): Promise<DataQueryResult> {
    return this.request("POST", "/v1/data/query", input) as Promise<DataQueryResult>;
  }

  /** Fetch one record by its stable ID. */
  async get(recordId: string): Promise<DataRecordResult> {
    return this.request(
      "GET",
      `/v1/data/records/${encodeURIComponent(recordId)}`,
    ) as Promise<DataRecordResult>;
  }

  /** Read the cursor-based changes feed. */
  async changes(options: DataChangesOptions = {}): Promise<DataChangesResult> {
    const params = new URLSearchParams();
    if (options.collection_id !== undefined) {
      params.set("collection_id", options.collection_id);
    }
    if (options.cursor !== undefined) params.set("cursor", options.cursor);
    if (options.limit !== undefined) params.set("limit", String(options.limit));
    const query = params.toString();
    return this.request(
      "GET",
      `/v1/data/changes${query ? `?${query}` : ""}`,
    ) as Promise<DataChangesResult>;
  }

  /** Append a tombstone; records remain addressable through change history. */
  async tombstone(
    recordId: string,
    options: DataTombstoneOptions = {},
  ): Promise<DataTombstoneResult> {
    return this.request(
      "POST",
      `/v1/data/records/${encodeURIComponent(recordId)}/tombstone`,
      options,
    ) as Promise<DataTombstoneResult>;
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const init: RequestInit = {
      method,
      headers: {
        ...this.headers,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      signal: AbortSignal.timeout(this.timeoutMs),
    };
    if (body !== undefined) init.body = JSON.stringify(body);

    let response: Response;
    try {
      response = await globalThis.fetch(`${this.baseUrl}${path}`, init);
    } catch (error) {
      throw new AgentToolError("Agent data node request failed.", {
        code: "data_node_unreachable",
        hint:
          error instanceof Error
            ? error.message
            : "Check that the configured agent-data/v1 node is reachable.",
      });
    }

    if (!response.ok) {
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        payload = undefined;
      }
      throw AgentToolError.fromResponseBody(
        payload,
        response.status,
        `Agent data node request failed (${response.status}).`,
        response.headers,
      );
    }

    if (response.status === 204) return {};
    return response.json();
  }
}

/**
 * Narrow agent-data-sync/v1 façade.
 *
 * `peer_id` names a peer configured by the local node operator. This client
 * never accepts a peer bearer and never contacts that peer directly.
 */
export class DataSyncClient {
  /** @internal */
  constructor(private readonly requestLocalNode: DataNodeRequest) {}

  /** Pull and apply a bounded number of remote changes into the local node. */
  async pull(input: DataSyncPullRequest): Promise<DataSyncPullResult> {
    const result = await this.request("POST", "/v1/data/sync/pull", {
      protocol: AGENT_DATA_SYNC_PROTOCOL,
      peer_id: input.peer_id,
      collection_id: input.collection_id,
      ...(input.limit !== undefined ? { limit: input.limit } : {}),
      ...(input.max_pages !== undefined ? { max_pages: input.max_pages } : {}),
      ...(input.max_plaintext_bytes !== undefined
        ? { max_plaintext_bytes: input.max_plaintext_bytes }
        : {}),
    });
    return withoutRawCursor(result) as unknown as DataSyncPullResult;
  }

  /** Read sanitized local checkpoint state without revealing the raw cursor. */
  async status(input: DataSyncStatusRequest): Promise<DataSyncStatusResult> {
    const params = new URLSearchParams({
      peer_id: input.peer_id,
      collection_id: input.collection_id,
    });
    const result = await this.request(
      "GET",
      `/v1/data/sync/status?${params.toString()}`,
    );
    return withoutRawCursor(result) as unknown as DataSyncStatusResult;
  }

  private async request(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    try {
      return await this.requestLocalNode(method, path, body);
    } catch (error) {
      if (!(error instanceof AgentToolError)) throw error;
      // A peer-facing failure may carry an internal checkpoint or capability
      // in prose/details. Keep only metadata that is safe and useful to an
      // SDK caller; the local node owns richer operator diagnostics.
      throw new AgentToolError("Agent data sync request failed.", {
        code: error.code,
        status: error.status,
        retryAfter: error.retryAfter,
      });
    }
  }
}

function withoutRawCursor(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const { cursor: _cursor, ...safe } = value as Record<string, unknown>;
  if (safe.status && typeof safe.status === "object" && !Array.isArray(safe.status)) {
    safe.status = withoutRawCursor(safe.status);
  }
  return safe;
}
