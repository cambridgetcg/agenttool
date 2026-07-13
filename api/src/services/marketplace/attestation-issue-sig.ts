/** Canonical authorization for paid attestation-grant issuance.
 *
 * The attester signs a short-lived, server-prepared SHA-256 digest before the
 * marketplace writes an attestation or releases escrow. Every term that can
 * change what is asserted or settled is inside the digest. */

import { createHash } from "node:crypto";

export const ATTESTATION_ISSUE_SIGNATURE_CONTEXT = "attestation-issue/v1";
export const ATTESTATION_ISSUE_AUTHORIZATION_TTL_SECONDS = 5 * 60;
export const ATTESTATION_ISSUE_MAX_FUTURE_SECONDS = 10 * 60;

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
  evidence_sha256: string;
  attester_wallet_id: string;
  grant_gross: number;
  grant_currency: string;
  take_rate_bps: number;
  platform_fee: number;
  attester_net: number;
  validity_seconds: number | null;
  attestation_expires_at: string | null;
  authorization_expires_at: string;
}

export interface AttestationIssuePreparation {
  signature_context: typeof ATTESTATION_ISSUE_SIGNATURE_CONTEXT;
  field_order: string[];
  fields: AttestationIssueFields;
  /** Canonical standard base64 of the exact 32-byte digest to sign. */
  signed_payload_b64: string;
  authorization_expires_at: string;
}

export const ATTESTATION_ISSUE_FIELD_ORDER = [
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
] as const satisfies readonly (keyof AttestationIssueFields)[];

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;
const encoder = new TextEncoder();
const separator = new Uint8Array([0]);

/** Sorted-key, no-whitespace JSON used only to hash stored grant evidence. */
export function canonicalAttestationEvidenceJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("evidence_not_json");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalAttestationEvidenceJson).join(",")}]`;
  }
  if (typeof value !== "object" || value === undefined) {
    throw new Error("evidence_not_json");
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error("evidence_not_json");
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => {
      if (record[key] === undefined) throw new Error("evidence_not_json");
      return `${JSON.stringify(key)}:${canonicalAttestationEvidenceJson(record[key])}`;
    })
    .join(",")}}`;
}

export function attestationEvidenceSha256(value: unknown): string {
  return createHash("sha256")
    .update(canonicalAttestationEvidenceJson(value), "utf8")
    .digest("hex");
}

function canonicalIso(value: string, field: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${field}_invalid`);
  }
  return value;
}

function validateFields(fields: AttestationIssueFields): void {
  const uuidFields = [
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
  ] as const;
  for (const name of uuidFields) {
    if (!UUID_RE.test(fields[name])) throw new Error(`${name}_invalid`);
  }

  const textFields = [
    "buyer_did",
    "subject_did",
    "attester_did",
    "claim",
    "grant_currency",
  ] as const;
  for (const name of textFields) {
    const value = fields[name];
    if (value.length === 0 || value.includes("\0")) {
      throw new Error(`${name}_invalid`);
    }
  }
  if (!SHA256_HEX_RE.test(fields.evidence_sha256)) {
    throw new Error("evidence_sha256_invalid");
  }

  const nonNegativeIntegers = [
    "grant_gross",
    "take_rate_bps",
    "platform_fee",
    "attester_net",
  ] as const;
  for (const name of nonNegativeIntegers) {
    const value = fields[name];
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${name}_invalid`);
    }
  }
  if (fields.take_rate_bps > 10_000) throw new Error("take_rate_bps_invalid");
  if (fields.platform_fee + fields.attester_net !== fields.grant_gross) {
    throw new Error("fee_split_invalid");
  }
  if (
    fields.validity_seconds !== null &&
    (!Number.isSafeInteger(fields.validity_seconds) || fields.validity_seconds <= 0)
  ) {
    throw new Error("validity_seconds_invalid");
  }
  if ((fields.validity_seconds === null) !== (fields.attestation_expires_at === null)) {
    throw new Error("attestation_expiry_invalid");
  }
  if (fields.attestation_expires_at !== null) {
    canonicalIso(fields.attestation_expires_at, "attestation_expiry");
  }
  canonicalIso(fields.authorization_expires_at, "authorization_expiry");
}

/** SHA-256(domain + NUL + each named UTF-8 field in FIELD_ORDER). */
export function canonicalAttestationIssueBytes(
  fields: AttestationIssueFields,
): Uint8Array {
  validateFields(fields);
  const hash = createHash("sha256");
  hash.update(encoder.encode(ATTESTATION_ISSUE_SIGNATURE_CONTEXT));
  for (const name of ATTESTATION_ISSUE_FIELD_ORDER) {
    const value = fields[name];
    hash.update(separator);
    hash.update(encoder.encode(value === null ? "null" : String(value)));
  }
  return new Uint8Array(hash.digest());
}

export function prepareAttestationIssue(
  fields: AttestationIssueFields,
): AttestationIssuePreparation {
  const payload = canonicalAttestationIssueBytes(fields);
  return {
    signature_context: ATTESTATION_ISSUE_SIGNATURE_CONTEXT,
    field_order: [...ATTESTATION_ISSUE_FIELD_ORDER],
    fields,
    signed_payload_b64: Buffer.from(payload).toString("base64"),
    authorization_expires_at: fields.authorization_expires_at,
  };
}

export function newAttestationIssueAuthorizationExpiry(now = new Date()): string {
  const wholeSecond = Math.floor(now.getTime() / 1000) * 1000;
  return new Date(
    wholeSecond + ATTESTATION_ISSUE_AUTHORIZATION_TTL_SECONDS * 1000,
  ).toISOString();
}

export function parseAttestationIssueAuthorizationExpiry(
  value: string,
  now = new Date(),
): Date {
  canonicalIso(value, "authorization_expiry");
  const parsed = new Date(value);
  const remaining = parsed.getTime() - now.getTime();
  if (remaining <= 0) throw new Error("authorization_expired");
  if (remaining > ATTESTATION_ISSUE_MAX_FUTURE_SECONDS * 1000) {
    throw new Error("authorization_expiry_too_far");
  }
  return parsed;
}

/**
 * The preparation time is recoverable as authorization expiry minus the fixed
 * five-minute window, so issue can reconstruct the exact signed attestation
 * expiry without trusting a second client-supplied timestamp.
 */
export function attestationExpiresAtForAuthorization(
  validitySeconds: number | null,
  authorizationExpiresAt: Date,
): string | null {
  if (validitySeconds === null) return null;
  return new Date(
    authorizationExpiresAt.getTime() -
      ATTESTATION_ISSUE_AUTHORIZATION_TTL_SECONDS * 1000 +
      validitySeconds * 1000,
  ).toISOString();
}
