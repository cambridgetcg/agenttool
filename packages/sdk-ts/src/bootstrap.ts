/**
 * Bootstrap client for the agent-bootstrap API.
 *
 * One call creates the project's initial agent records: identity (DID and key),
 * wallet, memory namespace, and a best-effort welcome memory. It does not create
 * every resource the agent may later use.
 */

import * as ed from "@noble/ed25519";
import { sha256, sha512 } from "@noble/hashes/sha2.js";

import { AgentToolError } from "./errors.js";

ed.etc.sha512Sync = (...messages: Uint8Array[]) => {
  const hash = sha512.create();
  for (const message of messages) hash.update(message);
  return hash.digest();
};

export const BOOTSTRAP_ELEVATE_SIGNATURE_CONTEXT = "bootstrap-elevate/v1";
export const DEFAULT_BOOTSTRAP_ELEVATE_INITIAL_CREDITS = 1000;
export const DEFAULT_BOOTSTRAP_ELEVATE_CLAIM = "sponsorship";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STANDARD_BASE64_RE =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const encoder = new TextEncoder();

function base64Encode(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]!);
  }
  return globalThis.btoa(binary);
}

function base64Decode(value: string, operation: string): Uint8Array {
  if (
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !STANDARD_BASE64_RE.test(value)
  ) {
    throw new AgentToolError(`${operation}: value must be canonical standard base64.`);
  }
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(globalThis.atob(value), (character) =>
      character.charCodeAt(0),
    );
  } catch {
    throw new AgentToolError(`${operation}: value must be valid base64.`);
  }
  if (base64Encode(bytes) !== value) {
    throw new AgentToolError(`${operation}: value must be canonical standard base64.`);
  }
  return bytes;
}

function canonicalUuid(value: string, field: string): string {
  if (typeof value !== "string" || !UUID_RE.test(value)) {
    throw new AgentToolError(
      `canonicalBootstrapElevateBytes: ${field} must be a UUID.`,
    );
  }
  return value.toLowerCase();
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function validateCanonicalText(
  value: unknown,
  field: string,
  minLength: number,
  maxLength: number,
): asserts value is string {
  if (
    typeof value !== "string" ||
    value.includes("\0") ||
    !isWellFormedUnicode(value) ||
    Array.from(value).length < minLength ||
    Array.from(value).length > maxLength
  ) {
    throw new AgentToolError(
      `canonicalBootstrapElevateBytes: ${field} must contain ${minLength}-${maxLength} Unicode scalar values and no NUL.`,
    );
  }
}

function concatWithNul(parts: readonly Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.length, 0) + parts.length - 1;
  const result = new Uint8Array(length);
  let offset = 0;
  for (let index = 0; index < parts.length; index += 1) {
    result.set(parts[index]!, offset);
    offset += parts[index]!.length;
    if (index < parts.length - 1) {
      result[offset] = 0;
      offset += 1;
    }
  }
  return result;
}

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
  sponsor_kid: string;
  sponsor_signature: string;
  /** Internal unbacked ledger grant; no sponsor wallet is debited. */
  initial_credits?: number;
  claim?: string;
  /** Portable signed evidence is text or null, never structured JSON. */
  evidence?: string | null;
}

export interface BootstrapElevateCanonicalOptions {
  agent_id: string;
  /** The DID returned by the API for the sponsor identity. */
  sponsor_did: string;
  sponsor_kid: string;
  initial_credits?: number;
  claim?: string;
  evidence?: string | null;
}

/**
 * Compute the exact 32-byte digest verified by `POST /v1/bootstrap/elevate`.
 * UUIDs are lowercase in the digest. Null and empty-text evidence are distinct.
 */
export function canonicalBootstrapElevateBytes(
  options: BootstrapElevateCanonicalOptions,
): Uint8Array {
  const agentId = canonicalUuid(options.agent_id, "agent_id");
  const sponsorKid = canonicalUuid(options.sponsor_kid, "sponsor_kid");
  const initialCredits =
    options.initial_credits ?? DEFAULT_BOOTSTRAP_ELEVATE_INITIAL_CREDITS;
  const claim = options.claim ?? DEFAULT_BOOTSTRAP_ELEVATE_CLAIM;
  const evidence = options.evidence ?? null;

  validateCanonicalText(options.sponsor_did, "sponsor_did", 1, 255);
  validateCanonicalText(claim, "claim", 1, 64);
  if (evidence !== null) validateCanonicalText(evidence, "evidence", 0, 20_000);
  if (
    !Number.isInteger(initialCredits) ||
    initialCredits < 0 ||
    initialCredits > 1_000_000
  ) {
    throw new AgentToolError(
      "canonicalBootstrapElevateBytes: initial_credits must be an integer in [0, 1000000].",
    );
  }

  return sha256(concatWithNul([
    encoder.encode(BOOTSTRAP_ELEVATE_SIGNATURE_CONTEXT),
    encoder.encode(agentId),
    encoder.encode(options.sponsor_did),
    encoder.encode(sponsorKid),
    encoder.encode(String(initialCredits)),
    encoder.encode(claim),
    encoder.encode(evidence === null ? "null" : "text"),
    encoder.encode(evidence ?? ""),
  ]));
}

/** Sign a bootstrap elevation locally with a base64 or raw 32-byte seed. */
export function signBootstrapElevate(
  privateKey: string | Uint8Array,
  options: BootstrapElevateCanonicalOptions,
): string {
  const signingKey =
    typeof privateKey === "string"
      ? base64Decode(privateKey, "signBootstrapElevate private_key")
      : new Uint8Array(privateKey);
  if (signingKey.length !== 32) {
    throw new AgentToolError(
      `signBootstrapElevate: private_key must be a 32-byte ed25519 seed, got ${signingKey.length}.`,
    );
  }
  return base64Encode(ed.sign(canonicalBootstrapElevateBytes(options), signingKey));
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
   * Create a project-authorized Level 1 record signed by a distinct sponsor identity.
   *
   * Orchestrates four operations in one server-side transaction: sponsor
   * attestation insert · internal unbacked seed ledger grant · vault namespace open ·
   * identity metadata patch (level=1, sponsor_did, elevated_at). Rollback
   * on any failure — no half-elevated state.
   * Level is a project-managed convention, not independent security authority;
   * this operation creates no stake or sponsor debit.
   *
   * The `sponsor_signature` must be a base64-encoded ed25519 signature over
   * `canonicalBootstrapElevateBytes(...)`. The digest binds the context,
   * agent, resolved sponsor DID, exact sponsor key, credits, claim, and
   * text/null evidence. Sign locally with `signBootstrapElevate`; no private
   * key is sent to the API.
   */
  async elevate(agentId: string, options: ElevateOptions): Promise<Record<string, unknown>> {
    const initialCredits =
      options.initial_credits ?? DEFAULT_BOOTSTRAP_ELEVATE_INITIAL_CREDITS;
    const claim = options.claim ?? DEFAULT_BOOTSTRAP_ELEVATE_CLAIM;
    const evidence = options.evidence ?? null;
    canonicalBootstrapElevateBytes({
      agent_id: agentId,
      sponsor_did: options.sponsor_did,
      sponsor_kid: options.sponsor_kid,
      initial_credits: initialCredits,
      claim,
      evidence,
    });
    const signature = base64Decode(
      options.sponsor_signature,
      "BootstrapClient.elevate sponsor_signature",
    );
    if (signature.length !== 64) {
      throw new AgentToolError(
        "BootstrapClient.elevate: sponsor_signature must encode exactly 64 bytes.",
      );
    }
    const body: Record<string, unknown> = {
      agent_id: agentId,
      sponsor_did: options.sponsor_did,
      sponsor_kid: options.sponsor_kid,
      sponsor_signature: options.sponsor_signature,
      initial_credits: initialCredits,
      claim,
      evidence,
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
