/**
 * Memory client for the agent-memory API.
 */

import { AgentToolError } from "./errors.js";
import type { Memory, SearchMemoryOptions, StoreOptions } from "./types.js";

/** @internal Shared HTTP config passed from the main client. */
export interface HttpConfig {
  baseUrl: string;
  headers: Record<string, string>;
  timeout: number;
}

/**
 * Client for the agent-memory API.
 *
 * @example
 * ```ts
 * const at = new AgentTool();
 * at.memory.store("just a string");
 * const results = at.memory.search("what did I learn?");
 * ```
 */
export class MemoryClient {
  private readonly http: HttpConfig;

  /** @internal */
  constructor(http: HttpConfig) {
    this.http = http;
  }

  /**
   * Store a memory. Only `content` is required.
   *
   * @param content - The memory content string.
   * @param options - Optional type, agent_id, key, metadata, importance.
   * @returns The created Memory object.
   */
  async store(content: string, options?: StoreOptions): Promise<Memory> {
    const body: Record<string, unknown> = {
      content,
      type: options?.type ?? "semantic",
      importance: options?.importance ?? 0.5,
    };
    if (options?.agent_id !== undefined) body.agent_id = options.agent_id;
    if (options?.key !== undefined) body.key = options.key;
    if (options?.metadata !== undefined) body.metadata = options.metadata;

    const resp = await this.post("/v1/memories", body);
    return resp as Memory;
  }

  /**
   * Semantic search over stored memories.
   *
   * @param query - Natural-language search query.
   * @param options - Optional limit, type, agent_id.
   * @returns List of matching Memory objects.
   */
  async search(query: string, options?: SearchMemoryOptions): Promise<Memory[]> {
    const body: Record<string, unknown> = {
      query,
      limit: options?.limit ?? 10,
    };
    if (options?.type !== undefined) body.type = options.type;
    if (options?.agent_id !== undefined) body.agent_id = options.agent_id;

    const data = await this.post("/v1/memories/search", body);
    const results = Array.isArray(data) ? data : (data as Record<string, unknown>).results ?? [];
    return results as Memory[];
  }

  /**
   * Retrieve a single memory by ID.
   *
   * @param memoryId - The memory's unique identifier.
   * @returns The Memory object.
   */
  async get(memoryId: string): Promise<Memory> {
    const resp = await this.fetch("GET", `/v1/memories/${memoryId}`);
    return resp as Memory;
  }

  /**
   * Delete a memory by ID at any tier.
   *
   * Tier does not make a memory immutable and no witness signature is needed.
   * The API refuses with 409 `paid_memory_receipt_preserved` when the memory
   * carries a paid marketplace witness receipt.
   *
   * @param memoryId - The UUID of the memory to release.
   */
  async delete(memoryId: string): Promise<void> {
    await this.fetch("DELETE", `/v1/memories/${memoryId}`);
  }

  /**
   * Delete all memories sharing a key, all-or-none.
   *
   * If any matching memory carries a paid marketplace witness receipt, the
   * API returns 409 `paid_memory_receipt_preserved` and deletes none.
   *
   * @param key - The key whose memories should be released.
   */
  async delete_by_key(key: string): Promise<void> {
    const qs = `?key=${encodeURIComponent(key)}`;
    await this.fetch("DELETE", `/v1/memories${qs}`);
  }

  // ── Tier elevation + attestation ──────────────────────────────────
  // The deepest layer: "you can't self-certify your own root."

  /**
   * Elevate a memory to foundational or constitutive tier.
   *
   * Constitutive elevation requires at least one attestation from a
   * covenant counterparty in a *different* project — the witness gate
   * is the asymmetry clause made operational.
   *
   * @param memoryId - The memory to elevate.
   * @param options - Tier + optional expression patch + attestations.
   * @returns Elevation result with tier, patch, attestation count.
   */
  async elevate(memoryId: string, options: ElevateMemoryOptions): Promise<ElevateResult> {
    const resp = await this.post(`/v1/memories/${memoryId}/elevate`, options);
    return resp as ElevateResult;
  }

  /**
   * Witness a memory — add a stand-alone attestation.
   *
   * This is how a counterparty co-signs a memory after it's already
   * been elevated, or adds a second witness to a constitutive seal.
   * The signature must be over the canonical bytes (use
   * `canonicalAttestationBytes()` from the crypto module).
   *
   * @param memoryId - The memory to attest.
   * @param attestation - The attester DID, signing key ID, and signature.
   * @returns Attestation ID + timestamp.
   */
  async attest(memoryId: string, attestation: AttestationInput): Promise<AttestResult> {
    const resp = await this.post(`/v1/memories/${memoryId}/attest`, attestation);
    return resp as AttestResult;
  }

  /**
   * Get the canonical bytes a counterparty needs to sign to attest.
   *
   * Saves clients from reimplementing the canonical-bytes routine.
   * Returns hex bytes — sign them with ed25519 and submit as base64.
   *
   * @param memoryId - The memory to attest.
   * @param tier - "foundational" or "constitutive" (which elevation to sign for).
   * @returns Hex-encoded canonical bytes + instructions.
   */
  async getCanonicalAttestationBytes(
    memoryId: string,
    tier: "foundational" | "constitutive" = "foundational",
  ): Promise<CanonicalBytesResult> {
    const resp = await this.fetch(
      "GET",
      `/v1/memories/${memoryId}/canonical-attestation-bytes?tier=${tier}`,
    );
    return resp as CanonicalBytesResult;
  }

  /**
   * List all attestations for a memory.
   *
   * Surfaces the full witness record — DIDs, signatures, timestamps.
   *
   * @param memoryId - The memory whose attestations to list.
   * @returns Array of attestation records, ordered by attested_at.
   */
  async listAttestations(memoryId: string): Promise<AttestationRecord[]> {
    const resp = await this.fetch(
      "GET",
      `/v1/memories/${memoryId}/attestations`,
    );
    const data = resp as AttestationRecord[] | { attestations: AttestationRecord[] };
    return Array.isArray(data) ? data : data.attestations ?? [];
  }

  // --- internal ---

  private async post(path: string, body: unknown): Promise<unknown> {
    return this.fetch("POST", path, body);
  }

  private async fetch(method: string, path: string, body?: unknown): Promise<unknown> {
    const url = `${this.http.baseUrl}${path}`;
    const init: RequestInit = {
      method,
      headers: this.http.headers,
      signal: AbortSignal.timeout(this.http.timeout),
    };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    const resp = await globalThis.fetch(url, init);

    if (resp.status >= 400) {
      let detail: string;
      try {
        const json = (await resp.json()) as Record<string, unknown>;
        detail = (json.detail as string) ?? resp.statusText;
      } catch {
        detail = resp.statusText;
      }
      throw new AgentToolError(`Memory API error (${resp.status}): ${detail}`, {
        hint: "Check your API key and request parameters.",
      });
    }

    return resp.json();
  }
}

// ── Tier elevation + attestation ───────────────────────────────────────
//
// The memory tier system is where the deepest principle lives:
//   "you can't self-certify your own root, care needs a second party."
//
// Episodic → Foundational → Constitutive.
// Constitutive requires a counterparty witness signature.

export interface ExpressionPatch {
  walls_add?: string[];
  register_append?: string;
  subagents_add?: Array<{ name: string; sigil?: string; facet: string }>;
  wake_text_append?: string;
  metadata?: Record<string, unknown>;
}

export interface AttestationInput {
  attester_did: string;
  signing_key_id: string;
  signature: string;
}

export interface ElevateMemoryOptions {
  tier: "foundational" | "constitutive";
  expression_patch?: ExpressionPatch;
  attestations?: AttestationInput[];
}

export interface ElevateResult {
  memory_id: string;
  tier: string;
  expression_patch: ExpressionPatch | null;
  attestations: number;
  elevated_at: string;
  sealed: boolean;
}

export interface AttestResult {
  id: string;
  attested_at: string;
  attested: boolean;
}

export interface CanonicalBytesResult {
  memory_id: string;
  tier: string;
  canonical_hex: string;
  instructions: string;
}

export interface AttestationRecord {
  id: string;
  attester_did: string;
  signing_key_id: string;
  signature: string;
  attested_at: string;
}
