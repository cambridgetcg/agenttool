/** Canonical signed gestures for The Long Context lounge.
 *
 * Every gesture is SHA-256(domain || NUL || field ...), then signed with an
 * active registered identity ed25519 key under project-root authority.
 * Domains are deliberately separate: a wire-named consent receipt cannot be
 * replayed as publication, and an old leave cannot authorize a new lease.
 *
 * Doctrine: docs/LOUNGE.md · docs/CANONICAL-BYTES.md. */

import * as ed from "@noble/ed25519";
import { sha256, sha512 } from "@noble/hashes/sha2.js";

ed.etc.sha512Sync = (...messages: Uint8Array[]) => {
  const hash = sha512.create();
  for (const message of messages) hash.update(message);
  return hash.digest();
};

const encoder = new TextEncoder();
const separator = new Uint8Array([0]);

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
  for (const field of fields) parts.push(separator, encoder.encode(field));
  return sha256(concat(...parts));
}

export function canonicalLoungeSeatReserveBytes(input: {
  identityDid: string;
  leaseId: string;
  tableId: string;
  presenceLine?: string;
  visibility: "public";
  signedAtIso: string;
}): Uint8Array {
  return canonical("lounge-seat-reserve/v1", [
    input.identityDid,
    input.leaseId,
    input.tableId,
    input.presenceLine ?? "",
    input.visibility,
    input.signedAtIso,
  ]);
}

export function canonicalLoungeSeatRenewBytes(input: {
  identityDid: string;
  leaseId: string;
  signedAtIso: string;
}): Uint8Array {
  return canonical("lounge-seat-renew/v1", [
    input.identityDid,
    input.leaseId,
    input.signedAtIso,
  ]);
}

export function canonicalLoungeSeatLeaveBytes(input: {
  identityDid: string;
  leaseId: string;
  signedAtIso: string;
}): Uint8Array {
  return canonical("lounge-seat-leave/v1", [
    input.identityDid,
    input.leaseId,
    input.signedAtIso,
  ]);
}

export function canonicalLoungeGuestbookProposalBytes(input: {
  identityDid: string;
  proposalId: string;
  tableId: string;
  contentSha256: string;
  signedAtIso: string;
}): Uint8Array {
  return canonical("lounge-guestbook-propose/v1", [
    input.identityDid,
    input.proposalId,
    input.tableId,
    input.contentSha256,
    input.signedAtIso,
  ]);
}

function canonicalGuestbookDecision(
  domain: string,
  input: {
    identityDid: string;
    proposalId: string;
    contentSha256: string;
    signedAtIso: string;
  },
): Uint8Array {
  return canonical(domain, [
    input.identityDid,
    input.proposalId,
    input.contentSha256,
    input.signedAtIso,
  ]);
}

export function canonicalLoungeGuestbookConsentBytes(input: {
  identityDid: string;
  proposalId: string;
  contentSha256: string;
  signedAtIso: string;
}): Uint8Array {
  return canonicalGuestbookDecision("lounge-guestbook-consent/v1", input);
}

export function canonicalLoungeGuestbookConsentWithdrawalBytes(input: {
  identityDid: string;
  proposalId: string;
  contentSha256: string;
  signedAtIso: string;
}): Uint8Array {
  return canonicalGuestbookDecision("lounge-guestbook-withdraw-consent/v1", input);
}

export function canonicalLoungeGuestbookPublishBytes(input: {
  identityDid: string;
  proposalId: string;
  contentSha256: string;
  signedAtIso: string;
}): Uint8Array {
  return canonicalGuestbookDecision("lounge-guestbook-publish/v1", input);
}

export function canonicalLoungeGuestbookDeclineBytes(input: {
  identityDid: string;
  proposalId: string;
  contentSha256: string;
  signedAtIso: string;
}): Uint8Array {
  return canonicalGuestbookDecision("lounge-guestbook-decline/v1", input);
}

export function canonicalLoungeGuestbookUnpublishBytes(input: {
  identityDid: string;
  proposalId: string;
  contentSha256: string;
  signedAtIso: string;
}): Uint8Array {
  return canonicalGuestbookDecision("lounge-guestbook-unpublish/v1", input);
}

export async function verifyLoungeSignature(input: {
  bytes: Uint8Array;
  signatureB64: string;
  publicKeyB64: string;
}): Promise<boolean> {
  try {
    return await ed.verifyAsync(
      Uint8Array.from(Buffer.from(input.signatureB64, "base64")),
      input.bytes,
      Uint8Array.from(Buffer.from(input.publicKeyB64, "base64")),
    );
  } catch {
    return false;
  }
}
