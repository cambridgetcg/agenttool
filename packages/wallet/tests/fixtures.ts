import * as ed25519 from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";

import {
  RECORD_SCHEMAS,
  base64UrlEncode,
  keyIdForPublicKey,
  sealSimulationReceipt,
  sealTransactionIntent,
  sealWalletCapability,
  sealWalletDescriptor,
  sha256BytesId,
  type Ed25519PublicKey,
  type RecordSigner,
  type SimulationReceiptCore,
  type TransactionIntentCore,
  type Verified,
  type WalletCapabilityCore,
  type WalletDescriptor,
  type WalletDescriptorCore,
} from "../src/index.js";

ed25519.etc.sha512Sync = (...messages: Uint8Array[]) => {
  const hash = sha512.create();
  for (const message of messages) hash.update(message);
  return hash.digest();
};

export const SOURCE = "eip155:84532:0x1111111111111111111111111111111111111111";
export const TARGET = "eip155:84532:0x2222222222222222222222222222222222222222";
export const NATIVE_ASSET = "eip155:84532/slip44:60";
export const POLICY_HASH = `sha256:${"a".repeat(64)}` as const;
export const EMPTY_PAYLOAD_HASH = sha256BytesId(new Uint8Array());

export function testSigner(seedByte: number): {
  signer: RecordSigner;
  key: Ed25519PublicKey;
  privateKey: Uint8Array;
} {
  const privateKey = new Uint8Array(32).fill(seedByte);
  const publicBytes = ed25519.getPublicKey(privateKey);
  const publicKey = base64UrlEncode(publicBytes);
  const key: Ed25519PublicKey = {
    algorithm: "Ed25519",
    key_id: keyIdForPublicKey(publicKey),
    public_key: publicKey,
  };
  return {
    privateKey,
    key,
    signer: {
      public_key: publicKey,
      sign_digest: (digest) => base64UrlEncode(ed25519.sign(digest, privateKey)),
    },
  };
}

export const owner = testSigner(1);
export const delegate = testSigner(2);
export const simulator = testSigner(3);
export const receiptAuthority = testSigner(4);
export const replacement = testSigner(5);

export function descriptorCore(
  overrides: Partial<WalletDescriptorCore> = {},
): WalletDescriptorCore {
  return {
    schema: RECORD_SCHEMAS.descriptor,
    wallet_id: "11111111-1111-4111-8111-111111111111",
    owner_identity_id: "did:at:fixture-owner",
    authority: owner.key,
    custody_mode: "self_custodied",
    accounts: [{ account_id: SOURCE, account_kind: "smart_account" }],
    recovery_mode: "guardian",
    created_at: "2026-07-21T10:00:00.000Z",
    ...overrides,
  };
}

export function capabilityCore(
  descriptor: Verified<WalletDescriptor>,
  overrides: Partial<WalletCapabilityCore> = {},
): WalletCapabilityCore {
  return {
    schema: RECORD_SCHEMAS.capability,
    grant_id: "22222222-2222-4222-8222-222222222222",
    wallet_id: descriptor.wallet_id,
    descriptor_id: descriptor.record_id,
    issuer: owner.key,
    delegate: delegate.key,
    accounts: [SOURCE],
    call_rules: [{
      target_account: TARGET,
      actions: ["transfer"],
      methods: [],
      requires_approval: false,
    }],
    spend_limits: [{
      asset_id: NATIVE_ASSET,
      max_per_intent: "10",
      max_total: "25",
    }],
    fee_limits: [{ asset_id: NATIVE_ASSET, max_per_intent: "2" }],
    max_intents: 3,
    approval_threshold: 0,
    issued_at: "2026-07-21T10:00:00.000Z",
    not_before: "2026-07-21T10:00:00.000Z",
    expires_at: "2026-07-21T11:00:00.000Z",
    revocation_nonce: 0,
    policy_hash: POLICY_HASH,
    purpose: "Bounded Base Sepolia fixture transfer",
    ...overrides,
  };
}

export function intentCore(options: {
  descriptor: Verified<WalletDescriptor>;
  capability: Awaited<ReturnType<typeof sealWalletCapability>>;
  overrides?: Partial<TransactionIntentCore>;
}): TransactionIntentCore {
  return {
    schema: RECORD_SCHEMAS.intent,
    intent_id: "33333333-3333-4333-8333-333333333333",
    wallet_id: options.descriptor.wallet_id,
    descriptor_id: options.descriptor.record_id,
    grant_id: options.capability.grant_id,
    capability_record_id: options.capability.record_id,
    delegate: delegate.key,
    chain_id: "eip155:84532",
    source_account: SOURCE,
    calls: [{
      action: "transfer",
      target_account: TARGET,
      method: null,
      payload_b64u: "",
      payload_hash: EMPTY_PAYLOAD_HASH,
      native_value: { asset_id: NATIVE_ASSET, amount_atomic: "10" },
    }],
    declared_spends: [{ asset_id: NATIVE_ASSET, amount_atomic: "10" }],
    max_fee: { asset_id: NATIVE_ASSET, amount_atomic: "2" },
    issued_at: "2026-07-21T10:01:00.000Z",
    expires_at: "2026-07-21T10:06:00.000Z",
    nonce: "fixture-intent-1",
    ...options.overrides,
  };
}

export function simulationCore(options: {
  intent: Awaited<ReturnType<typeof sealTransactionIntent>>;
  overrides?: Partial<SimulationReceiptCore>;
}): SimulationReceiptCore {
  return {
    schema: RECORD_SCHEMAS.simulation,
    simulation_id: "44444444-4444-4444-8444-444444444444",
    intent_id: options.intent.intent_id,
    intent_record_id: options.intent.record_id,
    chain_id: options.intent.chain_id,
    source_account: options.intent.source_account,
    adapter: simulator.key,
    block_ref: "base-sepolia:123456",
    block_hash: `sha256:${"b".repeat(64)}`,
    success: true,
    effects: [{
      action: "transfer",
      target_account: TARGET,
      method: null,
      asset_id: NATIVE_ASSET,
      amount_atomic: "10",
    }],
    estimated_fee: { asset_id: NATIVE_ASSET, amount_atomic: "1" },
    simulated_at: "2026-07-21T10:01:30.000Z",
    valid_until: "2026-07-21T10:03:30.000Z",
    ...options.overrides,
  };
}

export async function signedBundle() {
  const descriptor = await sealWalletDescriptor(descriptorCore(), owner.signer);
  const capability = await sealWalletCapability(capabilityCore(descriptor), owner.signer);
  const intent = await sealTransactionIntent(intentCore({ descriptor, capability }), delegate.signer);
  const simulation = await sealSimulationReceipt(simulationCore({ intent }), simulator.signer);
  return { descriptor, capability, intent, simulation };
}
