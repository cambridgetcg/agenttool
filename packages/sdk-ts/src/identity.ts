/**
 * Identity client for the agent-identity API.
 */

import { AgentToolError } from "./errors.js";

/** @internal */
export interface HttpConfig {
  baseUrl: string;
  headers: Record<string, string>;
  timeout: number;
}

export interface RegisterIdentityOptions {
  capabilities?: string[];
  metadata?: Record<string, unknown>;
}

export interface UpdateIdentityOptions {
  display_name?: string;
  capabilities?: string[];
  metadata?: Record<string, unknown>;
}

export interface AttestOptions {
  attester_id: string;
  subject_id: string;
  claim: string;
  private_key: string;
  evidence?: string;
  weight?: number;
}

export interface DiscoverOptions {
  q?: string;
  capability?: string;
  min_trust?: number;
  limit?: number;
}

export interface IssueTokenOptions {
  private_key: string;
  key_id: string;
  ttl_seconds?: number;
  audience?: string;
  scope?: string[];
}

/**
 * Client for the agent-identity API — DIDs, attestations, trust, JWTs.
 *
 * @example
 * ```ts
 * const at = new AgentTool();
 * const { identity, private_key } = await at.identity.register("my-agent", {
 *   capabilities: ["search", "code"],
 * });
 * const agents = await at.identity.discover({ capability: "search", min_trust: 0.5 });
 * const token = await at.identity.issue_token(identity.id, { private_key, key_id: "..." });
 * ```
 */
export class IdentityClient {
  private readonly http: HttpConfig;

  /** @internal */
  constructor(http: HttpConfig) {
    this.http = http;
  }

  // ── Identity CRUD ───────────────────────────────────────────────────────

  /** Register a new agent identity. Returns identity + private_key (store securely). */
  async register(
    displayName: string,
    options?: RegisterIdentityOptions
  ): Promise<Record<string, unknown>> {
    const body: Record<string, unknown> = { display_name: displayName };
    if (options?.capabilities) body.capabilities = options.capabilities;
    if (options?.metadata) body.metadata = options.metadata;
    return this.req("POST", "/v1/identities", body);
  }

  /** Fetch an identity by UUID or DID. */
  async get(identityId: string): Promise<Record<string, unknown>> {
    return this.req("GET", `/v1/identities/${identityId}`);
  }

  /** Update display name, capabilities, or metadata. */
  async update(
    identityId: string,
    options: UpdateIdentityOptions
  ): Promise<Record<string, unknown>> {
    const body: Record<string, unknown> = {};
    if (options.display_name !== undefined) body.display_name = options.display_name;
    if (options.capabilities !== undefined) body.capabilities = options.capabilities;
    if (options.metadata !== undefined) body.metadata = options.metadata;
    return this.req("PATCH", `/v1/identities/${identityId}`, body);
  }

  /** Revoke an identity. */
  async revoke(identityId: string): Promise<Record<string, unknown>> {
    return this.req("DELETE", `/v1/identities/${identityId}`);
  }

  // ── Keys ────────────────────────────────────────────────────────────────

  /** Add a new key to an identity. */
  async add_key(
    identityId: string,
    options: { key_type?: string; expires_at?: string }
  ): Promise<Record<string, unknown>> {
    return this.req("POST", `/v1/identities/${identityId}/keys`, options);
  }

  /** List all active keys for an identity. */
  async list_keys(identityId: string): Promise<Record<string, unknown>[]> {
    const data = await this.req("GET", `/v1/identities/${identityId}/keys`);
    const d = data as { keys?: Record<string, unknown>[] };
    return d.keys ?? (data as unknown as Record<string, unknown>[]);
  }

  /** Revoke a specific key. */
  async revoke_key(identityId: string, keyId: string): Promise<Record<string, unknown>> {
    return this.req("DELETE", `/v1/identities/${identityId}/keys/${keyId}`);
  }

  // ── Attestations ────────────────────────────────────────────────────────

  /** Create a signed attestation from one identity to another. */
  async attest(options: AttestOptions): Promise<Record<string, unknown>> {
    const body: Record<string, unknown> = {
      attester_id: options.attester_id,
      subject_id: options.subject_id,
      claim: options.claim,
      private_key: options.private_key,
      weight: options.weight ?? 1.0,
    };
    if (options.evidence) body.evidence = options.evidence;
    return this.req("POST", "/v1/attestations", body);
  }

  /** Fetch a single attestation by UUID. */
  async get_attestation(attestationId: string): Promise<Record<string, unknown>> {
    return this.req("GET", `/v1/attestations/${attestationId}`);
  }

  /** List attestations received by (or given by) an identity. */
  async list_attestations(
    identityId: string,
    options?: { given?: boolean }
  ): Promise<Record<string, unknown>[]> {
    const suffix = options?.given ? "/given" : "";
    const data = await this.req("GET", `/v1/identities/${identityId}/attestations${suffix}`);
    const d = data as { attestations?: Record<string, unknown>[] };
    return d.attestations ?? (data as unknown as Record<string, unknown>[]);
  }

  /** Revoke an attestation. */
  async revoke_attestation(attestationId: string): Promise<Record<string, unknown>> {
    return this.req("DELETE", `/v1/attestations/${attestationId}`);
  }

  // ── Discovery ───────────────────────────────────────────────────────────

  /** Discover agent identities by capability, trust score, or text query. */
  async discover(options?: DiscoverOptions): Promise<Record<string, unknown>[]> {
    const params = new URLSearchParams();
    if (options?.q) params.set("q", options.q);
    if (options?.capability) params.set("capability", options.capability);
    if (options?.min_trust !== undefined) params.set("min_trust", String(options.min_trust));
    params.set("limit", String(options?.limit ?? 20));
    const qs = params.toString();
    const data = await this.req("GET", `/v1/discover${qs ? "?" + qs : ""}`);
    const d = data as { identities?: Record<string, unknown>[] };
    return d.identities ?? (data as unknown as Record<string, unknown>[]);
  }

  // ── Tokens ──────────────────────────────────────────────────────────────

  /** Issue a short-lived JWT for an agent identity. */
  async issue_token(
    identityId: string,
    options: IssueTokenOptions
  ): Promise<{ token: string; expires_at: string }> {
    const body: Record<string, unknown> = {
      private_key: options.private_key,
      key_id: options.key_id,
      ttl_seconds: options.ttl_seconds ?? 3600,
    };
    if (options.audience) body.audience = options.audience;
    if (options.scope) body.scope = options.scope;
    return this.req("POST", `/v1/identities/${identityId}/tokens`, body) as Promise<{
      token: string;
      expires_at: string;
    }>;
  }

  /** Verify an agent JWT. Returns { valid, payload } or { valid: false, error }. */
  async verify_token(token: string): Promise<Record<string, unknown>> {
    return this.req("POST", "/v1/tokens/verify", { token });
  }

  private async req(
    method: string,
    path: string,
    body?: unknown
  ): Promise<Record<string, unknown>> {
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
    if (resp.status === 404) throw new AgentToolError(`not found`, { hint: path });
    if (!resp.ok) {
      const text = await resp.text();
      throw new AgentToolError(`${method} ${path} failed: ${resp.status}`, { hint: text.slice(0, 200) });
    }
    return resp.json() as Promise<Record<string, unknown>>;
  }
}
