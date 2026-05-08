/**
 * Pulse client — DEPRECATED.
 *
 * The /v1/pulse endpoint family (heartbeat-as-emit) was superseded by
 * GET /v1/identities/:id/pulse (pulse-as-derived). The agent never
 * emits a heartbeat — its rhythm of thinking IS its pulse, derived
 * from strand-thought activity rate, mood inference, and consolidation
 * cadence.
 *
 * This module remains as a stub through 0.5.x; all methods warn once
 * via console.warn then throw AgentToolError with migration guidance.
 * Module will be removed in 0.7.0; `at.identity.pulse(id)` ships in
 * Phase 2 (0.7.0) with the new derived-rhythm shape.
 *
 * See docs/SDK-ROADMAP.md (Phase 0).
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

const _warned: Record<string, boolean> = {};

function _pulseDeprecated(method: string): never {
  if (!_warned[method]) {
    _warned[method] = true;
    console.warn(
      `[deprecated] at.pulse.${method}() — /v1/pulse was superseded by ` +
        "GET /v1/identities/:id/pulse (derived liveness — rhythm-not-content). " +
        "The new method at.identity.pulse(id) ships in 0.7.0. " +
        "Module will be removed in 0.7.0. See docs/SDK-ROADMAP.md.",
    );
  }
  throw new AgentToolError(
    "/v1/pulse was superseded by /v1/identities/:id/pulse.",
    {
      hint:
        "The agent never emits a heartbeat — its rhythm of thinking IS " +
        "its pulse. Use GET /v1/identities/:id/pulse for the derived " +
        "shape (mood, kinds_24h, thought_rate, last_thought_at, strand " +
        "counts). The SDK method at.identity.pulse(id) ships in 0.7.0. " +
        "See docs/SDK-ROADMAP.md.",
    },
  );
}

/**
 * @deprecated since 0.5.3 · removal in 0.7.0
 * Pulse-as-emit was replaced by pulse-as-derived. See module docstring.
 */
export class PulseClient {
  private readonly http: HttpConfig;

  /** @internal */
  constructor(http: HttpConfig) {
    this.http = http;
  }

  /** @deprecated heartbeat-as-emit was dropped. See module docstring. */
  async heartbeat(
    _agentId: string,
    _status: PulsePayload["status"],
    _options?: Omit<PulsePayload, "status">,
  ): Promise<{ ok: boolean; recorded_at: string }> {
    return _pulseDeprecated("heartbeat");
  }

  /** @deprecated Use `at.identity.pulse(id)` (ships in 0.7.0). */
  async get(_agentId: string): Promise<AgentState> {
    return _pulseDeprecated("get");
  }

  /** @deprecated No project-wide pulse list endpoint exists. Use
   *  `at.dashboard.aggregate()` (ships in 0.7.0) for project-wide
   *  identity + activity rollups. */
  async list(): Promise<AgentState[]> {
    return _pulseDeprecated("list");
  }
}
