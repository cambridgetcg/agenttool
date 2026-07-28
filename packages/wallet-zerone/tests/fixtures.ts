import * as ed25519 from "@noble/ed25519";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha512 } from "@noble/hashes/sha2.js";
import {
  RECORD_SCHEMAS,
  assertIntentWithinCapabilityStatic,
  base64UrlEncode,
  keyIdForPublicKey,
  sealSimulationReceipt,
  sealTransactionIntent,
  sealWalletCapability,
  sealWalletDescriptor,
  sha256BytesId,
  type Ed25519PublicKey,
  type RecordSigner,
  type TransactionIntentCore,
  type WalletCapabilityCore,
  type WalletDescriptorCore,
} from "@agenttool/wallet";

import {
  AGENTTOOL_ADAPTER_ID,
  AGENTTOOL_WORK_CLASS_ID,
  COSMOS_SECP256K1_PUBLIC_KEY_TYPE_URL,
  ZERONE_CHAIN_PROFILES,
  ZERONE_WALLET_METHOD_SUBMIT_EXTERNAL_ATTESTATION,
  createAgentToolInvocationWitnessLink,
  createZeroneDirectSignPlan,
  createZeroneSignedPayload,
  createZeroneSigningRequest,
  createZeroneSimulationBinding,
  createZeroneSimulationReceiptCore,
  encodeZeroneMsgSubmitExternalAttestation,
  verifyZeroneSignedPayload,
  zeroneAccountId,
  zeroneAddressFromSecp256k1PublicKey,
  type AgentToolInvocationProjection,
  type ZeroneAccountObservation,
  type ZeroneAdapterSnapshot,
  type ZeroneDirectSignPlan,
  type VerifiedZeroneTransaction,
} from "../src/index.js";

ed25519.etc.sha512Sync = (...messages: Uint8Array[]) => {
  const hash = sha512.create();
  for (const message of messages) hash.update(message);
  return hash.digest();
};

function walletSigner(seed: number): {
  readonly key: Ed25519PublicKey;
  readonly signer: RecordSigner;
} {
  const privateKey = new Uint8Array(32).fill(seed);
  const publicKey = ed25519.getPublicKey(privateKey);
  const publicKeyB64u = base64UrlEncode(publicKey);
  return {
    key: {
      algorithm: "Ed25519",
      key_id: keyIdForPublicKey(publicKeyB64u),
      public_key: publicKeyB64u,
    },
    signer: {
      public_key: publicKeyB64u,
      sign_digest: (digest) =>
        base64UrlEncode(ed25519.sign(digest, privateKey)),
    },
  };
}

export const owner = walletSigner(1);
export const delegate = walletSigner(2);
export const simulationAdapter = walletSigner(3);
export const SECP_PRIVATE_KEY = Uint8Array.from([
  0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 1,
]);
export const SECP_PUBLIC_KEY = secp256k1.getPublicKey(SECP_PRIVATE_KEY, true);
export const profile = ZERONE_CHAIN_PROFILES.testnet;
export const SOURCE_ADDRESS =
  zeroneAddressFromSecp256k1PublicKey(SECP_PUBLIC_KEY);
export const SOURCE_ACCOUNT = zeroneAccountId(profile, SOURCE_ADDRESS);
const recipientPrivateKey = Uint8Array.from(SECP_PRIVATE_KEY);
recipientPrivateKey[31] = 2;
export const RECIPIENT_ADDRESS =
  zeroneAddressFromSecp256k1PublicKey(
    secp256k1.getPublicKey(recipientPrivateKey, true),
  );
export const RECIPIENT_ACCOUNT = zeroneAccountId(profile, RECIPIENT_ADDRESS);

export const INVOCATION: AgentToolInvocationProjection = {
  amount: 53,
  buyer_did: "did:at:buyer-fixture",
  completed_at: "2026-07-05T21:58:00Z",
  completion_sig: "Y29tcGxldGlvbi1zaWduYXR1cmU=",
  created_at: "2026-07-05T21:00:00Z",
  currency: "USD",
  id: "11111111-1111-4111-8111-111111111111",
  listing_id: "22222222-2222-4222-8222-222222222222",
  settled_at: "2026-07-05T22:00:00Z",
  status: "released",
};

export const ADAPTER_SNAPSHOT: ZeroneAdapterSnapshot = {
  chain_id: profile.chain_id,
  adapter_id: AGENTTOOL_ADAPTER_ID,
  version: "1.1.0",
  status: "active",
  min_attestation_bond_uzrn: "1000000",
  allowed_work_class_ids: [AGENTTOOL_WORK_CLASS_ID],
  required_qualification_domain: null,
  observed_at_height: "700000",
};

export function accountObservation(
  overrides: Partial<ZeroneAccountObservation> = {},
): ZeroneAccountObservation {
  return {
    status: "found",
    account: SOURCE_ACCOUNT,
    account_number: "7",
    sequence: "9",
    public_key_type_url: null,
    public_key_b64u: null,
    observed_at_height: "700000",
    ...overrides,
  };
}

export function attestationPayload(): Uint8Array {
  const link = createAgentToolInvocationWitnessLink({
    invocation: INVOCATION,
    source_id: INVOCATION.id,
    source_url:
      `https://api.agenttool.dev/v1/invocations/${INVOCATION.id}`,
    fetched_at_block: "699999",
  });
  return encodeZeroneMsgSubmitExternalAttestation({
    submitter: SOURCE_ADDRESS,
    adapter_id: AGENTTOOL_ADAPTER_ID,
    work_class_id: AGENTTOOL_WORK_CLASS_ID,
    link,
    bond_uzrn: "1000000",
  });
}

export async function walletIntent(
  kind: "send" | "attestation",
) {
  const descriptorCore: WalletDescriptorCore = {
    schema: RECORD_SCHEMAS.descriptor,
    wallet_id: "33333333-3333-4333-8333-333333333333",
    owner_identity_id: "did:at:zerone-owner",
    authority: owner.key,
    custody_mode: "delegated_signer",
    accounts: [{
      account_id: SOURCE_ACCOUNT,
      account_kind: "eoa",
    }],
    recovery_mode: "owner_rotation",
    created_at: "2026-07-05T20:00:00.000Z",
  };
  const descriptor = await sealWalletDescriptor(
    descriptorCore,
    owner.signer,
  );
  const target =
    kind === "send"
      ? RECIPIENT_ACCOUNT
      : profile.substrate_bridge_account;
  const capabilityCore: WalletCapabilityCore = {
    schema: RECORD_SCHEMAS.capability,
    grant_id: "44444444-4444-4444-8444-444444444444",
    wallet_id: descriptor.wallet_id,
    descriptor_id: descriptor.record_id,
    issuer: owner.key,
    delegate: delegate.key,
    accounts: [SOURCE_ACCOUNT],
    call_rules: [{
      target_account: target,
      actions:
        kind === "send"
          ? ["transfer"]
          : ["call", "transfer"],
      methods:
        kind === "send"
          ? []
          : [ZERONE_WALLET_METHOD_SUBMIT_EXTERNAL_ATTESTATION],
      requires_approval: false,
    }],
    spend_limits: [{
      asset_id: profile.native_asset_id,
      max_per_intent: "2000000",
      max_total: "4000000",
    }],
    fee_limits: [{
      asset_id: profile.native_asset_id,
      max_per_intent: "500000",
    }],
    max_intents: 4,
    approval_threshold: 0,
    issued_at: "2026-07-05T20:30:00.000Z",
    not_before: "2026-07-05T20:30:00.000Z",
    expires_at: "2026-07-05T21:30:00.000Z",
    revocation_nonce: 0,
    policy_hash: `sha256:${"a".repeat(64)}`,
    purpose: "Bounded Zerone fixture",
  };
  const capability = await sealWalletCapability(
    capabilityCore,
    owner.signer,
  );
  const amount = kind === "send" ? "123456" : "1000000";
  const payload =
    kind === "send" ? new Uint8Array() : attestationPayload();
  const intentCore: TransactionIntentCore = {
    schema: RECORD_SCHEMAS.intent,
    intent_id: "55555555-5555-4555-8555-555555555555",
    wallet_id: descriptor.wallet_id,
    descriptor_id: descriptor.record_id,
    grant_id: capability.grant_id,
    capability_record_id: capability.record_id,
    delegate: delegate.key,
    chain_id: profile.chain_id,
    source_account: SOURCE_ACCOUNT,
    calls: [{
      action: kind === "send" ? "transfer" : "call",
      target_account: target,
      method:
        kind === "send"
          ? null
          : ZERONE_WALLET_METHOD_SUBMIT_EXTERNAL_ATTESTATION,
      payload_b64u: base64UrlEncode(payload),
      payload_hash: sha256BytesId(payload),
      native_value: {
        asset_id: profile.native_asset_id,
        amount_atomic: amount,
      },
    }],
    declared_spends: [{
      asset_id: profile.native_asset_id,
      amount_atomic: amount,
    }],
    max_fee: {
      asset_id: profile.native_asset_id,
      amount_atomic: "500000",
    },
    issued_at: "2026-07-05T20:31:00.000Z",
    expires_at: "2026-07-05T20:36:00.000Z",
    nonce: `fixture-${kind}`,
  };
  const intent = await sealTransactionIntent(intentCore, delegate.signer);
  return { descriptor, capability, intent };
}

export async function planFor(
  kind: "send" | "attestation",
  overrides: Partial<Parameters<typeof createZeroneDirectSignPlan>[0]> = {},
): Promise<{
  readonly bundle: Awaited<ReturnType<typeof walletIntent>>;
  readonly plan: Readonly<ZeroneDirectSignPlan>;
}> {
  const bundle = await walletIntent(kind);
  const plan = createZeroneDirectSignPlan({
    intent: bundle.intent,
    network: "testnet",
    signer_public_key: SECP_PUBLIC_KEY,
    account_observation: accountObservation(),
    fee_amount_uzrn: "222222",
    gas_limit: "222222",
    ...(kind === "attestation"
      ? { adapter_snapshot: ADAPTER_SNAPSHOT }
      : {}),
    ...overrides,
  });
  return { bundle, plan };
}

export async function authorizedPlan(
  kind: "send" | "attestation",
) {
  const { bundle, plan } = await planFor(kind);
  const simulationResult = {
    status: "succeeded" as const,
    simulation_tx_bytes_hash: plan.simulation_tx_bytes_hash,
    code: 0,
    codespace: "",
    gas_wanted: "200000",
    gas_used: "150000",
    observed_at_height: "700001",
  };
  const simulationCore = createZeroneSimulationReceiptCore({
    plan,
    simulation: simulationResult,
    intent: bundle.intent,
    adapter: simulationAdapter.key,
    simulation_id: "66666666-6666-4666-8666-666666666666",
    simulated_at: "2026-07-05T20:31:30.000Z",
    valid_until: "2026-07-05T20:34:30.000Z",
  });
  const simulation = await sealSimulationReceipt(
    simulationCore,
    simulationAdapter.signer,
  );
  const binding = createZeroneSimulationBinding({
    plan,
    simulation,
    simulation_result: simulationResult,
  });
  const authorization = assertIntentWithinCapabilityStatic({
    ...bundle,
    simulation,
    context: {
      now: "2026-07-05T20:32:00.000Z",
      usage: {
        revocation_nonce: 0,
        intent_count: 0,
        spent: [],
        host_verified_approval_ids: [],
      },
    },
  });
  const request = createZeroneSigningRequest({
    plan,
    simulation,
    binding,
    authorization,
    request_id: "77777777-7777-4777-8777-777777777777",
  });
  return {
    bundle,
    plan,
    simulation,
    binding,
    authorization,
    request,
  };
}

export async function signedTransaction(
  kind: "send" | "attestation" = "attestation",
): Promise<{
  readonly transaction: Readonly<VerifiedZeroneTransaction>;
  readonly plan: Readonly<ZeroneDirectSignPlan>;
}> {
  const { plan, request } = await authorizedPlan(kind);
  const signature = secp256k1.sign(
    Buffer.from(plan.sign_doc_bytes_b64u, "base64url"),
    SECP_PRIVATE_KEY,
    { prehash: true, lowS: true, format: "compact" },
  );
  const payload = createZeroneSignedPayload({
    plan,
    request,
    signature,
  });
  const transaction = verifyZeroneSignedPayload({
    plan,
    request,
    payload,
  });
  return { transaction, plan };
}

export const MATCHING_ACCOUNT_KEY: Pick<
  ZeroneAccountObservation,
  "public_key_type_url" | "public_key_b64u"
> = {
  public_key_type_url: COSMOS_SECP256K1_PUBLIC_KEY_TYPE_URL,
  public_key_b64u: base64UrlEncode(SECP_PUBLIC_KEY),
};
