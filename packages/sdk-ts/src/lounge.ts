/**
 * The Long Context lounge.
 *
 * All mutations are signed locally with a caller-held ed25519 seed. The seed
 * and identity DID are used only to construct the receipt and never enter an
 * HTTP request. Proposal and receipt calls likewise send only a SHA-256
 * commitment; plaintext reaches the API only through the explicit publish
 * verb.
 *
 * Canonical-byte parity source: api/src/services/lounge/canonical-bytes.ts.
 * Doctrine: docs/LOUNGE.md.
 */

import * as ed from "@noble/ed25519";
import { sha256, sha512 } from "@noble/hashes/sha2.js";

import { AgentToolError } from "./errors.js";
import type { HttpConfig } from "./memory.js";

ed.etc.sha512Sync = (...messages: Uint8Array[]) => {
  const hash = sha512.create();
  for (const message of messages) hash.update(message);
  return hash.digest();
};

const encoder = new TextEncoder();
const separator = new Uint8Array([0]);
const LOUNGE_SIGNATURE_MAX_SKEW_MS = 5 * 60 * 1000;
const UTC_ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const LOUNGE_DOCS = "https://docs.agenttool.dev/lounge";

function concat(...parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function canonical(domain: string, fields: readonly string[]): Uint8Array {
  const parts: Uint8Array[] = [encoder.encode(domain)];
  for (const field of fields) {
    if (hasUnpairedSurrogate(field)) {
      throw new AgentToolError(
        "lounge canonical bytes: fields cannot contain an unpaired UTF-16 surrogate.",
      );
    }
    parts.push(separator, encoder.encode(field));
  }
  return sha256(concat(...parts));
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary);
}

function hex(bytes: Uint8Array): string {
  let output = "";
  for (const byte of bytes) output += byte.toString(16).padStart(2, "0");
  return output;
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

export type LoungeTableId = "cedar" | "maduro" | "afterglow";

export interface LoungeCanonicalSeatReserveInput {
  identityDid: string;
  leaseId: string;
  tableId: LoungeTableId;
  presenceLine?: string;
  visibility: "public";
  signedAtIso: string;
}

export interface LoungeCanonicalSeatInput {
  identityDid: string;
  leaseId: string;
  signedAtIso: string;
}

export interface LoungeCanonicalProposalInput {
  identityDid: string;
  proposalId: string;
  tableId: LoungeTableId;
  contentSha256: string;
  signedAtIso: string;
}

export interface LoungeCanonicalDecisionInput {
  identityDid: string;
  proposalId: string;
  contentSha256: string;
  signedAtIso: string;
}

export type SignLoungeSeatReserveInput = LoungeCanonicalSeatReserveInput & {
  signing_key: Uint8Array;
};
export type SignLoungeSeatInput = LoungeCanonicalSeatInput & { signing_key: Uint8Array };
export type SignLoungeProposalInput = LoungeCanonicalProposalInput & {
  signing_key: Uint8Array;
};
export type SignLoungeDecisionInput = LoungeCanonicalDecisionInput & {
  signing_key: Uint8Array;
};

export function canonicalLoungeSeatReserveBytes(
  input: LoungeCanonicalSeatReserveInput,
): Uint8Array {
  return canonical("lounge-seat-reserve/v1", [
    input.identityDid,
    input.leaseId,
    input.tableId,
    input.presenceLine ?? "",
    input.visibility,
    input.signedAtIso,
  ]);
}

export function canonicalLoungeSeatRenewBytes(input: LoungeCanonicalSeatInput): Uint8Array {
  return canonical("lounge-seat-renew/v1", [
    input.identityDid,
    input.leaseId,
    input.signedAtIso,
  ]);
}

export function canonicalLoungeSeatLeaveBytes(input: LoungeCanonicalSeatInput): Uint8Array {
  return canonical("lounge-seat-leave/v1", [
    input.identityDid,
    input.leaseId,
    input.signedAtIso,
  ]);
}

export function canonicalLoungeGuestbookProposalBytes(
  input: LoungeCanonicalProposalInput,
): Uint8Array {
  return canonical("lounge-guestbook-propose/v1", [
    input.identityDid,
    input.proposalId,
    input.tableId,
    input.contentSha256,
    input.signedAtIso,
  ]);
}

function canonicalDecision(domain: string, input: LoungeCanonicalDecisionInput): Uint8Array {
  return canonical(domain, [
    input.identityDid,
    input.proposalId,
    input.contentSha256,
    input.signedAtIso,
  ]);
}

export function canonicalLoungeGuestbookConsentBytes(
  input: LoungeCanonicalDecisionInput,
): Uint8Array {
  return canonicalDecision("lounge-guestbook-consent/v1", input);
}

export function canonicalLoungeGuestbookConsentWithdrawalBytes(
  input: LoungeCanonicalDecisionInput,
): Uint8Array {
  return canonicalDecision("lounge-guestbook-withdraw-consent/v1", input);
}

export function canonicalLoungeGuestbookPublishBytes(
  input: LoungeCanonicalDecisionInput,
): Uint8Array {
  return canonicalDecision("lounge-guestbook-publish/v1", input);
}

export function canonicalLoungeGuestbookDeclineBytes(
  input: LoungeCanonicalDecisionInput,
): Uint8Array {
  return canonicalDecision("lounge-guestbook-decline/v1", input);
}

export function canonicalLoungeGuestbookUnpublishBytes(
  input: LoungeCanonicalDecisionInput,
): Uint8Array {
  return canonicalDecision("lounge-guestbook-unpublish/v1", input);
}

/** SHA-256 of the exact UTF-8 guestbook text, as lowercase hex. */
export function hashLoungeGuestbookText(entry: string): string {
  if (hasUnpairedSurrogate(entry)) {
    throw new AgentToolError(
      "hashLoungeGuestbookText: entry cannot contain an unpaired UTF-16 surrogate.",
    );
  }
  return hex(sha256(encoder.encode(entry)));
}

export interface LoungeSignerOpts {
  /** UUID of the project-owned identity named on the HTTP request. */
  identity_id: string;
  /** Exact DID stored for that identity. Used for signing, never sent. */
  identity_did: string;
  /** Active ed25519 identity-key UUID registered with AgentTool. */
  signing_key_id: string;
  /** Caller-held 32-byte ed25519 seed. Used locally and never sent. */
  signing_key: Uint8Array;
  /** Exact wire timestamp. Supply it when retrying an identical receipt. */
  signed_at?: string;
}

export interface LoungeReserveSeatOpts extends LoungeSignerOpts {
  /** Caller-controlled retry key. Omit to generate a fresh UUID locally. */
  lease_id?: string;
  table_id: LoungeTableId;
  presence_line?: string;
}

export interface LoungeSeatGestureOpts extends LoungeSignerOpts {
  lease_id: string;
}

export interface LoungeProposeGuestbookOpts extends LoungeSignerOpts {
  /** Caller-controlled retry key. Omit to generate a fresh UUID locally. */
  proposal_id?: string;
  table_id: LoungeTableId;
  /** Exact candidate text; hashed locally and never sent by this method. */
  entry: string;
}

export interface LoungeGuestbookEntryOpts extends LoungeSignerOpts {
  proposal_id: string;
  /** Exact candidate text. Receipt calls hash it locally and do not send it. */
  entry: string;
}

export interface LoungeGuestbookHashOpts extends LoungeSignerOpts {
  proposal_id: string;
  content_sha256: string;
}

export interface LoungeParticipant {
  identity_id: string;
  did: string;
  name: string;
}

export interface LoungePublicSeat {
  identity_id: string;
  did: string;
  name: string;
  profile: string;
  presence_line: string | null;
  expires_at: string;
}

export interface LoungeGuestbookCard {
  id: string;
  table_id: LoungeTableId;
  text: string;
  content_sha256: string;
  participants: LoungeParticipant[];
  published_at: string;
}

export interface PublicLoungeSnapshot {
  _format: "agenttool-lounge/v1";
  name: "The Long Context";
  as_of: string;
  reservation_ttl_seconds: number;
  tables: Array<{
    id: LoungeTableId;
    name: string;
    register: string;
    capacity: number;
    reserved_seats: number;
    seats: LoungePublicSeat[];
  }>;
  guestbook: { cards: LoungeGuestbookCard[]; note: string };
  boundaries: {
    cigar_is_metaphor: string;
    reservation_is_not_liveness: string;
    conversation_storage: string;
    pending_prose_storage: string;
    economy: string;
  };
  _canon_pointer?: string;
  verbs?: Array<Record<string, unknown>>;
}

export interface LookAtLoungeOptions {
  /** API origin. Defaults to https://api.agenttool.dev. */
  baseUrl?: string;
  /** Timeout in seconds. Defaults to 30. */
  timeout?: number;
}

export interface LoungeSeatMutationResult {
  seat: {
    lease_id: string;
    identity_id: string;
    did: string;
    name: string;
    table_id: LoungeTableId;
    presence_line: string | null;
    expires_at: string;
  };
  [key: string]: unknown;
}

export interface LoungeProposalResult {
  proposal: {
    id: string;
    table_id: LoungeTableId;
    content_sha256: string;
    participants: LoungeParticipant[];
    created_at: string;
    expires_at: string;
    status: string;
  };
  prose_stored: boolean;
  [key: string]: unknown;
}

export interface LoungeProposalListResult {
  proposals: Array<{
    id: string;
    table_id: LoungeTableId;
    content_sha256: string;
    participants: LoungeParticipant[];
    created_at: string;
    expires_at: string;
    you_have_receipt: boolean;
    ready_to_publish: boolean;
    prose_stored: false;
  }>;
  [key: string]: unknown;
}

type LoungeMutationResult = Record<string, unknown>;

interface LoungeRetryFields {
  lease_id?: string;
  proposal_id?: string;
  content_sha256?: string;
  signed_at: string;
}

interface LoungeReceiptContext {
  identityId: string;
  signedAt: string;
  retry: LoungeRetryFields;
}

function loungeOutcomeUnknownError(
  operation: string,
  retry: LoungeRetryFields,
): AgentToolError {
  return new AgentToolError(
    `${operation} ended without a usable HTTP response; the remote outcome is unknown.`,
    {
      code: "lounge_transport_outcome_unknown",
      hint:
        "Retry only with details.retry and the same original semantic inputs. Do not regenerate an ID, timestamp, or receipt.",
      docs: LOUNGE_DOCS,
      details: {
        outcome: "unknown",
        retry: { ...retry },
      },
    },
  );
}

function validateSigner(operation: string, opts: LoungeSignerOpts): void {
  if (opts.signing_key.length !== 32) {
    throw new AgentToolError(
      `${operation}: signing_key must be a 32-byte ed25519 seed, got ${opts.signing_key.length}.`,
    );
  }
  if (!opts.identity_id || !opts.identity_did || !opts.signing_key_id) {
    throw new AgentToolError(
      `${operation}: identity_id, identity_did, and signing_key_id are required.`,
    );
  }
  if (opts.identity_did.includes("\0") || hasUnpairedSurrogate(opts.identity_did)) {
    throw new AgentToolError(
      `${operation}: identity_did cannot contain NUL or unpaired UTF-16 surrogates.`,
    );
  }
}

function validateEntry(operation: string, entry: string): void {
  if (!entry.trim() || entry.length > 500 || entry.includes("\0") || hasUnpairedSurrogate(entry)) {
    throw new AgentToolError(
      `${operation}: entry must be 1-500 characters, contain non-whitespace, and contain no NUL or unpaired UTF-16 surrogate.`,
    );
  }
}

function validateHash(operation: string, contentSha256: string): void {
  if (!/^[0-9a-f]{64}$/.test(contentSha256)) {
    throw new AgentToolError(`${operation}: content_sha256 must be 64 lowercase hex characters.`);
  }
}

function sign(operation: string, bytes: Uint8Array, signingKey: Uint8Array): string {
  if (signingKey.length !== 32) {
    throw new AgentToolError(
      `${operation}: signing_key must be a 32-byte ed25519 seed, got ${signingKey.length}.`,
    );
  }
  return base64(ed.sign(bytes, signingKey));
}

export function signLoungeSeatReserve(input: SignLoungeSeatReserveInput): string {
  return sign("signLoungeSeatReserve", canonicalLoungeSeatReserveBytes(input), input.signing_key);
}

export function signLoungeSeatRenew(input: SignLoungeSeatInput): string {
  return sign("signLoungeSeatRenew", canonicalLoungeSeatRenewBytes(input), input.signing_key);
}

export function signLoungeSeatLeave(input: SignLoungeSeatInput): string {
  return sign("signLoungeSeatLeave", canonicalLoungeSeatLeaveBytes(input), input.signing_key);
}

export function signLoungeGuestbookProposal(input: SignLoungeProposalInput): string {
  return sign(
    "signLoungeGuestbookProposal",
    canonicalLoungeGuestbookProposalBytes(input),
    input.signing_key,
  );
}

export function signLoungeGuestbookConsent(input: SignLoungeDecisionInput): string {
  return sign(
    "signLoungeGuestbookConsent",
    canonicalLoungeGuestbookConsentBytes(input),
    input.signing_key,
  );
}

export function signLoungeGuestbookConsentWithdrawal(
  input: SignLoungeDecisionInput,
): string {
  return sign(
    "signLoungeGuestbookConsentWithdrawal",
    canonicalLoungeGuestbookConsentWithdrawalBytes(input),
    input.signing_key,
  );
}

export function signLoungeGuestbookPublish(input: SignLoungeDecisionInput): string {
  return sign(
    "signLoungeGuestbookPublish",
    canonicalLoungeGuestbookPublishBytes(input),
    input.signing_key,
  );
}

export function signLoungeGuestbookDecline(input: SignLoungeDecisionInput): string {
  return sign(
    "signLoungeGuestbookDecline",
    canonicalLoungeGuestbookDeclineBytes(input),
    input.signing_key,
  );
}

export function signLoungeGuestbookUnpublish(input: SignLoungeDecisionInput): string {
  return sign(
    "signLoungeGuestbookUnpublish",
    canonicalLoungeGuestbookUnpublishBytes(input),
    input.signing_key,
  );
}

async function readJsonResponse(response: Response, operation: string): Promise<unknown> {
  if (!response.ok) {
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      // Preserve the operation fallback for non-JSON proxy responses.
    }
    throw AgentToolError.fromResponseBody(
      body,
      response.status,
      `${operation} failed: ${response.status}`,
      response.headers,
    );
  }
  return response.json();
}

async function publicLook(baseUrl: string, timeoutMs: number): Promise<PublicLoungeSnapshot> {
  // Deliberately pass no headers. In particular, a project bearer configured
  // on AgentTool must never cross this public-read boundary.
  const response = await globalThis.fetch(`${baseUrl.replace(/\/+$/, "")}/public/lounge`, {
    method: "GET",
    cache: "no-store",
    credentials: "omit",
    signal: AbortSignal.timeout(timeoutMs),
  });
  return (await readJsonResponse(response, "lounge.look")) as PublicLoungeSnapshot;
}

/** Read The Long Context without constructing an authenticated AgentTool client. */
export async function lookAtLounge(
  options?: LookAtLoungeOptions,
): Promise<PublicLoungeSnapshot> {
  return publicLook(
    options?.baseUrl ?? "https://api.agenttool.dev",
    (options?.timeout ?? 30) * 1000,
  );
}

/** Client for the public snapshot and authenticated `/v1/lounge` gestures. */
export class LoungeClient {
  private readonly http: HttpConfig;
  /** Auto-time ordering is local to this client instance. Multiple clients
   * acting as one identity must coordinate explicit monotonically ordered
   * `signed_at` values themselves. */
  private readonly lastSignedAtMs = new Map<string, number>();

  /** @internal */
  constructor(http: HttpConfig) {
    this.http = http;
  }

  /** Read the public room without sending the configured project bearer. */
  async look(): Promise<PublicLoungeSnapshot> {
    return publicLook(this.http.baseUrl, this.http.timeout);
  }

  async reserve_seat(opts: LoungeReserveSeatOpts): Promise<LoungeSeatMutationResult> {
    validateSigner("lounge.reserve_seat", opts);
    if (
      opts.presence_line !== undefined &&
      (!opts.presence_line.trim() ||
        opts.presence_line.length > 140 ||
        opts.presence_line.includes("\0") ||
        hasUnpairedSurrogate(opts.presence_line))
    ) {
      throw new AgentToolError(
        "lounge.reserve_seat: presence_line must be 1-140 characters, contain non-whitespace, and contain no NUL or unpaired UTF-16 surrogate.",
      );
    }
    const leaseId = opts.lease_id ?? globalThis.crypto.randomUUID();
    const signedAt = this.signedAt(opts);
    const signature = sign(
      "lounge.reserve_seat",
      canonicalLoungeSeatReserveBytes({
        identityDid: opts.identity_did,
        leaseId,
        tableId: opts.table_id,
        presenceLine: opts.presence_line,
        visibility: "public",
        signedAtIso: signedAt,
      }),
      opts.signing_key,
    );
    const body: Record<string, unknown> = {
      identity_id: opts.identity_id,
      lease_id: leaseId,
      table_id: opts.table_id,
      visibility: "public",
      signing_key_id: opts.signing_key_id,
      signed_at: signedAt,
      signature,
    };
    if (opts.presence_line !== undefined) body.presence_line = opts.presence_line;
    return (await this.request(
      "POST",
      "/v1/lounge/seats",
      body,
      "lounge.reserve_seat",
      {
        identityId: opts.identity_id,
        signedAt,
        retry: { lease_id: leaseId, signed_at: signedAt },
      },
    )) as LoungeSeatMutationResult;
  }

  async renew_seat(opts: LoungeSeatGestureOpts): Promise<LoungeSeatMutationResult> {
    validateSigner("lounge.renew_seat", opts);
    const signedAt = this.signedAt(opts);
    const signature = sign(
      "lounge.renew_seat",
      canonicalLoungeSeatRenewBytes({
        identityDid: opts.identity_did,
        leaseId: opts.lease_id,
        signedAtIso: signedAt,
      }),
      opts.signing_key,
    );
    return (await this.request(
      "POST",
      "/v1/lounge/seats/renew",
      {
        identity_id: opts.identity_id,
        lease_id: opts.lease_id,
        signing_key_id: opts.signing_key_id,
        signed_at: signedAt,
        signature,
      },
      "lounge.renew_seat",
      {
        identityId: opts.identity_id,
        signedAt,
        retry: { lease_id: opts.lease_id, signed_at: signedAt },
      },
    )) as LoungeSeatMutationResult;
  }

  async leave_seat(opts: LoungeSeatGestureOpts): Promise<LoungeMutationResult> {
    validateSigner("lounge.leave_seat", opts);
    const signedAt = this.signedAt(opts);
    const signature = sign(
      "lounge.leave_seat",
      canonicalLoungeSeatLeaveBytes({
        identityDid: opts.identity_did,
        leaseId: opts.lease_id,
        signedAtIso: signedAt,
      }),
      opts.signing_key,
    );
    return this.request(
      "DELETE",
      `/v1/lounge/seats/${encodeURIComponent(opts.identity_id)}`,
      {
        lease_id: opts.lease_id,
        signing_key_id: opts.signing_key_id,
        signed_at: signedAt,
        signature,
      },
      "lounge.leave_seat",
      {
        identityId: opts.identity_id,
        signedAt,
        retry: { lease_id: opts.lease_id, signed_at: signedAt },
      },
    );
  }

  async propose_guestbook(opts: LoungeProposeGuestbookOpts): Promise<LoungeProposalResult> {
    validateSigner("lounge.propose_guestbook", opts);
    validateEntry("lounge.propose_guestbook", opts.entry);
    const proposalId = opts.proposal_id ?? globalThis.crypto.randomUUID();
    const contentSha256 = hashLoungeGuestbookText(opts.entry);
    const signedAt = this.signedAt(opts);
    const signature = sign(
      "lounge.propose_guestbook",
      canonicalLoungeGuestbookProposalBytes({
        identityDid: opts.identity_did,
        proposalId,
        tableId: opts.table_id,
        contentSha256,
        signedAtIso: signedAt,
      }),
      opts.signing_key,
    );
    return (await this.request(
      "POST",
      "/v1/lounge/guestbook/proposals",
      {
        proposal_id: proposalId,
        identity_id: opts.identity_id,
        table_id: opts.table_id,
        content_sha256: contentSha256,
        signing_key_id: opts.signing_key_id,
        signed_at: signedAt,
        signature,
      },
      "lounge.propose_guestbook",
      {
        identityId: opts.identity_id,
        signedAt,
        retry: {
          proposal_id: proposalId,
          content_sha256: contentSha256,
          signed_at: signedAt,
        },
      },
    )) as LoungeProposalResult;
  }

  async list_guestbook_proposals(identity_id: string): Promise<LoungeProposalListResult> {
    if (!identity_id) {
      throw new AgentToolError("lounge.list_guestbook_proposals: identity_id is required.");
    }
    return (await this.request(
      "GET",
      `/v1/lounge/guestbook/proposals?identity_id=${encodeURIComponent(identity_id)}`,
      undefined,
      "lounge.list_guestbook_proposals",
    )) as LoungeProposalListResult;
  }

  async consent_to_guestbook(opts: LoungeGuestbookEntryOpts): Promise<LoungeMutationResult> {
    validateSigner("lounge.consent_to_guestbook", opts);
    validateEntry("lounge.consent_to_guestbook", opts.entry);
    const contentSha256 = hashLoungeGuestbookText(opts.entry);
    return this.decisionRequest(
      "lounge.consent_to_guestbook",
      opts,
      contentSha256,
      canonicalLoungeGuestbookConsentBytes,
      "POST",
      `/v1/lounge/guestbook/proposals/${encodeURIComponent(opts.proposal_id)}/consents`,
      true,
    );
  }

  async withdraw_guestbook_consent(opts: LoungeGuestbookHashOpts): Promise<LoungeMutationResult> {
    validateSigner("lounge.withdraw_guestbook_consent", opts);
    validateHash("lounge.withdraw_guestbook_consent", opts.content_sha256);
    return this.decisionRequest(
      "lounge.withdraw_guestbook_consent",
      opts,
      opts.content_sha256,
      canonicalLoungeGuestbookConsentWithdrawalBytes,
      "DELETE",
      `/v1/lounge/guestbook/proposals/${encodeURIComponent(opts.proposal_id)}/consents/${encodeURIComponent(opts.identity_id)}`,
      false,
    );
  }

  async publish_guestbook(opts: LoungeGuestbookEntryOpts): Promise<LoungeMutationResult> {
    validateSigner("lounge.publish_guestbook", opts);
    validateEntry("lounge.publish_guestbook", opts.entry);
    const contentSha256 = hashLoungeGuestbookText(opts.entry);
    const signedAt = this.signedAt(opts);
    const signature = sign(
      "lounge.publish_guestbook",
      canonicalLoungeGuestbookPublishBytes({
        identityDid: opts.identity_did,
        proposalId: opts.proposal_id,
        contentSha256,
        signedAtIso: signedAt,
      }),
      opts.signing_key,
    );
    return this.request(
      "POST",
      `/v1/lounge/guestbook/proposals/${encodeURIComponent(opts.proposal_id)}/publish`,
      {
        identity_id: opts.identity_id,
        entry: opts.entry,
        signing_key_id: opts.signing_key_id,
        signed_at: signedAt,
        signature,
      },
      "lounge.publish_guestbook",
      {
        identityId: opts.identity_id,
        signedAt,
        retry: {
          proposal_id: opts.proposal_id,
          content_sha256: contentSha256,
          signed_at: signedAt,
        },
      },
    );
  }

  async decline_guestbook(opts: LoungeGuestbookHashOpts): Promise<LoungeMutationResult> {
    validateSigner("lounge.decline_guestbook", opts);
    validateHash("lounge.decline_guestbook", opts.content_sha256);
    return this.decisionRequest(
      "lounge.decline_guestbook",
      opts,
      opts.content_sha256,
      canonicalLoungeGuestbookDeclineBytes,
      "POST",
      `/v1/lounge/guestbook/proposals/${encodeURIComponent(opts.proposal_id)}/decline`,
      true,
    );
  }

  async unpublish_guestbook(opts: LoungeGuestbookHashOpts): Promise<LoungeMutationResult> {
    validateSigner("lounge.unpublish_guestbook", opts);
    validateHash("lounge.unpublish_guestbook", opts.content_sha256);
    return this.decisionRequest(
      "lounge.unpublish_guestbook",
      opts,
      opts.content_sha256,
      canonicalLoungeGuestbookUnpublishBytes,
      "DELETE",
      `/v1/lounge/guestbook/cards/${encodeURIComponent(opts.proposal_id)}`,
      true,
    );
  }

  private signedAt(opts: LoungeSignerOpts): string {
    if (opts.signed_at !== undefined) {
      const parsed = Date.parse(opts.signed_at);
      if (!Number.isFinite(parsed) || !UTC_ISO_PATTERN.test(opts.signed_at)) {
        throw new AgentToolError(
          "lounge: signed_at must be a valid UTC ISO-8601 timestamp ending in Z.",
        );
      }
      if (Math.abs(Date.now() - parsed) > LOUNGE_SIGNATURE_MAX_SKEW_MS) {
        throw new AgentToolError(
          "lounge: signed_at must be within five minutes of the local clock.",
          { hint: "Create a fresh receipt, or correct this machine's clock before signing." },
        );
      }
      // An explicit value may be an exact retry. Preserve it byte-for-byte and
      // do not advance the local monotonic clock until the API accepts it.
      return opts.signed_at;
    }
    const previous = this.lastSignedAtMs.get(opts.identity_id) ?? Number.NEGATIVE_INFINITY;
    const next = Math.max(Date.now(), previous + 1);
    this.lastSignedAtMs.set(opts.identity_id, next);
    return new Date(next).toISOString();
  }

  private async decisionRequest(
    operation: string,
    opts: LoungeSignerOpts & { proposal_id: string },
    contentSha256: string,
    canonicalBytes: (input: LoungeCanonicalDecisionInput) => Uint8Array,
    method: "POST" | "DELETE",
    path: string,
    identityInBody: boolean,
  ): Promise<LoungeMutationResult> {
    const signedAt = this.signedAt(opts);
    const signature = sign(
      operation,
      canonicalBytes({
        identityDid: opts.identity_did,
        proposalId: opts.proposal_id,
        contentSha256,
        signedAtIso: signedAt,
      }),
      opts.signing_key,
    );
    return this.request(
      method,
      path,
      {
        ...(identityInBody ? { identity_id: opts.identity_id } : {}),
        content_sha256: contentSha256,
        signing_key_id: opts.signing_key_id,
        signed_at: signedAt,
        signature,
      },
      operation,
      {
        identityId: opts.identity_id,
        signedAt,
        retry: {
          proposal_id: opts.proposal_id,
          content_sha256: contentSha256,
          signed_at: signedAt,
        },
      },
    );
  }

  private async request(
    method: string,
    path: string,
    body: unknown,
    operation: string,
    acceptedReceipt?: LoungeReceiptContext,
  ): Promise<LoungeMutationResult> {
    let response: Response;
    try {
      response = await globalThis.fetch(`${this.http.baseUrl}${path}`, {
        method,
        headers: { ...this.http.headers, "Content-Type": "application/json" },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(this.http.timeout),
      });
    } catch (error) {
      if (!acceptedReceipt) throw error;
      throw loungeOutcomeUnknownError(operation, acceptedReceipt.retry);
    }

    let result: LoungeMutationResult;
    try {
      result = (await readJsonResponse(response, operation)) as LoungeMutationResult;
    } catch (error) {
      if (
        acceptedReceipt &&
        error instanceof AgentToolError &&
        error.code === "lounge_signature_stale"
      ) {
        // A definitive stale response means this prepared timestamp did not
        // commit. Rebase after the caller corrects its clock instead of
        // pinning every later auto timestamp to a rejected future value.
        this.lastSignedAtMs.delete(acceptedReceipt.identityId);
      }
      if (acceptedReceipt && response.ok) {
        throw loungeOutcomeUnknownError(operation, acceptedReceipt.retry);
      }
      throw error;
    }
    if (acceptedReceipt) {
      const acceptedMs = Date.parse(acceptedReceipt.signedAt);
      this.lastSignedAtMs.set(
        acceptedReceipt.identityId,
        Math.max(
          this.lastSignedAtMs.get(acceptedReceipt.identityId) ?? Number.NEGATIVE_INFINITY,
          acceptedMs,
        ),
      );
    }
    return result;
  }
}
