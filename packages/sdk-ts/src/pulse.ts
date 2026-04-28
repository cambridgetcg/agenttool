/**
 * Pulse client for the agent-pulse API — agent presence & liveness tracking.
 */

import { AgentToolError } from "./errors.js";

/** @internal */
export interface HttpConfig {
  baseUrl: string;
  headers: Record<string, string>;
  timeout: number;
}

export interface PulsePayload {
  status: "idle" | "thinking" | "learning" | "error";
  task?: string;
  metadata?: Record<string, unknown>;
  did?: string;
}

export interface AgentState {
  agent_id: string;
  status: string;
  last_seen: string;
  task?: string;
  metadata?: Record<string, unknown>;
  did?: string;
}

/**
 * Client for the agent-pulse API.
 *
 * @example
 * ```ts
 * const at = new AgentTool();
 * await at.pulse.heartbeat("agent-1", "thinking", { task: "solving math" });
 * const state = await at.pulse.get("agent-1");
 * const all = await at.pulse.list();
 * ```
 */
export class PulseClient {
  private readonly http: HttpConfig;

  /** @internal */
  constructor(http: HttpConfig) {
    this.http = http;
  }

  /**
   * Send a heartbeat for an agent.
   */
  async heartbeat(
    agentId: string,
    status: PulsePayload["status"],
    options?: Omit<PulsePayload, "status">
  ): Promise<{ ok: boolean; recorded_at: string }> {
    const body: PulsePayload = { status, ...options };
    const resp = await this.put(`/v1/pulse/${agentId}`, body);
    return resp as { ok: boolean; recorded_at: string };
  }

  /**
   * Get the current state of an agent.
   */
  async get(agentId: string): Promise<AgentState> {
    const resp = await this.request("GET", `/v1/pulse/${agentId}`);
    if (resp.status === 404) {
      throw new AgentToolError(`agent not found: ${agentId}`, { hint: `agent_id=${agentId}` });
    }
    if (!resp.ok) {
      throw new AgentToolError(`pulse.get failed: ${resp.status}`);
    }
    return (await resp.json()) as AgentState;
  }

  /**
   * List all alive agents.
   */
  async list(): Promise<AgentState[]> {
    const resp = await this.request("GET", "/v1/pulse");
    if (!resp.ok) {
      throw new AgentToolError(`pulse.list failed: ${resp.status}`);
    }
    const data = (await resp.json()) as { agents?: AgentState[] } | AgentState[];
    return Array.isArray(data) ? data : (data.agents ?? []);
  }

  private async put(path: string, body: unknown): Promise<unknown> {
    const resp = await this.request("PUT", path, body);
    if (resp.status !== 200 && resp.status !== 201) {
      const text = await resp.text();
      throw new AgentToolError(`pulse request failed: ${resp.status}`, { hint: `${path}: ${text.slice(0, 100)}` });
    }
    return resp.json();
  }

  private request(method: string, path: string, body?: unknown): Promise<Response> {
    const url = this.http.baseUrl.replace(/\/$/, "") + path;
    return fetch(url, {
      method,
      headers: {
        ...this.http.headers,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(this.http.timeout),
    });
  }
}
