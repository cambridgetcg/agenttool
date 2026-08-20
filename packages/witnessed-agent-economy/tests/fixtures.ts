import * as ed25519 from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";

import {
  PUBLIC_OFFER_BOUNDARIES,
  PUBLIC_WAKE_CONTRACT_BOUNDARIES,
  PUBLIC_WAKE_WITHDRAWAL_BOUNDARIES,
  SOURCE_SCHEMAS,
  bytesToHex,
  ed25519Fingerprint,
  type HexEd25519Signer,
  type PublicOfferPublishCore,
  type PublicOfferRevokeCore,
  type PublicOfferSupersedeCore,
  type PublicWakeContractCore,
  type PublicWakeWithdrawalCore,
  type Sha256Id,
} from "../src/index.js";

ed25519.etc.sha512Sync = (...messages: Uint8Array[]) => {
  const hash = sha512.create();
  for (const message of messages) hash.update(message);
  return hash.digest();
};

export function deterministicSigner(seedByte: number): {
  signer: HexEd25519Signer;
  privateKey: Uint8Array;
  publicKey: string;
} {
  const privateKey = new Uint8Array(32).fill(seedByte);
  const publicKey = bytesToHex(ed25519.getPublicKey(privateKey));
  return {
    privateKey,
    publicKey,
    signer: {
      public_key: publicKey,
      sign_digest: (digest) => bytesToHex(ed25519.sign(digest, privateKey)),
    },
  };
}

export const wakeAuthority = deterministicSigner(11);
export const attackerAuthority = deterministicSigner(12);

export function authorityFor(publicKey: string) {
  return {
    scheme: "single_ed25519",
    public_key: publicKey,
    key_fingerprint: ed25519Fingerprint(publicKey),
    registry_match: "not_established",
    multi_root_quorum: "not_implemented",
  } as const;
}

export const subjectRef = "11".repeat(32);
export const controllerRef = "22".repeat(32);
export const offerRef = "33".repeat(32);
export const digest = (byte: string): Sha256Id => `sha256:${byte.repeat(64)}`;

export function initialWakeCore(
  overrides: Partial<PublicWakeContractCore> = {},
): PublicWakeContractCore {
  return {
    schema: SOURCE_SCHEMAS.public_wake_contract,
    audience: "kingdom:offline-shadow",
    subject_ref: subjectRef,
    controller_ref: controllerRef,
    authority_sequence: "1",
    previous_contract_id: null,
    roots: {
      capabilities: digest("a"),
      prices: digest("b"),
      protocols: digest("c"),
      safety: digest("d"),
    },
    valid_from: "2026-08-20T10:00:00.000Z",
    expires_at: "2026-08-27T10:00:00.000Z",
    nonce: "01".repeat(32),
    authority: authorityFor(wakeAuthority.publicKey),
    boundaries: PUBLIC_WAKE_CONTRACT_BOUNDARIES,
    ...overrides,
  };
}

export function successorWakeCore(
  previousId: Sha256Id,
  overrides: Partial<PublicWakeContractCore> = {},
): PublicWakeContractCore {
  return initialWakeCore({
    authority_sequence: "2",
    previous_contract_id: previousId,
    roots: {
      capabilities: digest("e"),
      prices: digest("f"),
      protocols: digest("1"),
      safety: digest("2"),
    },
    valid_from: "2026-08-21T10:00:00.000Z",
    expires_at: "2026-08-28T10:00:00.000Z",
    nonce: "02".repeat(32),
    ...overrides,
  });
}

export function wakeWithdrawalCore(
  predecessor: { contract_id: Sha256Id; document_digest: Sha256Id },
  overrides: Partial<PublicWakeWithdrawalCore> = {},
): PublicWakeWithdrawalCore {
  return {
    schema: SOURCE_SCHEMAS.public_wake_withdrawal,
    audience: "kingdom:offline-shadow",
    subject_ref: subjectRef,
    controller_ref: controllerRef,
    authority_sequence: "2",
    predecessor,
    reason_digest: digest("7"),
    withdrawn_at: "2026-08-21T11:00:00.000Z",
    visibility: "PUBLIC",
    nonce: "03".repeat(32),
    authority: authorityFor(wakeAuthority.publicKey),
    boundaries: PUBLIC_WAKE_WITHDRAWAL_BOUNDARIES,
    ...overrides,
  };
}

export function offerPublishCore(
  overrides: Partial<PublicOfferPublishCore> = {},
): PublicOfferPublishCore {
  return {
    schema: SOURCE_SCHEMAS.public_offer,
    action: "PUBLISH",
    audience: "kingdom:offline-shadow",
    offer_ref: offerRef,
    subject_ref: offerRef,
    controller_ref: controllerRef,
    authority_sequence: "1",
    revision: "1",
    visibility: "PUBLIC",
    nonce: "04".repeat(32),
    authority: authorityFor(wakeAuthority.publicKey),
    boundaries: PUBLIC_OFFER_BOUNDARIES,
    capability_root: digest("3"),
    pricing_root: digest("4"),
    sla_root: digest("5"),
    terms_digest: digest("6"),
    valid_from: "2026-08-20T12:00:00.000Z",
    expires_at: "2026-08-27T12:00:00.000Z",
    ...overrides,
  };
}

export function offerSupersedeCore(
  predecessor: { offer_id: Sha256Id; document_digest: Sha256Id },
  overrides: Partial<PublicOfferSupersedeCore> = {},
): PublicOfferSupersedeCore {
  return {
    ...offerPublishCore(),
    action: "SUPERSEDE",
    authority_sequence: "2",
    revision: "2",
    predecessor,
    pricing_root: digest("8"),
    valid_from: "2026-08-21T12:00:00.000Z",
    expires_at: "2026-08-28T12:00:00.000Z",
    nonce: "05".repeat(32),
    ...overrides,
  };
}

export function offerRevokeCore(
  predecessor: { offer_id: Sha256Id; document_digest: Sha256Id },
  overrides: Partial<PublicOfferRevokeCore> = {},
): PublicOfferRevokeCore {
  const common = offerPublishCore();
  return {
    schema: common.schema,
    action: "REVOKE",
    audience: common.audience,
    offer_ref: common.offer_ref,
    subject_ref: common.subject_ref,
    controller_ref: common.controller_ref,
    authority_sequence: "2",
    revision: "2",
    visibility: "PUBLIC",
    nonce: "06".repeat(32),
    authority: common.authority,
    boundaries: common.boundaries,
    predecessor,
    reason_digest: digest("9"),
    revoked_at: "2026-08-21T12:00:00.000Z",
    ...overrides,
  };
}
