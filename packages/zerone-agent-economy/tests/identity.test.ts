import { describe, expect, test } from "bun:test";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import * as ed25519 from "@noble/ed25519";
import { base64UrlDecode, base64UrlEncode } from "@agenttool/wallet";
import { getZeroneProfile, zeroneAccountId, zeroneAddressFromSecp256k1PublicKey } from "@agenttool/wallet-zerone";

import {
  HASH_DOMAINS,
  assertVerifiedWalletIdentityBindingProof,
  assertWalletIdentityBindingSuccessor,
  createWalletIdentityBinding,
  createWalletIdentityBindingProofEnvelope,
  createWalletIdentityBindingSigningRequest,
  domainSeparatedId,
  validateWalletIdentityBinding,
  validateWalletIdentityBindingProofEnvelope,
  verifyWalletIdentityBindingProofEnvelope,
  type WalletIdentityBindingProofCore,
  type WalletIdentityBindingProofEnvelope,
  type WalletIdentityBinding,
} from "../src/index.js";
import {
  buildIdentityProofFixture,
  buildFixture,
  ed25519Authority,
  ed25519PrivateKey,
  HASHES,
  proofEd25519Authority,
  SECP_PRIVATE_KEY,
  SECP_PUBLIC_KEY,
  SECOND_SECP_PUBLIC_KEY,
} from "./fixtures.js";

function withProofId(
  core: WalletIdentityBindingProofCore,
): WalletIdentityBindingProofEnvelope {
  return {
    ...core,
    proof_id: domainSeparatedId(HASH_DOMAINS.wallet_binding_proof, core),
  };
}

function proofCore(
  proof: WalletIdentityBindingProofEnvelope,
): WalletIdentityBindingProofCore {
  const { proof_id: _proofId, ...core } = proof;
  return core;
}

function highSSignature(signatureB64u: string): string {
  const signature = base64UrlDecode(signatureB64u);
  let lowS = 0n;
  for (const byte of signature.subarray(32)) lowS = (lowS << 8n) | BigInt(byte);
  let highS = secp256k1.Point.Fn.ORDER - lowS;
  const output = Uint8Array.from(signature);
  for (let index = 63; index >= 32; index -= 1) {
    output[index] = Number(highS & 0xffn);
    highS >>= 8n;
  }
  return base64UrlEncode(output);
}

function rebindProof(
  proof: WalletIdentityBindingProofEnvelope,
  binding: WalletIdentityBinding,
): WalletIdentityBindingProofEnvelope {
  const base = proofCore(proof);
  return withProofId({
    ...base,
    binding,
    shared_signing_digest: binding.binding_id,
    identity_proof: {
      ...base.identity_proof,
      key_id: binding.identity_authority.key_id,
    },
    wallet_proof: {
      ...base.wallet_proof,
      key_id: binding.zerone_signer.key_id,
    },
  });
}

describe("wallet identity binding", () => {
  test("uses one canonical digest for both external proof roles", () => {
    const { binding, bindingProof } = buildIdentityProofFixture();
    const request = createWalletIdentityBindingSigningRequest(binding);
    expect(request.shared_signing_digest).toBe(binding.binding_id);
    expect(base64UrlDecode(request.shared_signing_digest_b64u)).toHaveLength(32);
    expect(request.signature_input).toBe("shared_signing_digest_raw_32_bytes");
    expect(request.required_proofs.map((proof) => proof.role)).toEqual([
      "identity_root_authorization",
      "wallet_key_control",
    ]);
    expect(request.signer_injection).toBe("external");
    expect(request.effects_performed).toBeFalse();
    expect(binding.proof_status).toBe("unsigned_unverified");
    expect(bindingProof.shared_signing_digest).toBe(binding.binding_id);
    expect(bindingProof.signature_input).toBe("shared_signing_digest_raw_32_bytes");
    expect(bindingProof.effects_performed).toBeFalse();
    expect(() => assertVerifiedWalletIdentityBindingProof(bindingProof)).not.toThrow();
  });

  test("verifies a portable closed dual-proof envelope after reload", () => {
    const { bindingProof } = buildIdentityProofFixture();
    const reloaded = structuredClone(bindingProof);
    expect(() => assertVerifiedWalletIdentityBindingProof(reloaded)).toThrow();
    const verified = verifyWalletIdentityBindingProofEnvelope(reloaded);
    expect(verified).toEqual(bindingProof);
    expect(() => assertVerifiedWalletIdentityBindingProof(verified)).not.toThrow();
    expect(() => validateWalletIdentityBindingProofEnvelope({
      ...reloaded,
      custody_ready: true,
    })).toThrow();
    expect(() => validateWalletIdentityBindingProofEnvelope({
      ...reloaded,
      proof_id: HASHES.parent,
    })).toThrow(/proof_id/i);
  });

  test("rejects missing, swapped, malformed, and wrong-digest signatures", () => {
    const { binding, bindingProof, bindingSigningRequest } = buildIdentityProofFixture();
    const base = proofCore(bindingProof);
    const { identity_proof: _missingIdentityProof, ...missingIdentityCore } = base;
    expect(() => verifyWalletIdentityBindingProofEnvelope({
      ...missingIdentityCore,
      proof_id: domainSeparatedId(
        HASH_DOMAINS.wallet_binding_proof,
        missingIdentityCore,
      ),
    })).toThrow(/missing property/i);

    const swappedIdentity = withProofId({
      ...base,
      identity_proof: {
        ...base.identity_proof,
        signature_b64u: base.wallet_proof.signature_b64u,
      },
    });
    expect(() => verifyWalletIdentityBindingProofEnvelope(swappedIdentity)).toThrow(/Ed25519/i);

    const swappedWallet = withProofId({
      ...base,
      wallet_proof: {
        ...base.wallet_proof,
        signature_b64u: base.identity_proof.signature_b64u,
      },
    });
    expect(() => verifyWalletIdentityBindingProofEnvelope(swappedWallet)).toThrow(/secp256k1/i);

    expect(() => createWalletIdentityBindingProofEnvelope({
      binding,
      identity_signature_b64u: base.identity_proof.signature_b64u.slice(1),
      wallet_signature_b64u: base.wallet_proof.signature_b64u,
    })).toThrow(/64 bytes/i);

    const digest = base64UrlDecode(bindingSigningRequest.shared_signing_digest_b64u);
    const doubleHashedWalletSignature = base64UrlEncode(secp256k1.sign(
      digest,
      SECP_PRIVATE_KEY,
      { prehash: true, lowS: true, format: "compact" },
    ));
    expect(() => createWalletIdentityBindingProofEnvelope({
      binding,
      identity_signature_b64u: base.identity_proof.signature_b64u,
      wallet_signature_b64u: doubleHashedWalletSignature,
    })).toThrow(/shared digest/i);

    const preimage = base64UrlDecode(bindingSigningRequest.signing_bytes_b64u);
    const wrongEd25519Input = base64UrlEncode(
      ed25519.sign(preimage, ed25519PrivateKey()),
    );
    expect(() => createWalletIdentityBindingProofEnvelope({
      binding,
      identity_signature_b64u: wrongEd25519Input,
      wallet_signature_b64u: base.wallet_proof.signature_b64u,
    })).toThrow(/shared digest/i);

    const wrongWalletSignatureBytes = base64UrlDecode(
      base.wallet_proof.signature_b64u,
    );
    wrongWalletSignatureBytes[0] ^= 1;
    expect(() => createWalletIdentityBindingProofEnvelope({
      binding,
      identity_signature_b64u: base.identity_proof.signature_b64u,
      wallet_signature_b64u: base64UrlEncode(wrongWalletSignatureBytes),
    })).toThrow(/shared digest/i);
  });

  test("rejects malleable high-S secp256k1 proofs", () => {
    const { bindingProof } = buildIdentityProofFixture();
    const base = proofCore(bindingProof);
    const highS = withProofId({
      ...base,
      wallet_proof: {
        ...base.wallet_proof,
        signature_b64u: highSSignature(base.wallet_proof.signature_b64u),
      },
    });
    expect(() => verifyWalletIdentityBindingProofEnvelope(highS)).toThrow(/low-S/i);
  });

  test("rejects cross-binding proof reuse across every security coordinate", () => {
    const { binding, bindingProof } = buildIdentityProofFixture();
    const common = {
      network: binding.network,
      owner_identity_id: binding.owner_identity_id,
      wallet_id: binding.wallet_id,
      wallet_descriptor_id: binding.wallet_descriptor_id,
      identity_authority: binding.identity_authority,
      zerone_account_id: binding.zerone_account_id,
      zerone_public_key: SECP_PUBLIC_KEY,
      revision: 1,
      wallet_continuity_sequence: 0,
      previous_binding_id: null,
      issued_at: binding.issued_at,
    } as const;

    const wrongDid = createWalletIdentityBinding({
      ...common,
      owner_identity_id: "did:agenttool:not-sol",
    });
    const wrongDescriptor = createWalletIdentityBinding({
      ...common,
      wallet_descriptor_id: `sha256:${"12".repeat(32)}`,
    });
    const wrongWalletId = createWalletIdentityBinding({
      ...common,
      wallet_id: "wallet-not-sol-001",
    });
    const mainnet = getZeroneProfile("mainnet");
    const wrongNetwork = createWalletIdentityBinding({
      ...common,
      network: "mainnet",
      zerone_account_id: zeroneAccountId(mainnet, binding.zerone_address),
    });
    const wrongIdentityKey = createWalletIdentityBinding({
      ...common,
      identity_authority: proofEd25519Authority(1),
    });
    const profile = getZeroneProfile("testnet");
    const wrongWalletKey = createWalletIdentityBinding({
      ...common,
      zerone_account_id: zeroneAccountId(
        profile,
        zeroneAddressFromSecp256k1PublicKey(SECOND_SECP_PUBLIC_KEY),
      ),
      zerone_public_key: SECOND_SECP_PUBLIC_KEY,
    });
    const wrongContinuity = createWalletIdentityBinding({
      ...common,
      revision: 2,
      wallet_continuity_sequence: 1,
      previous_binding_id: binding.binding_id,
    });
    const wrongIssuedAt = createWalletIdentityBinding({
      ...common,
      issued_at: "2026-08-20T18:00:01.000Z",
    });

    for (const other of [
      wrongDid,
      wrongDescriptor,
      wrongWalletId,
      wrongNetwork,
      wrongIdentityKey,
      wrongWalletKey,
      wrongContinuity,
      wrongIssuedAt,
    ]) {
      expect(() => verifyWalletIdentityBindingProofEnvelope(
        rebindProof(bindingProof, other),
      )).toThrow(/signature/i);
    }
  });

  test("requires both proof roles to re-sign any changed binding", () => {
    const { binding, bindingProof } = buildIdentityProofFixture();
    const substituted = createWalletIdentityBinding({
      network: binding.network,
      owner_identity_id: binding.owner_identity_id,
      wallet_id: "wallet-substituted-001",
      wallet_descriptor_id: binding.wallet_descriptor_id,
      identity_authority: binding.identity_authority,
      zerone_account_id: binding.zerone_account_id,
      zerone_public_key: SECP_PUBLIC_KEY,
      revision: binding.revision,
      wallet_continuity_sequence: binding.wallet_continuity_sequence,
      previous_binding_id: binding.previous_binding_id,
      issued_at: binding.issued_at,
    });
    const digest = base64UrlDecode(
      createWalletIdentityBindingSigningRequest(substituted).shared_signing_digest_b64u,
    );
    const base = proofCore(bindingProof);
    const common = {
      ...base,
      binding: substituted,
      shared_signing_digest: substituted.binding_id,
      identity_proof: {
        ...base.identity_proof,
        key_id: substituted.identity_authority.key_id,
      },
      wallet_proof: {
        ...base.wallet_proof,
        key_id: substituted.zerone_signer.key_id,
      },
    } as const;

    const identityOnly = withProofId({
      ...common,
      identity_proof: {
        ...common.identity_proof,
        signature_b64u: base64UrlEncode(ed25519.sign(digest, ed25519PrivateKey())),
      },
    });
    expect(() => verifyWalletIdentityBindingProofEnvelope(identityOnly)).toThrow(/secp256k1/i);

    const walletOnly = withProofId({
      ...common,
      wallet_proof: {
        ...common.wallet_proof,
        signature_b64u: base64UrlEncode(secp256k1.sign(
          digest,
          SECP_PRIVATE_KEY,
          { prehash: false, lowS: true, format: "compact" },
        )),
      },
    });
    expect(() => verifyWalletIdentityBindingProofEnvelope(walletOnly)).toThrow(/Ed25519/i);
  });

  test("does not turn a valid historical proof into a current-head assertion", () => {
    const { binding, bindingProof } = buildIdentityProofFixture();
    const successor = createWalletIdentityBinding({
      network: binding.network,
      owner_identity_id: binding.owner_identity_id,
      wallet_id: binding.wallet_id,
      wallet_descriptor_id: `sha256:${"10".repeat(32)}`,
      identity_authority: proofEd25519Authority(1),
      zerone_account_id: binding.zerone_account_id,
      zerone_public_key: base64UrlDecode(binding.zerone_signer.public_key_b64u),
      revision: 2,
      wallet_continuity_sequence: 1,
      previous_binding_id: binding.binding_id,
      issued_at: "2026-08-20T19:00:00.000Z",
    });
    expect(() => assertWalletIdentityBindingSuccessor(binding, successor)).not.toThrow();
    expect(() => verifyWalletIdentityBindingProofEnvelope(structuredClone(bindingProof))).not.toThrow();
  });

  test("rejects address, account, and compressed-public-key substitution", () => {
    const { binding } = buildFixture();
    const wrongAddress = {
      ...binding,
      zerone_address: binding.zerone_address.replace(/.$/u, binding.zerone_address.endsWith("q") ? "p" : "q"),
    };
    expect(() => validateWalletIdentityBinding(wrongAddress)).toThrow();

    const profile = getZeroneProfile("testnet");
    const secondAccount = zeroneAccountId(
      profile,
      zeroneAddressFromSecp256k1PublicKey(SECOND_SECP_PUBLIC_KEY),
    );
    expect(() => validateWalletIdentityBinding({
      ...binding,
      zerone_account_id: secondAccount,
    })).toThrow(/zerone_address|account address/i);
    expect(() => createWalletIdentityBinding({
      network: "testnet",
      owner_identity_id: binding.owner_identity_id,
      wallet_id: binding.wallet_id,
      wallet_descriptor_id: binding.wallet_descriptor_id,
      identity_authority: binding.identity_authority,
      zerone_account_id: secondAccount,
      zerone_public_key: Uint8Array.from(Buffer.from(
        "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
        "hex",
      )),
      revision: 1,
      wallet_continuity_sequence: 0,
      previous_binding_id: null,
      issued_at: binding.issued_at,
    })).toThrow();
  });

  test("allows one-axis rotation and rejects stale or ambiguous rotation", () => {
    const { binding } = buildFixture();
    const profile = getZeroneProfile("testnet");
    const nextAccount = zeroneAccountId(
      profile,
      zeroneAddressFromSecp256k1PublicKey(SECOND_SECP_PUBLIC_KEY),
    );
    const walletRotation = createWalletIdentityBinding({
      network: "testnet",
      owner_identity_id: binding.owner_identity_id,
      wallet_id: binding.wallet_id,
      wallet_descriptor_id: `sha256:${"10".repeat(32)}`,
      identity_authority: binding.identity_authority,
      zerone_account_id: nextAccount,
      zerone_public_key: SECOND_SECP_PUBLIC_KEY,
      revision: 2,
      wallet_continuity_sequence: 1,
      previous_binding_id: binding.binding_id,
      issued_at: "2026-08-20T19:00:00.000Z",
    });
    expect(() => assertWalletIdentityBindingSuccessor(binding, walletRotation)).not.toThrow();

    const stale = { ...walletRotation, previous_binding_id: HASHES.parent };
    expect(() => assertWalletIdentityBindingSuccessor(binding, stale)).toThrow();

    const ambiguous = createWalletIdentityBinding({
      network: "testnet",
      owner_identity_id: binding.owner_identity_id,
      wallet_id: binding.wallet_id,
      wallet_descriptor_id: `sha256:${"11".repeat(32)}`,
      identity_authority: ed25519Authority(1),
      zerone_account_id: nextAccount,
      zerone_public_key: SECOND_SECP_PUBLIC_KEY,
      revision: 2,
      wallet_continuity_sequence: 1,
      previous_binding_id: binding.binding_id,
      issued_at: "2026-08-20T19:00:00.000Z",
    });
    expect(() => assertWalletIdentityBindingSuccessor(binding, ambiguous)).toThrow();
  });
});
