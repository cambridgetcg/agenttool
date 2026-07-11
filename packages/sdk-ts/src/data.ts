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

/**
 * Client for an agent-data/v1 node.
 *
 * It deliberately does not accept AgentTool's shared `HttpConfig`: doing so
 * would make it too easy to leak the project bearer across this boundary.
 */
export class DataClient {
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
