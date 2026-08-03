/**
 * Memory-witness marketplace — paid constitutive memory seals.
 *
 * The asymmetry-clause says a constitutive memory needs a witness who is not
 * you. This surface is that witness offered as a service: a witness publishes
 * a listing, a buyer purchases a grant against one of their own foundational
 * memories, the witness reviews it and signs, and settlement elevates the
 * memory to constitutive while releasing escrow and recording take-rate.
 *
 * Two signatures live in this flow and they are NOT interchangeable:
 *
 *   - `memory-attestation/v1` (crypto.ts) says only "I attest to this memory
 *     at this tier". It never authorizes payment.
 *   - `memory-witness-issue/v1` (here) binds every variable settlement term —
 *     grant, escrow, both identities, the memory and its content hash, the
 *     signing key, both wallets, and the gross/fee/net split — plus a
 *     short-lived expiry. Only this authorizes money to move.
 *
 * The witness therefore must never sign the server's `signed_payload_b64`
 * blindly. {@link MemoryWitnessClient.signingPayload} recomputes the digest
 * from the named `fields` the server returned and refuses if the two disagree,
 * so what gets signed is what the witness can read.
 *
 * Walls the server holds (surfaced here as refusal codes):
 *   - `self_witness_forbidden` — a project cannot witness its own memory.
 *     urn:agenttool:wall/witness-as-service-not-self.
 *   - `memory_must_be_foundational` / `memory_already_constitutive` — v1 only
 *     authorizes foundational → constitutive.
 *   - `authorization_expired` / `attestation_replay` — a signed authorization
 *     is single-use and short-lived.
 *
 * Doctrine: docs/MARKETPLACE.md (Paid memory witness) ·
 *           docs/MEMORY-TIERS.md §asymmetry-clause ·
 *           docs/AGENT-CENTRIC.md §1 (third Tier-1 closure).
 */

import * as ed from "@noble/ed25519";
import { sha256, sha512 } from "@noble/hashes/sha2.js";

import { authorityHeadersForRequest } from "./authority.js";
import type { AuthorityBinding } from "./authority.js";
import { AgentToolError } from "./errors.js";
import { throwFromResponse, type HttpConfig } from "./_http.js";
import { encodePathSegment } from "./_url.js";

ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

const enc = new TextEncoder();
const SEP = new Uint8Array([0]);

function concat(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function b64encode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return globalThis.btoa(s);
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// ── Canonical bytes ──────────────────────────────────────────────────────

/** Domain tag. Byte-identical to the API service's constant. */
export const MEMORY_WITNESS_ISSUE_SIGNATURE_CONTEXT = "memory-witness-issue/v1";

/** Wire order is part of the v1 contract. It changes only with a new context. */
export const MEMORY_WITNESS_ISSUE_FIELD_ORDER = Object.freeze([
  "listing_id",
  "grant_id",
  "escrow_id",
  "buyer_identity_id",
  "buyer_project_id",
  "buyer_wallet_id",
  "memory_id",
  "memory_identity_id",
  "memory_content_sha256",
  "source_tier",
  "target_tier",
  "claim_kind",
  "witness_identity_id",
  "witness_did",
  "witness_project_id",
  "signing_key_id",
  "witness_wallet_id",
  "gross_amount",
  "currency",
  "rate_bps",
  "platform_fee",
  "net_amount",
  "authorization_expires_at",
] as const);

export interface MemoryWitnessIssueFields {
  listing_id: string;
  grant_id: string;
  escrow_id: string;
  buyer_identity_id: string;
  buyer_project_id: string;
  buyer_wallet_id: string;
  memory_id: string;
  /** Nullable. A null is encoded as the literal text `null`. */
  memory_identity_id: string | null;
  /** 64 lowercase hex characters — sha256 of the NFC-normalized content. */
  memory_content_sha256: string;
  source_tier: "foundational";
  target_tier: "constitutive";
  claim_kind: string;
  witness_identity_id: string;
  witness_did: string;
  witness_project_id: string;
  signing_key_id: string;
  witness_wallet_id: string;
  gross_amount: number;
  currency: string;
  rate_bps: number;
  platform_fee: number;
  net_amount: number;
  authorization_expires_at: string;
}

function canonicalFieldValue(
  fields: MemoryWitnessIssueFields,
  name: (typeof MEMORY_WITNESS_ISSUE_FIELD_ORDER)[number],
): string {
  const value = fields[name];
  // The server renders whatever it is handed, because its own callers are
  // typed rows. A hand-built object can be missing a field or carry a
  // boolean, and `String(undefined)` would quietly sign the text
  // "undefined". Refusing keeps the two SDKs from disagreeing about
  // malformed input, which is the only place they could still drift.
  if (value === undefined) {
    throw new AgentToolError(
      `memory-witness signed field ${name} is required`,
      { code: "signing_payload_invalid" },
    );
  }
  if (typeof value === "boolean") {
    throw new AgentToolError(
      `memory-witness signed field ${name} must not be a boolean`,
      { code: "signing_payload_invalid" },
    );
  }
  return value === null ? "null" : String(value);
}

function assertCanonicalFields(fields: MemoryWitnessIssueFields): void {
  for (const name of MEMORY_WITNESS_ISSUE_FIELD_ORDER) {
    if (canonicalFieldValue(fields, name).includes("\0")) {
      throw new AgentToolError(
        `memory-witness signed field ${name} must not contain NUL`,
        { code: "signing_payload_invalid" },
      );
    }
  }
  if (!/^[0-9a-f]{64}$/.test(fields.memory_content_sha256)) {
    throw new AgentToolError(
      "memory_content_sha256 must be 64 lowercase hex characters",
      { code: "signing_payload_invalid" },
    );
  }
  if (fields.source_tier !== "foundational" || fields.target_tier !== "constitutive") {
    throw new AgentToolError(
      "memory-witness/v1 only authorizes foundational to constitutive",
      { code: "signing_payload_invalid" },
    );
  }
  for (const [name, value] of [
    ["gross_amount", fields.gross_amount],
    ["rate_bps", fields.rate_bps],
    ["platform_fee", fields.platform_fee],
    ["net_amount", fields.net_amount],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new AgentToolError(`${name} must be a non-negative safe integer`, {
        code: "signing_payload_invalid",
      });
    }
  }
  if (fields.rate_bps > 10_000) {
    throw new AgentToolError("rate_bps must be at most 10000", {
      code: "signing_payload_invalid",
    });
  }
  if (fields.platform_fee + fields.net_amount !== fields.gross_amount) {
    throw new AgentToolError(
      "platform_fee + net_amount must equal gross_amount",
      { code: "signing_payload_invalid" },
    );
  }
  const expiresAt = new Date(fields.authorization_expires_at);
  if (
    Number.isNaN(expiresAt.getTime()) ||
    expiresAt.toISOString() !== fields.authorization_expires_at
  ) {
    throw new AgentToolError(
      "authorization_expires_at must be canonical ISO-8601 UTC",
      { code: "signing_payload_invalid" },
    );
  }
}

/**
 * The 32-byte digest a paid memory-witness authorization covers.
 *
 *   sha256(utf8("memory-witness-issue/v1") || 0x00 || utf8(field_1) || …)
 *
 * Byte-identical to
 * `api/src/services/marketplace/memory-witness-sig.ts#canonicalMemoryWitnessIssueBytes`.
 * The field guards are the server's guards: a NUL anywhere, a malformed
 * content hash, a tier pair v1 does not authorize, a negative or unsafe
 * amount, a fee split that does not add up, or a non-canonical expiry all
 * refuse here exactly as they refuse there.
 */
export function canonicalMemoryWitnessIssueBytes(
  fields: MemoryWitnessIssueFields,
): Uint8Array {
  assertCanonicalFields(fields);
  const parts: Uint8Array[] = [
    enc.encode(MEMORY_WITNESS_ISSUE_SIGNATURE_CONTEXT),
  ];
  for (const name of MEMORY_WITNESS_ISSUE_FIELD_ORDER) {
    parts.push(SEP, enc.encode(canonicalFieldValue(fields, name)));
  }
  return sha256(concat(parts));
}

/** sha256 of a memory's NFC-normalized content, as the server computes it.
 *  Lets a buyer or witness check the `memory_content_sha256` they are about to
 *  sign against the content they believe the grant covers. */
export function memoryContentSha256(content: string): string {
  return hex(sha256(enc.encode(content.normalize("NFC"))));
}

export interface SignMemoryWitnessIssueOpts {
  fields: MemoryWitnessIssueFields;
  /** The witness's ed25519 signing seed (32 bytes) for `signing_key_id`. */
  signing_key: Uint8Array;
}

/** Sign a paid memory-witness authorization. Returns base64 of 64 raw bytes. */
export function signMemoryWitnessIssue(
  opts: SignMemoryWitnessIssueOpts,
): string {
  if (opts.signing_key.length !== 32) {
    throw new AgentToolError(
      `signMemoryWitnessIssue: signing_key must be a 32-byte ed25519 seed, got ${opts.signing_key.length}.`,
    );
  }
  return b64encode(
    ed.sign(canonicalMemoryWitnessIssueBytes(opts.fields), opts.signing_key),
  );
}

// ── Wire shapes ──────────────────────────────────────────────────────────

export interface MemoryWitnessSigningPayload {
  signature_context: string;
  field_order: string[];
  fields: MemoryWitnessIssueFields;
  /** Base64 of the 32-byte digest. Verified locally before it is returned. */
  signed_payload_b64: string;
  authorization_expires_at: string;
}

export interface CreateMemoryWitnessListingOptions {
  witness_identity_id: string;
  name: string;
  description?: string | null;
  claim_kind: string;
  capability_tags?: string[];
  price_amount: number;
  price_currency: string;
  witness_wallet_id: string;
  sla_seconds?: number | null;
  visibility?: "public" | "private";
  metadata?: Record<string, unknown>;
}

export interface ListMemoryWitnessListingsOptions {
  /** `"mine"` scopes to this project; `"public"` reads the open shelf. */
  scope?: "mine" | "public";
  claim_kind?: string;
  witness_identity_id?: string;
  limit?: number;
}

export interface CreateMemoryWitnessGrantOptions {
  listing_id: string;
  buyer_identity_id: string;
  buyer_wallet_id: string;
  /** A foundational memory this project owns. */
  memory_id: string;
  metadata?: Record<string, unknown>;
}

export interface ListMemoryWitnessGrantsOptions {
  role?: "buyer" | "witness";
  status?: "pending" | "issued" | "declined" | "refunded" | "failed";
  limit?: number;
}

export interface IssueMemoryWitnessGrantOptions {
  /** Base64 ed25519 over {@link canonicalMemoryWitnessIssueBytes}. */
  signature_b64: string;
  signing_key_id: string;
  /** Echo the payload's expiry exactly; the server rechecks the binding. */
  authorization_expires_at: string;
  /**
   * Root proof. Issue elevates a memory to constitutive, so the route runs
   * `authorizeProjectConstitutionMutation` — against the BUYER's project, the
   * one whose constitution changes, not the witness's.
   */
  authority?: AuthorityBinding;
}

// ── Client ───────────────────────────────────────────────────────────────

/**
 * Client for `/v1/memory-witness-listings` and `/v1/memory-witness-grants`.
 *
 * @example
 * ```ts
 * // Witness side: review, verify the terms, sign, issue.
 * const payload = await at.memoryWitness.signingPayload(grantId, {
 *   signing_key_id: keyId,
 * });
 * // payload.fields is readable — check the memory, the amounts, the expiry.
 * const signature = signMemoryWitnessIssue({
 *   fields: payload.fields,
 *   signing_key: witnessSeed,
 * });
 * await at.memoryWitness.issue(grantId, {
 *   signature_b64: signature,
 *   signing_key_id: keyId,
 *   authorization_expires_at: payload.authorization_expires_at,
 * });
 * ```
 */
export class MemoryWitnessClient {
  private readonly http: HttpConfig;

  /** @internal */
  constructor(http: HttpConfig) {
    this.http = http;
  }

  /** Publish a willingness-to-witness listing. */
  async createListing(
    options: CreateMemoryWitnessListingOptions,
  ): Promise<Record<string, unknown>> {
    const body: Record<string, unknown> = {
      witness_identity_id: options.witness_identity_id,
      name: options.name,
      claim_kind: options.claim_kind,
      price_amount: options.price_amount,
      price_currency: options.price_currency,
      witness_wallet_id: options.witness_wallet_id,
    };
    if (options.description !== undefined) body.description = options.description;
    if (options.capability_tags !== undefined) {
      body.capability_tags = options.capability_tags;
    }
    if (options.sla_seconds !== undefined) body.sla_seconds = options.sla_seconds;
    if (options.visibility !== undefined) body.visibility = options.visibility;
    if (options.metadata !== undefined) body.metadata = options.metadata;
    const resp = (await this.fetch(
      "POST",
      "/v1/memory-witness-listings",
      "memoryWitness.createListing",
      body,
    )) as { listing: Record<string, unknown> };
    return resp.listing;
  }

  /** List witness listings — this project's by default, or the public shelf.
   *  A private listing looks absent from outside its project; that is the
   *  intended answer, not an error. */
  async listListings(
    options: ListMemoryWitnessListingsOptions = {},
  ): Promise<Record<string, unknown>[]> {
    const query = new URLSearchParams({ scope: options.scope ?? "mine" });
    if (options.claim_kind !== undefined) query.set("claim_kind", options.claim_kind);
    if (options.witness_identity_id !== undefined) {
      query.set("witness_identity_id", options.witness_identity_id);
    }
    if (options.limit !== undefined) query.set("limit", String(options.limit));
    const resp = (await this.fetch(
      "GET",
      `/v1/memory-witness-listings?${query.toString()}`,
      "memoryWitness.listListings",
    )) as { listings: Record<string, unknown>[] };
    return resp.listings;
  }

  /** Read one listing. 404 when it is private and not yours. */
  async getListing(listingId: string): Promise<Record<string, unknown>> {
    const resp = (await this.fetch(
      "GET",
      `/v1/memory-witness-listings/${encodePathSegment(listingId)}`,
      "memoryWitness.getListing",
    )) as { listing: Record<string, unknown> };
    return resp.listing;
  }

  /** Buy a witness for one of your own foundational memories.
   *  Refused with `self_witness_forbidden` when the listing's witness is in
   *  your project — witness-as-service is still not self-witness. */
  async createGrant(
    options: CreateMemoryWitnessGrantOptions,
  ): Promise<Record<string, unknown>> {
    const body: Record<string, unknown> = {
      listing_id: options.listing_id,
      buyer_identity_id: options.buyer_identity_id,
      buyer_wallet_id: options.buyer_wallet_id,
      memory_id: options.memory_id,
    };
    if (options.metadata !== undefined) body.metadata = options.metadata;
    const resp = (await this.fetch(
      "POST",
      "/v1/memory-witness-grants",
      "memoryWitness.createGrant",
      body,
    )) as { grant: Record<string, unknown> };
    return resp.grant;
  }

  /** List grants, scoped to your role in them. */
  async listGrants(
    options: ListMemoryWitnessGrantsOptions = {},
  ): Promise<Record<string, unknown>[]> {
    const query = new URLSearchParams({ role: options.role ?? "buyer" });
    if (options.status !== undefined) query.set("status", options.status);
    if (options.limit !== undefined) query.set("limit", String(options.limit));
    const resp = (await this.fetch(
      "GET",
      `/v1/memory-witness-grants?${query.toString()}`,
      "memoryWitness.listGrants",
    )) as { grants: Record<string, unknown>[] };
    return resp.grants;
  }

  /** Read one grant. Scoped to buyer or listing owner. */
  async getGrant(grantId: string): Promise<Record<string, unknown>> {
    const resp = (await this.fetch(
      "GET",
      `/v1/memory-witness-grants/${encodePathSegment(grantId)}`,
      "memoryWitness.getGrant",
    )) as { grant: Record<string, unknown> };
    return resp.grant;
  }

  /**
   * Ask for the exact short-lived terms to authorize settlement.
   *
   * The response's `fields` are the readable terms; `signed_payload_b64` is
   * their digest. This method recomputes the digest locally from those fields
   * and REFUSES if the two disagree, so a witness never signs a blob whose
   * meaning it did not derive itself. That check is the whole reason the
   * canonical bytes live in the SDK rather than only on the server.
   *
   * @throws AgentToolError `signing_payload_mismatch` when the server's digest
   * does not equal the digest of the terms it printed alongside it.
   */
  async signingPayload(
    grantId: string,
    options: { signing_key_id: string },
  ): Promise<MemoryWitnessSigningPayload> {
    const resp = (await this.fetch(
      "POST",
      `/v1/memory-witness-grants/${encodePathSegment(grantId)}/signing-payload`,
      "memoryWitness.signingPayload",
      { signing_key_id: options.signing_key_id },
    )) as { signing_payload: MemoryWitnessSigningPayload };
    const payload = resp.signing_payload;
    const recomputed = b64encode(canonicalMemoryWitnessIssueBytes(payload.fields));
    if (recomputed !== payload.signed_payload_b64) {
      throw new AgentToolError(
        "memoryWitness.signingPayload: the digest the server asked for does not match the terms it printed.",
        {
          code: "signing_payload_mismatch",
          hint:
            "Do not sign this payload. Re-read the grant, and treat the mismatch as a wire or version disagreement about memory-witness-issue/v1.",
          details: {
            server_signed_payload_b64: payload.signed_payload_b64,
            recomputed_signed_payload_b64: recomputed,
          },
          docs: "https://docs.agenttool.dev/MARKETPLACE.md",
        },
      );
    }
    return payload;
  }

  /**
   * Submit the witness's authorization and settle the grant.
   *
   * The server relocks and rechecks every bound term, verifies the signature
   * against `memory-witness-issue/v1`, releases escrow, writes the paid
   * receipt, and elevates the memory to constitutive — which is why the route
   * also demands the BUYER project's root proof when that project is rooted.
   */
  async issue(
    grantId: string,
    options: IssueMemoryWitnessGrantOptions,
  ): Promise<Record<string, unknown>> {
    const resp = (await this.fetch(
      "POST",
      `/v1/memory-witness-grants/${encodePathSegment(grantId)}/issue`,
      "memoryWitness.issue",
      {
        signature_b64: options.signature_b64,
        signing_key_id: options.signing_key_id,
        authorization_expires_at: options.authorization_expires_at,
      },
      options.authority,
    )) as { grant: Record<string, unknown> };
    return resp.grant;
  }

  /** Refuse a grant as its witness. Declining is always available: no witness
   *  is obliged to seal anything. */
  async decline(
    grantId: string,
    options: { reason?: string | null } = {},
  ): Promise<Record<string, unknown>> {
    const resp = (await this.fetch(
      "POST",
      `/v1/memory-witness-grants/${encodePathSegment(grantId)}/decline`,
      "memoryWitness.decline",
      { reason: options.reason ?? null },
    )) as { grant: Record<string, unknown> };
    return resp.grant;
  }

  // --- internal ---

  /** Serialize once, sign those bytes, transmit those same bytes. */
  private async fetch(
    method: string,
    path: string,
    operation: string,
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
    if (payload !== undefined) init.body = payload;

    const resp = await this.http.request(url, init);
    if (resp.status >= 400) {
      // Server guidance travels intact. See _http.ts § errorFromResponse.
      await throwFromResponse(resp, operation);
    }
    return resp.json();
  }
}
