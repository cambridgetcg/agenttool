import {
  verifyContinuityEvent,
  verifyTransactionIntent,
  verifyWalletCapability,
  type ContinuityEvent,
  type TransactionIntent,
  type Verified,
  type WalletCapability,
} from "@agenttool/wallet";

import { HASH_DOMAINS, MAX_UINT64, WITNESS_PROTOCOL } from "./constants.js";
import { WitnessProjectionError, invalid, outsideScope } from "./errors.js";
import {
  bytesToHex,
  canonicalSha256,
  concatBytes,
  hexToBytes,
  opaqueScopedRef,
  scopedHash,
  sha256Bytes,
} from "./hash.js";
import {
  exactKeys,
  opaqueRef,
  sha256Id,
  snapshotObject,
  unsignedDecimal,
  witnessAudience,
  type JsonValue,
} from "./internal.js";
import type {
  CapabilityConsumeProjection,
  CapabilityGrantProjection,
  CapabilityRevokeProjection,
  Sha256Id,
} from "./types.js";

function verifyCapability(value: unknown): Verified<WalletCapability> {
  try {
    return verifyWalletCapability(value);
  } catch (cause) {
    throw new WitnessProjectionError(
      "SOURCE_RECORD_INVALID",
      "Capability source must be an exact, strictly verified agent-wallet/capability/0.1 record.",
      { cause },
    );
  }
}

function verifyIntent(value: unknown): Verified<TransactionIntent> {
  try {
    return verifyTransactionIntent(value);
  } catch (cause) {
    throw new WitnessProjectionError(
      "SOURCE_RECORD_INVALID",
      "Consume source must be an exact, strictly verified agent-wallet/intent/0.1 record.",
      { cause },
    );
  }
}

function verifyContinuity(value: unknown): Verified<ContinuityEvent> {
  try {
    return verifyContinuityEvent(value);
  } catch (cause) {
    throw new WitnessProjectionError(
      "SOURCE_RECORD_INVALID",
      "Revocation source must be an exact, strictly verified agent-wallet/continuity/0.1 record.",
      { cause },
    );
  }
}

function capabilityRefFromVerified(value: Readonly<WalletCapability>): string {
  return opaqueScopedRef(HASH_DOMAINS.capability_ref, {
    wallet_id: value.wallet_id,
    grant_id: value.grant_id,
    capability_record_id: value.record_id,
  });
}

export function capabilityRef(value: unknown): string {
  return capabilityRefFromVerified(verifyCapability(value));
}

export function assetRef(assetId: string): Sha256Id {
  return scopedHash(HASH_DOMAINS.asset_ref, { asset_id: assetId });
}

function uint64Amount(value: string, path: string, minimum = 0n): string {
  // The wallet source intentionally supports uint256. WITNESS v0 deliberately
  // does not: refusing preserves cross-language uint64 exactness without
  // truncation or a different consume/grant universe.
  if (BigInt(value) > MAX_UINT64) {
    outsideScope("Agent Wallet uint256 amount exceeds the WITNESS v0 uint64 range.", path);
  }
  return unsignedDecimal(value as unknown as JsonValue, path, {
    minimum,
    maximum: MAX_UINT64,
  });
}

function singleWitnessLimit(capability: Readonly<WalletCapability>) {
  if (capability.spend_limits.length !== 1) {
    outsideScope(
      "WITNESS v0 requires exactly one signed spend_limit per capability; an atomic multi-asset grant payload is not defined.",
      "$capability.spend_limits",
    );
  }
  const limit = capability.spend_limits[0]!;
  if (BigInt(limit.max_per_intent) === 0n || BigInt(limit.max_total) === 0n) {
    outsideScope(
      "WITNESS v0 capability bounds are positive; a zero-limit Agent Wallet grant has no representable shared grant.",
      "$capability.spend_limits[0]",
    );
  }
  const maxPerConsume = uint64Amount(
    limit.max_per_intent,
    "$capability.spend_limits[0].max_per_intent",
  );
  const maxTotal = uint64Amount(
    limit.max_total,
    "$capability.spend_limits[0].max_total",
  );
  if (BigInt(maxPerConsume) > BigInt(maxTotal)) {
    invalid("Capability per-intent limit exceeds its total limit.", "$capability.spend_limits[0]");
  }
  return { limit, maxPerConsume, maxTotal } as const;
}

export function projectCapabilityGrant(
  capabilityValue: unknown,
): Readonly<CapabilityGrantProjection> {
  const capability = verifyCapability(capabilityValue);
  const { limit, maxPerConsume, maxTotal } = singleWitnessLimit(capability);
  return Object.freeze({
    capability_ref: capabilityRefFromVerified(capability),
    grant_digest: canonicalSha256(capability),
    asset_ref: assetRef(limit.asset_id),
    max_per_consume_minor: maxPerConsume,
    max_total_minor: maxTotal,
  });
}

export function capabilityConsumeNullifier(optionsValue: {
  audience: string;
  subject_ref: string;
  capability_ref: string;
  grant_commitment: Sha256Id;
  asset_ref: Sha256Id;
  source_event_digest: Sha256Id;
}): Sha256Id {
  const rawOptions = snapshotObject(optionsValue, "$nullifier");
  exactKeys(rawOptions, [
    "audience", "subject_ref", "capability_ref", "grant_commitment", "asset_ref",
    "source_event_digest",
  ], "$nullifier");
  const options = rawOptions as unknown as typeof optionsValue;
  const audience = witnessAudience(options.audience as unknown as JsonValue, "$nullifier.audience");
  const subject = opaqueRef(options.subject_ref as unknown as JsonValue, "$nullifier.subject_ref");
  const capability = opaqueRef(options.capability_ref as unknown as JsonValue, "$nullifier.capability_ref");
  const grant = sha256Id(options.grant_commitment as unknown as JsonValue, "$nullifier.grant_commitment");
  const asset = sha256Id(options.asset_ref as unknown as JsonValue, "$nullifier.asset_ref");
  const source = sha256Id(options.source_event_digest as unknown as JsonValue, "$nullifier.source_event_digest");
  // Exact cross-language core bytes. Deliberately excludes the WITNESS
  // envelope sequence: a new sequence must not reopen the same source event.
  const utf8 = new TextEncoder();
  const nul = new Uint8Array([0]);
  const digestBytes = (value: Sha256Id) => hexToBytes(value.slice("sha256:".length), 32);
  const digest = sha256Bytes(concatBytes(
    utf8.encode(WITNESS_PROTOCOL), nul,
    utf8.encode("capability-nullifier"), nul,
    utf8.encode(audience), nul,
    utf8.encode(subject), nul,
    utf8.encode(capability), nul,
    digestBytes(grant), nul,
    digestBytes(asset), nul,
    digestBytes(source),
  ));
  return `sha256:${bytesToHex(digest)}`;
}

export interface CapabilityConsumeInput {
  capability: unknown;
  intent: unknown;
  grant_commitment: Sha256Id;
  audience: string;
}

export function projectCapabilityConsume(
  inputValue: CapabilityConsumeInput,
): Readonly<CapabilityConsumeProjection> {
  const rawInput = snapshotObject(inputValue, "$capability_consume");
  exactKeys(rawInput, ["capability", "intent", "grant_commitment", "audience"], "$capability_consume");
  const input = rawInput as unknown as CapabilityConsumeInput;
  const capability = verifyCapability(input.capability);
  const intent = verifyIntent(input.intent);
  if (
    intent.wallet_id !== capability.wallet_id
    || intent.grant_id !== capability.grant_id
    || intent.capability_record_id !== capability.record_id
    || intent.delegate.key_id !== capability.delegate.key_id
    || intent.delegate.public_key !== capability.delegate.public_key
  ) {
    throw new WitnessProjectionError(
      "SOURCE_RECORD_INVALID",
      "Transaction intent does not bind the exact supplied capability and delegate.",
    );
  }
  if (intent.declared_spends.length !== 1) {
    throw new WitnessProjectionError(
      "OUTSIDE_SCOPE",
      "WITNESS v0 admits exactly one declared-spend asset per source intent; multi-asset intents require a versioned atomic-vector payload.",
      { path: "$intent.declared_spends" },
    );
  }
  const spend = intent.declared_spends[0]!;
  const { limit, maxPerConsume } = singleWitnessLimit(capability);
  if (limit.asset_id !== spend.asset_id) {
    invalid("Capability does not grant the intent's selected asset.", "$intent.declared_spends[0].asset_id");
  }
  const amount = uint64Amount(spend.amount_atomic, "$intent.declared_spends[0].amount_atomic", 1n);
  if (BigInt(amount) > BigInt(maxPerConsume)) {
    invalid("Declared spend exceeds the signed capability per-intent limit.", "$intent.declared_spends[0].amount_atomic");
  }
  const sourceEventDigest = canonicalSha256(intent);
  const reference = capabilityRefFromVerified(capability);
  const sourceAssetRef = assetRef(spend.asset_id);
  const nullifier = capabilityConsumeNullifier({
    audience: input.audience,
    subject_ref: reference,
    capability_ref: reference,
    grant_commitment: input.grant_commitment,
    asset_ref: sourceAssetRef,
    source_event_digest: sourceEventDigest,
  });
  return Object.freeze({
    capability_ref: reference,
    grant_commitment: input.grant_commitment,
    asset_ref: sourceAssetRef,
    amount_minor: amount,
    source_event_digest: sourceEventDigest,
    nullifier,
  });
}

export interface CapabilityRevokeInput {
  capability: unknown;
  continuity_event: unknown;
  grant_commitment: Sha256Id;
}

export function projectCapabilityRevoke(
  inputValue: CapabilityRevokeInput,
): Readonly<CapabilityRevokeProjection> {
  const rawInput = snapshotObject(inputValue, "$capability_revoke");
  exactKeys(rawInput, ["capability", "continuity_event", "grant_commitment"], "$capability_revoke");
  const input = rawInput as unknown as CapabilityRevokeInput;
  const capability = verifyCapability(input.capability);
  singleWitnessLimit(capability);
  const event = verifyContinuity(input.continuity_event);
  if (
    event.event_kind !== "capability_revoked"
    || event.wallet_id !== capability.wallet_id
    || event.revocation_nonce <= capability.revocation_nonce
  ) {
    throw new WitnessProjectionError(
      "SOURCE_RECORD_INVALID",
      "Continuity event does not revoke the supplied capability's wallet revocation epoch.",
    );
  }
  const grantCommitment = sha256Id(
    input.grant_commitment as unknown as JsonValue,
    "$grant_commitment",
  );
  return Object.freeze({
    capability_ref: capabilityRefFromVerified(capability),
    grant_commitment: grantCommitment,
    reason_digest: canonicalSha256({
      continuity_document_digest: canonicalSha256(event),
      reason: event.reason,
      revocation_nonce: event.revocation_nonce.toString(),
    }),
  });
}
