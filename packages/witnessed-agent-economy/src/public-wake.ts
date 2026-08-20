import { strictEd25519Verify } from "@agenttool/public-surface-binding";

import {
  HASH_DOMAINS,
  PUBLIC_WAKE_CONTRACT_BOUNDARIES,
  PUBLIC_WAKE_WITHDRAWAL_BOUNDARIES,
  SOURCE_SCHEMAS,
} from "./constants.js";
import { WitnessProjectionError, invalid } from "./errors.js";
import {
  agentToolSourceHash,
  agentToolSourceHashBytes,
  ed25519Fingerprint,
  canonicalSha256,
  hexToBytes,
} from "./hash.js";
import {
  canonicalInstant,
  exactKeys,
  exactString,
  hex,
  keyFingerprint,
  object,
  opaqueRef,
  sha256Id,
  snapshotObject,
  witnessAudience,
  unsignedDecimal,
  validated,
  type JsonValue,
} from "./internal.js";
import {
  signHexEd25519Digest,
  validateHexEd25519Signature,
  validateHexEd25519Signer,
} from "./signature.js";
import type {
  HexEd25519Signer,
  PublicWakeAuthority,
  PublicWakeContract,
  PublicWakeContractCore,
  PublicWakeWithdrawal,
  PublicWakeWithdrawalCore,
  PublicWakeRoots,
  VerifiedPublicWakeContract,
  VerifiedPublicWakeWithdrawal,
} from "./types.js";

const verifiedContracts = new WeakSet<object>();
const verifiedWithdrawals = new WeakSet<object>();
const MAX_CONTRACT_LIFETIME_MS = 30 * 24 * 60 * 60 * 1_000;

function assertBoundaryObject(value: JsonValue, path: string): void {
  const record = object(value, path);
  exactKeys(record, Object.keys(PUBLIC_WAKE_CONTRACT_BOUNDARIES), path);
  for (const [key, expected] of Object.entries(PUBLIC_WAKE_CONTRACT_BOUNDARIES)) {
    if (record[key] !== expected) invalid(`${path}.${key} must be ${JSON.stringify(expected)}.`, `${path}.${key}`);
  }
}

function validateRoots(value: JsonValue, path: string): PublicWakeRoots {
  const record = object(value, path);
  exactKeys(record, ["capabilities", "prices", "protocols", "safety"], path);
  for (const field of ["capabilities", "prices", "protocols", "safety"] as const) {
    sha256Id(record[field]!, `${path}.${field}`);
  }
  return record as unknown as PublicWakeRoots;
}

export function validateSingleKeyControlAuthority(value: JsonValue, path: string): PublicWakeAuthority {
  if (typeof path !== "string" || path.length === 0 || path.length > 512) {
    invalid("Authority validation path must be a bounded string.", "$path");
  }
  const record = snapshotObject(value, path);
  exactKeys(record, ["scheme", "public_key", "key_fingerprint", "registry_match", "multi_root_quorum"], path);
  exactString(record.scheme!, "single_ed25519", `${path}.scheme`);
  const publicKey = hex(record.public_key!, 32, `${path}.public_key`);
  const fingerprint = keyFingerprint(record.key_fingerprint!, `${path}.key_fingerprint`);
  if (fingerprint !== ed25519Fingerprint(publicKey)) {
    invalid(`${path}.key_fingerprint does not match the exact public key.`, `${path}.key_fingerprint`);
  }
  exactString(record.registry_match!, "not_established", `${path}.registry_match`);
  exactString(record.multi_root_quorum!, "not_implemented", `${path}.multi_root_quorum`);
  return record as unknown as PublicWakeAuthority;
}

export function validatePublicWakeContractCore(value: unknown): Readonly<PublicWakeContractCore> {
  const record = snapshotObject(value, "$public_wake_contract");
  exactKeys(record, [
    "schema",
    "audience",
    "subject_ref",
    "controller_ref",
    "authority_sequence",
    "previous_contract_id",
    "roots",
    "valid_from",
    "expires_at",
    "nonce",
    "authority",
    "boundaries",
  ], "$public_wake_contract");
  exactString(record.schema!, SOURCE_SCHEMAS.public_wake_contract, "$public_wake_contract.schema");
  witnessAudience(record.audience!, "$public_wake_contract.audience");
  opaqueRef(record.subject_ref!, "$public_wake_contract.subject_ref");
  opaqueRef(record.controller_ref!, "$public_wake_contract.controller_ref");
  unsignedDecimal(record.authority_sequence!, "$public_wake_contract.authority_sequence", { minimum: 1n });
  if (record.previous_contract_id !== null) {
    sha256Id(record.previous_contract_id!, "$public_wake_contract.previous_contract_id");
  }
  validateRoots(record.roots!, "$public_wake_contract.roots");
  const validFrom = canonicalInstant(record.valid_from!, "$public_wake_contract.valid_from");
  const expiresAt = canonicalInstant(record.expires_at!, "$public_wake_contract.expires_at");
  const startMs = new Date(validFrom).getTime();
  const endMs = new Date(expiresAt).getTime();
  if (endMs <= startMs || endMs - startMs > MAX_CONTRACT_LIFETIME_MS) {
    invalid("Public WAKE contract requires a positive lifetime of at most 30 days.", "$public_wake_contract.expires_at");
  }
  hex(record.nonce!, 32, "$public_wake_contract.nonce");
  validateSingleKeyControlAuthority(record.authority!, "$public_wake_contract.authority");
  assertBoundaryObject(record.boundaries!, "$public_wake_contract.boundaries");
  return validated<PublicWakeContractCore>(record);
}

function publicWakeCore(record: Readonly<PublicWakeContract>): PublicWakeContractCore {
  const { signature: _signature, contract_id: _contractId, ...core } = record;
  return core;
}

export function publicWakeContractDigest(value: PublicWakeContractCore): Uint8Array {
  return agentToolSourceHashBytes(HASH_DOMAINS.public_wake_contract, validatePublicWakeContractCore(value));
}

export function publicWakeContractId(
  value: PublicWakeContractCore,
  signature: unknown,
): `sha256:${string}` {
  const core = validatePublicWakeContractCore(value);
  const checkedSignature = validateHexEd25519Signature(signature);
  return agentToolSourceHash(HASH_DOMAINS.public_wake_contract_id, { ...core, signature: checkedSignature });
}

export async function sealPublicWakeContract(
  value: PublicWakeContractCore,
  signer: HexEd25519Signer,
): Promise<VerifiedPublicWakeContract> {
  const core = validatePublicWakeContractCore(value);
  const checkedSigner = validateHexEd25519Signer(signer);
  if (checkedSigner.public_key !== core.authority.public_key) {
    throw new WitnessProjectionError("SIGNER_MISMATCH", "Signer is not the public WAKE contract authority.");
  }
  const signature = await signHexEd25519Digest(publicWakeContractDigest(core), checkedSigner);
  const candidate = validatePublicWakeContract({
    ...core,
    signature,
    contract_id: publicWakeContractId(core, signature),
  });
  if (verifyPublicWakeContractSignature(candidate) !== "VALID") {
    throw new WitnessProjectionError("SIGNATURE_INVALID", "Signer returned an invalid public WAKE contract signature.");
  }
  verifiedContracts.add(candidate);
  return candidate as VerifiedPublicWakeContract;
}

export function validatePublicWakeContract(value: unknown): Readonly<PublicWakeContract> {
  const record = snapshotObject(value, "$public_wake_contract");
  exactKeys(record, [
    "schema", "audience", "subject_ref", "controller_ref", "authority_sequence",
    "previous_contract_id", "roots", "valid_from", "expires_at", "nonce",
    "authority", "boundaries", "signature", "contract_id",
  ], "$public_wake_contract");
  const { signature: rawSignature, contract_id: rawContractId, ...rawCore } = record;
  const core = validatePublicWakeContractCore(rawCore);
  const signature = validateHexEd25519Signature(rawSignature, "$public_wake_contract.signature");
  const contractId = sha256Id(rawContractId!, "$public_wake_contract.contract_id");
  const expected = agentToolSourceHash(HASH_DOMAINS.public_wake_contract_id, { ...core, signature });
  if (contractId !== expected) invalid("contract_id does not bind the exact signed record.", "$public_wake_contract.contract_id");
  return validated<PublicWakeContract>(record);
}

export function verifyPublicWakeContractSignature(value: unknown): "VALID" | "INVALID" {
  try {
    const record = validatePublicWakeContract(value);
    return strictEd25519Verify(
      hexToBytes(record.signature.value, 64),
      publicWakeContractDigest(publicWakeCore(record)),
      hexToBytes(record.authority.public_key, 32),
    ) && record.signature.public_key === record.authority.public_key
      ? "VALID"
      : "INVALID";
  } catch {
    return "INVALID";
  }
}

export function verifyPublicWakeContract(value: unknown): VerifiedPublicWakeContract {
  const record = validatePublicWakeContract(value);
  if (verifyPublicWakeContractSignature(record) !== "VALID") {
    throw new WitnessProjectionError("SIGNATURE_INVALID", "Public WAKE contract signature is invalid.");
  }
  verifiedContracts.add(record);
  return record as VerifiedPublicWakeContract;
}

export function assertVerifiedPublicWakeContract(
  value: Readonly<PublicWakeContract>,
): asserts value is VerifiedPublicWakeContract {
  if (!verifiedContracts.has(value)) {
    throw new WitnessProjectionError("SIGNATURE_INVALID", "Public WAKE contract has not passed strict verification.");
  }
}

export function assertPublicWakeSuccessor(
  previousValue: unknown,
  nextValue: unknown,
): VerifiedPublicWakeContract {
  const previous = verifyPublicWakeContract(previousValue);
  const next = verifyPublicWakeContract(nextValue);
  if (
    next.audience !== previous.audience
    || next.subject_ref !== previous.subject_ref
    || next.controller_ref !== previous.controller_ref
    || next.authority.public_key !== previous.authority.public_key
    || next.authority.key_fingerprint !== previous.authority.key_fingerprint
    || next.previous_contract_id !== previous.contract_id
    || BigInt(next.authority_sequence) !== BigInt(previous.authority_sequence) + 1n
    || new Date(next.valid_from).getTime() < new Date(previous.valid_from).getTime()
  ) {
    throw new WitnessProjectionError(
      "SEQUENCE_INVALID",
      "Public WAKE successor does not monotonically extend the exact prior contract.",
    );
  }
  return next;
}

function assertWithdrawalBoundaries(value: JsonValue, path: string): void {
  const record = object(value, path);
  exactKeys(record, Object.keys(PUBLIC_WAKE_WITHDRAWAL_BOUNDARIES), path);
  for (const [key, expected] of Object.entries(PUBLIC_WAKE_WITHDRAWAL_BOUNDARIES)) {
    if (record[key] !== expected) invalid(`${path}.${key} must be ${JSON.stringify(expected)}.`, `${path}.${key}`);
  }
}

export function validatePublicWakeWithdrawalCore(value: unknown): Readonly<PublicWakeWithdrawalCore> {
  const record = snapshotObject(value, "$public_wake_withdrawal");
  exactKeys(record, [
    "schema", "audience", "subject_ref", "controller_ref", "authority_sequence",
    "predecessor", "reason_digest", "withdrawn_at", "visibility", "nonce",
    "authority", "boundaries",
  ], "$public_wake_withdrawal");
  exactString(record.schema!, SOURCE_SCHEMAS.public_wake_withdrawal, "$public_wake_withdrawal.schema");
  witnessAudience(record.audience!, "$public_wake_withdrawal.audience");
  opaqueRef(record.subject_ref!, "$public_wake_withdrawal.subject_ref");
  opaqueRef(record.controller_ref!, "$public_wake_withdrawal.controller_ref");
  unsignedDecimal(record.authority_sequence!, "$public_wake_withdrawal.authority_sequence", { minimum: 1n });
  const predecessor = object(record.predecessor!, "$public_wake_withdrawal.predecessor");
  exactKeys(predecessor, ["contract_id", "document_digest"], "$public_wake_withdrawal.predecessor");
  sha256Id(predecessor.contract_id!, "$public_wake_withdrawal.predecessor.contract_id");
  sha256Id(predecessor.document_digest!, "$public_wake_withdrawal.predecessor.document_digest");
  sha256Id(record.reason_digest!, "$public_wake_withdrawal.reason_digest");
  canonicalInstant(record.withdrawn_at!, "$public_wake_withdrawal.withdrawn_at");
  exactString(record.visibility!, "PUBLIC", "$public_wake_withdrawal.visibility");
  hex(record.nonce!, 32, "$public_wake_withdrawal.nonce");
  validateSingleKeyControlAuthority(record.authority!, "$public_wake_withdrawal.authority");
  assertWithdrawalBoundaries(record.boundaries!, "$public_wake_withdrawal.boundaries");
  return validated<PublicWakeWithdrawalCore>(record);
}

function publicWakeWithdrawalCore(record: Readonly<PublicWakeWithdrawal>): PublicWakeWithdrawalCore {
  const { signature: _signature, withdrawal_id: _withdrawalId, ...core } = record;
  return core;
}

export function publicWakeWithdrawalDigest(value: PublicWakeWithdrawalCore): Uint8Array {
  return agentToolSourceHashBytes(HASH_DOMAINS.public_wake_withdrawal, validatePublicWakeWithdrawalCore(value));
}

export function publicWakeWithdrawalId(value: PublicWakeWithdrawalCore, signatureValue: unknown): `sha256:${string}` {
  const core = validatePublicWakeWithdrawalCore(value);
  const signature = validateHexEd25519Signature(signatureValue);
  return agentToolSourceHash(HASH_DOMAINS.public_wake_withdrawal_id, { ...core, signature });
}

export async function sealPublicWakeWithdrawal(
  value: PublicWakeWithdrawalCore,
  signer: HexEd25519Signer,
): Promise<VerifiedPublicWakeWithdrawal> {
  const core = validatePublicWakeWithdrawalCore(value);
  const checkedSigner = validateHexEd25519Signer(signer);
  if (checkedSigner.public_key !== core.authority.public_key) {
    throw new WitnessProjectionError("SIGNER_MISMATCH", "Signer is not the public WAKE withdrawal authority.");
  }
  const signature = await signHexEd25519Digest(publicWakeWithdrawalDigest(core), checkedSigner);
  const candidate = validatePublicWakeWithdrawal({
    ...core,
    signature,
    withdrawal_id: publicWakeWithdrawalId(core, signature),
  });
  if (verifyPublicWakeWithdrawalSignature(candidate) !== "VALID") {
    throw new WitnessProjectionError("SIGNATURE_INVALID", "Signer returned an invalid public WAKE withdrawal signature.");
  }
  verifiedWithdrawals.add(candidate);
  return candidate as VerifiedPublicWakeWithdrawal;
}

export function validatePublicWakeWithdrawal(value: unknown): Readonly<PublicWakeWithdrawal> {
  const record = snapshotObject(value, "$public_wake_withdrawal");
  const { signature: rawSignature, withdrawal_id: rawWithdrawalId, ...rawCore } = record;
  if (rawSignature === undefined || rawWithdrawalId === undefined) {
    invalid("Signed public WAKE withdrawal requires signature and withdrawal_id.", "$public_wake_withdrawal");
  }
  const core = validatePublicWakeWithdrawalCore(rawCore);
  const signature = validateHexEd25519Signature(rawSignature, "$public_wake_withdrawal.signature");
  const withdrawalId = sha256Id(rawWithdrawalId, "$public_wake_withdrawal.withdrawal_id");
  const expected = agentToolSourceHash(HASH_DOMAINS.public_wake_withdrawal_id, { ...core, signature });
  if (withdrawalId !== expected) {
    invalid("withdrawal_id does not bind the exact signed withdrawal.", "$public_wake_withdrawal.withdrawal_id");
  }
  return validated<PublicWakeWithdrawal>(record);
}

export function verifyPublicWakeWithdrawalSignature(value: unknown): "VALID" | "INVALID" {
  try {
    const record = validatePublicWakeWithdrawal(value);
    return record.signature.public_key === record.authority.public_key
      && strictEd25519Verify(
        hexToBytes(record.signature.value, 64),
        publicWakeWithdrawalDigest(publicWakeWithdrawalCore(record)),
        hexToBytes(record.authority.public_key, 32),
      )
      ? "VALID"
      : "INVALID";
  } catch {
    return "INVALID";
  }
}

export function verifyPublicWakeWithdrawal(value: unknown): VerifiedPublicWakeWithdrawal {
  const record = validatePublicWakeWithdrawal(value);
  if (verifyPublicWakeWithdrawalSignature(record) !== "VALID") {
    throw new WitnessProjectionError("SIGNATURE_INVALID", "Public WAKE withdrawal signature is invalid.");
  }
  verifiedWithdrawals.add(record);
  return record as VerifiedPublicWakeWithdrawal;
}

export function verifyPublicWakeWithdrawalForContract(options: {
  contract: unknown;
  withdrawal: unknown;
}): VerifiedPublicWakeWithdrawal {
  const safeOptions = snapshotObject(options, "$public_wake_withdrawal_relationship");
  exactKeys(
    safeOptions,
    ["contract", "withdrawal"],
    "$public_wake_withdrawal_relationship",
  );
  const contract = verifyPublicWakeContract(safeOptions.contract);
  const withdrawal = verifyPublicWakeWithdrawal(safeOptions.withdrawal);
  if (
    withdrawal.audience !== contract.audience
    || withdrawal.subject_ref !== contract.subject_ref
    || withdrawal.controller_ref !== contract.controller_ref
    || withdrawal.authority.public_key !== contract.authority.public_key
    || withdrawal.authority.key_fingerprint !== contract.authority.key_fingerprint
    || BigInt(withdrawal.authority_sequence) !== BigInt(contract.authority_sequence) + 1n
    || withdrawal.predecessor.contract_id !== contract.contract_id
    || withdrawal.predecessor.document_digest !== canonicalSha256(contract)
    || new Date(withdrawal.withdrawn_at).getTime() < new Date(contract.valid_from).getTime()
  ) {
    throw new WitnessProjectionError(
      "SEQUENCE_INVALID",
      "Public WAKE withdrawal does not monotonically withdraw the exact supplied contract under the same key.",
    );
  }
  return withdrawal;
}
