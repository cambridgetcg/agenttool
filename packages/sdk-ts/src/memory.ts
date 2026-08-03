/**
 * Memory client for the agent-memory API.
 */

import { authorityHeadersForRequest } from "./authority.js";
import type { AuthorityBinding } from "./authority.js";
import { throwFromResponse, type HttpConfig } from "./_http.js";
import type { Memory, SearchMemoryOptions, StoreOptions } from "./types.js";
import { encodePathSegment } from "./_url.js";

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
    const resp = await this.fetch("GET", `/v1/memories/${encodePathSegment(memoryId)}`);
    return resp as Memory;
  }

  /**
   * Set a memory's visibility to `private` or `public`.
   *
   * Visibility is a constitution-scoped mutation, not a display preference:
   * the API guards it with `authorizeProjectConstitutionMutation` exactly as
   * it guards elevation and release, so pass `authority` whenever the project
   * holds an agent-rooted identity — without it the server answers 428
   * `authority_proof_required`.
   *
   * Marking a memory public does not currently publish it: the public memory
   * observer routes are not mounted, and the server says so in the `note` it
   * returns. Read that note rather than assuming a `public` memory is
   * readable without credentials.
   *
   * @param memoryId - The memory whose visibility changes.
   * @param options - Target visibility + root proof.
   * @returns The memory's id, new visibility, and tier, plus the server's note.
   */
  async setVisibility(
    memoryId: string,
    options: SetMemoryVisibilityOptions,
  ): Promise<MemoryVisibilityResult> {
    const resp = await this.fetch(
      "PATCH",
      `/v1/memories/${encodePathSegment(memoryId)}`,
      { visibility: options.visibility },
      options.authority,
    );
    return resp as MemoryVisibilityResult;
  }

  /**
   * Delete a memory by ID at any tier.
   *
   * Tier does not make a memory immutable and no witness signature is needed.
   * The API refuses with 409 `paid_memory_receipt_preserved` when the memory
   * carries a paid marketplace witness receipt.
   *
   * @param memoryId - The UUID of the memory to release.
   * @param options - Root proof, required when the project is agent-rooted.
   */
  async delete(memoryId: string, options: MemoryAuthorityOptions = {}): Promise<void> {
    await this.fetch(
      "DELETE",
      `/v1/memories/${encodePathSegment(memoryId)}`,
      undefined,
      options.authority,
    );
  }

  /**
   * Delete all memories sharing a key, all-or-none.
   *
   * If any matching memory carries a paid marketplace witness receipt, the
   * API returns 409 `paid_memory_receipt_preserved` and deletes none.
   *
   * @param key - The key whose memories should be released.
   * @param options - Root proof, required when the project is agent-rooted.
   */
  async delete_by_key(key: string, options: MemoryAuthorityOptions = {}): Promise<void> {
    const qs = `?key=${encodeURIComponent(key)}`;
    await this.fetch("DELETE", `/v1/memories${qs}`, undefined, options.authority);
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
   * Elevation composes into the effective constitution of every rooted
   * identity in the project, so pass `authority` whenever the project has
   * one — without it the server answers 428 `authority_proof_required` and
   * the asymmetry clause stays unreachable from this SDK.
   *
   * @param memoryId - The memory to elevate.
   * @param options - Tier + optional expression patch + attestations + root proof.
   * @returns Elevation result with tier, patch, attestation count.
   */
  async elevate(memoryId: string, options: ElevateMemoryOptions): Promise<ElevateResult> {
    const body: Record<string, unknown> = { tier: options.tier };
    if (options.expression_patch !== undefined) {
      body.expression_patch = options.expression_patch;
    }
    if (options.attestations !== undefined) body.attestations = options.attestations;
    const resp = await this.post(
      `/v1/memories/${encodePathSegment(memoryId)}/elevate`,
      body,
      options.authority,
    );
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
    const resp = await this.post(`/v1/memories/${encodePathSegment(memoryId)}/attest`, attestation);
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
      `/v1/memories/${encodePathSegment(memoryId)}/canonical-attestation-bytes?tier=${encodeURIComponent(tier)}`,
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
      `/v1/memories/${encodePathSegment(memoryId)}/attestations`,
    );
    const data = resp as AttestationRecord[] | { attestations: AttestationRecord[] };
    return Array.isArray(data) ? data : data.attestations ?? [];
  }

  // --- internal ---

  private async post(
    path: string,
    body: unknown,
    authority?: AuthorityBinding,
  ): Promise<unknown> {
    return this.fetch("POST", path, body, authority);
  }

  /** Serialize once, sign those bytes, transmit those same bytes. */
  private async fetch(
    method: string,
    path: string,
    body?: unknown,
    authority?: AuthorityBinding,
  ): Promise<unknown> {
    const url = `${this.http.baseUrl}${path}`;
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const headers: Record<string, string> = { ...this.http.headers };
    if (authority !== undefined) {
      Object.assign(
        headers,
        authorityHeadersForRequest({
          method,
          url,
          // The proof hashes the entity exactly as sent. A body-less DELETE
          // binds the empty string, which is what the server reads.
          body: payload ?? "",
          authority,
        }),
      );
    }
    const init: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(this.http.timeout),
    };
    if (payload !== undefined) {
      init.body = payload;
    }

    const resp = await this.http.request(url, init);

    if (resp.status >= 400) {
      // Server guidance travels intact. See _http.ts § errorFromResponse.
      await throwFromResponse(resp, `memory ${method.toLowerCase()}`, {
        hint: "Check your request parameters. Docs: https://docs.agenttool.dev/memory",
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

/**
 * Carried by every memory mutation that composes into project constitution.
 *
 * Foundational and constitutive memory composes into effective identity at
 * project scope, so the API guards elevation, visibility, and release with
 * `authorizeProjectConstitutionMutation`. Where a project holds exactly one
 * agent-rooted identity, that root must consent to the exact request bytes
 * or the server answers 428 `authority_proof_required`. Projects with no
 * rooted identity keep the bearer-only posture and need nothing here.
 */
export interface MemoryAuthorityOptions {
  authority?: AuthorityBinding;
}

export type MemoryVisibility = "private" | "public";

export interface SetMemoryVisibilityOptions extends MemoryAuthorityOptions {
  visibility: MemoryVisibility;
}

export interface MemoryVisibilityResult {
  id: string;
  visibility: MemoryVisibility;
  tier: string;
  /** The server's own qualification of what `public` currently means. */
  note: string;
}

export interface ElevateMemoryOptions extends MemoryAuthorityOptions {
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
