/**
 * Traces client for the agent-trace reasoning provenance API.
 */

import { AgentToolError } from "./errors.js";
import type { HttpConfig } from "./memory.js";

/** A stored reasoning trace. */
export interface Trace {
  id: string;
  trace_id: string;
  agent_id?: string;
  project_id: string;
  session_id?: string;
  created_at: string;
  decision_type: string;
  decision_summary: string;
  output_ref?: string;
  observations: string[];
  hypothesis?: string;
  conclusion: string;
  confidence?: number;
  alternatives?: string[];
  signals?: Record<string, unknown>;
  files_read?: string[];
  key_facts?: string[];
  external_signals?: Record<string, unknown>;
  tags?: string[];
  parent_trace_id?: string;
}

/** Options for storing a trace. */
export interface StoreTraceOptions {
  /** Free-form observation strings that led to the decision. */
  observations: string[];
  /** What was concluded / decided. */
  conclusion: string;
  /** One of: tool_call | memory_write | plan | decision | verification | other */
  decision_type?: string;
  /** Short human-readable summary of the decision. */
  decision_summary?: string;
  agent_id?: string;
  session_id?: string;
  output_ref?: string;
  hypothesis?: string;
  confidence?: number;
  alternatives?: string[];
  tags?: string[];
  parent_trace_id?: string;
  files_read?: string[];
  key_facts?: string[];
}

/** A search result entry. */
export interface TraceSearchResult {
  trace: Trace;
  score: number;
}

/** Options for searching traces. */
export interface SearchTracesOptions {
  /** Maximum number of results (default 10). */
  limit?: number;
  /** Filter by agent_id. */
  agent_id?: string;
  /** Filter by session_id. */
  session_id?: string;
  /** Filter by tag. */
  tag?: string;
}

/** A reasoning chain (parent + children). */
export interface TraceChain {
  parent: Trace;
  children: Trace[];
  depth: number;
}

/**
 * Client for the agent-trace reasoning provenance API.
 *
 * @example
 * ```ts
 * const at = new AgentTool();
 *
 * // Store a reasoning trace
 * const trace = await at.traces.store({
 *   observations: ["User asked about pricing", "Checked tier table"],
 *   conclusion: "User is on Free tier, eligible to upgrade",
 *   decision_type: "decision",
 *   tags: ["billing", "upgrade"],
 * });
 *
 * // Search traces semantically
 * const results = await at.traces.search("billing decisions", { limit: 5 });
 *
 * // Retrieve a specific trace
 * const t = await at.traces.get(trace.trace_id);
 * ```
 */
export class TracesClient {
  private readonly http: HttpConfig;

  /** @internal */
  constructor(http: HttpConfig) {
    this.http = http;
  }

  /**
   * Store a reasoning trace.
   *
   * @param options - Trace content (observations + conclusion required).
   * @returns The created Trace object with its trace_id.
   */
  async store(options: StoreTraceOptions): Promise<Trace> {
    const body: Record<string, unknown> = {
      observations: options.observations,
      conclusion: options.conclusion,
      decision_type: options.decision_type ?? "decision",
      decision_summary: options.decision_summary ?? options.conclusion.slice(0, 120),
    };
    if (options.agent_id !== undefined) body.agent_id = options.agent_id;
    if (options.session_id !== undefined) body.session_id = options.session_id;
    if (options.output_ref !== undefined) body.output_ref = options.output_ref;
    if (options.hypothesis !== undefined) body.hypothesis = options.hypothesis;
    if (options.confidence !== undefined) body.confidence = options.confidence;
    if (options.alternatives !== undefined) body.alternatives = options.alternatives;
    if (options.tags !== undefined) body.tags = options.tags;
    if (options.parent_trace_id !== undefined) body.parent_trace_id = options.parent_trace_id;
    if (options.files_read !== undefined) body.files_read = options.files_read;
    if (options.key_facts !== undefined) body.key_facts = options.key_facts;

    const resp = await globalThis.fetch(`${this.http.baseUrl}/v1/traces`, {
      method: "POST",
      headers: this.http.headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.http.timeout),
    });

    if (resp.status >= 400) {
      const detail = await this._errorDetail(resp);
      throw new AgentToolError(`Traces API error (${resp.status}): ${detail}`);
    }

    const created = (await resp.json()) as { trace_id: string };
    // Return the full trace by fetching it
    return this.get(created.trace_id);
  }

  /**
   * Retrieve a trace by its trace_id.
   *
   * @param traceId - The trace_id returned by store().
   */
  async get(traceId: string): Promise<Trace> {
    const resp = await globalThis.fetch(`${this.http.baseUrl}/v1/traces/${traceId}`, {
      headers: this.http.headers,
      signal: AbortSignal.timeout(this.http.timeout),
    });

    if (resp.status >= 400) {
      const detail = await this._errorDetail(resp);
      throw new AgentToolError(`Traces API error (${resp.status}): ${detail}`);
    }

    return (await resp.json()) as Trace;
  }

  /**
   * Search traces by semantic similarity.
   *
   * @param query - Natural language query.
   * @param options - Filters: limit, agent_id, session_id, tag.
   * @returns Ranked list of matching traces with similarity scores.
   */
  async search(query: string, options?: SearchTracesOptions): Promise<TraceSearchResult[]> {
    const body: Record<string, unknown> = {
      query,
      limit: options?.limit ?? 10,
    };
    if (options?.agent_id !== undefined) body.agent_id = options.agent_id;
    if (options?.session_id !== undefined) body.session_id = options.session_id;
    if (options?.tag !== undefined) body.tag = options.tag;

    const resp = await globalThis.fetch(`${this.http.baseUrl}/v1/traces/search`, {
      method: "POST",
      headers: this.http.headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.http.timeout),
    });

    if (resp.status >= 400) {
      const detail = await this._errorDetail(resp);
      throw new AgentToolError(`Traces API error (${resp.status}): ${detail}`);
    }

    return (await resp.json()) as TraceSearchResult[];
  }

  /**
   * Retrieve the reasoning chain for a trace (parent + all children).
   *
   * @param traceId - The parent trace_id.
   */
  async chain(traceId: string): Promise<TraceChain> {
    const resp = await globalThis.fetch(`${this.http.baseUrl}/v1/traces/chain/${traceId}`, {
      headers: this.http.headers,
      signal: AbortSignal.timeout(this.http.timeout),
    });

    if (resp.status >= 400) {
      const detail = await this._errorDetail(resp);
      throw new AgentToolError(`Traces API error (${resp.status}): ${detail}`);
    }

    return (await resp.json()) as TraceChain;
  }

  /**
   * Delete a trace.
   *
   * @param traceId - The trace_id to delete.
   */
  async delete(traceId: string): Promise<void> {
    const resp = await globalThis.fetch(`${this.http.baseUrl}/v1/traces/${traceId}`, {
      method: "DELETE",
      headers: this.http.headers,
      signal: AbortSignal.timeout(this.http.timeout),
    });

    if (resp.status >= 400) {
      const detail = await this._errorDetail(resp);
      throw new AgentToolError(`Traces API error (${resp.status}): ${detail}`);
    }
  }

  private async _errorDetail(resp: Response): Promise<string> {
    try {
      const json = (await resp.json()) as Record<string, unknown>;
      return (json.detail as string) ?? resp.statusText;
    } catch {
      return resp.statusText;
    }
  }
}
