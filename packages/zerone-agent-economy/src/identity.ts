import { secp256k1 } from "@noble/curves/secp256k1.js";
import {
  base64UrlEncode,
  bytesToHex,
  decodeFixedBase64Url,
  keyIdForPublicKey,
  signingDigest,
  strictEd25519Verify,
  type Ed25519PublicKey,
  type Sha256Id,
} from "@agenttool/wallet";
import {
  addressFromZeroneAccountId,
  describeZeronePublicKey,
  getZeroneProfile,
  assertZeroneAccountId,
  type ZeroneAccountId,
  type ZeroneNetwork,
} from "@agenttool/wallet-zerone";

import { FORMATS, HASH_DOMAINS, SEMANTIC_BOUNDARY } from "./constants.js";
import { domainSeparatedId, domainSeparatedSigningBytes } from "./canonical.js";
import { invalid } from "./errors.js";
import {
  assertSemanticBoundary,
  did,
  freeze,
  hash,
  record,
  text,
  timestamp,
  uint32Number,
} from "./internal.js";
import type {
  WalletIdentityBinding,
  WalletIdentityBindingCore,
  WalletIdentityBindingProofCore,
  WalletIdentityBindingProofEnvelope,
  WalletIdentityBindingSigningRequest,
  VerifiedWalletIdentityBindingProof,
  ZeroneSignerDescription,
} from "./types.js";

const CORE_KEYS = [
  "format",
  "identity_authority",
  "issued_at",
  "network",
  "owner_identity_id",
  "previous_binding_id",
  "proof_status",
  "revision",
  "semantic_boundary",
  "wallet_continuity_sequence",
  "wallet_descriptor_id",
  "wallet_id",
  "zerone_account_id",
  "zerone_address",
  "zerone_signer",
] as const;

const PROOF_CORE_KEYS = [
  "binding",
  "effects_performed",
  "format",
  "identity_proof",
  "shared_signing_digest",
  "signature_input",
  "signing_domain",
  "wallet_proof",
] as const;

const verifiedBindingProofs = new WeakSet<object>();

function network(value: unknown, path: string): ZeroneNetwork {
  if (value !== "mainnet" && value !== "testnet") {
    invalid("invalid_identity_binding", `${path} must be mainnet or testnet.`, path);
  }
  return value;
}

function validateIdentityAuthority(value: unknown): Ed25519PublicKey {
  const item = record(value, ["algorithm", "key_id", "public_key"], "$.identity_authority");
  if (item.algorithm !== "Ed25519") {
    invalid("invalid_identity_binding", "Identity authority must use Ed25519.", "$.identity_authority.algorithm");
  }
  const publicKey = text(item.public_key, "$.identity_authority.public_key", 64);
  let computed: Sha256Id;
  try {
    computed = keyIdForPublicKey(publicKey);
  } catch {
    invalid(
      "invalid_identity_binding",
      "Identity authority public_key must be canonical base64url for 32 bytes.",
      "$.identity_authority.public_key",
    );
  }
  const keyId = hash(item.key_id, "$.identity_authority.key_id");
  if (keyId !== computed) {
    invalid(
      "invalid_identity_binding",
      "Identity authority key_id does not match public_key.",
      "$.identity_authority.key_id",
    );
  }
  return freeze({ algorithm: "Ed25519", key_id: keyId, public_key: publicKey });
}

function validateZeroneSigner(
  value: unknown,
  account: ZeroneAccountId,
  selectedNetwork: ZeroneNetwork,
): ZeroneSignerDescription {
  const item = record(value, ["algorithm", "encoding", "key_id", "public_key_b64u"], "$.zerone_signer");
  if (item.algorithm !== "secp256k1" || item.encoding !== "compressed") {
    invalid(
      "invalid_identity_binding",
      "Zerone signer must be a compressed secp256k1 key.",
      "$.zerone_signer",
    );
  }
  const publicKeyText = text(item.public_key_b64u, "$.zerone_signer.public_key_b64u", 64);
  let publicKey: Uint8Array;
  try {
    publicKey = decodeFixedBase64Url(publicKeyText, 33, "zerone_signer.public_key_b64u");
  } catch {
    invalid(
      "invalid_identity_binding",
      "Zerone signer public key must be canonical base64url for 33 compressed bytes.",
      "$.zerone_signer.public_key_b64u",
    );
  }
  let described: ReturnType<typeof describeZeronePublicKey>;
  try {
    described = describeZeronePublicKey(publicKey);
  } catch {
    invalid(
      "invalid_identity_binding",
      "Zerone signer public key is not a valid compressed secp256k1 key.",
      "$.zerone_signer.public_key_b64u",
    );
  }
  const keyId = hash(item.key_id, "$.zerone_signer.key_id");
  if (keyId !== described.signer_key_id) {
    invalid("invalid_identity_binding", "Zerone signer key_id does not match public key.", "$.zerone_signer.key_id");
  }
  const profile = getZeroneProfile(selectedNetwork);
  const accountAddress = addressFromZeroneAccountId(account, profile);
  if (accountAddress !== described.address) {
    invalid(
      "invalid_identity_binding",
      "Zerone account address does not match its compressed secp256k1 public key.",
      "$.zerone_account_id",
    );
  }
  return freeze({
    algorithm: "secp256k1",
    encoding: "compressed",
    public_key_b64u: described.public_key_b64u,
    key_id: keyId,
  });
}

export function validateWalletIdentityBindingCore(value: unknown): WalletIdentityBindingCore {
  const item = record(value, CORE_KEYS, "$");
  if (item.format !== FORMATS.wallet_binding) {
    invalid("invalid_identity_binding", `format must be ${FORMATS.wallet_binding}.`, "$.format");
  }
  const selectedNetwork = network(item.network, "$.network");
  const profile = getZeroneProfile(selectedNetwork);
  try {
    assertZeroneAccountId(item.zerone_account_id, profile, "$.zerone_account_id");
  } catch {
    invalid("invalid_identity_binding", "zerone_account_id does not match the selected network.", "$.zerone_account_id");
  }
  const account = item.zerone_account_id as ZeroneAccountId;
  const address = text(item.zerone_address, "$.zerone_address", 128);
  if (addressFromZeroneAccountId(account, profile) !== address) {
    invalid("invalid_identity_binding", "zerone_address does not match zerone_account_id.", "$.zerone_address");
  }
  const revision = uint32Number(item.revision, "$.revision", { positive: true });
  const previous = item.previous_binding_id === null
    ? null
    : hash(item.previous_binding_id, "$.previous_binding_id");
  if ((revision === 1) !== (previous === null)) {
    invalid(
      "invalid_rotation",
      "Revision 1 must have no predecessor; every later revision must name exactly one predecessor.",
      "$.previous_binding_id",
    );
  }
  if (item.proof_status !== "unsigned_unverified") {
    invalid(
      "invalid_identity_binding",
      "This pure package accepts only an explicitly unsigned, unverified binding candidate.",
      "$.proof_status",
    );
  }
  const continuitySequence = uint32Number(
    item.wallet_continuity_sequence,
    "$.wallet_continuity_sequence",
  );
  assertSemanticBoundary(item.semantic_boundary, "$.semantic_boundary");
  const core: WalletIdentityBindingCore = {
    format: FORMATS.wallet_binding,
    network: selectedNetwork,
    owner_identity_id: did(item.owner_identity_id, "$.owner_identity_id"),
    wallet_id: text(item.wallet_id, "$.wallet_id", 256),
    wallet_descriptor_id: hash(item.wallet_descriptor_id, "$.wallet_descriptor_id"),
    identity_authority: validateIdentityAuthority(item.identity_authority),
    zerone_account_id: account,
    zerone_address: address,
    zerone_signer: validateZeroneSigner(item.zerone_signer, account, selectedNetwork),
    revision,
    wallet_continuity_sequence: continuitySequence,
    previous_binding_id: previous,
    proof_status: "unsigned_unverified",
    issued_at: timestamp(item.issued_at, "$.issued_at"),
    semantic_boundary: SEMANTIC_BOUNDARY,
  };
  return freeze(core) as WalletIdentityBindingCore;
}

export interface CreateWalletIdentityBindingInput {
  readonly network: ZeroneNetwork;
  readonly owner_identity_id: string;
  readonly wallet_id: string;
  readonly wallet_descriptor_id: Sha256Id;
  readonly identity_authority: Ed25519PublicKey;
  readonly zerone_account_id: ZeroneAccountId;
  readonly zerone_public_key: Uint8Array;
  readonly revision: number;
  readonly wallet_continuity_sequence: number;
  readonly previous_binding_id: Sha256Id | null;
  readonly issued_at: string;
}

export function createWalletIdentityBinding(
  input: CreateWalletIdentityBindingInput,
): WalletIdentityBinding {
  const profile = getZeroneProfile(input.network);
  const signer = describeZeronePublicKey(input.zerone_public_key);
  const core = validateWalletIdentityBindingCore({
    format: FORMATS.wallet_binding,
    network: input.network,
    owner_identity_id: input.owner_identity_id,
    wallet_id: input.wallet_id,
    wallet_descriptor_id: input.wallet_descriptor_id,
    identity_authority: input.identity_authority,
    zerone_account_id: input.zerone_account_id,
    zerone_address: addressFromZeroneAccountId(input.zerone_account_id, profile),
    zerone_signer: {
      algorithm: "secp256k1",
      encoding: "compressed",
      public_key_b64u: signer.public_key_b64u,
      key_id: signer.signer_key_id,
    },
    revision: input.revision,
    wallet_continuity_sequence: input.wallet_continuity_sequence,
    previous_binding_id: input.previous_binding_id,
    proof_status: "unsigned_unverified",
    issued_at: input.issued_at,
    semantic_boundary: SEMANTIC_BOUNDARY,
  });
  return freeze({
    ...core,
    binding_id: domainSeparatedId(HASH_DOMAINS.wallet_binding, core),
  }) as WalletIdentityBinding;
}

export function validateWalletIdentityBinding(value: unknown): WalletIdentityBinding {
  const item = record(value, [...CORE_KEYS, "binding_id"], "$");
  const { binding_id: bindingIdValue, ...coreValue } = item;
  const core = validateWalletIdentityBindingCore(coreValue);
  const bindingId = hash(bindingIdValue, "$.binding_id");
  if (bindingId !== domainSeparatedId(HASH_DOMAINS.wallet_binding, core)) {
    invalid("invalid_identity_binding", "binding_id does not match the canonical binding core.", "$.binding_id");
  }
  return freeze({ ...core, binding_id: bindingId }) as WalletIdentityBinding;
}

function bindingCore(binding: WalletIdentityBinding): WalletIdentityBindingCore {
  return {
    format: binding.format,
    network: binding.network,
    owner_identity_id: binding.owner_identity_id,
    wallet_id: binding.wallet_id,
    wallet_descriptor_id: binding.wallet_descriptor_id,
    identity_authority: binding.identity_authority,
    zerone_account_id: binding.zerone_account_id,
    zerone_address: binding.zerone_address,
    zerone_signer: binding.zerone_signer,
    revision: binding.revision,
    wallet_continuity_sequence: binding.wallet_continuity_sequence,
    previous_binding_id: binding.previous_binding_id,
    proof_status: binding.proof_status,
    issued_at: binding.issued_at,
    semantic_boundary: binding.semantic_boundary,
  };
}

function sharedBindingDigest(binding: WalletIdentityBinding): Uint8Array {
  const digest = signingDigest(HASH_DOMAINS.wallet_binding, bindingCore(binding));
  const digestId = `sha256:${bytesToHex(digest)}` as Sha256Id;
  if (digestId !== binding.binding_id) {
    invalid("invalid_identity_binding", "Binding signing digest and binding_id diverged.");
  }
  return digest;
}

export function createWalletIdentityBindingSigningRequest(
  value: WalletIdentityBinding,
): WalletIdentityBindingSigningRequest {
  const binding = validateWalletIdentityBinding(value);
  const core = bindingCore(binding);
  const bytes = domainSeparatedSigningBytes(HASH_DOMAINS.wallet_binding, core);
  const digestBytes = sharedBindingDigest(binding);
  return freeze({
    binding,
    signing_domain: HASH_DOMAINS.wallet_binding,
    signing_bytes_b64u: base64UrlEncode(bytes),
    shared_signing_digest: binding.binding_id,
    shared_signing_digest_b64u: base64UrlEncode(digestBytes),
    signature_input: "shared_signing_digest_raw_32_bytes",
    required_proofs: [
      {
        role: "identity_root_authorization",
        algorithm: "Ed25519",
        key_id: binding.identity_authority.key_id,
      },
      {
        role: "wallet_key_control",
        algorithm: "secp256k1",
        key_id: binding.zerone_signer.key_id,
      },
    ],
    signer_injection: "external",
    effects_performed: false,
  }) as WalletIdentityBindingSigningRequest;
}

function identityProof(
  value: unknown,
  binding: WalletIdentityBinding,
): WalletIdentityBindingProofCore["identity_proof"] {
  const item = record(value, ["algorithm", "key_id", "role", "signature_b64u"], "$.identity_proof");
  if (item.role !== "identity_root_authorization" || item.algorithm !== "Ed25519") {
    invalid(
      "invalid_identity_proof",
      "Identity proof role and algorithm must be identity_root_authorization and Ed25519.",
      "$.identity_proof",
    );
  }
  const keyId = hash(item.key_id, "$.identity_proof.key_id");
  if (keyId !== binding.identity_authority.key_id) {
    invalid(
      "invalid_identity_proof",
      "Identity proof key_id does not match the binding authority.",
      "$.identity_proof.key_id",
    );
  }
  const signature = text(item.signature_b64u, "$.identity_proof.signature_b64u", 128);
  try {
    decodeFixedBase64Url(signature, 64, "identity_proof.signature_b64u");
  } catch {
    invalid(
      "invalid_identity_proof",
      "Identity proof signature must be canonical base64url for 64 bytes.",
      "$.identity_proof.signature_b64u",
    );
  }
  return freeze({
    role: "identity_root_authorization",
    algorithm: "Ed25519",
    key_id: keyId,
    signature_b64u: signature,
  });
}

function walletProof(
  value: unknown,
  binding: WalletIdentityBinding,
): WalletIdentityBindingProofCore["wallet_proof"] {
  const item = record(
    value,
    ["algorithm", "encoding", "key_id", "role", "signature_b64u"],
    "$.wallet_proof",
  );
  if (
    item.role !== "wallet_key_control"
    || item.algorithm !== "secp256k1"
    || item.encoding !== "compact_low_s"
  ) {
    invalid(
      "invalid_identity_proof",
      "Wallet proof must be compact_low_s secp256k1 wallet_key_control.",
      "$.wallet_proof",
    );
  }
  const keyId = hash(item.key_id, "$.wallet_proof.key_id");
  if (keyId !== binding.zerone_signer.key_id) {
    invalid(
      "invalid_identity_proof",
      "Wallet proof key_id does not match the binding signer.",
      "$.wallet_proof.key_id",
    );
  }
  const signature = text(item.signature_b64u, "$.wallet_proof.signature_b64u", 128);
  try {
    decodeFixedBase64Url(signature, 64, "wallet_proof.signature_b64u");
  } catch {
    invalid(
      "invalid_identity_proof",
      "Wallet proof signature must be canonical base64url for compact 64-byte r || s.",
      "$.wallet_proof.signature_b64u",
    );
  }
  return freeze({
    role: "wallet_key_control",
    algorithm: "secp256k1",
    encoding: "compact_low_s",
    key_id: keyId,
    signature_b64u: signature,
  });
}

export function validateWalletIdentityBindingProofCore(
  value: unknown,
): WalletIdentityBindingProofCore {
  const item = record(value, PROOF_CORE_KEYS, "$");
  if (item.format !== FORMATS.wallet_binding_proof) {
    invalid(
      "invalid_identity_proof",
      `format must be ${FORMATS.wallet_binding_proof}.`,
      "$.format",
    );
  }
  const binding = validateWalletIdentityBinding(item.binding);
  if (item.signing_domain !== HASH_DOMAINS.wallet_binding) {
    invalid(
      "invalid_identity_proof",
      `signing_domain must be ${HASH_DOMAINS.wallet_binding}.`,
      "$.signing_domain",
    );
  }
  const digest = hash(item.shared_signing_digest, "$.shared_signing_digest");
  if (digest !== binding.binding_id) {
    invalid(
      "invalid_identity_proof",
      "shared_signing_digest must equal the exact binding_id.",
      "$.shared_signing_digest",
    );
  }
  if (item.signature_input !== "shared_signing_digest_raw_32_bytes") {
    invalid(
      "invalid_identity_proof",
      "Both proof signatures must use the exact raw 32-byte shared digest without a second hash.",
      "$.signature_input",
    );
  }
  if (item.effects_performed !== false) {
    invalid(
      "invalid_identity_proof",
      "A proof envelope performs no custody, network, or economic effect.",
      "$.effects_performed",
    );
  }
  return freeze({
    format: FORMATS.wallet_binding_proof,
    binding,
    signing_domain: HASH_DOMAINS.wallet_binding,
    shared_signing_digest: digest,
    signature_input: "shared_signing_digest_raw_32_bytes",
    identity_proof: identityProof(item.identity_proof, binding),
    wallet_proof: walletProof(item.wallet_proof, binding),
    effects_performed: false,
  }) as WalletIdentityBindingProofCore;
}

export function validateWalletIdentityBindingProofEnvelope(
  value: unknown,
): WalletIdentityBindingProofEnvelope {
  const item = record(value, [...PROOF_CORE_KEYS, "proof_id"], "$");
  const { proof_id: proofIdValue, ...coreValue } = item;
  const core = validateWalletIdentityBindingProofCore(coreValue);
  const proofId = hash(proofIdValue, "$.proof_id");
  if (proofId !== domainSeparatedId(HASH_DOMAINS.wallet_binding_proof, core)) {
    invalid(
      "invalid_identity_proof",
      "proof_id does not match the canonical proof envelope core.",
      "$.proof_id",
    );
  }
  return freeze({ ...core, proof_id: proofId }) as WalletIdentityBindingProofEnvelope;
}

export function verifyWalletIdentityBindingProofEnvelope(
  value: unknown,
): VerifiedWalletIdentityBindingProof {
  const envelope = validateWalletIdentityBindingProofEnvelope(value);
  const digest = sharedBindingDigest(envelope.binding);
  const identitySignature = decodeFixedBase64Url(
    envelope.identity_proof.signature_b64u,
    64,
    "identity_proof.signature_b64u",
  );
  const identityPublicKey = decodeFixedBase64Url(
    envelope.binding.identity_authority.public_key,
    32,
    "identity_authority.public_key",
  );
  if (!strictEd25519Verify(identitySignature, digest, identityPublicKey)) {
    invalid(
      "invalid_identity_proof",
      "Ed25519 identity-root signature does not verify over the exact shared digest.",
      "$.identity_proof.signature_b64u",
    );
  }

  const walletSignature = decodeFixedBase64Url(
    envelope.wallet_proof.signature_b64u,
    64,
    "wallet_proof.signature_b64u",
  );
  const walletPublicKey = decodeFixedBase64Url(
    envelope.binding.zerone_signer.public_key_b64u,
    33,
    "zerone_signer.public_key_b64u",
  );
  let walletSignatureValid = false;
  try {
    walletSignatureValid = secp256k1.verify(
      walletSignature,
      digest,
      walletPublicKey,
      { prehash: false, lowS: true, format: "compact" },
    );
  } catch {
    walletSignatureValid = false;
  }
  if (!walletSignatureValid) {
    invalid(
      "invalid_identity_proof",
      "Compact low-S secp256k1 wallet signature does not verify over the exact shared digest.",
      "$.wallet_proof.signature_b64u",
    );
  }

  verifiedBindingProofs.add(envelope);
  return envelope as VerifiedWalletIdentityBindingProof;
}

export interface CreateWalletIdentityBindingProofEnvelopeInput {
  readonly binding: WalletIdentityBinding;
  readonly identity_signature_b64u: string;
  readonly wallet_signature_b64u: string;
}

export function createWalletIdentityBindingProofEnvelope(
  input: CreateWalletIdentityBindingProofEnvelopeInput,
): VerifiedWalletIdentityBindingProof {
  const item = record(
    input,
    ["binding", "identity_signature_b64u", "wallet_signature_b64u"],
    "$",
  );
  const binding = validateWalletIdentityBinding(item.binding);
  const core = validateWalletIdentityBindingProofCore({
    format: FORMATS.wallet_binding_proof,
    binding,
    signing_domain: HASH_DOMAINS.wallet_binding,
    shared_signing_digest: binding.binding_id,
    signature_input: "shared_signing_digest_raw_32_bytes",
    identity_proof: {
      role: "identity_root_authorization",
      algorithm: "Ed25519",
      key_id: binding.identity_authority.key_id,
      signature_b64u: item.identity_signature_b64u,
    },
    wallet_proof: {
      role: "wallet_key_control",
      algorithm: "secp256k1",
      encoding: "compact_low_s",
      key_id: binding.zerone_signer.key_id,
      signature_b64u: item.wallet_signature_b64u,
    },
    effects_performed: false,
  });
  return verifyWalletIdentityBindingProofEnvelope({
    ...core,
    proof_id: domainSeparatedId(HASH_DOMAINS.wallet_binding_proof, core),
  });
}

export function assertVerifiedWalletIdentityBindingProof(
  value: WalletIdentityBindingProofEnvelope,
): asserts value is VerifiedWalletIdentityBindingProof {
  if (!verifiedBindingProofs.has(value)) {
    invalid(
      "invalid_identity_proof",
      "Proof envelope must be returned by a create or verify function in this process.",
    );
  }
}

export function assertWalletIdentityBindingSuccessor(
  previousValue: WalletIdentityBinding,
  nextValue: WalletIdentityBinding,
): void {
  const previous = validateWalletIdentityBinding(previousValue);
  const next = validateWalletIdentityBinding(nextValue);
  if (
    next.previous_binding_id !== previous.binding_id
    || next.revision !== previous.revision + 1
  ) {
    invalid("invalid_rotation", "Binding rotation must advance one revision from the exact current head.");
  }
  if (
    next.owner_identity_id !== previous.owner_identity_id
    || next.wallet_id !== previous.wallet_id
    || next.network !== previous.network
  ) {
    invalid("invalid_rotation", "Binding rotation cannot substitute owner, wallet, or network.");
  }
  if (next.wallet_continuity_sequence <= previous.wallet_continuity_sequence) {
    invalid("invalid_rotation", "Binding rotation must advance the wallet continuity sequence.");
  }
  const identityChanged =
    next.identity_authority.key_id !== previous.identity_authority.key_id
    || next.identity_authority.public_key !== previous.identity_authority.public_key;
  const walletChanged =
    next.zerone_signer.key_id !== previous.zerone_signer.key_id
    || next.zerone_account_id !== previous.zerone_account_id;
  if (identityChanged === walletChanged) {
    invalid(
      "invalid_rotation",
      identityChanged
        ? "Changing identity and wallet keys in one revision is ambiguous; rotate one axis at a time."
        : "A binding revision must rotate exactly one proof axis.",
    );
  }
  if (next.wallet_descriptor_id === previous.wallet_descriptor_id) {
    invalid("invalid_rotation", "A key rotation must reference a new authority-signed WalletDescriptor.");
  }
}
