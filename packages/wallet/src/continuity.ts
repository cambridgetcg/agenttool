import { WalletProtocolError } from "./errors.js";
import { assertSha256Id, assertTimestamp, timestampMs } from "./identifiers.js";
import { assertVerifiedRecord } from "./signatures.js";
import type {
  ContinuityEvent,
  Sha256Id,
  Verified,
  WalletDescriptor,
} from "./types.js";

export interface ContinuityHead {
  wallet_id: string;
  sequence: number;
  record_id: Sha256Id | null;
  authority_key_id: Sha256Id;
  revocation_nonce: number;
  effective_at: string;
}

export function continuityHeadFromDescriptor(
  descriptor: Verified<WalletDescriptor>,
): Readonly<ContinuityHead> {
  assertVerifiedRecord(descriptor);
  return Object.freeze({
    wallet_id: descriptor.wallet_id,
    sequence: 0,
    record_id: null,
    authority_key_id: descriptor.authority.key_id,
    revocation_nonce: 0,
    effective_at: descriptor.created_at,
  });
}

/**
 * Pure compare-and-swap rule. Persist the returned head with a durable CAS;
 * this helper cannot itself prevent two processes from racing one head.
 */
export function advanceContinuityHead(
  head: ContinuityHead,
  event: Verified<ContinuityEvent>,
  now: string,
): Readonly<ContinuityHead> {
  assertVerifiedRecord(event);
  assertTimestamp(head.effective_at, "continuity_head.effective_at");
  assertTimestamp(now, "continuity.now");
  if (
    event.wallet_id !== head.wallet_id
    || event.sequence !== head.sequence + 1
    || event.previous_record_id !== head.record_id
  ) {
    throw new WalletProtocolError("CONTINUITY_CONFLICT", "Continuity event does not extend the exact current head.");
  }
  if (event.actor.key_id !== head.authority_key_id) {
    throw new WalletProtocolError("AUTHORITY_MISMATCH", "Continuity event actor is not the current wallet authority.");
  }
  if (
    timestampMs(event.effective_at) < timestampMs(head.effective_at)
    || timestampMs(event.effective_at) > timestampMs(now)
  ) {
    throw new WalletProtocolError(
      "CONTINUITY_CONFLICT",
      "Continuity effective_at must not precede the head or lie in the future.",
    );
  }

  let authorityKeyId = head.authority_key_id;
  let revocationNonce = head.revocation_nonce;
  if (event.event_kind === "authority_rotated") {
    assertSha256Id(event.next_value, "continuity.next_value");
    if (event.previous_value !== head.authority_key_id) {
      throw new WalletProtocolError("CONTINUITY_CONFLICT", "Authority rotation does not name the current authority.");
    }
    authorityKeyId = event.next_value;
  }
  if (event.event_kind === "capability_revoked") {
    if (event.revocation_nonce !== head.revocation_nonce + 1) {
      throw new WalletProtocolError("CONTINUITY_CONFLICT", "Capability revocation nonce must increment exactly once.");
    }
    revocationNonce = event.revocation_nonce;
  } else if (event.revocation_nonce !== head.revocation_nonce) {
    throw new WalletProtocolError("CONTINUITY_CONFLICT", "Non-revocation continuity cannot change revocation_nonce.");
  }

  return Object.freeze({
    wallet_id: head.wallet_id,
    sequence: event.sequence,
    record_id: event.record_id,
    authority_key_id: authorityKeyId,
    revocation_nonce: revocationNonce,
    effective_at: event.effective_at,
  });
}
