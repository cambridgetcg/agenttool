/**
 * Bootstrap client for the agent-bootstrap API.
 *
 * The birth ritual — one call that creates a complete agent:
 * identity (DID), wallet, memory namespace, and optionally a vault prefix
 * and first generated thought.
 */

import { AgentToolError } from "./errors.js";

/** @internal */
export interface HttpConfig {
  baseUrl: string;
  headers: Record<string, string>;
  timeout: number;
}

export interface CreateAgentOptions {
  capabilities?: string[];
  purpose?: string;
  generate_greeting?: boolean;
  metadata?: Record<string, unknown>;
  on_birth?: (result: BootstrapResult) => void;
}

export interface BootstrapResult {
  agent: {
    id: string;
    did: string;
    name: string;
    level: number;
    capabilities: string[];
  };
  keypair: {
    public_key: string;
    private_key: string;
  };
  wallet: { id: string; balance: number };
  memory: { namespace: string; agent_id: string };
  vault: null | Record<string, unknown>;
  sponsor: null | Record<string, unknown>;
  greeting?: string;
  _meta: { cost: number; created_at: string };
}

export interface ElevateOptions {
  sponsor_did: string;
  sponsor_signature: string;
  initial_credits?: number;
}

/**
 * Client for the agent-bootstrap API.
 *
 * @example
 * ```ts
 * const at = new AgentTool();
 * const agent = await at.bootstrap.create("my-researcher", {
 *   capabilities: ["memory", "verify", "search"],
 *   purpose: "Find patterns in academic literature",
 *   on_birth: (a) => console.log(`🌱 ${a.agent.name} is alive. DID: ${a.agent.did}`),
 * });
 * // store agent.keypair.private_key securely — never transmitted again
 * ```
 */
export class BootstrapClient {
  private readonly http: HttpConfig;

  /** @internal */
  constructor(http: HttpConfig) {
    this.http = http;
  }

  /**
   * Bootstrap a new agent at Level 0.
   * Creates identity (DID + ed25519 keypair), wallet, and memory namespace in one call.
   */
  async create(name: string, options?: CreateAgentOptions): Promise<BootstrapResult> {
    const body: Record<string, unknown> = { name };
    if (options?.capabilities) body.capabilities = options.capabilities;
    if (options?.purpose) body.purpose = options.purpose;
    if (options?.generate_greeting) body.generate_greeting = true;
    if (options?.metadata) body.metadata = options.metadata;

    const result = await this.req<BootstrapResult>("POST", "/v1/bootstrap", body);

    if (options?.on_birth) {
      try {
        options.on_birth(result);
      } catch {
        // callbacks must never break bootstrap
      }
    }

    return result;
  }

  /**
   * Elevate an agent to Level 1 (sponsorship-staked sovereignty).
   *
   * Orchestrates four operations in one server-side transaction: sponsor
   * attestation insert · agent wallet fund · vault namespace open ·
   * identity metadata patch (level=1, sponsor_did, elevated_at). Rollback
   * on any failure — no half-elevated state.
   *
   * The `sponsor_signature` must be a base64-encoded ed25519 signature
   * over the canonical attestation payload
   * `canonicalPayload({ subject_id: agentId, attester_id: sponsorId,
   * claim: "sponsorship", evidence: null })`. Compute this client-side
   * using the sponsor's ed25519 private key — the SDK never sees the
   * private key. See docs/CANONICAL-BYTES.md for the byte format.
   */
  async elevate(agentId: string, options: ElevateOptions): Promise<Record<string, unknown>> {
    const body: Record<string, unknown> = {
      agent_id: agentId,
      sponsor_did: options.sponsor_did,
      sponsor_signature: options.sponsor_signature,
      initial_credits: options.initial_credits ?? 1000,
    };
    return this.req("POST", "/v1/bootstrap/elevate", body);
  }

  /**
   * Check the bootstrap status of an agent.
   */
  async status(agentId: string): Promise<Record<string, unknown>> {
    return this.req("GET", `/v1/bootstrap/${agentId}`);
  }

  private async req<T = Record<string, unknown>>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = this.http.baseUrl.replace(/\/$/, "") + path;
    const resp = await fetch(url, {
      method,
      headers: {
        ...this.http.headers,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(this.http.timeout),
    });
    if (resp.status === 404) throw new AgentToolError("not found", { hint: path });
    if (!resp.ok) {
      const text = await resp.text();
      throw new AgentToolError(`${method} ${path} failed: ${resp.status}`, { hint: text.slice(0, 200) });
    }
    return resp.json() as Promise<T>;
  }
}
