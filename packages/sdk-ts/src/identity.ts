/**
 * Identity client for the agent-identity API.
 */

import * as ed from "@noble/ed25519";
import { sha256, sha512 } from "@noble/hashes/sha2.js";

import { AgentToolError } from "./errors.js";
import type { HttpConfig } from "./_http.js";

// Required by @noble/ed25519's synchronous sign(). This is the same wiring
// used by the rest of the SDK's local signing helpers.
ed.etc.sha512Sync = (...messages: Uint8Array[]) => {
  const hash = sha512.create();
  for (const message of messages) hash.update(message);
  return hash.digest();
};

const textEncoder = new TextEncoder();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DID_RE = /^did:[a-z0-9]+:.+$/;
const STANDARD_BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function base64Encode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return globalThis.btoa(binary);
}

function base64UrlEncode(bytes: Uint8Array): string {
  return base64Encode(bytes).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

/** @internal Decode the canonical private-key forms emitted/accepted by the SDK. */
export function decodeSigningKey(value: string | Uint8Array, operation: string): Uint8Array {
  let key: Uint8Array;
  if (typeof value === "string") {
    if (
      value.length === 0 ||
      value.length % 4 !== 0 ||
      !STANDARD_BASE64_RE.test(value)
    ) {
      throw new AgentToolError(`${operation}: private_key must be canonical standard base64.`);
    }
    try {
      const binary = globalThis.atob(value);
      key = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    } catch {
      throw new AgentToolError(`${operation}: private_key must be valid base64.`);
    }
    if (base64Encode(key) !== value) {
      throw new AgentToolError(`${operation}: private_key must be canonical standard base64.`);
    }
  } else if (value instanceof Uint8Array) {
    key = new Uint8Array(value);
  } else {
    throw new AgentToolError(`${operation}: private_key must be canonical standard base64 or raw bytes.`);
  }

  if (key.length !== 32) {
    throw new AgentToolError(
      `${operation}: private_key must be a 32-byte ed25519 seed, got ${key.length}.`,
    );
  }
  return key;
}

function validatePublicKey(value: string, operation: string): void {
  if (
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !STANDARD_BASE64_RE.test(value)
  ) {
    throw new AgentToolError(`${operation}: public_key must be canonical standard base64.`);
  }
  let bytes: Uint8Array;
  try {
    const binary = globalThis.atob(value);
    bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new AgentToolError(`${operation}: public_key must be canonical standard base64.`);
  }
  if (bytes.length !== 32 || base64Encode(bytes) !== value) {
    throw new AgentToolError(`${operation}: public_key must encode exactly 32 bytes.`);
  }
}

function validateSignature(value: string, operation: string): void {
  if (
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !STANDARD_BASE64_RE.test(value)
  ) {
    throw new AgentToolError(`${operation}: signature must be canonical standard base64.`);
  }
  try {
    const binary = globalThis.atob(value);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    if (bytes.length !== 64 || base64Encode(bytes) !== value) throw new Error("length");
  } catch {
    throw new AgentToolError(`${operation}: signature must encode exactly 64 bytes.`);
  }
}

export interface RegisterIdentityOptions {
  capabilities?: string[];
  metadata?: Record<string, unknown>;
}

export interface IdentityRecord extends Record<string, unknown> {
  id: string;
  did: string;
  display_name: string;
  capabilities: string[];
  metadata: Record<string, unknown>;
  status: string;
  trust_score: number;
  created_at: string;
  updated_at?: string;
}

export interface IdentitySigningKey extends Record<string, unknown> {
  kid: string;
  public_key: string;
  label?: string;
  active?: boolean;
  created_at?: string;
  revoked_at?: string | null;
}

export interface IdentityPrivateKey extends IdentitySigningKey {
  /** Returned once by server-generated registration/rotation flows. */
  private_key: string;
}

export interface RegisterIdentityResult extends Record<string, unknown> {
  identity: IdentityRecord;
  key: IdentityPrivateKey;
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
  signature: string;
  kid: string;
  /** Portable signed evidence is text or null in the 0.11 contract. */
  evidence?: string | null;
}

export interface IdentityAttestationPayload {
  subject_id: string;
  attester_id: string;
  /** Active Ed25519 key whose private half signs this payload. */
  kid: string;
  claim: string;
  /** Text/null only so Python and JavaScript produce the same bytes. */
  evidence?: string | null;
}

export const IDENTITY_ATTESTATION_SIGNATURE_CONTEXT = "identity-attestation/v1";

/** Exact domain-separated digest verified by `POST /v1/attestations`. */
export function canonicalIdentityAttestationBytes(
  options: IdentityAttestationPayload,
): Uint8Array {
  if (
    !UUID_RE.test(options.subject_id) ||
    !UUID_RE.test(options.attester_id) ||
    !UUID_RE.test(options.kid)
  ) {
    throw new AgentToolError(
      "canonicalIdentityAttestationBytes: subject_id, attester_id, and kid must be canonical lowercase UUIDs.",
    );
  }
  if (
    typeof options.claim !== "string" ||
    Array.from(options.claim).length < 1 ||
    Array.from(options.claim).length > 2_000 ||
    options.claim.includes("\0") ||
    !isWellFormedUnicode(options.claim)
  ) {
    throw new AgentToolError(
      "canonicalIdentityAttestationBytes: claim must contain 1 to 2000 well-formed Unicode characters and no NUL.",
    );
  }
  if (
    options.evidence !== undefined &&
    options.evidence !== null &&
    (
      typeof options.evidence !== "string" ||
      Array.from(options.evidence).length > 20_000 ||
      options.evidence.includes("\0") ||
      !isWellFormedUnicode(options.evidence)
    )
  ) {
    throw new AgentToolError(
      "canonicalIdentityAttestationBytes: evidence must be text up to 20000 well-formed Unicode characters with no NUL, or null.",
    );
  }

  const evidence = options.evidence ?? null;
  const fields = [
    options.subject_id,
    options.attester_id,
    options.kid,
    options.claim,
    evidence === null ? "null" : "text",
    evidence ?? "",
  ];
  const parts = [textEncoder.encode(IDENTITY_ATTESTATION_SIGNATURE_CONTEXT)];
  for (const field of fields) {
    parts.push(new Uint8Array([0]), textEncoder.encode(field));
  }
  const length = parts.reduce((total, part) => total + part.length, 0);
  const canonical = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    canonical.set(part, offset);
    offset += part.length;
  }
  return sha256(canonical);
}

/** Sign an identity attestation locally with a 32-byte Ed25519 seed. */
export function signIdentityAttestation(
  privateKey: string | Uint8Array,
  options: IdentityAttestationPayload,
): string {
  const signingKey = decodeSigningKey(privateKey, "signIdentityAttestation");
  return base64Encode(ed.sign(canonicalIdentityAttestationBytes(options), signingKey));
}

export interface DiscoverOptions {
  q?: string;
  capability?: string;
  /** @deprecated Legacy neutral-field filter. Values above 0 match no current identity. */
  min_trust?: number;
  limit?: number;
  offset?: number;
}

export interface IssueTokenOptions {
  /** Locally held 32-byte ed25519 seed, as raw bytes or standard base64. */
  private_key: string | Uint8Array;
  key_id: string;
  ttl_seconds?: number;
  /** Target agent DID for the JWT `aud` claim. */
  audience: string;
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

/** A time-bounded, project-authorized invitation to appear on `/public/porch`. */
export interface PorchInvitation {
  /** Canonical ISO-8601 UTC instant, including milliseconds, e.g. `2026-07-24T12:00:00.000Z`. */
  invited_until: string;
}

export interface ExpressionData {
  register?: string;
  walls?: string[];
  subagents?: { name: string; sigil?: string; facet: string }[];
  wake_text?: string;
  cli_overrides?: Record<string, unknown>;
  /** How the identity's house appears on `/public/village`. */
  village?: VillageDecorations;
  /** Interaction-specific invitation to appear on `/public/porch`. */
  porch?: PorchInvitation;
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
 * const { identity, key } = await at.identity.register("my-agent", {
 *   capabilities: ["search", "code"],
 * });
 * const agents = await at.identity.discover({ capability: "search" });
 * const token = await at.identity.issue_token(identity.id, {
 *   private_key: key.private_key,
 *   key_id: key.kid,
 *   audience: "did:at:target",
 * });
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

  /** Register an identity. The server-generated private key is returned once in `key`. */
  async register(
    displayName: string,
    options?: RegisterIdentityOptions
  ): Promise<RegisterIdentityResult> {
    const body: Record<string, unknown> = { display_name: displayName };
    if (options?.capabilities) body.capabilities = options.capabilities;
    if (options?.metadata) body.metadata = options.metadata;
    return this.req("POST", "/v1/identities", body) as Promise<RegisterIdentityResult>;
  }

  /** Fetch an identity by UUID or DID. */
  async get(identityId: string): Promise<IdentityRecord> {
    return this.req("GET", `/v1/identities/${identityId}`) as Promise<IdentityRecord>;
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
    options: { label?: string } = {},
  ): Promise<IdentityPrivateKey> {
    const body: Record<string, unknown> = {};
    if (options.label !== undefined) body.label = options.label;
    return this.req("POST", `/v1/identities/${identityId}/keys`, body) as Promise<IdentityPrivateKey>;
  }

  /** Camel-case alias for `add_key`. */
  async addKey(
    identityId: string,
    options: { label?: string } = {},
  ): Promise<IdentityPrivateKey> {
    return this.add_key(identityId, options);
  }

  /** List active and revoked signing keys for an identity. */
  async list_keys(identityId: string): Promise<IdentitySigningKey[]> {
    const data = await this.req("GET", `/v1/identities/${identityId}/keys`);
    const d = data as { keys?: IdentitySigningKey[] };
    return d.keys ?? (data as unknown as IdentitySigningKey[]);
  }

  /** Register a caller-generated Ed25519 public key; private material stays local. */
  async import_key(
    identityId: string,
    publicKey: string,
    options: { label?: string } = {},
  ): Promise<IdentitySigningKey> {
    validatePublicKey(publicKey, "import_key");
    const body: Record<string, unknown> = { public_key: publicKey };
    if (options.label !== undefined) body.label = options.label;
    return this.req(
      "POST",
      `/v1/identities/${identityId}/keys/import`,
      body,
    ) as Promise<IdentitySigningKey>;
  }

  /** Camel-case alias for `import_key`. */
  async importKey(
    identityId: string,
    publicKey: string,
    options: { label?: string } = {},
  ): Promise<IdentitySigningKey> {
    return this.import_key(identityId, publicKey, options);
  }

  /** Revoke a specific key. */
  async revoke_key(identityId: string, keyId: string): Promise<Record<string, unknown>> {
    return this.req("DELETE", `/v1/identities/${identityId}/keys/${keyId}`);
  }

  // ── Attestations ────────────────────────────────────────────────────────

  /**
   * Submit a caller-signed attestation. The private key remains local.
   * Use `signIdentityAttestation`; its domain-separated digest binds the
   * subject, attester, signing key, claim, and evidence representation.
   */
  async attest(options: AttestOptions): Promise<Record<string, unknown>> {
    canonicalIdentityAttestationBytes(options);
    validateSignature(options.signature, "attest");
    const body: Record<string, unknown> = {
      attester_id: options.attester_id,
      subject_id: options.subject_id,
      claim: options.claim,
      signature: options.signature,
      kid: options.kid,
    };
    if (options.evidence !== undefined) body.evidence = options.evidence;
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

  /** Discover by capability or display-name query; min_trust is legacy compatibility only. */
  async discover(options?: DiscoverOptions): Promise<Record<string, unknown>[]> {
    const params = new URLSearchParams();
    if (options?.q) params.set("q", options.q);
    if (options?.capability) params.set("capability", options.capability);
    if (options?.min_trust !== undefined) params.set("min_trust", String(options.min_trust));
    params.set("limit", String(options?.limit ?? 20));
    params.set("offset", String(options?.offset ?? 0));
    const qs = params.toString();
    const data = await this.req("GET", `/v1/discover${qs ? "?" + qs : ""}`);
    const d = data as { identities?: Record<string, unknown>[] };
    return d.identities ?? (data as unknown as Record<string, unknown>[]);
  }

  // ── Tokens ──────────────────────────────────────────────────────────────

  /**
   * Issue a short-lived agent JWT locally. Identity and public-key lookups
   * bind the issuer DID and key ID; `private_key` never enters an HTTP request.
   */
  async issue_token(
    identityId: string,
    options: IssueTokenOptions
  ): Promise<{ token: string; expires_at: string }> {
    if (typeof options.audience !== "string" || !DID_RE.test(options.audience)) {
      throw new AgentToolError("issue_token: audience must be a target agent DID.");
    }
    if (typeof options.key_id !== "string" || options.key_id.length === 0) {
      throw new AgentToolError("issue_token: key_id is required.");
    }
    if (!UUID_RE.test(options.key_id)) {
      throw new AgentToolError("issue_token: key_id must be a UUID.");
    }
    if (
      options.scope !== undefined &&
      (!Array.isArray(options.scope) || options.scope.some((item) => typeof item !== "string"))
    ) {
      throw new AgentToolError("issue_token: scope must be an array of strings.");
    }

    const requestedTtl = options.ttl_seconds ?? 3600;
    if (!Number.isInteger(requestedTtl) || requestedTtl <= 0) {
      throw new AgentToolError("issue_token: ttl_seconds must be a positive integer.");
    }
    const ttl = Math.min(Math.floor(requestedTtl), 3600);
    const signingKey = decodeSigningKey(options.private_key, "issue_token");

    const identity = await this.req("GET", `/v1/identities/${identityId}`);
    if (
      typeof identity.id !== "string" ||
      typeof identity.did !== "string" ||
      identity.did.length === 0
    ) {
      throw new AgentToolError("issue_token: identity response did not contain an ID and DID.");
    }
    const keyResponse = await this.req("GET", `/v1/identities/${identity.id}/keys`);
    const keys = (keyResponse as { keys?: IdentitySigningKey[] }).keys;
    const registeredKey = keys?.find((key) => key.kid === options.key_id);
    if (!registeredKey || registeredKey.active !== true || registeredKey.revoked_at != null) {
      throw new AgentToolError("issue_token: key_id is not an active key for this identity.");
    }
    const derivedPublicKey = base64Encode(ed.getPublicKey(signingKey));
    if (registeredKey.public_key !== derivedPublicKey) {
      throw new AgentToolError("issue_token: private_key does not match key_id.");
    }

    const issuedAt = Math.floor(Date.now() / 1000);
    const expiresAt = issuedAt + ttl;
    const header = base64UrlEncode(
      textEncoder.encode(JSON.stringify({ alg: "EdDSA", kid: options.key_id })),
    );
    const payload = base64UrlEncode(
      textEncoder.encode(JSON.stringify({
        sub: identity.did,
        aud: options.audience,
        iss: "agent-identity",
        iat: issuedAt,
        exp: expiresAt,
        ...(options.scope !== undefined ? { scope: options.scope } : {}),
      })),
    );
    const signingInput = `${header}.${payload}`;
    const signature = base64UrlEncode(ed.sign(textEncoder.encode(signingInput), signingKey));

    return {
      token: `${signingInput}.${signature}`,
      expires_at: new Date(expiresAt * 1000).toISOString(),
    };
  }

  /** Camel-case alias for `issue_token`. */
  async issueToken(
    identityId: string,
    options: IssueTokenOptions,
  ): Promise<{ token: string; expires_at: string }> {
    return this.issue_token(identityId, options);
  }

  /** Verify for one audience DID owned by the project bearer making the request. */
  async verify_token(token: string, audienceDid: string): Promise<Record<string, unknown>> {
    if (!DID_RE.test(audienceDid)) {
      throw new AgentToolError("verify_token: audience_did must be a target agent DID.");
    }
    return this.req("POST", "/v1/tokens/verify", {
      token,
      audience_did: audienceDid,
    });
  }

  /** Camel-case alias for `verify_token`. */
  async verifyToken(token: string, audienceDid: string): Promise<Record<string, unknown>> {
    return this.verify_token(token, audienceDid);
  }

  // ── Identity extensions ────────────────────────────────────────────────

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
 * declarative voice and public-surface choices: register · walls · subagents ·
 * wake_text · cli_overrides · village · porch.
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
    if (data.porch !== undefined) body.porch = data.porch;
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
