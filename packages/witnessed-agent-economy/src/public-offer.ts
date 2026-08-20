import { strictEd25519Verify } from "@agenttool/public-surface-binding";

import {
  HASH_DOMAINS,
  PUBLIC_OFFER_BOUNDARIES,
  SOURCE_SCHEMAS,
} from "./constants.js";
import { WitnessProjectionError, invalid } from "./errors.js";
import {
  agentToolSourceHash,
  agentToolSourceHashBytes,
  canonicalSha256,
  hexToBytes,
} from "./hash.js";
import {
  canonicalInstant,
  exactKeys,
  exactString,
  hex,
  object,
  opaqueRef,
  sha256Id,
  snapshotObject,
  witnessAudience,
  unsignedDecimal,
  validated,
  type JsonValue,
} from "./internal.js";
import { validateSingleKeyControlAuthority } from "./public-wake.js";
import {
  signHexEd25519Digest,
  validateHexEd25519Signature,
  validateHexEd25519Signer,
} from "./signature.js";
import type {
  HexEd25519Signer,
  PublicOfferCore,
  PublicOfferPredecessor,
  PublicOfferPublishProjection,
  PublicOfferRecord,
  PublicOfferRevokeProjection,
  PublicOfferSupersedeProjection,
  Sha256Id,
  VerifiedPublicOffer,
} from "./types.js";

const verifiedOffers = new WeakSet<object>();
const MAX_OFFER_LIFETIME_MS = 30 * 24 * 60 * 60 * 1_000;

function validateBoundaries(value: JsonValue, path: string): void {
  const record = object(value, path);
  exactKeys(record, Object.keys(PUBLIC_OFFER_BOUNDARIES), path);
  for (const [key, expected] of Object.entries(PUBLIC_OFFER_BOUNDARIES)) {
    if (record[key] !== expected) invalid(`${path}.${key} must be ${JSON.stringify(expected)}.`, `${path}.${key}`);
  }
}

function validatePredecessor(value: JsonValue, path: string): PublicOfferPredecessor {
  const record = object(value, path);
  exactKeys(record, ["offer_id", "document_digest"], path);
  sha256Id(record.offer_id!, `${path}.offer_id`);
  sha256Id(record.document_digest!, `${path}.document_digest`);
  return record as unknown as PublicOfferPredecessor;
}

function validateCommon(record: ReturnType<typeof snapshotObject>): void {
  exactString(record.schema!, SOURCE_SCHEMAS.public_offer, "$public_offer.schema");
  witnessAudience(record.audience!, "$public_offer.audience");
  opaqueRef(record.offer_ref!, "$public_offer.offer_ref");
  opaqueRef(record.subject_ref!, "$public_offer.subject_ref");
  if (record.subject_ref !== record.offer_ref) {
    invalid("Public offer subject_ref must equal offer_ref for the stable WITNESS subject lane.", "$public_offer.subject_ref");
  }
  opaqueRef(record.controller_ref!, "$public_offer.controller_ref");
  unsignedDecimal(record.authority_sequence!, "$public_offer.authority_sequence", { minimum: 1n });
  unsignedDecimal(record.revision!, "$public_offer.revision", { minimum: 1n });
  exactString(record.visibility!, "PUBLIC", "$public_offer.visibility");
  hex(record.nonce!, 32, "$public_offer.nonce");
  validateSingleKeyControlAuthority(record.authority!, "$public_offer.authority");
  validateBoundaries(record.boundaries!, "$public_offer.boundaries");
}

function validateOfferTerms(record: ReturnType<typeof snapshotObject>): void {
  for (const field of ["capability_root", "pricing_root", "sla_root", "terms_digest"] as const) {
    sha256Id(record[field]!, `$public_offer.${field}`);
  }
  const start = canonicalInstant(record.valid_from!, "$public_offer.valid_from");
  const end = canonicalInstant(record.expires_at!, "$public_offer.expires_at");
  const lifetime = new Date(end).getTime() - new Date(start).getTime();
  if (lifetime <= 0 || lifetime > MAX_OFFER_LIFETIME_MS) {
    invalid("Public offer requires a positive lifetime of at most 30 days.", "$public_offer.expires_at");
  }
}

export function validatePublicOfferCore(value: unknown): Readonly<PublicOfferCore> {
  const record = snapshotObject(value, "$public_offer");
  const action = record.action;
  if (action === "PUBLISH") {
    exactKeys(record, [
      "schema", "action", "audience", "offer_ref", "subject_ref", "controller_ref",
      "authority_sequence", "revision", "visibility", "nonce", "authority", "boundaries",
      "capability_root", "pricing_root", "sla_root", "terms_digest", "valid_from", "expires_at",
    ], "$public_offer");
  } else if (action === "SUPERSEDE") {
    exactKeys(record, [
      "schema", "action", "audience", "offer_ref", "subject_ref", "controller_ref",
      "authority_sequence", "revision", "visibility", "nonce", "authority", "boundaries",
      "predecessor", "capability_root", "pricing_root", "sla_root", "terms_digest",
      "valid_from", "expires_at",
    ], "$public_offer");
  } else if (action === "REVOKE") {
    exactKeys(record, [
      "schema", "action", "audience", "offer_ref", "subject_ref", "controller_ref",
      "authority_sequence", "revision", "visibility", "nonce", "authority", "boundaries",
      "predecessor", "reason_digest", "revoked_at",
    ], "$public_offer");
  } else {
    invalid("Public offer action must be PUBLISH, SUPERSEDE, or REVOKE.", "$public_offer.action");
  }
  validateCommon(record);
  if (action === "PUBLISH") {
    if (record.revision !== "1") invalid("Initial public offer revision must be 1.", "$public_offer.revision");
    validateOfferTerms(record);
  } else if (action === "SUPERSEDE") {
    validatePredecessor(record.predecessor!, "$public_offer.predecessor");
    validateOfferTerms(record);
  } else {
    validatePredecessor(record.predecessor!, "$public_offer.predecessor");
    sha256Id(record.reason_digest!, "$public_offer.reason_digest");
    canonicalInstant(record.revoked_at!, "$public_offer.revoked_at");
  }
  return validated<PublicOfferCore>(record);
}

function offerCore(record: Readonly<PublicOfferRecord>): PublicOfferCore {
  const { signature: _signature, offer_id: _offerId, ...core } = record;
  return core;
}

export function publicOfferDigest(value: PublicOfferCore): Uint8Array {
  return agentToolSourceHashBytes(HASH_DOMAINS.public_offer, validatePublicOfferCore(value));
}

export function publicOfferId(value: PublicOfferCore, signatureValue: unknown): Sha256Id {
  const core = validatePublicOfferCore(value);
  const signature = validateHexEd25519Signature(signatureValue);
  return agentToolSourceHash(HASH_DOMAINS.public_offer_id, { ...core, signature });
}

export async function sealPublicOffer(
  value: PublicOfferCore,
  signer: HexEd25519Signer,
): Promise<VerifiedPublicOffer> {
  const core = validatePublicOfferCore(value);
  const checkedSigner = validateHexEd25519Signer(signer);
  if (checkedSigner.public_key !== core.authority.public_key) {
    throw new WitnessProjectionError("SIGNER_MISMATCH", "Signer is not the public-offer key-control authority.");
  }
  const signature = await signHexEd25519Digest(publicOfferDigest(core), checkedSigner);
  const candidate = validatePublicOffer({
    ...core,
    signature,
    offer_id: publicOfferId(core, signature),
  });
  if (verifyPublicOfferSignature(candidate) !== "VALID") {
    throw new WitnessProjectionError("SIGNATURE_INVALID", "Signer returned an invalid public-offer signature.");
  }
  verifiedOffers.add(candidate);
  return candidate as VerifiedPublicOffer;
}

export function validatePublicOffer(value: unknown): Readonly<PublicOfferRecord> {
  const record = snapshotObject(value, "$public_offer");
  const { signature: rawSignature, offer_id: rawOfferId, ...rawCore } = record;
  if (rawSignature === undefined || rawOfferId === undefined) {
    invalid("Signed public offer requires signature and offer_id.", "$public_offer");
  }
  const core = validatePublicOfferCore(rawCore);
  const signature = validateHexEd25519Signature(rawSignature, "$public_offer.signature");
  const offerId = sha256Id(rawOfferId, "$public_offer.offer_id");
  const expected = agentToolSourceHash(HASH_DOMAINS.public_offer_id, { ...core, signature });
  if (offerId !== expected) invalid("offer_id does not bind the exact signed offer.", "$public_offer.offer_id");
  return validated<PublicOfferRecord>(record);
}

export function verifyPublicOfferSignature(value: unknown): "VALID" | "INVALID" {
  try {
    const record = validatePublicOffer(value);
    return record.signature.public_key === record.authority.public_key
      && strictEd25519Verify(
        hexToBytes(record.signature.value, 64),
        publicOfferDigest(offerCore(record)),
        hexToBytes(record.authority.public_key, 32),
      )
      ? "VALID"
      : "INVALID";
  } catch {
    return "INVALID";
  }
}

export function verifyPublicOffer(value: unknown): VerifiedPublicOffer {
  const record = validatePublicOffer(value);
  if (verifyPublicOfferSignature(record) !== "VALID") {
    throw new WitnessProjectionError("SIGNATURE_INVALID", "Public offer signature is invalid.");
  }
  verifiedOffers.add(record);
  return record as VerifiedPublicOffer;
}

type VerifiedActiveOffer = VerifiedPublicOffer & {
  readonly action: "PUBLISH" | "SUPERSEDE";
  readonly valid_from: string;
};

function verifyActiveOffer(value: unknown): VerifiedActiveOffer {
  const offer = verifyPublicOffer(value);
  if (offer.action === "REVOKE") {
    throw new WitnessProjectionError("SOURCE_RECORD_INVALID", "A revoked offer cannot be used as an active predecessor.");
  }
  return offer as VerifiedActiveOffer;
}

export function assertPublicOfferSuccessor(
  previousValue: unknown,
  nextValue: unknown,
): VerifiedPublicOffer {
  const previous = verifyActiveOffer(previousValue);
  const next = verifyPublicOffer(nextValue);
  if (next.action === "PUBLISH") {
    throw new WitnessProjectionError("SEQUENCE_INVALID", "A PUBLISH record cannot extend a prior offer.");
  }
  const predecessor = next.predecessor;
  const sameAuthority = next.authority.public_key === previous.authority.public_key;
  const nextInstant = next.action === "REVOKE" ? next.revoked_at : next.valid_from;
  const previousInstant = previous.valid_from;
  if (
    next.audience !== previous.audience
    || next.offer_ref !== previous.offer_ref
    || next.subject_ref !== previous.subject_ref
    || next.controller_ref !== previous.controller_ref
    || !sameAuthority
    || BigInt(next.authority_sequence) !== BigInt(previous.authority_sequence) + 1n
    || BigInt(next.revision) !== BigInt(previous.revision) + 1n
    || predecessor.offer_id !== previous.offer_id
    || predecessor.document_digest !== canonicalSha256(previous)
    || new Date(nextInstant).getTime() < new Date(previousInstant).getTime()
  ) {
    throw new WitnessProjectionError(
      "SEQUENCE_INVALID",
      "Public offer event does not monotonically extend the exact supplied predecessor.",
    );
  }
  return next;
}

function sourceProjectionFields(offer: VerifiedPublicOffer) {
  return {
    offer_document_digest: canonicalSha256(offer),
    authority_sequence: offer.authority_sequence,
    visibility: "PUBLIC" as const,
  } as const;
}

export function projectPublicOfferPublish(value: unknown): Readonly<PublicOfferPublishProjection> {
  const offer = verifyPublicOffer(value);
  if (offer.action !== "PUBLISH") {
    throw new WitnessProjectionError("SOURCE_RECORD_INVALID", "Expected a PUBLISH public-offer source record.");
  }
  return Object.freeze({
    offer_ref: offer.offer_ref,
    capability_root: offer.capability_root,
    pricing_root: offer.pricing_root,
    sla_root: offer.sla_root,
    terms_digest: offer.terms_digest,
    revision: offer.revision,
    ...sourceProjectionFields(offer),
  });
}

export function projectPublicOfferSupersede(options: {
  previous_offer: unknown;
  next_offer: unknown;
  supersedes: Sha256Id;
}): Readonly<PublicOfferSupersedeProjection> {
  const safeOptions = snapshotObject(options, "$offer_supersede_projection");
  exactKeys(
    safeOptions,
    ["previous_offer", "next_offer", "supersedes"],
    "$offer_supersede_projection",
  );
  const offer = assertPublicOfferSuccessor(safeOptions.previous_offer, safeOptions.next_offer);
  if (offer.action !== "SUPERSEDE") {
    throw new WitnessProjectionError("SOURCE_RECORD_INVALID", "Expected a SUPERSEDE public-offer source record.");
  }
  if (typeof safeOptions.supersedes !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(safeOptions.supersedes)) {
    invalid("supersedes must be the exact prior WITNESS commitment.", "$supersedes");
  }
  return Object.freeze({
    offer_ref: offer.offer_ref,
    capability_root: offer.capability_root,
    pricing_root: offer.pricing_root,
    sla_root: offer.sla_root,
    terms_digest: offer.terms_digest,
    revision: offer.revision,
    supersedes: safeOptions.supersedes as Sha256Id,
    ...sourceProjectionFields(offer),
  });
}

export function projectPublicOfferRevoke(options: {
  previous_offer: unknown;
  revoke_offer: unknown;
  offer_commitment: Sha256Id;
}): Readonly<PublicOfferRevokeProjection> {
  const safeOptions = snapshotObject(options, "$offer_revoke_projection");
  exactKeys(
    safeOptions,
    ["previous_offer", "revoke_offer", "offer_commitment"],
    "$offer_revoke_projection",
  );
  const offer = assertPublicOfferSuccessor(safeOptions.previous_offer, safeOptions.revoke_offer);
  if (offer.action !== "REVOKE") {
    throw new WitnessProjectionError("SOURCE_RECORD_INVALID", "Expected a REVOKE public-offer source record.");
  }
  if (
    typeof safeOptions.offer_commitment !== "string"
    || !/^sha256:[0-9a-f]{64}$/u.test(safeOptions.offer_commitment)
  ) {
    invalid("offer_commitment must be the exact active WITNESS offer commitment.", "$offer_commitment");
  }
  return Object.freeze({
    offer_ref: offer.offer_ref,
    offer_commitment: safeOptions.offer_commitment as Sha256Id,
    reason_digest: offer.reason_digest,
    ...sourceProjectionFields(offer),
  });
}
