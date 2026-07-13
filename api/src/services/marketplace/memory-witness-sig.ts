/** Canonical authorization for paid memory-witness settlement.
 *
 * A normal `memory-attestation/v1` signature says only that a witness attests
 * to a memory and target tier. It cannot authorize escrow release. The paid
 * path therefore has its own context and binds every variable settlement
 * term before any money or identity state moves.
 */

import * as ed from "@noble/ed25519";
import { sha256, sha512 } from "@noble/hashes/sha2.js";

ed.etc.sha512Sync = (...messages: Uint8Array[]) => {
  const hash = sha512.create();
  for (const message of messages) hash.update(message);
  return hash.digest();
};

export const MEMORY_WITNESS_ISSUE_SIGNATURE_CONTEXT =
  "memory-witness-issue/v1";

export interface MemoryWitnessIssueFields {
  listing_id: string;
  grant_id: string;
  escrow_id: string;
  buyer_identity_id: string;
  buyer_project_id: string;
  buyer_wallet_id: string;
  memory_id: string;
  memory_identity_id: string | null;
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

/** Wire order is part of the v1 contract. Change it only with a new context. */
export const MEMORY_WITNESS_ISSUE_FIELD_ORDER = [
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
] as const satisfies readonly (keyof MemoryWitnessIssueFields)[];

const encoder = new TextEncoder();
const separator = new Uint8Array([0]);

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function canonicalFieldValue(
  fields: MemoryWitnessIssueFields,
  name: (typeof MEMORY_WITNESS_ISSUE_FIELD_ORDER)[number],
): string {
  const value = fields[name];
  return value === null ? "null" : String(value);
}

function assertCanonicalFields(fields: MemoryWitnessIssueFields): void {
  for (const name of MEMORY_WITNESS_ISSUE_FIELD_ORDER) {
    if (canonicalFieldValue(fields, name).includes("\0")) {
      throw new Error(`memory-witness signed field ${name} must not contain NUL`);
    }
  }
  if (!/^[0-9a-f]{64}$/.test(fields.memory_content_sha256)) {
    throw new Error("memory_content_sha256 must be 64 lowercase hex characters");
  }
  if (fields.source_tier !== "foundational" || fields.target_tier !== "constitutive") {
    throw new Error("memory-witness/v1 only authorizes foundational to constitutive");
  }
  for (const [name, value] of [
    ["gross_amount", fields.gross_amount],
    ["rate_bps", fields.rate_bps],
    ["platform_fee", fields.platform_fee],
    ["net_amount", fields.net_amount],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${name} must be a non-negative safe integer`);
    }
  }
  if (fields.rate_bps > 10_000) {
    throw new Error("rate_bps must be at most 10000");
  }
  if (fields.platform_fee + fields.net_amount !== fields.gross_amount) {
    throw new Error("platform_fee + net_amount must equal gross_amount");
  }
  const expiresAt = new Date(fields.authorization_expires_at);
  if (
    Number.isNaN(expiresAt.getTime()) ||
    expiresAt.toISOString() !== fields.authorization_expires_at
  ) {
    throw new Error("authorization_expires_at must be canonical ISO-8601 UTC");
  }
}

/**
 * sha256(utf8("memory-witness-issue/v1") || NUL || utf8(field_1) ...)
 */
export function canonicalMemoryWitnessIssueBytes(
  fields: MemoryWitnessIssueFields,
): Uint8Array {
  assertCanonicalFields(fields);
  const parts: Uint8Array[] = [
    encoder.encode(MEMORY_WITNESS_ISSUE_SIGNATURE_CONTEXT),
  ];
  for (const name of MEMORY_WITNESS_ISSUE_FIELD_ORDER) {
    parts.push(separator, encoder.encode(canonicalFieldValue(fields, name)));
  }
  return sha256(concat(parts));
}

export function memoryContentSha256(content: string): string {
  return Buffer.from(sha256(encoder.encode(content.normalize("NFC")))).toString(
    "hex",
  );
}

function decodeCanonicalBase64(
  value: string,
  expectedLength: number,
): Uint8Array | null {
  try {
    const decoded = Buffer.from(value, "base64");
    if (
      decoded.length !== expectedLength ||
      decoded.toString("base64") !== value
    ) {
      return null;
    }
    return Uint8Array.from(decoded);
  } catch {
    return null;
  }
}

export function verifyMemoryWitnessIssue(
  fields: MemoryWitnessIssueFields,
  signatureB64: string,
  publicKeyB64: string,
): boolean {
  try {
    const signature = decodeCanonicalBase64(signatureB64, 64);
    const publicKey = decodeCanonicalBase64(publicKeyB64, 32);
    if (!signature || !publicKey) return false;
    return ed.verify(
      signature,
      canonicalMemoryWitnessIssueBytes(fields),
      publicKey,
    );
  } catch {
    return false;
  }
}
