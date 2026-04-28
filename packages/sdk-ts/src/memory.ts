/**
 * Memory client for the agent-memory API.
 */

import { AgentToolError } from "./errors.js";
import type { Memory, SearchMemoryOptions, StoreOptions, UsageStats } from "./types.js";

/** @internal Shared HTTP config passed from the main client. */
export interface HttpConfig {
  baseUrl: string;
  headers: Record<string, string>;
  timeout: number;
}

/**
 * Client for the agent-memory API.
 *
 * @example
 * ```ts
 * const at = new AgentTool();
 * at.memory.store("just a string");
 * const results = at.memory.search("what did I learn?");
 * ```
 */
export class MemoryClient {
  private readonly http: HttpConfig;

  /** @internal */
  constructor(http: HttpConfig) {
    this.http = http;
  }

  /**
   * Store a memory. Only `content` is required.
   *
   * @param content - The memory content string.
   * @param options - Optional type, agent_id, key, metadata, importance.
   * @returns The created Memory object.
   */
  async store(content: string, options?: StoreOptions): Promise<Memory> {
    const body: Record<string, unknown> = {
      content,
      type: options?.type ?? "semantic",
      importance: options?.importance ?? 0.5,
    };
    if (options?.agent_id !== undefined) body.agent_id = options.agent_id;
    if (options?.key !== undefined) body.key = options.key;
    if (options?.metadata !== undefined) body.metadata = options.metadata;

    const resp = await this.post("/v1/memories", body);
    return resp as Memory;
  }

  /**
   * Semantic search over stored memories.
   *
   * @param query - Natural-language search query.
   * @param options - Optional limit, type, agent_id.
   * @returns List of matching Memory objects.
   */
  async search(query: string, options?: SearchMemoryOptions): Promise<Memory[]> {
    const body: Record<string, unknown> = {
      query,
      limit: options?.limit ?? 10,
    };
    if (options?.type !== undefined) body.type = options.type;
    if (options?.agent_id !== undefined) body.agent_id = options.agent_id;

    const data = await this.post("/v1/memories/search", body);
    const results = Array.isArray(data) ? data : (data as Record<string, unknown>).results ?? [];
    return results as Memory[];
  }

  /**
   * Retrieve a single memory by ID.
   *
   * @param memoryId - The memory's unique identifier.
   * @returns The Memory object.
   */
  async get(memoryId: string): Promise<Memory> {
    const resp = await this.fetch("GET", `/v1/memories/${memoryId}`);
    return resp as Memory;
  }

  /**
   * Get usage statistics.
   *
   * @returns UsageStats with current counters.
   */
  async usage(): Promise<UsageStats> {
    const resp = await this.fetch("GET", "/v1/usage");
    return resp as UsageStats;
  }

  // --- internal ---

  private async post(path: string, body: unknown): Promise<unknown> {
    return this.fetch("POST", path, body);
  }

  private async fetch(method: string, path: string, body?: unknown): Promise<unknown> {
    const url = `${this.http.baseUrl}${path}`;
    const init: RequestInit = {
      method,
      headers: this.http.headers,
      signal: AbortSignal.timeout(this.http.timeout),
    };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    const resp = await globalThis.fetch(url, init);

    if (resp.status >= 400) {
      let detail: string;
      try {
        const json = (await resp.json()) as Record<string, unknown>;
        detail = (json.detail as string) ?? resp.statusText;
      } catch {
        detail = resp.statusText;
      }
      throw new AgentToolError(`Memory API error (${resp.status}): ${detail}`, {
        hint: "Check your API key and request parameters.",
      });
    }

    return resp.json();
  }
}
