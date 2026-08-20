import { describe, expect, test } from "bun:test";
import { getZeroneProfile, zeroneAccountId, zeroneAddressFromSecp256k1PublicKey } from "@agenttool/wallet-zerone";

import {
  assertWalletIdentityBindingSuccessor,
  createWalletIdentityBinding,
  createWalletIdentityBindingSigningRequest,
  validateWalletIdentityBinding,
} from "../src/index.js";
import {
  buildFixture,
  ed25519Authority,
  HASHES,
  SECOND_SECP_PUBLIC_KEY,
} from "./fixtures.js";

describe("wallet identity binding", () => {
  test("uses one canonical digest for both external proof roles", () => {
    const { binding } = buildFixture();
    const request = createWalletIdentityBindingSigningRequest(binding);
    expect(request.shared_signing_digest).toBe(binding.binding_id);
    expect(request.required_proofs.map((proof) => proof.role)).toEqual([
      "identity_root_authorization",
      "wallet_key_control",
    ]);
    expect(request.signer_injection).toBe("external");
    expect(request.effects_performed).toBeFalse();
    expect(binding.proof_status).toBe("unsigned_unverified");
  });

  test("rejects address and compressed-public-key substitution", () => {
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
