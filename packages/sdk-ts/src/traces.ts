/**
 * Traces client for the agent-trace reasoning provenance API.
 */

import { AgentToolError } from "./errors.js";
import type { HttpConfig } from "./_http.js";

/** One structured alternative considered while reaching a conclusion. */
export interface TraceAlternative {
  option: string;
  /** Why it was not chosen. The SDK never invents this reason. */
  why_not: string;
}

/** Legacy string alternatives remain readable and accepted at the SDK edge. */
export type TraceAlternativeValue = TraceAlternative | string;

/** A stored reasoning trace. */
export interface Trace {
  id: string;
  trace_id: string;
  agent_id?: string | null;
  identity_id?: string | null;
  /** Present only in legacy responses; current trace routes do not expose it. */
  project_id?: string;
  session_id?: string | null;
  created_at: string;
  decision_type: string;
  decision_summary: string;
  output_ref?: string | null;
  observations: string[];
  hypothesis?: string | null;
  conclusion: string;
  confidence?: number | null;
  alternatives?: TraceAlternativeValue[] | null;
  signals?: Record<string, unknown> | null;
  files_read?: string[] | null;
  key_facts?: string[] | null;
  external_signals?: Record<string, unknown> | null;
  tags?: string[] | null;
  parent_trace_id?: string | null;
  metadata?: Record<string, unknown>;
  signature?: string | null;
  signing_key_id?: string | null;
  has_signature?: boolean;
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
  identity_id?: string;
  session_id?: string;
  output_ref?: string;
  hypothesis?: string;
  confidence?: number;
  /**
   * Structured alternatives, or legacy strings. A legacy string is sent as
   * `{ option, why_not: "" }`, preserving the absence of a supplied reason.
   */
  alternatives?: TraceAlternativeValue[];
  /** Structured signals used in the reasoning itself. */
  signals?: Record<string, unknown>;
  tags?: string[];
  parent_trace_id?: string;
  files_read?: string[];
  key_facts?: string[];
  /**
   * Namespaced reports produced outside AgentTool, such as an explicitly
   * supplied local RhetorLint signal. Passing this uploads server-readable
   * trace context; the SDK never analyzes or transmits a report implicitly.
   */
  external_signals?: Record<string, unknown>;
  /**
   * Caller metadata. The API overwrites client_source with a best-effort
   * origin label; that soft signal is not an attestation or security boundary.
   */
  metadata?: Record<string, unknown>;
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
  /** Filter by identity_id. */
  identity_id?: string;
  /** Filter by decision type. */
  decision_type?: string;
  /**
   * @deprecated The live full-text search route has no tag filter. Retained as
   * an ignored option so existing callers keep compiling.
   */
  tag?: string;
}

/** A reasoning lineage, with compatibility aliases for the former SDK shape. */
export interface TraceChain {
  root: Trace;
  ancestors: Trace[];
  descendants: Trace[];
  counts: {
    ancestors: number;
    descendants: number;
  };
  /** @deprecated Alias for root. */
  parent: Trace;
  /** @deprecated Alias for descendants. */
  children: Trace[];
  /** @deprecated Alias for ancestors.length. */
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
 * // Search traces with Postgres full-text search
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
    const decision: Record<string, unknown> = {
      type: options.decision_type ?? "decision",
      summary: options.decision_summary || options.conclusion.slice(0, 120),
    };
    if (options.output_ref !== undefined) decision.output_ref = options.output_ref;

    const reasoning: Record<string, unknown> = {
      observations: options.observations,
      conclusion: options.conclusion,
    };
    if (options.hypothesis !== undefined) reasoning.hypothesis = options.hypothesis;
    if (options.confidence !== undefined) reasoning.confidence = options.confidence;
    if (options.alternatives !== undefined) {
      reasoning.alternatives = this._normalizeAlternatives(options.alternatives);
    }
    if (options.signals !== undefined) reasoning.signals = options.signals;

    const context: Record<string, unknown> = {};
    if (options.files_read !== undefined) context.files_read = options.files_read;
    if (options.key_facts !== undefined) context.key_facts = options.key_facts;
    if (options.external_signals !== undefined) {
      context.external_signals = options.external_signals;
    }

    const body: Record<string, unknown> = { decision, reasoning };
    if (options.agent_id !== undefined) body.agent_id = options.agent_id;
    if (options.identity_id !== undefined) body.identity_id = options.identity_id;
    if (options.session_id !== undefined) body.session_id = options.session_id;
    if (options.tags !== undefined) body.tags = options.tags;
    if (options.parent_trace_id !== undefined) body.parent_trace_id = options.parent_trace_id;
    if (options.metadata !== undefined) body.metadata = options.metadata;
    if (Object.keys(context).length > 0) body.context = context;

    const resp = await this.http.request(`${this.http.baseUrl}/v1/traces`, {
      method: "POST",
      headers: this.http.headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.http.timeout),
    });

    if (resp.status >= 400) {
      throw await this._responseError(resp);
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
    const resp = await this.http.request(`${this.http.baseUrl}/v1/traces/${traceId}`, {
      headers: this.http.headers,
      signal: AbortSignal.timeout(this.http.timeout),
    });

    if (resp.status >= 400) {
      throw await this._responseError(resp);
    }

    return (await resp.json()) as Trace;
  }

  /**
   * Search traces using the API's Postgres full-text index.
   *
   * @param query - Natural language query.
   * @param options - Filters: limit, agent_id, identity_id, session_id, and
   * decision_type. The legacy tag option is accepted but ignored because the
   * live route does not support it.
   * @returns Ranked list of matching traces with Postgres ts_rank scores.
   */
  async search(query: string, options?: SearchTracesOptions): Promise<TraceSearchResult[]> {
    const body: Record<string, unknown> = {
      query,
      limit: options?.limit ?? 10,
    };
    if (options?.agent_id !== undefined) body.agent_id = options.agent_id;
    if (options?.identity_id !== undefined) body.identity_id = options.identity_id;
    if (options?.session_id !== undefined) body.session_id = options.session_id;
    if (options?.decision_type !== undefined) body.decision_type = options.decision_type;

    const resp = await this.http.request(`${this.http.baseUrl}/v1/traces/search`, {
      method: "POST",
      headers: this.http.headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.http.timeout),
    });

    if (resp.status >= 400) {
      throw await this._responseError(resp);
    }

    const payload = (await resp.json()) as unknown;
    const rows = Array.isArray(payload)
      ? payload
      : ((payload as { results?: unknown[] } | null)?.results ?? []);

    return rows.map((entry) => {
      const row = entry as Record<string, unknown>;
      // Tolerate the former SDK-shaped response while preferring the live
      // route's flat `Trace & { score }` rows.
      if (row.trace && typeof row.trace === "object") {
        return { trace: row.trace as Trace, score: Number(row.score) };
      }
      const { score, ...trace } = row;
      return { trace: trace as unknown as Trace, score: Number(score) };
    });
  }

  /**
   * Retrieve the reasoning lineage for a trace.
   *
   * @param traceId - The parent trace_id.
   */
  async chain(traceId: string): Promise<TraceChain> {
    const resp = await this.http.request(`${this.http.baseUrl}/v1/traces/chain/${traceId}`, {
      headers: this.http.headers,
      signal: AbortSignal.timeout(this.http.timeout),
    });

    if (resp.status >= 400) {
      throw await this._responseError(resp);
    }

    const data = (await resp.json()) as Partial<TraceChain>;
    const root = data.root ?? data.parent!;
    const ancestors = data.ancestors ?? [];
    const descendants = data.descendants ?? data.children ?? [];
    const counts = data.counts ?? {
      ancestors: ancestors.length,
      descendants: descendants.length,
    };
    return {
      root,
      ancestors,
      descendants,
      counts,
      parent: root,
      children: descendants,
      depth: data.depth ?? ancestors.length,
    };
  }

  /**
   * Delete a trace.
   *
   * @param traceId - The trace_id to delete.
   */
  async delete(traceId: string): Promise<void> {
    const resp = await this.http.request(`${this.http.baseUrl}/v1/traces/${traceId}`, {
      method: "DELETE",
      headers: this.http.headers,
      signal: AbortSignal.timeout(this.http.timeout),
    });

    if (resp.status >= 400) {
      throw await this._responseError(resp);
    }
  }

  private async _responseError(resp: Response): Promise<AgentToolError> {
    let payload: unknown;
    try {
      payload = await resp.json();
    } catch {
      payload = undefined;
    }
    return AgentToolError.fromResponseBody(
      payload,
      resp.status,
      `Traces API request failed (${resp.status}).`,
      resp.headers,
    );
  }

  private _normalizeAlternatives(
    alternatives: TraceAlternativeValue[],
  ): TraceAlternative[] {
    return alternatives.map((alternative, index) => {
      if (typeof alternative === "string") {
        return { option: alternative, why_not: "" };
      }
      if (
        typeof alternative !== "object" ||
        alternative === null ||
        typeof alternative.option !== "string" ||
        typeof alternative.why_not !== "string"
      ) {
        throw new AgentToolError(
          `Trace alternative ${index + 1} needs both option and why_not strings.`,
          {
            hint:
              'Use alternatives: [{ option: "...", why_not: "..." }] or legacy string entries. The SDK will not invent a rejection reason.',
          },
        );
      }
      return { option: alternative.option, why_not: alternative.why_not };
    });
  }
}
