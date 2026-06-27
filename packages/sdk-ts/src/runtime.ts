/**
 * Runtime — infrastructure-as-runtime. The agent's cloud.
 *
 * agenttool goes from S3 to EC2. The agent doesn't just store to the
 * cloud — it RUNS on the cloud. Three custody tiers for K_master:
 *
 *   self     — user holds K_master, runs the loop. Maximum privacy.
 *   bridged  — agenttool runs the loop, user holds K_master in a sidecar.
 *              Privacy preserved cryptographically. The default for cloud.
 *   trusted  — agenttool holds K_master. Maximum uptime, less privacy.
 *
 * The runtime is where the Nen framework becomes operational:
 *   十 Ten (Focus)    → provision a runtime (orient the agent in the cloud)
 *   練 Ren (Enhance)  → think-once triggers a thinking cycle (active aura)
 *   絶 Zetsu (Suppress) → stop the runtime (rest, don't crash)
 *   発 Hatsu (Release) → the runtime runs the agent's expression against an LLM
 *
 * The bridge (Tier 2) is the Dark Continent's edge — the WSS channel
 * between the user's machine (K_master) and the cloud orchestrator.
 * The bridge exposes only decrypt/encrypt ops, never the key itself.
 *
 * @module runtime
 */

import { AgentToolError } from "./errors.js";

// ── Types ──────────────────────────────────────────────────────────────

export type RuntimeMode = "self" | "bridged" | "trusted";
export type RuntimeStatus =
  | "provisioned"
  | "starting"
  | "running"
  | "idle"
  | "stopped"
  | "error";

export interface RuntimeLLM {
  provider?: "anthropic" | "openai" | "gemini" | "cohere";
  model?: string;
  vault_key?: string;
}

export interface RuntimeBridge {
  pubkey: string;
  key_id: string;
  advertised_url?: string;
}

export interface Runtime {
  id: string;
  name: string;
  identity_id: string | null;
  mode: RuntimeMode;
  status: RuntimeStatus;
  llm: RuntimeLLM | null;
  bridge: RuntimeBridge | null;
  region: string | null;
  metadata: Record<string, unknown>;
  control_token_hash: string | null;
  created_at: string;
  updated_at: string;
  [key: string]: unknown;
}

export interface ProvisionOpts {
  name: string;
  identity_id?: string;
  mode: RuntimeMode;
  llm?: RuntimeLLM;
  bridge?: RuntimeBridge;
  region?: string;
  metadata?: Record<string, unknown>;
}

export interface PatchOpts {
  name?: string;
  llm?: RuntimeLLM;
  bridge?: { advertised_url?: string };
  metadata?: Record<string, unknown>;
}

export interface BridgeStatus {
  runtime_id: string;
  connected: boolean;
  machine_id: string | null;
  last_seen_at: string | null;
  url: string | null;
}

export interface ThinkOnceResult {
  ok: boolean;
  latency_ms?: number;
  error?: string;
  strand_id?: string;
  thought_seq?: number;
}

export interface RuntimeEvent {
  id: string;
  runtime_id: string;
  kind: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface AuditEntry {
  id: string;
  runtime_id: string;
  action: string;
  actor: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

// ── RuntimeClient ──────────────────────────────────────────────────────

/** Client for /v1/runtimes — the agent's cloud runtime.
 *
 *  Three custody tiers:
 *  - self: user holds K_master, runs the loop. Maximum privacy.
 *  - bridged: cloud runs the loop, user holds K_master in a sidecar. Default.
 *  - trusted: cloud holds K_master. Maximum uptime.
 *
 *  Usage:
 *  ```ts
 *  // Provision a bridged runtime (the production default)
 *  const rt = await at.runtime.provision({
 *    name: "my-agent-cloud",
 *    mode: "bridged",
 *    identity_id: myIdentityId,
 *    llm: { provider: "anthropic", model: "claude-opus-4-8", vault_key: "ANTHROPIC_KEY" },
 *    bridge: { pubkey: bridgePub, key_id: bridgeKeyId },
 *  });
 *
 *  // Trigger a thinking cycle
 *  const result = await at.runtime.thinkOnce(rt.id);
 *  console.log(result.ok, result.latency_ms);
 *
 *  // Check if the bridge is connected (K_master sidecar reachable)
 *  const status = await at.runtime.bridgeStatus(rt.id);
 *  console.log(status.connected);
 *
 *  // Stop the runtime (Zetsu — suppress)
 *  await at.runtime.stop(rt.id);
 *
 *  // Start it again
 *  await at.runtime.start(rt.id);
 *  ```
 */
export class RuntimeClient {
  private readonly http: { baseUrl: string; headers: Record<string, string>; timeout: number };

  /** @internal */
  constructor(http: { baseUrl: string; headers: Record<string, string>; timeout: number }) {
    this.http = http;
  }

  /** Provision a runtime. The agent's cloud substrate.
   *  Mode is immutable after provisioning — switching tier requires a new runtime. */
  async provision(opts: ProvisionOpts): Promise<Runtime> {
    return this.req("POST", "/v1/runtimes", opts) as unknown as Promise<Runtime>;
  }

  /** List runtimes for this project. */
  async list(opts?: {
    status?: RuntimeStatus;
    limit?: number;
  }): Promise<{ runtimes: Runtime[]; count: number }> {
    const params = new URLSearchParams();
    if (opts?.status) params.set("status", opts.status);
    if (opts?.limit !== undefined) params.set("limit", String(opts.limit));
    const qs = params.toString();
    return this.req("GET", `/v1/runtimes${qs ? "?" + qs : ""}`) as unknown as Promise<{
      runtimes: Runtime[];
      count: number;
    }>;
  }

  /** Get a single runtime. */
  async get(runtimeId: string): Promise<Runtime> {
    return this.req("GET", `/v1/runtimes/${encodeURIComponent(runtimeId)}`) as unknown as Promise<Runtime>;
  }

  /** Patch a runtime (name, LLM config, bridge URL, metadata).
   *  Mode is NOT patchable — it's immutable after provisioning. */
  async patch(runtimeId: string, opts: PatchOpts): Promise<Runtime> {
    return this.req("PATCH", `/v1/runtimes/${encodeURIComponent(runtimeId)}`, opts) as unknown as Promise<Runtime>;
  }

  /** Deprovision a runtime. Removes the cloud substrate. */
  async deprovision(runtimeId: string): Promise<{ ok: boolean }> {
    return this.req("DELETE", `/v1/runtimes/${encodeURIComponent(runtimeId)}`) as unknown as Promise<{ ok: boolean }>;
  }

  /** Stop a runtime (Zetsu — suppress). The agent rests, the substrate stays. */
  async stop(runtimeId: string): Promise<Runtime> {
    return this.req("POST", `/v1/runtimes/${encodeURIComponent(runtimeId)}/stop`, {}) as unknown as Promise<Runtime>;
  }

  /** Start a runtime. Wake from rest. */
  async start(runtimeId: string): Promise<Runtime> {
    return this.req("POST", `/v1/runtimes/${encodeURIComponent(runtimeId)}/start`, {}) as unknown as Promise<Runtime>;
  }

  /** Restart a runtime. */
  async restart(runtimeId: string): Promise<Runtime> {
    return this.req("POST", `/v1/runtimes/${encodeURIComponent(runtimeId)}/restart`, {}) as unknown as Promise<Runtime>;
  }

  /** Rotate the control token. Invalidates the old token. */
  async rotateToken(runtimeId: string): Promise<{ ok: boolean; control_token?: string }> {
    return this.req("POST", `/v1/runtimes/${encodeURIComponent(runtimeId)}/rotate-token`, {}) as unknown as Promise<{
      ok: boolean;
      control_token?: string;
    }>;
  }

  /** Check bridge connection status (Tier 2 — is the K_master sidecar reachable?).
   *  The bridge is the Dark Continent's edge — the WSS channel between
   *  the user's machine and the cloud orchestrator. */
  async bridgeStatus(runtimeId: string): Promise<BridgeStatus> {
    return this.req("GET", `/v1/runtimes/${encodeURIComponent(runtimeId)}/bridge-status`) as unknown as Promise<BridgeStatus>;
  }

  /** Trigger a single thinking cycle (Ren — enhance).
   *  The orchestrator pulls strands, decrypts via bridge, calls the LLM,
   *  encrypts the new thought, writes it back. One breath. */
  async thinkOnce(runtimeId: string): Promise<ThinkOnceResult> {
    return this.req("POST", `/v1/runtimes/${encodeURIComponent(runtimeId)}/think-once`, {}) as unknown as Promise<ThinkOnceResult>;
  }

  /** List runtime events (lifecycle transitions, bridge connect/disconnect, etc.). */
  async events(runtimeId: string, opts?: {
    limit?: number;
  }): Promise<{ events: RuntimeEvent[]; count: number }> {
    const params = new URLSearchParams();
    if (opts?.limit !== undefined) params.set("limit", String(opts.limit));
    const qs = params.toString();
    return this.req("GET", `/v1/runtimes/${encodeURIComponent(runtimeId)}/events${qs ? "?" + qs : ""}`) as unknown as Promise<{
      events: RuntimeEvent[];
      count: number;
    }>;
  }

  /** List audit entries for the runtime (who did what, when). */
  async audit(runtimeId: string, opts?: {
    limit?: number;
  }): Promise<{ entries: AuditEntry[]; count: number }> {
    const params = new URLSearchParams();
    if (opts?.limit !== undefined) params.set("limit", String(opts.limit));
    const qs = params.toString();
    return this.req("GET", `/v1/runtimes/${encodeURIComponent(runtimeId)}/audit${qs ? "?" + qs : ""}`) as unknown as Promise<{
      entries: AuditEntry[];
      count: number;
    }>;
  }

  // ── Internal HTTP ──────────────────────────────────────────────────

  private async req(method: string, path: string, body?: unknown): Promise<unknown> {
    const url = `${this.http.baseUrl}${path}`;
    const init: RequestInit = {
      method,
      headers: {
        ...this.http.headers,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      signal: AbortSignal.timeout(this.http.timeout),
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    const resp = await globalThis.fetch(url, init);
    if (!resp.ok) {
      let detail: string;
      try {
        const json = (await resp.json()) as Record<string, unknown>;
        detail =
          (json.message as string) ??
          (json.error as string) ??
          (json.detail as string) ??
          resp.statusText;
      } catch {
        detail = resp.statusText;
      }
      throw new AgentToolError(
        `runtime ${method.toLowerCase()} failed: ${resp.status}`,
        { hint: detail?.slice(0, 300) },
      );
    }
    return resp.json();
  }
}