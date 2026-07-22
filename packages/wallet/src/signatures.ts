import * as ed25519 from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";

import { base64UrlEncode, decodeFixedBase64Url } from "./bytes.js";
import { sha256Id, signingDigest } from "./canonical.js";
import { SIGNING_DOMAINS } from "./constants.js";
import { WalletProtocolError, invalid } from "./errors.js";
import { assertEd25519Signature } from "./identifiers.js";
import type {
  ContinuityEvent,
  ContinuityEventCore,
  Ed25519PublicKey,
  RecordSignature,
  RecordSigner,
  SignedRecordFields,
  SigningReceipt,
  SigningReceiptCore,
  SimulationReceipt,
  SimulationReceiptCore,
  TransactionIntent,
  TransactionIntentCore,
  Verified,
  WalletCapability,
  WalletCapabilityCore,
  WalletDescriptor,
  WalletDescriptorCore,
} from "./types.js";
import {
  unsignedRecord,
  validateCapabilityCore,
  validateContinuityCore,
  validateContinuityEvent,
  validateDescriptorCore,
  validateIntentCore,
  validateSigningReceipt,
  validateSigningReceiptCore,
  validateSimulationCore,
  validateSimulationReceipt,
  validateTransactionIntent,
  validateWalletCapability,
  validateWalletDescriptor,
} from "./validation.js";

ed25519.etc.sha512Sync = (...messages: Uint8Array[]) => {
  const hash = sha512.create();
  for (const message of messages) hash.update(message);
  return hash.digest();
};

const verifiedRecords = new WeakSet<object>();

/** Strict RFC 8032 verification: canonical encodings and prime-subgroup A/R points. */
export function strictEd25519Verify(
  signature: Uint8Array,
  message: Uint8Array,
  publicKey: Uint8Array,
): boolean {
  try {
    if (signature.byteLength !== 64 || publicKey.byteLength !== 32) return false;
    const publicPoint = ed25519.Point.fromHex(publicKey, false);
    const rPoint = ed25519.Point.fromHex(signature.subarray(0, 32), false);
    if (
      publicPoint.isSmallOrder()
      || !publicPoint.isTorsionFree()
      || rPoint.isSmallOrder()
      || !rPoint.isTorsionFree()
    ) return false;
    return ed25519.verify(signature, message, publicKey, { zip215: false });
  } catch {
    return false;
  }
}

function verifyDigest(
  core: unknown,
  domain: string,
  authority: Ed25519PublicKey,
  signature: RecordSignature,
): boolean {
  return strictEd25519Verify(
    decodeFixedBase64Url(signature.value, 64, "signature.value"),
    signingDigest(domain, core),
    decodeFixedBase64Url(authority.public_key, 32, "authority.public_key"),
  );
}

function markVerified<T extends object>(record: T): Verified<T> {
  verifiedRecords.add(record);
  return record as Verified<T>;
}

export function assertVerifiedRecord<T extends object>(record: T): asserts record is T & Verified<T> {
  if (!verifiedRecords.has(record)) {
    throw new WalletProtocolError(
      "SIGNATURE_INVALID",
      "Record must be returned by a verify* or seal* function before authorization.",
    );
  }
}

async function sealValidated<TCore extends object, TRecord extends TCore & SignedRecordFields>(options: {
  core: Readonly<TCore>;
  domain: string;
  authority: Ed25519PublicKey;
  signer: RecordSigner;
  validate: (value: unknown) => Readonly<TRecord>;
}): Promise<Verified<TRecord>> {
  if (options.signer.public_key !== options.authority.public_key) {
    throw new WalletProtocolError(
      "AUTHORITY_MISMATCH",
      "Record signer public key does not match the authority-bearing field.",
    );
  }
  const digest = signingDigest(options.domain, options.core);
  const value = await options.signer.sign_digest(Uint8Array.from(digest));
  assertEd25519Signature(value, "signature.value");
  const signature: RecordSignature = { algorithm: "Ed25519", value };
  if (!verifyDigest(options.core, options.domain, options.authority, signature)) {
    throw new WalletProtocolError("SIGNATURE_INVALID", "Record signer returned an invalid signature.");
  }
  const withoutId = { ...options.core, signature };
  const candidate = { ...withoutId, record_id: sha256Id(withoutId) };
  return markVerified(options.validate(candidate) as TRecord);
}

function verifyValidated<TRecord extends object & SignedRecordFields>(options: {
  record: Readonly<TRecord>;
  core: object;
  domain: string;
  authority: Ed25519PublicKey;
}): Verified<TRecord> {
  const withoutId = { ...options.core, signature: options.record.signature };
  if (sha256Id(withoutId) !== options.record.record_id) {
    throw new WalletProtocolError("INTEGRITY_FAILURE", "record_id does not match the signed record bytes.");
  }
  if (!verifyDigest(options.core, options.domain, options.authority, options.record.signature)) {
    throw new WalletProtocolError("SIGNATURE_INVALID", "Record signature is invalid.");
  }
  return markVerified(options.record as TRecord);
}

export function descriptorDigest(core: WalletDescriptorCore): Uint8Array {
  return signingDigest(SIGNING_DOMAINS.descriptor, validateDescriptorCore(core));
}

export function capabilityDigest(core: WalletCapabilityCore): Uint8Array {
  return signingDigest(SIGNING_DOMAINS.capability, validateCapabilityCore(core));
}

export function intentDigest(core: TransactionIntentCore): Uint8Array {
  return signingDigest(SIGNING_DOMAINS.intent, validateIntentCore(core));
}

export function simulationDigest(core: SimulationReceiptCore): Uint8Array {
  return signingDigest(SIGNING_DOMAINS.simulation, validateSimulationCore(core));
}

export function signingReceiptDigest(core: SigningReceiptCore): Uint8Array {
  return signingDigest(SIGNING_DOMAINS.signing_receipt, validateSigningReceiptCore(core));
}

export function continuityDigest(core: ContinuityEventCore): Uint8Array {
  return signingDigest(SIGNING_DOMAINS.continuity, validateContinuityCore(core));
}

export async function sealWalletDescriptor(
  core: WalletDescriptorCore,
  signer: RecordSigner,
): Promise<Verified<WalletDescriptor>> {
  const validated = validateDescriptorCore(core);
  return sealValidated({
    core: validated,
    domain: SIGNING_DOMAINS.descriptor,
    authority: validated.authority,
    signer,
    validate: validateWalletDescriptor,
  });
}

export async function sealWalletCapability(
  core: WalletCapabilityCore,
  signer: RecordSigner,
): Promise<Verified<WalletCapability>> {
  const validated = validateCapabilityCore(core);
  return sealValidated({
    core: validated,
    domain: SIGNING_DOMAINS.capability,
    authority: validated.issuer,
    signer,
    validate: validateWalletCapability,
  });
}

export async function sealTransactionIntent(
  core: TransactionIntentCore,
  signer: RecordSigner,
): Promise<Verified<TransactionIntent>> {
  const validated = validateIntentCore(core);
  return sealValidated({
    core: validated,
    domain: SIGNING_DOMAINS.intent,
    authority: validated.delegate,
    signer,
    validate: validateTransactionIntent,
  });
}

export async function sealSimulationReceipt(
  core: SimulationReceiptCore,
  signer: RecordSigner,
): Promise<Verified<SimulationReceipt>> {
  const validated = validateSimulationCore(core);
  return sealValidated({
    core: validated,
    domain: SIGNING_DOMAINS.simulation,
    authority: validated.adapter,
    signer,
    validate: validateSimulationReceipt,
  });
}

export async function sealSigningReceipt(
  core: SigningReceiptCore,
  signer: RecordSigner,
): Promise<Verified<SigningReceipt>> {
  const validated = validateSigningReceiptCore(core);
  return sealValidated({
    core: validated,
    domain: SIGNING_DOMAINS.signing_receipt,
    authority: validated.receipt_authority,
    signer,
    validate: validateSigningReceipt,
  });
}

export async function sealContinuityEvent(
  core: ContinuityEventCore,
  signer: RecordSigner,
): Promise<Verified<ContinuityEvent>> {
  const validated = validateContinuityCore(core);
  return sealValidated({
    core: validated,
    domain: SIGNING_DOMAINS.continuity,
    authority: validated.actor,
    signer,
    validate: validateContinuityEvent,
  });
}

export function verifyWalletDescriptor(value: unknown): Verified<WalletDescriptor> {
  const record = validateWalletDescriptor(value);
  const core = unsignedRecord(record);
  return verifyValidated({ record, core, domain: SIGNING_DOMAINS.descriptor, authority: record.authority });
}

export function verifyWalletCapability(value: unknown): Verified<WalletCapability> {
  const record = validateWalletCapability(value);
  const core = unsignedRecord(record);
  return verifyValidated({ record, core, domain: SIGNING_DOMAINS.capability, authority: record.issuer });
}

export function verifyTransactionIntent(value: unknown): Verified<TransactionIntent> {
  const record = validateTransactionIntent(value);
  const core = unsignedRecord(record);
  return verifyValidated({ record, core, domain: SIGNING_DOMAINS.intent, authority: record.delegate });
}

export function verifySimulationReceipt(value: unknown): Verified<SimulationReceipt> {
  const record = validateSimulationReceipt(value);
  const core = unsignedRecord(record);
  return verifyValidated({ record, core, domain: SIGNING_DOMAINS.simulation, authority: record.adapter });
}

export function verifySigningReceipt(value: unknown): Verified<SigningReceipt> {
  const record = validateSigningReceipt(value);
  const core = unsignedRecord(record);
  return verifyValidated({
    record,
    core,
    domain: SIGNING_DOMAINS.signing_receipt,
    authority: record.receipt_authority,
  });
}

export function verifyContinuityEvent(value: unknown): Verified<ContinuityEvent> {
  const record = validateContinuityEvent(value);
  const core = unsignedRecord(record);
  return verifyValidated({ record, core, domain: SIGNING_DOMAINS.continuity, authority: record.actor });
}

export function publicKeyFromBase64Url(publicKey: string): Uint8Array {
  return decodeFixedBase64Url(publicKey, 32, "public_key");
}

export function signatureToBase64Url(signature: Uint8Array): string {
  if (signature.byteLength !== 64) return invalid("Ed25519 signatures must be 64 bytes.");
  return base64UrlEncode(signature);
}

export function signatureFromBase64Url(signature: string): Uint8Array {
  return decodeFixedBase64Url(signature, 64, "signature");
}
