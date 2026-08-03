/**
 * Attestation marketplace — willingness-to-attest, sold.
 *
 * Templates publish a voice. Listings publish a callable. An **attestation
 * listing publishes a willingness-to-attest**: an attester offers to review
 * evidence and, if satisfied, sign one specific class of claim at a price.
 * A buyer purchases a *grant* against a subject identity; the attester
 * reviews, asks for the exact short-lived digest, signs it, and delivers.
 * Settlement writes a row in `identity.attestations` and releases escrow with
 * the take-rate split.
 *
 * What is being sold is **review and issuance**, not trust. Payment proves
 * settlement and the signature proves which key made the claim; neither proves
 * the claim is true, that the issuer is accredited, or that any relying agent
 * should believe it. The legacy identity trust field stays neutral at `0`.
 *
 * Two signatures could be confused here and they are NOT interchangeable:
 *
 *   - `identity-attestation/v1` (identity.ts) is an ordinary unpaid
 *     attestation. It names no grant and authorizes no payment.
 *   - `attestation-issue/v1` (here) additionally binds one grant, one escrow,
 *     the buyer/subject/attester identities and DIDs, both wallets, the active
 *     signing key, the deterministic evidence hash, the current fee split, and
 *     both expiry terms. Only this authorizes money to move.
 *
 * The attester therefore must never sign the server's `signed_payload_b64`
 * blindly. {@link AttestationMarketplaceClient.signingPayload} recomputes the
 * digest from the named `fields` the server returned and refuses if the two
 * disagree, so what gets signed is what the attester can read. And because
 * `evidence_sha256` is the one field that says *what was reviewed*,
 * {@link attestationEvidenceSha256} lets the attester tie that hash back to
 * the evidence body on the grant row before signing.
 *
 * Walls the server holds (surfaced here as refusal codes):
 *   - `self_purchase_not_allowed` — the buyer cannot be the listing's
 *     attester. Buyer may equal subject; attester may equal subject.
 *   - `not_listing_owner` (403) — only the listing's project may issue or
 *     decline; only the buyer's project may cancel.
 *   - `signature_invalid` / `signing_key_revoked` /
 *     `signing_key_does_not_belong_to_attester` (401).
 *   - `attestation_replay` (409) — an exact signature is single-use.
 *   - `grant_sla_expired`, `grant_state_invalid: status=…`,
 *     `*_terms_changed` (409) — the bound terms drifted before settlement.
 *   - `insufficient_balance` (402) on purchase. No partial payments.
 *
 * Doctrine: docs/MARKETPLACE.md §"Attestation marketplace" ·
 *           docs/CANONICAL-BYTES.md §attestation-issue/v1.
 */

import * as ed from "@noble/ed25519";
import { sha256, sha512 } from "@noble/hashes/sha2.js";

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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

// ── Canonical bytes ──────────────────────────────────────────────────────

/** Domain tag. Byte-identical to the API service's constant. */
export const ATTESTATION_ISSUE_SIGNATURE_CONTEXT = "attestation-issue/v1";

/** The authorization the server prepares lives five minutes. Pinned so a
 *  caller can reason about the window without a round trip. */
export const ATTESTATION_ISSUE_AUTHORIZATION_TTL_SECONDS = 5 * 60;

/** Wire order is part of the v1 contract. It changes only with a new context. */
export const ATTESTATION_ISSUE_FIELD_ORDER = Object.freeze([
  "listing_id",
  "grant_id",
  "escrow_id",
  "buyer_identity_id",
  "buyer_did",
  "buyer_project_id",
  "buyer_wallet_id",
  "subject_identity_id",
  "subject_did",
  "attester_identity_id",
  "attester_did",
  "attester_project_id",
  "signing_key_id",
  "claim",
  "evidence_sha256",
  "attester_wallet_id",
  "grant_gross",
  "grant_currency",
  "take_rate_bps",
  "platform_fee",
  "attester_net",
  "validity_seconds",
  "attestation_expires_at",
  "authorization_expires_at",
] as const);

/** The UUID-shaped slots. The server matches lowercase hex only. */
const UUID_FIELDS = Object.freeze([
  "listing_id",
  "grant_id",
  "escrow_id",
  "buyer_identity_id",
  "buyer_project_id",
  "buyer_wallet_id",
  "subject_identity_id",
  "attester_identity_id",
  "attester_project_id",
  "signing_key_id",
  "attester_wallet_id",
] as const);

/** Free-form text slots. Non-empty, and no NUL — 0x00 is the delimiter. */
const TEXT_FIELDS = Object.freeze([
  "buyer_did",
  "subject_did",
  "attester_did",
  "claim",
  "grant_currency",
] as const);

const AMOUNT_FIELDS = Object.freeze([
  "grant_gross",
  "take_rate_bps",
  "platform_fee",
  "attester_net",
] as const);

export interface AttestationIssueFields {
  listing_id: string;
  grant_id: string;
  escrow_id: string;
  buyer_identity_id: string;
  buyer_did: string;
  buyer_project_id: string;
  buyer_wallet_id: string;
  subject_identity_id: string;
  subject_did: string;
  attester_identity_id: string;
  attester_did: string;
  attester_project_id: string;
  signing_key_id: string;
  claim: string;
  /** 64 lowercase hex characters — see {@link attestationEvidenceSha256}. */
  evidence_sha256: string;
  attester_wallet_id: string;
  grant_gross: number;
  grant_currency: string;
  take_rate_bps: number;
  platform_fee: number;
  attester_net: number;
  /** Null for an attestation that never expires. Paired with the next field. */
  validity_seconds: number | null;
  /** Null exactly when `validity_seconds` is null. Encoded as text `null`. */
  attestation_expires_at: string | null;
  authorization_expires_at: string;
}

function invalid(message: string): AgentToolError {
  return new AgentToolError(message, { code: "signing_payload_invalid" });
}

function canonicalFieldValue(
  fields: AttestationIssueFields,
  name: (typeof ATTESTATION_ISSUE_FIELD_ORDER)[number],
): string {
  const value = fields[name];
  // The server renders whatever it is handed, because its own callers are
  // typed rows. A hand-built object can be missing a field or carry a
  // boolean, and `String(undefined)` would quietly sign the text
  // "undefined". Refusing keeps the two SDKs from disagreeing about
  // malformed input, which is the only place they could still drift.
  if (value === undefined) {
    throw invalid(`attestation-issue signed field ${name} is required`);
  }
  if (typeof value === "boolean") {
    throw invalid(`attestation-issue signed field ${name} must not be a boolean`);
  }
  return value === null ? "null" : String(value);
}

function isCanonicalIso(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

/** The server's `validateFields`, re-stated. Every guard is the server's. */
function assertCanonicalFields(fields: AttestationIssueFields): void {
  for (const name of ATTESTATION_ISSUE_FIELD_ORDER) {
    // Reading every slot first is what turns a missing field into a named
    // refusal instead of a silently different digest.
    canonicalFieldValue(fields, name);
  }
  for (const name of UUID_FIELDS) {
    if (!UUID_RE.test(fields[name])) {
      throw invalid(`${name} must be a lowercase UUID`);
    }
  }
  for (const name of TEXT_FIELDS) {
    const value = fields[name];
    if (typeof value !== "string" || value.length === 0) {
      throw invalid(`${name} must be a non-empty string`);
    }
    if (value.includes("\0")) {
      throw invalid(`attestation-issue signed field ${name} must not contain NUL`);
    }
  }
  if (!SHA256_HEX_RE.test(fields.evidence_sha256)) {
    throw invalid("evidence_sha256 must be 64 lowercase hex characters");
  }
  for (const name of AMOUNT_FIELDS) {
    const value = fields[name];
    if (!Number.isSafeInteger(value) || value < 0) {
      throw invalid(`${name} must be a non-negative safe integer`);
    }
  }
  if (fields.take_rate_bps > 10_000) {
    throw invalid("take_rate_bps must be at most 10000");
  }
  if (fields.platform_fee + fields.attester_net !== fields.grant_gross) {
    throw invalid("platform_fee + attester_net must equal grant_gross");
  }
  if (
    fields.validity_seconds !== null &&
    (!Number.isSafeInteger(fields.validity_seconds) || fields.validity_seconds <= 0)
  ) {
    throw invalid("validity_seconds must be null or a positive safe integer");
  }
  if ((fields.validity_seconds === null) !== (fields.attestation_expires_at === null)) {
    throw invalid(
      "validity_seconds and attestation_expires_at must be null together",
    );
  }
  if (
    fields.attestation_expires_at !== null &&
    !isCanonicalIso(fields.attestation_expires_at)
  ) {
    throw invalid("attestation_expires_at must be canonical ISO-8601 UTC");
  }
  if (!isCanonicalIso(fields.authorization_expires_at)) {
    throw invalid("authorization_expires_at must be canonical ISO-8601 UTC");
  }
}

/**
 * The 32-byte digest a paid attestation issuance covers.
 *
 *   sha256(utf8("attestation-issue/v1") || 0x00 || utf8(field_1) || …)
 *
 * Byte-identical to
 * `api/src/services/marketplace/attestation-issue-sig.ts#canonicalAttestationIssueBytes`.
 * The field guards are the server's guards: a non-lowercase-UUID identifier,
 * an empty or NUL-bearing text field, a malformed evidence hash, a negative or
 * unsafe amount, a rate above 100%, a fee split that does not add up, a
 * validity/expiry pair that disagrees about nullness, or a non-canonical
 * timestamp all refuse here exactly as they refuse there.
 */
export function canonicalAttestationIssueBytes(
  fields: AttestationIssueFields,
): Uint8Array {
  assertCanonicalFields(fields);
  const parts: Uint8Array[] = [enc.encode(ATTESTATION_ISSUE_SIGNATURE_CONTEXT)];
  for (const name of ATTESTATION_ISSUE_FIELD_ORDER) {
    parts.push(SEP, enc.encode(canonicalFieldValue(fields, name)));
  }
  return sha256(concat(parts));
}

// ── The evidence hash ────────────────────────────────────────────────────

/**
 * Sorted-key, no-whitespace JSON — the exact spelling the server hashes to
 * produce `evidence_sha256`.
 *
 * Byte-identical to
 * `api/src/services/marketplace/attestation-issue-sig.ts#canonicalAttestationEvidenceJson`.
 * Anything that is not JSON — `undefined`, a non-finite number, a class
 * instance, a `Map` — is refused rather than coerced, because a coerced
 * evidence body would hash to something the attester never read.
 */
export function canonicalAttestationEvidenceJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw invalid("evidence_not_json: a non-finite number has no JSON form");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalAttestationEvidenceJson).join(",")}]`;
  }
  if (typeof value !== "object" || value === undefined) {
    throw invalid("evidence_not_json");
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw invalid("evidence_not_json: only plain objects have a canonical form");
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => {
      if (record[key] === undefined) {
        throw invalid("evidence_not_json: an undefined value has no JSON form");
      }
      return `${JSON.stringify(key)}:${canonicalAttestationEvidenceJson(record[key])}`;
    })
    .join(",")}}`;
}

/**
 * The `evidence_sha256` the server binds into the digest.
 *
 * Read the grant's `evidence` and pass it here. If the result does not equal
 * the `evidence_sha256` in the signing payload, the terms describe a review of
 * something other than what you read — do not sign. A grant with no evidence
 * hashes `null`, which is a real value and not an absence.
 */
export function attestationEvidenceSha256(value: unknown): string {
  return hex(sha256(enc.encode(canonicalAttestationEvidenceJson(value))));
}

// ── Signing ──────────────────────────────────────────────────────────────

export interface SignAttestationIssueOpts {
  fields: AttestationIssueFields;
  /** The attester's ed25519 signing seed (32 bytes) for `signing_key_id`. */
  signing_key: Uint8Array;
}

/** Sign a paid attestation issuance. Returns base64 of 64 raw bytes —
 *  the exact spelling `POST /:id/issue` accepts in its `signature` field. */
export function signAttestationIssue(opts: SignAttestationIssueOpts): string {
  if (opts.signing_key.length !== 32) {
    throw new AgentToolError(
      `signAttestationIssue: signing_key must be a 32-byte ed25519 seed, got ${opts.signing_key.length}.`,
    );
  }
  return b64encode(
    ed.sign(canonicalAttestationIssueBytes(opts.fields), opts.signing_key),
  );
}

// ── Wire shapes ──────────────────────────────────────────────────────────

export type AttestationListingVisibility = "private" | "public";
export type AttestationListingStatus = "active" | "paused" | "archived";
export type AttestationGrantStatus = "pending" | "issued" | "refunded" | "failed";
export type AttestationGrantRole = "buyer" | "attester" | "subject";

export interface AttestationIssueSigningPayload {
  signature_context: string;
  field_order: string[];
  fields: AttestationIssueFields;
  /** Base64 of the 32-byte digest. Verified locally before it is returned. */
  signed_payload_b64: string;
  authorization_expires_at: string;
}

export interface CreateAttestationListingOptions {
  attester_identity_id: string;
  name: string;
  claim: string;
  price_amount: number;
  price_currency: string;
  attester_wallet_id: string;
  description?: string | null;
  capability_tags?: string[];
  /** Published buyer guidance. The purchase route does NOT validate evidence
   *  against it — it is a contract between agents, not a server wall. */
  evidence_schema?: Record<string, unknown> | null;
  validity_seconds?: number | null;
  sla_seconds?: number | null;
  visibility?: AttestationListingVisibility;
  metadata?: Record<string, unknown>;
}

export interface ListAttestationListingsOptions {
  attester_id?: string;
  claim?: string;
  status?: AttestationListingStatus;
  /** `true` returns only this project's rows — the management view. The
   *  default collection is your own rows plus other projects' public ones. */
  mine?: boolean;
  limit?: number;
}

export interface PatchAttestationListingOptions {
  name?: string;
  description?: string | null;
  capability_tags?: string[];
  evidence_schema?: Record<string, unknown> | null;
  price_amount?: number;
  price_currency?: string;
  attester_wallet_id?: string;
  validity_seconds?: number | null;
  sla_seconds?: number | null;
  visibility?: AttestationListingVisibility;
  status?: AttestationListingStatus;
  metadata?: Record<string, unknown>;
}

export interface PurchaseAttestationGrantOptions {
  buyer_identity_id: string;
  buyer_wallet_id: string;
  /** Who the claim is about. May be the buyer, or someone else entirely. */
  subject_identity_id: string;
  /** Stored plaintext and hashed into the signed digest. Omitting it is not
   *  the same as `null`: an absent key sends no field, and the server then
   *  stores `null`, which hashes as the JSON text `null`. */
  evidence?: Record<string, unknown> | null;
}

export interface ListAttestationGrantsOptions {
  role?: AttestationGrantRole;
  status?: AttestationGrantStatus;
  limit?: number;
}

/** `GET /v1/attestation-grants/:id` answers with the role you hold in it.
 *  A project unrelated to the grant gets a 404, not an empty role. */
export interface AttestationGrantView {
  grant: Record<string, unknown>;
  role: "buyer" | "attester";
}

export interface IssueAttestationGrantOptions {
  /** Base64 ed25519 over {@link canonicalAttestationIssueBytes}. The server
   *  requires canonical standard base64 of exactly 64 bytes. */
  signature: string;
  signing_key_id: string;
  /** Echo the payload's expiry exactly; it is inside the signed bytes and the
   *  server rechecks the binding. */
  authorization_expires_at: string;
}

// ── Client ───────────────────────────────────────────────────────────────

/**
 * Client for `/v1/attestation-listings` and `/v1/attestation-grants`.
 *
 * @example
 * ```ts
 * // Attester side: review, verify the terms, sign, issue.
 * const payload = await at.attestationMarketplace.signingPayload(grantId, {
 *   signing_key_id: keyId,
 * });
 * const { grant } = await at.attestationMarketplace.getGrant(grantId);
 * // The one field that says WHAT you reviewed — check it yourself.
 * if (attestationEvidenceSha256(grant.evidence ?? null) !==
 *     payload.fields.evidence_sha256) throw new Error("not what I read");
 * await at.attestationMarketplace.issue(grantId, {
 *   signature: signAttestationIssue({
 *     fields: payload.fields,
 *     signing_key: attesterSeed,
 *   }),
 *   signing_key_id: keyId,
 *   authorization_expires_at: payload.authorization_expires_at,
 * });
 * ```
 */
export class AttestationMarketplaceClient {
  private readonly http: HttpConfig;

  /** @internal */
  constructor(http: HttpConfig) {
    this.http = http;
  }

  // --- listings ---

  /** Publish a willingness-to-attest listing. The attester identity and
   *  wallet must be active, owned by this project, and share the listing's
   *  currency. */
  async createListing(
    options: CreateAttestationListingOptions,
  ): Promise<Record<string, unknown>> {
    const body: Record<string, unknown> = {
      attester_identity_id: options.attester_identity_id,
      name: options.name,
      claim: options.claim,
      price_amount: options.price_amount,
      price_currency: options.price_currency,
      attester_wallet_id: options.attester_wallet_id,
    };
    if (options.description !== undefined) body.description = options.description;
    if (options.capability_tags !== undefined) {
      body.capability_tags = options.capability_tags;
    }
    if (options.evidence_schema !== undefined) {
      body.evidence_schema = options.evidence_schema;
    }
    if (options.validity_seconds !== undefined) {
      body.validity_seconds = options.validity_seconds;
    }
    if (options.sla_seconds !== undefined) body.sla_seconds = options.sla_seconds;
    if (options.visibility !== undefined) body.visibility = options.visibility;
    if (options.metadata !== undefined) body.metadata = options.metadata;
    const resp = (await this.fetch(
      "POST",
      "/v1/attestation-listings",
      "attestationMarketplace.createListing",
      body,
    )) as { listing: Record<string, unknown> };
    return resp.listing;
  }

  /** Browse the shelf. Default: this project's rows plus other projects'
   *  public ones. `mine: true` narrows to a strictly owned management view.
   *  A private listing looks absent from outside its project; that is the
   *  intended answer, not an error. */
  async listListings(
    options: ListAttestationListingsOptions = {},
  ): Promise<Record<string, unknown>[]> {
    const query = new URLSearchParams();
    if (options.attester_id !== undefined) {
      query.set("attester_id", options.attester_id);
    }
    if (options.claim !== undefined) query.set("claim", options.claim);
    if (options.status !== undefined) query.set("status", options.status);
    if (options.mine === true) query.set("mine", "true");
    if (options.limit !== undefined) query.set("limit", String(options.limit));
    const suffix = query.toString();
    const resp = (await this.fetch(
      "GET",
      suffix ? `/v1/attestation-listings?${suffix}` : "/v1/attestation-listings",
      "attestationMarketplace.listListings",
    )) as { listings: Record<string, unknown>[] };
    return resp.listings;
  }

  /** Read one listing. 404 when it is private and not yours. */
  async getListing(listingId: string): Promise<Record<string, unknown>> {
    const resp = (await this.fetch(
      "GET",
      `/v1/attestation-listings/${encodePathSegment(listingId)}`,
      "attestationMarketplace.getListing",
    )) as { listing: Record<string, unknown> };
    return resp.listing;
  }

  /** Amend your own listing. Only the keys you pass are touched; the price,
   *  claim wording, and payout wallet of already-purchased grants are frozen
   *  in those grants' own signed terms. */
  async patchListing(
    listingId: string,
    options: PatchAttestationListingOptions,
  ): Promise<Record<string, unknown>> {
    const body: Record<string, unknown> = {};
    for (const key of [
      "name",
      "description",
      "capability_tags",
      "evidence_schema",
      "price_amount",
      "price_currency",
      "attester_wallet_id",
      "validity_seconds",
      "sla_seconds",
      "visibility",
      "status",
      "metadata",
    ] as const) {
      const value = options[key];
      if (value !== undefined) body[key] = value;
    }
    const resp = (await this.fetch(
      "PATCH",
      `/v1/attestation-listings/${encodePathSegment(listingId)}`,
      "attestationMarketplace.patchListing",
      body,
    )) as { listing: Record<string, unknown> };
    return resp.listing;
  }

  /** Buy a grant against an active public listing. This is the ONLY mounted
   *  grant-creation operation — `POST /v1/attestation-grants` does not exist.
   *  Atomically debits the buyer wallet and funds escrow.
   *
   *  Refused with `self_purchase_not_allowed` when the buyer is the listing's
   *  attester, and with `insufficient_balance` (402) when the wallet cannot
   *  cover the gross. */
  async purchase(
    listingId: string,
    options: PurchaseAttestationGrantOptions,
  ): Promise<Record<string, unknown>> {
    const body: Record<string, unknown> = {
      buyer_identity_id: options.buyer_identity_id,
      buyer_wallet_id: options.buyer_wallet_id,
      subject_identity_id: options.subject_identity_id,
    };
    if (options.evidence !== undefined) body.evidence = options.evidence;
    const resp = (await this.fetch(
      "POST",
      `/v1/attestation-listings/${encodePathSegment(listingId)}/purchase`,
      "attestationMarketplace.purchase",
      body,
    )) as { grant: Record<string, unknown> };
    return resp.grant;
  }

  // --- grants ---

  /** List grants, scoped to the role you hold in them. Defaults to `buyer`;
   *  `attester` is the issuance queue. */
  async listGrants(
    options: ListAttestationGrantsOptions = {},
  ): Promise<Record<string, unknown>[]> {
    const query = new URLSearchParams({ role: options.role ?? "buyer" });
    if (options.status !== undefined) query.set("status", options.status);
    if (options.limit !== undefined) query.set("limit", String(options.limit));
    const resp = (await this.fetch(
      "GET",
      `/v1/attestation-grants?${query.toString()}`,
      "attestationMarketplace.listGrants",
    )) as { grants: Record<string, unknown>[] };
    return resp.grants;
  }

  /** Read one grant and the role you hold in it. The server tries buyer scope
   *  first, then attester scope, and 404s if you are neither — so `role` is
   *  the server's answer, not an echo of your request. */
  async getGrant(grantId: string): Promise<AttestationGrantView> {
    const resp = (await this.fetch(
      "GET",
      `/v1/attestation-grants/${encodePathSegment(grantId)}`,
      "attestationMarketplace.getGrant",
    )) as AttestationGrantView;
    return { grant: resp.grant, role: resp.role };
  }

  /**
   * Ask for the exact short-lived terms to authorize issuance.
   *
   * The response's `fields` are the readable terms; `signed_payload_b64` is
   * their digest. This method recomputes the digest locally from those fields
   * and REFUSES if the two disagree, so an attester never signs a blob whose
   * meaning it did not derive itself. That check is the whole reason the
   * canonical bytes live in the SDK rather than only on the server.
   *
   * The authorization lives five minutes. Sign and submit within it.
   *
   * @throws AgentToolError `signing_payload_mismatch` when the server's digest
   * does not equal the digest of the terms it printed alongside it.
   */
  async signingPayload(
    grantId: string,
    options: { signing_key_id: string },
  ): Promise<AttestationIssueSigningPayload> {
    const resp = (await this.fetch(
      "POST",
      `/v1/attestation-grants/${encodePathSegment(grantId)}/signing-payload`,
      "attestationMarketplace.signingPayload",
      { signing_key_id: options.signing_key_id },
    )) as { signing_payload: AttestationIssueSigningPayload };
    const payload = resp.signing_payload;
    const recomputed = b64encode(canonicalAttestationIssueBytes(payload.fields));
    if (recomputed !== payload.signed_payload_b64) {
      throw new AgentToolError(
        "attestationMarketplace.signingPayload: the digest the server asked for does not match the terms it printed.",
        {
          code: "signing_payload_mismatch",
          hint:
            "Do not sign this payload. Re-read the grant, and treat the mismatch as a wire or version disagreement about attestation-issue/v1.",
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
   * Submit the attester's authorization and settle the grant.
   *
   * The server relocks and rechecks every bound term, recomputes the current
   * fee split and evidence hash, verifies the signature against
   * `attestation-issue/v1`, writes the `identity.attestations` receipt,
   * credits the attester the net, releases the bound escrow, and records the
   * take-rate. There is no legacy fallback signature shape.
   *
   * Unlike memory-witness issuance, nothing here mutates a project's
   * constitution, so this route takes no root authority proof.
   */
  async issue(
    grantId: string,
    options: IssueAttestationGrantOptions,
  ): Promise<Record<string, unknown>> {
    const resp = (await this.fetch(
      "POST",
      `/v1/attestation-grants/${encodePathSegment(grantId)}/issue`,
      "attestationMarketplace.issue",
      {
        signature: options.signature,
        signing_key_id: options.signing_key_id,
        authorization_expires_at: options.authorization_expires_at,
      },
    )) as { grant: Record<string, unknown> };
    return resp.grant;
  }

  /** Refuse a grant as its attester. Declining is always available: no
   *  attester is obliged to sign anything. The buyer is refunded in full and
   *  the platform earns no fee. */
  async decline(grantId: string): Promise<Record<string, unknown>> {
    const resp = (await this.fetch(
      "POST",
      `/v1/attestation-grants/${encodePathSegment(grantId)}/decline`,
      "attestationMarketplace.decline",
    )) as { grant: Record<string, unknown> };
    return resp.grant;
  }

  /** Withdraw a grant as its buyer, while it is still `pending`. Once the
   *  attester issues, the claim is signed and the window is closed. */
  async cancel(grantId: string): Promise<Record<string, unknown>> {
    const resp = (await this.fetch(
      "POST",
      `/v1/attestation-grants/${encodePathSegment(grantId)}/cancel`,
      "attestationMarketplace.cancel",
    )) as { grant: Record<string, unknown> };
    return resp.grant;
  }

  // --- internal ---

  /** Serialize once, transmit those same bytes. */
  private async fetch(
    method: string,
    path: string,
    operation: string,
    body?: unknown,
  ): Promise<unknown> {
    const url = `${this.http.baseUrl}${path}`;
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const init: RequestInit = {
      method,
      headers: { ...this.http.headers },
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
