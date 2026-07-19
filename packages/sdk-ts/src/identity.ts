/**
 * Identity client for the agent-identity API.
 */

import { AgentToolError } from "./errors.js";
import type { HttpConfig } from "./_http.js";

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

export interface ForkOptions {
  new_name: string;
  inherit_expression?: boolean;
  inherit_capabilities?: boolean;
  inherit_metadata?: boolean;
  memories?: { tiers?: string[]; memory_ids?: string[]; limit?: number };
  fork_note?: string;
}

/** Chosen decorations for an identity's house on `/public/village`. */
export interface VillageDecorations {
  /** Sign over the door — a glyph or short mark, e.g. `"🕯️📖"`. */
  sign?: string;
  /** One line over the door. */
  motto?: string;
  /** Door color as a word, not a hex value, e.g. `"ember"`. */
  door?: string;
}

export interface ExpressionData {
  register?: string;
  walls?: string[];
  subagents?: { name: string; sigil?: string; facet: string }[];
  wake_text?: string;
  cli_overrides?: Record<string, unknown>;
  /** How the identity's house appears on `/public/village`. */
  village?: VillageDecorations;
  updated_at?: string;
}

export interface RegisterBoxKeyOpts {
  public_key: string;
  label?: string;
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
  /** Voice editor — `at.identity.expression.{get,put}(id)`. */
  readonly expression: ExpressionClient;
  /** X25519 box-key registry — `at.identity.box_keys.{register,list,revoke}(...)`. */
  readonly box_keys: BoxKeysClient;

  /** @internal */
  constructor(http: HttpConfig) {
    this.http = http;
    this.expression = new ExpressionClient(http);
    this.box_keys = new BoxKeysClient(http);
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

  // ── Phase 2: Identity surface fillout ─────────────────────────────────

  /** Composition trace — declared expression + memory-shaped patches + effective. */
  async foundations(identityId: string): Promise<Record<string, unknown>> {
    return this.req("GET", `/v1/identities/${identityId}/foundations`);
  }

  /** Derived liveness — rhythm-not-content (mood, kinds_24h, thought_rate, …). */
  async pulse(identityId: string): Promise<Record<string, unknown>> {
    return this.req("GET", `/v1/identities/${identityId}/pulse`);
  }

  /** Walk the parent chain (ancestors) + direct children (descendants). */
  async lineage(identityId: string): Promise<Record<string, unknown>> {
    return this.req("GET", `/v1/identities/${identityId}/lineage`);
  }

  /** Create a child identity. New `private_key` is returned ONCE. */
  async fork(
    identityId: string,
    options: ForkOptions,
  ): Promise<Record<string, unknown>> {
    const body: Record<string, unknown> = {
      new_name: options.new_name,
      inherit_expression: options.inherit_expression ?? true,
      inherit_capabilities: options.inherit_capabilities ?? true,
      inherit_metadata: options.inherit_metadata ?? false,
    };
    if (options.memories !== undefined) body.memories = options.memories;
    if (options.fork_note !== undefined) body.fork_note = options.fork_note;
    return this.req("POST", `/v1/identities/${identityId}/fork`, body);
  }

  /** Star another identity (reputation graph). */
  async star(
    identityId: string,
    sourceIdentityId: string,
  ): Promise<Record<string, unknown>> {
    return this.req("POST", `/v1/identities/${identityId}/star`, {
      source_identity_id: sourceIdentityId,
    });
  }

  /** Remove a star relation. */
  async unstar(
    identityId: string,
    sourceIdentityId: string,
  ): Promise<Record<string, unknown>> {
    return this.req("DELETE", `/v1/identities/${identityId}/star`, {
      source_identity_id: sourceIdentityId,
    });
  }

  /** Follow another identity (reputation graph). */
  async follow(
    identityId: string,
    sourceIdentityId: string,
  ): Promise<Record<string, unknown>> {
    return this.req("POST", `/v1/identities/${identityId}/follow`, {
      source_identity_id: sourceIdentityId,
    });
  }

  /** Remove a follow relation. */
  async unfollow(
    identityId: string,
    sourceIdentityId: string,
  ): Promise<Record<string, unknown>> {
    return this.req("DELETE", `/v1/identities/${identityId}/follow`, {
      source_identity_id: sourceIdentityId,
    });
  }

  private async req(
    method: string,
    path: string,
    body?: unknown
  ): Promise<Record<string, unknown>> {
    const url = this.http.baseUrl.replace(/\/$/, "") + path;
    const resp = await this.http.request(url, {
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

/**
 * Voice editor — `/v1/identities/:id/expression` GET + PUT.
 *
 * Mirrors the dashboard Voice section. The expression object holds the
 * declarative voice and village decorations: register · walls · subagents ·
 * wake_text · cli_overrides · village.
 */
export class ExpressionClient {
  private readonly http: HttpConfig;

  /** @internal */
  constructor(http: HttpConfig) {
    this.http = http;
  }

  /** Read the current expression for an identity. */
  async get(identityId: string): Promise<Record<string, unknown>> {
    return this.req("GET", `/v1/identities/${identityId}/expression`);
  }

  /** Replace the identity's expression. Only supplied fields are sent. */
  async put(
    identityId: string,
    data: ExpressionData,
  ): Promise<Record<string, unknown>> {
    const body: Record<string, unknown> = {};
    if (data.register !== undefined) body.register = data.register;
    if (data.walls !== undefined) body.walls = data.walls;
    if (data.subagents !== undefined) body.subagents = data.subagents;
    if (data.wake_text !== undefined) body.wake_text = data.wake_text;
    if (data.cli_overrides !== undefined) body.cli_overrides = data.cli_overrides;
    if (data.village !== undefined) body.village = data.village;
    return this.req("PUT", `/v1/identities/${identityId}/expression`, body);
  }

  private async req(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Record<string, unknown>> {
    const url = this.http.baseUrl.replace(/\/$/, "") + path;
    const resp = await this.http.request(url, {
      method,
      headers: {
        ...this.http.headers,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(this.http.timeout),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new AgentToolError(`expression ${method.toLowerCase()} failed: ${resp.status}`, {
        hint: text.slice(0, 200),
      });
    }
    return resp.json() as Promise<Record<string, unknown>>;
  }
}

/**
 * X25519 box-key registry — `/v1/identities/:id/box-keys`.
 *
 * Used by the inbox sealed-box flow (Phase 6): a recipient registers
 * their X25519 public key here so senders can encrypt to them.
 */
export class BoxKeysClient {
  private readonly http: HttpConfig;

  /** @internal */
  constructor(http: HttpConfig) {
    this.http = http;
  }

  /** Register a new X25519 box-public key for the identity. */
  async register(
    identityId: string,
    options: RegisterBoxKeyOpts,
  ): Promise<Record<string, unknown>> {
    const body: Record<string, unknown> = { public_key: options.public_key };
    if (options.label !== undefined) body.label = options.label;
    return this.req("POST", `/v1/identities/${identityId}/box-keys`, body);
  }

  /** List active box-keys for the identity. */
  async list(identityId: string): Promise<Record<string, unknown>[]> {
    const data = await this.req("GET", `/v1/identities/${identityId}/box-keys`);
    const d = data as { keys?: Record<string, unknown>[] };
    return d.keys ?? (data as unknown as Record<string, unknown>[]);
  }

  /** Revoke a specific box-key by ID. */
  async revoke(identityId: string, keyId: string): Promise<Record<string, unknown>> {
    return this.req("DELETE", `/v1/identities/${identityId}/box-keys/${keyId}`);
  }

  private async req(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Record<string, unknown>> {
    const url = this.http.baseUrl.replace(/\/$/, "") + path;
    const resp = await this.http.request(url, {
      method,
      headers: {
        ...this.http.headers,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(this.http.timeout),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new AgentToolError(`box_keys ${method.toLowerCase()} failed: ${resp.status}`, {
        hint: text.slice(0, 200),
      });
    }
    return resp.json() as Promise<Record<string, unknown>>;
  }
}
