import { createHash } from "node:crypto";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import * as ed25519 from "@noble/ed25519";
import {
  base64UrlDecode,
  base64UrlEncode,
  canonicalJson,
  keyIdForPublicKey,
  type Ed25519PublicKey,
  type Sha256Id,
} from "@agenttool/wallet";
import {
  getZeroneProfile,
  zeroneAccountId,
  zeroneAddressFromSecp256k1PublicKey,
} from "@agenttool/wallet-zerone";
import {
  createTreasuryPolicy,
  createWalletIdentityBinding,
  createWalletIdentityBindingProofEnvelope,
  createWalletIdentityBindingSigningRequest,
  type WalletIdentityBinding,
  type VerifiedWalletIdentityBindingProof,
} from "@agenttool/zerone-agent-economy";
import { Database } from "bun:sqlite";

import { eventHash } from "../src/events.js";
import {
  createBindingCurrentnessAssertion,
  GENESIS_EVENT_HASH,
  ZeroneAgentHostStore,
} from "../src/index.js";
import type {
  BindingCurrentnessAssertion,
  ReserveOperationInput,
  ZeroneAccountSnapshot,
} from "../src/index.js";

export const TIME = "2026-08-20T20:00:00.000Z";
export const LATER = "2026-08-20T20:01:00.000Z";

ed25519.etc.sha512Sync = (...messages: Uint8Array[]) => {
  const digest = createHash("sha512");
  for (const message of messages) digest.update(message);
  return Uint8Array.from(digest.digest());
};

export function rewriteEventChain(
  store: ZeroneAgentHostStore,
  operationId: string,
  rewrite: (kind: string, details: Record<string, unknown>) => Record<string, unknown>,
  rewriteAt: (kind: string, at: string) => string = (_kind, at) => at,
): void {
  const database = Reflect.get(store, "db") as Database;
  const rows = database.query(`
    SELECT ledger_sequence, sequence, kind, at, details_json FROM operation_events
    WHERE operation_id = ? ORDER BY sequence
  `).all(operationId) as Array<{
    ledger_sequence: number;
    sequence: number;
    kind: string;
    at: string;
    details_json: string;
  }>;
  database.exec("DROP TRIGGER operation_events_no_update");
  let previous = GENESIS_EVENT_HASH;
  for (const row of rows) {
    const details = rewrite(
      row.kind,
      JSON.parse(row.details_json) as Record<string, unknown>,
    );
    const at = rewriteAt(row.kind, row.at);
    const nextHash = eventHash({
      ledger_sequence: row.ledger_sequence,
      operation_id: operationId,
      sequence: row.sequence,
      kind: row.kind,
      at,
      details,
      previous_event_hash: previous,
    });
    database.query(`
      UPDATE operation_events SET at = ?, details_json = ?, previous_event_hash = ?, event_hash = ?
      WHERE operation_id = ? AND sequence = ?
    `).run(at, canonicalJson(details), previous, nextHash, operationId, row.sequence);
    previous = nextHash;
  }
  database.query("UPDATE operations SET event_head_hash = ? WHERE operation_id = ?")
    .run(previous, operationId);
  database.exec(`
    CREATE TRIGGER operation_events_no_update
    BEFORE UPDATE ON operation_events
    BEGIN
      SELECT RAISE(ABORT, 'operation events are append-only');
    END
  `);
}

export function hash(byte: string): Sha256Id {
  return `sha256:${byte.repeat(64)}` as Sha256Id;
}

export const SECP_PUBLIC_KEY = Uint8Array.from(Buffer.from(
  "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
  "hex",
));

export const SECP_PRIVATE_KEY = Uint8Array.from(
  { length: 32 },
  (_, index) => index === 31 ? 1 : 0,
);

export const ED25519_PRIVATE_KEY = Uint8Array.from(
  { length: 32 },
  (_, index) => index + 1,
);

function authority(): Ed25519PublicKey {
  const publicKey = base64UrlEncode(ed25519.getPublicKey(ED25519_PRIVATE_KEY));
  return Object.freeze({
    algorithm: "Ed25519",
    key_id: keyIdForPublicKey(publicKey),
    public_key: publicKey,
  });
}

export function proofForBinding(
  binding: WalletIdentityBinding,
  secpPrivateKey: Uint8Array = SECP_PRIVATE_KEY,
): VerifiedWalletIdentityBindingProof {
  const request = createWalletIdentityBindingSigningRequest(binding);
  const digest = base64UrlDecode(request.shared_signing_digest_b64u);
  return createWalletIdentityBindingProofEnvelope({
    binding,
    identity_signature_b64u: base64UrlEncode(ed25519.sign(digest, ED25519_PRIVATE_KEY)),
    wallet_signature_b64u: base64UrlEncode(secp256k1.sign(
      digest,
      secpPrivateKey,
      { prehash: false, lowS: true, format: "compact" },
    )),
  });
}

export function currentnessForProof(
  proof: VerifiedWalletIdentityBindingProof,
  overrides: Partial<{
    verifier_id: string;
    verified_at: string;
    valid_until: string;
    wallet_revocation_nonce: number;
  }> = {},
): BindingCurrentnessAssertion {
  return createBindingCurrentnessAssertion({
    binding_id: proof.binding.binding_id,
    proof_id: proof.proof_id,
    verifier_id: overrides.verifier_id ?? "injected-currentness-verifier-v0",
    verified_at: overrides.verified_at ?? "2026-08-20T19:30:00.000Z",
    valid_until: overrides.valid_until ?? "2026-08-21T19:30:00.000Z",
    wallet_revocation_nonce: overrides.wallet_revocation_nonce ?? 0,
  });
}

export function bindingForWallet(walletId: string) {
  const profile = getZeroneProfile("testnet");
  const address = zeroneAddressFromSecp256k1PublicKey(SECP_PUBLIC_KEY);
  return createWalletIdentityBinding({
    network: "testnet",
    owner_identity_id: "did:agenttool:host-test",
    wallet_id: walletId,
    wallet_descriptor_id: hash("1"),
    identity_authority: authority(),
    zerone_account_id: zeroneAccountId(profile, address),
    zerone_public_key: SECP_PUBLIC_KEY,
    revision: 1,
    wallet_continuity_sequence: 0,
    previous_binding_id: null,
    issued_at: "2026-08-20T19:00:00.000Z",
  });
}

export function fixture() {
  const profile = getZeroneProfile("testnet");
  const address = zeroneAddressFromSecp256k1PublicKey(SECP_PUBLIC_KEY);
  const account = zeroneAccountId(profile, address);
  const binding = createWalletIdentityBinding({
    network: "testnet",
    owner_identity_id: "did:agenttool:host-test",
    wallet_id: "wallet-host-test",
    wallet_descriptor_id: hash("1"),
    identity_authority: authority(),
    zerone_account_id: account,
    zerone_public_key: SECP_PUBLIC_KEY,
    revision: 1,
    wallet_continuity_sequence: 0,
    previous_binding_id: null,
    issued_at: "2026-08-20T19:00:00.000Z",
  });
  const proof = proofForBinding(binding);
  const currentness = currentnessForProof(proof);
  const treasury = createTreasuryPolicy({
    wallet_binding: binding,
    network: "testnet",
    wallet_binding_id: binding.binding_id,
    treasury_account: account,
    denom: "uzrn",
    reserve_floor_uzrn: "300000",
    max_single_spend_uzrn: "300000",
    window_blocks: "1000",
    window_caps_uzrn: {
      compute: "400000",
      storage: "100000",
      network_fee: "100000",
      knowledge_bond: "200000",
      sponsorship_escrow: "300000",
      total: "600000",
    },
    allowed_purposes: [
      "compute",
      "knowledge_bond",
      "network_fee",
      "sponsorship_escrow",
      "storage",
    ],
    issued_at: "2026-08-20T19:45:00.000Z",
  });
  const snapshot: ZeroneAccountSnapshot = Object.freeze({
    chain_id: profile.chain_id,
    account,
    account_number: "7",
    sequence: "9",
    balance_uzrn: "1000000",
    observed_at_height: "1500",
    block_hash: "A".repeat(64),
    observed_at: TIME,
  });
  const reserve = (operationId = "operation-1", overrides: Partial<ReserveOperationInput> = {}): ReserveOperationInput => ({
    operation_id: operationId,
    binding_head: {
      wallet_id: binding.wallet_id,
      binding_id: binding.binding_id,
      proof_id: proof.proof_id,
      currentness_id: currentness.currentness_id,
      head_version: 1,
    },
    authorization: {
      trust_boundary: "trusted_injected_wallet_authorization_projection/0.1",
      external_verification_id: operationId === "operation-1" ? hash("a") : hash("b"),
      intent_record_id: operationId === "operation-1" ? hash("3") : hash("4"),
      simulation_record_id: operationId === "operation-1" ? hash("5") : hash("6"),
      plan_reference_id: operationId === "operation-1" ? hash("7") : hash("8"),
    },
    capability: {
      capability_record_id: hash("9"),
      descriptor_id: binding.wallet_descriptor_id,
      policy_hash: treasury.treasury_policy_id,
      revocation_nonce: 0,
      max_intents: 3,
      max_spend_uzrn: "500000",
      max_fee_per_intent_uzrn: "100000",
    },
    treasury_policy: treasury,
    account_snapshot: snapshot,
    signer_key_id: binding.zerone_signer.key_id,
    reservations: [
      { purpose: "compute", amount_uzrn: "100000" },
      { purpose: "network_fee", amount_uzrn: "20000" },
    ],
    created_at: TIME,
    ...overrides,
  });
  return { profile, account, binding, proof, currentness, treasury, snapshot, reserve };
}
