import * as ed25519 from "@noble/ed25519";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha512 } from "@noble/hashes/sha2.js";
import {
  RECORD_SCHEMAS,
  assertIntentWithinCapabilityStatic,
  base64UrlDecode,
  base64UrlEncode,
  keyIdForPublicKey,
  sealSimulationReceipt,
  sealTransactionIntent,
  sealWalletCapability,
  sealWalletDescriptor,
  sha256BytesId,
  type AssetAmount,
  type Ed25519PublicKey,
  type IntentCall,
  type RecordSigner,
  type TransactionIntentCore,
  type WalletCapabilityCore,
  type WalletDescriptorCore,
} from "@agenttool/wallet";
import {
  COSMOS_SECP256K1_PUBLIC_KEY_TYPE_URL,
  getZeroneProfile,
  zeroneAccountId,
  zeroneAddressFromSecp256k1PublicKey,
  type ZeroneAccountObservation,
} from "@agenttool/wallet-zerone";
import {
  FORMATS,
  MESSAGE_TYPE_URLS,
  SEMANTIC_BOUNDARY,
  WALLET_METHODS,
  WALLET_ZERONE_SUPPORT,
  decodeCreateBountyOrderValue,
  decodeFulfillBountyValue,
  decodeSubmitComputationalClaimValue,
  describeCanonicalProjection,
  type UnsignedMessageProjection,
  type UnsignedMessageValue,
} from "@agenttool/zerone-agent-economy";

import {
  ECONOMY_ACTIVATION_OBSERVATION_PROTOCOL,
  ZERONE_ECONOMY_CORE_COMMIT,
  ZERONE_ECONOMY_COSMOS_SDK,
  ZERONE_KNOWLEDGE_CONSENSUS_VERSION,
  ZERONE_SPONSORSHIP_CONSENSUS_VERSION,
  createZeroneEconomyDirectSignPlan,
  createZeroneEconomySigningRequest,
  createZeroneEconomySimulationBinding,
  createZeroneEconomySimulationEvidence,
  createZeroneEconomySimulationReceiptCore,
  getZeroneEconomyModuleAccounts,
  type ZeroneEconomyActivationObservation,
} from "../src/index.js";

ed25519.etc.sha512Sync = (...messages: Uint8Array[]) => {
  const hash = sha512.create();
  for (const message of messages) hash.update(message);
  return hash.digest();
};

export interface EconomyDirectSignVector {
  readonly body_bytes_b64u: string;
  readonly auth_info_bytes_b64u: string;
  readonly sign_doc_bytes_b64u: string;
  readonly simulation_tx_bytes_b64u: string;
  readonly signature_b64u: string;
  readonly signed_tx_bytes_b64u: string;
  readonly tx_hash: string;
}

export interface EconomyGoVector {
  readonly schema: string;
  readonly provenance: {
    readonly generator: string;
    readonly zerone_core_commit: string;
    readonly cosmos_sdk: string;
    readonly gas_source: string;
  };
  readonly fixture_boundary: {
    readonly bundle_purpose: "byte_order_and_parity_only";
    readonly bundle_same_transaction_lifecycle_viable: false;
    readonly ordinary_execution_shape: "one_lifecycle_message_per_plan";
    readonly multi_message_requirement:
      "independently_valid_combination_and_successful_exact_simulation";
  };
  readonly profile: {
    readonly chain_reference: string;
    readonly account_number: string;
    readonly sequence: string;
    readonly gas_limit: string;
    readonly fee_amount_uzrn: string;
    readonly source_address: string;
    readonly public_key_b64u: string;
    readonly sponsorship_module_address: string;
    readonly knowledge_module_address: string;
  };
  readonly gas: Record<string, string>;
  readonly messages: Readonly<Record<
    "create_bounty" | "submit_claim" | "fulfill_bounty",
    {
      readonly type_url: UnsignedMessageProjection["type_url"];
      readonly value_b64u: string;
      readonly value_sha256_id: `sha256:${string}`;
      readonly any_b64u: string;
    }
  >>;
  readonly direct_sign: EconomyDirectSignVector;
  readonly single_message_plans: Readonly<Record<
    "create_bounty" | "submit_claim" | "fulfill_bounty",
    {
      readonly required_gas: string;
      readonly reserved_spend_uzrn: string;
      readonly direct_sign: EconomyDirectSignVector;
    }
  >>;
  readonly verified: Record<string, boolean>;
}

export const vector = await Bun.file(new URL(
  "../vectors/wallet-zerone-economy-v0.1-vectors.json",
  import.meta.url,
)).json() as EconomyGoVector;

function walletSigner(seed: number): {
  readonly key: Ed25519PublicKey;
  readonly signer: RecordSigner;
} {
  const privateKey = new Uint8Array(32).fill(seed);
  const publicKey = ed25519.getPublicKey(privateKey);
  const publicKeyB64u = base64UrlEncode(publicKey);
  return Object.freeze({
    key: Object.freeze({
      algorithm: "Ed25519" as const,
      key_id: keyIdForPublicKey(publicKeyB64u),
      public_key: publicKeyB64u,
    }),
    signer: Object.freeze({
      public_key: publicKeyB64u,
      sign_digest: (digest: Uint8Array) => base64UrlEncode(
        ed25519.sign(digest, privateKey),
      ),
    }),
  });
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
export const profile = getZeroneProfile("testnet");
export const SOURCE_ADDRESS = zeroneAddressFromSecp256k1PublicKey(SECP_PUBLIC_KEY);
export const SOURCE_ACCOUNT = zeroneAccountId(profile, SOURCE_ADDRESS);
const otherKey = Uint8Array.from(SECP_PRIVATE_KEY);
otherKey[31] = 2;
export const OTHER_ADDRESS = zeroneAddressFromSecp256k1PublicKey(
  secp256k1.getPublicKey(otherKey, true),
);
export const OTHER_ACCOUNT = zeroneAccountId(profile, OTHER_ADDRESS);

function decodeValue(
  typeUrl: UnsignedMessageProjection["type_url"],
  valueBytes: Uint8Array,
): UnsignedMessageValue {
  if (typeUrl === MESSAGE_TYPE_URLS.create_bounty) {
    return decodeCreateBountyOrderValue(valueBytes);
  }
  if (typeUrl === MESSAGE_TYPE_URLS.submit_claim) {
    return decodeSubmitComputationalClaimValue(valueBytes);
  }
  return decodeFulfillBountyValue(valueBytes);
}

const methodFor = Object.freeze({
  [MESSAGE_TYPE_URLS.create_bounty]: WALLET_METHODS.create_bounty,
  [MESSAGE_TYPE_URLS.submit_claim]: WALLET_METHODS.submit_claim,
  [MESSAGE_TYPE_URLS.fulfill_bounty]: WALLET_METHODS.fulfill_bounty,
});

export function projectionFromBytes(input: {
  readonly type_url: UnsignedMessageProjection["type_url"];
  readonly value_bytes: Uint8Array;
  readonly value?: UnsignedMessageValue;
  readonly source_account?: typeof SOURCE_ACCOUNT;
}): UnsignedMessageProjection {
  const value = input.value ?? decodeValue(input.type_url, input.value_bytes);
  const described = describeCanonicalProjection({
    type_url: input.type_url,
    value,
  });
  return Object.freeze({
    format: FORMATS.unsigned_message,
    network: "testnet" as const,
    chain_id: profile.chain_id,
    source_account: input.source_account ?? SOURCE_ACCOUNT,
    type_url: input.type_url,
    wallet_method: methodFor[input.type_url],
    value,
    ...described,
    protobuf_value_b64u: base64UrlEncode(input.value_bytes),
    protobuf_value_hash: sha256BytesId(input.value_bytes),
    compatibility: WALLET_ZERONE_SUPPORT,
    semantic_boundary: SEMANTIC_BOUNDARY,
  }) as UnsignedMessageProjection;
}

export function defaultProjections(): readonly UnsignedMessageProjection[] {
  return Object.freeze([
    projectionFromBytes({
      type_url: vector.messages.create_bounty.type_url,
      value_bytes: base64UrlDecode(vector.messages.create_bounty.value_b64u),
    }),
    projectionFromBytes({
      type_url: vector.messages.submit_claim.type_url,
      value_bytes: base64UrlDecode(vector.messages.submit_claim.value_b64u),
    }),
    projectionFromBytes({
      type_url: vector.messages.fulfill_bounty.type_url,
      value_bytes: base64UrlDecode(vector.messages.fulfill_bounty.value_b64u),
    }),
  ]);
}

function defaultCalls(
  projections: readonly UnsignedMessageProjection[],
): readonly IntentCall[] {
  const modules = getZeroneEconomyModuleAccounts("testnet");
  return Object.freeze(projections.map((projection): IntentCall => {
    const create = projection.type_url === MESSAGE_TYPE_URLS.create_bounty
      ? decodeCreateBountyOrderValue(base64UrlDecode(projection.protobuf_value_b64u))
      : null;
    const claim = projection.type_url === MESSAGE_TYPE_URLS.submit_claim
      ? decodeSubmitComputationalClaimValue(base64UrlDecode(projection.protobuf_value_b64u))
      : null;
    const spend = create === null
      ? claim?.stake ?? null
      : (BigInt(create.price_per_artifact) * BigInt(create.target_count)).toString();
    const targetAccount = projection.type_url === MESSAGE_TYPE_URLS.submit_claim
      ? modules.knowledge
      : modules.sponsorship;
    return Object.freeze({
      action: "call",
      target_account: targetAccount,
      method: projection.wallet_method,
      payload_b64u: projection.protobuf_value_b64u,
      payload_hash: projection.protobuf_value_hash,
      native_value: spend === null
        ? null
        : Object.freeze({
            asset_id: profile.native_asset_id,
            amount_atomic: spend,
          }),
    });
  }));
}

export async function walletBundle(options: {
  readonly projections?: readonly UnsignedMessageProjection[];
  readonly calls?: readonly IntentCall[];
  readonly declared_spends?: readonly AssetAmount[];
  readonly chain_id?: string;
  readonly source_account?: string;
} = {}) {
  const projections = options.projections ?? defaultProjections();
  const calls = options.calls ?? defaultCalls(projections);
  const descriptorCore: WalletDescriptorCore = {
    schema: RECORD_SCHEMAS.descriptor,
    wallet_id: "33333333-3333-4333-8333-333333333333",
    owner_identity_id: "did:at:zerone-economy-owner",
    authority: owner.key,
    custody_mode: "delegated_signer",
    accounts: [{ account_id: SOURCE_ACCOUNT, account_kind: "eoa" }],
    recovery_mode: "owner_rotation",
    created_at: "2026-08-20T18:00:00.000Z",
  };
  const descriptor = await sealWalletDescriptor(descriptorCore, owner.signer);
  const modules = getZeroneEconomyModuleAccounts("testnet");
  const callRules = [
    {
      target_account: modules.sponsorship,
      actions: ["call", "transfer"] as const,
      methods: [WALLET_METHODS.create_bounty, WALLET_METHODS.fulfill_bounty],
      requires_approval: false,
    },
    {
      target_account: modules.knowledge,
      actions: ["call", "transfer"] as const,
      methods: [WALLET_METHODS.submit_claim],
      requires_approval: false,
    },
  ].sort((left, right) => {
    const leftKey = `${left.target_account}\0${left.actions.join(",")}\0${left.methods.join(",")}`;
    const rightKey = `${right.target_account}\0${right.actions.join(",")}\0${right.methods.join(",")}`;
    return leftKey.localeCompare(rightKey);
  });
  const capabilityCore: WalletCapabilityCore = {
    schema: RECORD_SCHEMAS.capability,
    grant_id: "44444444-4444-4444-8444-444444444444",
    wallet_id: descriptor.wallet_id,
    descriptor_id: descriptor.record_id,
    issuer: owner.key,
    delegate: delegate.key,
    accounts: [SOURCE_ACCOUNT],
    call_rules: callRules,
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
    issued_at: "2026-08-20T18:01:00.000Z",
    not_before: "2026-08-20T18:01:00.000Z",
    expires_at: "2026-08-20T19:01:00.000Z",
    revocation_nonce: 0,
    policy_hash: `sha256:${"a".repeat(64)}`,
    purpose: "Bounded Zerone agent economy fixture",
  };
  const capability = await sealWalletCapability(capabilityCore, owner.signer);
  const intentCore: TransactionIntentCore = {
    schema: RECORD_SCHEMAS.intent,
    intent_id: "55555555-5555-4555-8555-555555555555",
    wallet_id: descriptor.wallet_id,
    descriptor_id: descriptor.record_id,
    grant_id: capability.grant_id,
    capability_record_id: capability.record_id,
    delegate: delegate.key,
    chain_id: options.chain_id ?? profile.chain_id,
    source_account: options.source_account ?? SOURCE_ACCOUNT,
    calls: [...calls],
    declared_spends: [...(options.declared_spends ?? [{
      asset_id: profile.native_asset_id,
      amount_atomic: "600000",
    }])],
    max_fee: {
      asset_id: profile.native_asset_id,
      amount_atomic: "500000",
    },
    issued_at: "2026-08-20T18:02:00.000Z",
    expires_at: "2026-08-20T18:07:00.000Z",
    nonce: "economy-fixture",
  };
  const intent = await sealTransactionIntent(intentCore, delegate.signer);
  return Object.freeze({ descriptor, capability, intent, projections });
}

export const ACTIVATION_OBSERVATION: ZeroneEconomyActivationObservation = Object.freeze({
  protocol: ECONOMY_ACTIVATION_OBSERVATION_PROTOCOL,
  evidence_scope: "caller_supplied_structural_only",
  currentness_proven: false,
  status: "reported_activated",
  network: "testnet",
  chain_id: profile.chain_id,
  zerone_core_commit: ZERONE_ECONOMY_CORE_COMMIT,
  cosmos_sdk: ZERONE_ECONOMY_COSMOS_SDK,
  sponsorship_consensus_version: ZERONE_SPONSORSHIP_CONSENSUS_VERSION,
  knowledge_consensus_version: ZERONE_KNOWLEDGE_CONSENSUS_VERSION,
  observed_at_height: "700000",
});

export function accountObservation(
  overrides: Partial<ZeroneAccountObservation> = {},
): ZeroneAccountObservation {
  return {
    status: "found",
    account: SOURCE_ACCOUNT,
    account_number: vector.profile.account_number,
    sequence: vector.profile.sequence,
    public_key_type_url: null,
    public_key_b64u: null,
    observed_at_height: "700000",
    ...overrides,
  };
}

export async function planFor(options: {
  readonly bundle?: Awaited<ReturnType<typeof walletBundle>>;
  readonly plan_overrides?: Partial<Parameters<typeof createZeroneEconomyDirectSignPlan>[0]>;
} = {}) {
  const bundle = options.bundle ?? await walletBundle();
  const plan = createZeroneEconomyDirectSignPlan({
    intent: bundle.intent,
    projections: bundle.projections,
    network: "testnet",
    signer_public_key: SECP_PUBLIC_KEY,
    account_observation: accountObservation(),
    activation_observation: ACTIVATION_OBSERVATION,
    fee_amount_uzrn: vector.profile.fee_amount_uzrn,
    gas_limit: vector.profile.gas_limit,
    ...options.plan_overrides,
  });
  return Object.freeze({ bundle, plan });
}

export async function authorizedPlan(options: {
  readonly bundle?: Awaited<ReturnType<typeof walletBundle>>;
  readonly plan_overrides?: Partial<Parameters<typeof createZeroneEconomyDirectSignPlan>[0]>;
} = {}) {
  const { bundle, plan } = await planFor(options);
  const simulationResult = Object.freeze({
    status: "succeeded" as const,
    simulation_tx_bytes_hash: plan.simulation_tx_bytes_hash,
    code: 0,
    codespace: "",
    gas_wanted: plan.gas_limit,
    gas_used: plan.required_gas_limit,
    observed_at_height: "700001",
  });
  const simulationCore = createZeroneEconomySimulationReceiptCore({
    plan,
    simulation: simulationResult,
    intent: bundle.intent,
    adapter: simulationAdapter.key,
    simulation_id: "66666666-6666-4666-8666-666666666666",
    simulated_at: "2026-08-20T18:02:30.000Z",
    valid_until: "2026-08-20T18:05:30.000Z",
  });
  const simulation = await sealSimulationReceipt(
    simulationCore,
    simulationAdapter.signer,
  );
  const evidence = await createZeroneEconomySimulationEvidence({
    plan,
    simulation,
    simulation_result: simulationResult,
    signer: simulationAdapter.signer,
  });
  const binding = createZeroneEconomySimulationBinding({
    plan,
    simulation,
    evidence,
  });
  const authorization = assertIntentWithinCapabilityStatic({
    descriptor: bundle.descriptor,
    capability: bundle.capability,
    intent: bundle.intent,
    simulation,
    context: {
      now: "2026-08-20T18:03:00.000Z",
      usage: {
        revocation_nonce: 0,
        intent_count: 0,
        spent: [],
        host_verified_approval_ids: [],
      },
    },
  });
  const request = createZeroneEconomySigningRequest({
    plan,
    simulation,
    binding,
    authorization,
    request_id: "77777777-7777-4777-8777-777777777777",
    requested_at: "2026-08-20T18:03:00.000Z",
  });
  return Object.freeze({
    bundle,
    plan,
    simulationResult,
    simulation,
    evidence,
    binding,
    authorization,
    request,
  });
}

export const MATCHING_ACCOUNT_KEY = Object.freeze({
  public_key_type_url: COSMOS_SECP256K1_PUBLIC_KEY_TYPE_URL,
  public_key_b64u: base64UrlEncode(SECP_PUBLIC_KEY),
});
