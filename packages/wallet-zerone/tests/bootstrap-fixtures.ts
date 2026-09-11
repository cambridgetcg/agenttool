// Disposable public test identities only; never used by runtime.
import { bech32 } from "@scure/base";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  base64UrlEncode, sealWalletDescriptor, sealWalletCapability, sealTransactionIntent,
  sealSimulationReceipt, sha256BytesId,
  type WalletCapabilityCore, type TransactionIntentCore,
} from "@agenttool/wallet";
import { owner, delegate, simulationAdapter, SECP_PUBLIC_KEY, SOURCE_ADDRESS, RECIPIENT_ADDRESS } from "./fixtures.js";
import {
  createSeedProfile, createSeedPolicy, encodeSeedMsgClaim, createSeedClaimPlan,
  createSeedSimulationReceiptCore, createSeedSimulationBinding, authorizeSeedClaim, createSeedSigningRequest,
  SEED_CLAIM_METHOD,
  type SeedProfileCore, type SeedPolicyCore, type SeedObservation, type SeedSimulationResult,
} from "../src/bootstrap/v1.js";

export const NOW = "2026-09-08T08:00:30.000Z";
export const START = "2026-09-08T08:00:00.000Z";
export const END = "2026-09-08T08:05:00.000Z";
export const KEY = base64UrlEncode(SECP_PUBLIC_KEY);
export const D = (letter = "a"): `sha256:${string}` => `sha256:${letter.repeat(64)}`;
export const PROFILE_CORE: SeedProfileCore = {
  protocol: "agent-wallet-zerone.seed-profile/0.1", chain_reference: "seed-local-1", chain_id: "cosmos:seed-local-1",
  native_asset_id: "cosmos:seed-local-1/denom:uzrn",
  claiming_pot_account: `cosmos:seed-local-1:${bech32.encodeFromBytes("zrn", sha256(new TextEncoder().encode("claiming_pot")).subarray(0, 20))}` as never,
  genesis_hash: D("a"), source_digest: D("b"), zerone_core_commit: "c".repeat(40), cosmos_sdk_version: "v0.53.8",
  runtime_sha256: D("d"), helper_sha256: D("e"), native_denom: "uzrn", bech32_prefix: "zrn", seed_amount_uzrn: "222000",
  claim_type_url: "/zerone.claiming_pot.v1.MsgClaim", claim_gas_floor: "22222", tx_gas_cap: "11111111", min_gas_price_uzrn: "1", confirmation_depth: 1,
};
export const PROFILE = createSeedProfile(PROFILE_CORE);
export const POLICY_CORE: SeedPolicyCore = {
  protocol: "agent-wallet-zerone.seed-policy/0.1", profile_id: PROFILE.profile_id, node_trust_id: D("f"),
  claimant_account: `cosmos:seed-local-1:${SOURCE_ADDRESS}` as never,
  sponsor_account: `cosmos:seed-local-1:${RECIPIENT_ADDRESS}` as never,
  pot_id: `bootstrap-${SOURCE_ADDRESS}`, max_intents: 1, seed_amount_uzrn: "222000",
  max_fee_uzrn: "200000", max_gas: "200000", grant_spend_limit_uzrn: "300000", grant_expires_at: "2026-09-08T08:10:00.000Z",
  setup_fee_budget_uzrn: "50000", not_before: START, expires_at: END, timeout_height: "200", max_observation_age_seconds: 60, max_height_lag: 2,
};
export const POLICY = createSeedPolicy(PROFILE, POLICY_CORE);
export function observation(): Extract<SeedObservation, { status: "observed" }> {
  return {
    protocol: "agent-wallet-zerone.seed-observation/0.1", status: "observed",
    evidence: { trust: "configured_full_node", node_trust_id: POLICY.node_trust_id, profile_id: PROFILE.profile_id, chain_id: PROFILE.chain_id,
      genesis_hash: PROFILE.genesis_hash, anchor: { height: "100", block_hash: D("1"), block_time: "2026-09-08T08:00:20.000Z" },
      latest_height: "100", catching_up: false, observed_at: "2026-09-08T08:00:25.000Z" },
    claimant: { status: "found", account: POLICY.claimant_account, account_number: "7", sequence: "9", public_key: null },
    sponsor_account: POLICY.sponsor_account, sponsor_balance_uzrn: "350000",
    pot: { pot_id: POLICY.pot_id, status: "active", total_amount_uzrn: "222000", claimed_amount_uzrn: "0", start_block: "10", end_block: "11",
      cliff_blocks: "0", period_blocks: "0", min_staking_tier: 0, min_registration_age: "0", whitelist: [SOURCE_ADDRESS] },
    prior_claim: null, min_claim_amount_uzrn: "1000",
    allowance: { status: "found", granter: RECIPIENT_ADDRESS, grantee: SOURCE_ADDRESS, type_url: "/cosmos.feegrant.v1beta1.AllowedMsgAllowance",
      inner_type_url: "/cosmos.feegrant.v1beta1.BasicAllowance", allowed_messages: ["/zerone.claiming_pot.v1.MsgClaim"],
      spend_limit_uzrn: POLICY.grant_spend_limit_uzrn, expires_at: POLICY.grant_expires_at },
    supply: { total_minted_uzrn: "999999999999999", current_supply_uzrn: "1000000", max_supply_uzrn: "222222222000000" },
  };
}
export async function records(capChange: Partial<WalletCapabilityCore> = {}, intentChange: Partial<TransactionIntentCore> = {}) {
  const descriptor = await sealWalletDescriptor({ schema: "agent-wallet/descriptor/0.1", wallet_id: "33333333-3333-4333-8333-333333333333",
    owner_identity_id: "did:at:seed-test", authority: owner.key, custody_mode: "delegated_signer", accounts: [{ account_id: POLICY.claimant_account, account_kind: "eoa" }],
    recovery_mode: "owner_rotation", created_at: START }, owner.signer);
  const capability = await sealWalletCapability({ schema: "agent-wallet/capability/0.1", grant_id: "44444444-4444-4444-8444-444444444444", wallet_id: descriptor.wallet_id,
    descriptor_id: descriptor.record_id, issuer: owner.key, delegate: delegate.key, accounts: [POLICY.claimant_account],
    call_rules: [{ target_account: PROFILE.claiming_pot_account, actions: ["call"], methods: [SEED_CLAIM_METHOD], requires_approval: false }],
    spend_limits: [], fee_limits: [{ asset_id: PROFILE.native_asset_id, max_per_intent: POLICY.max_fee_uzrn }], max_intents: 1, approval_threshold: 0,
    issued_at: START, not_before: START, expires_at: END, revocation_nonce: 0, policy_hash: POLICY.policy_hash, purpose: "Disposable seed fixture", ...capChange }, owner.signer);
  const payload = encodeSeedMsgClaim({ claimant: SOURCE_ADDRESS, pot_id: POLICY.pot_id });
  const intent = await sealTransactionIntent({ schema: "agent-wallet/intent/0.1", intent_id: "55555555-5555-4555-8555-555555555555", wallet_id: descriptor.wallet_id,
    descriptor_id: descriptor.record_id, grant_id: capability.grant_id, capability_record_id: capability.record_id, delegate: delegate.key,
    chain_id: PROFILE.chain_id, source_account: POLICY.claimant_account,
    calls: [{ action: "call", target_account: PROFILE.claiming_pot_account, method: SEED_CLAIM_METHOD, payload_b64u: base64UrlEncode(payload), payload_hash: sha256BytesId(payload), native_value: null }],
    declared_spends: [], max_fee: { asset_id: PROFILE.native_asset_id, amount_atomic: POLICY.max_fee_uzrn }, issued_at: START, expires_at: END, nonce: "seed-test", ...intentChange }, delegate.signer);
  return { descriptor, capability, intent };
}
export async function planned() {
  const bundle = await records();
  const input = { profile: PROFILE, policy: POLICY, observation: observation(), signer_public_key_b64u: KEY, now: NOW, ...bundle, fee_amount_uzrn: "100000", gas_limit: "100000" };
  const { descriptor: _descriptor, ...planInput } = input;
  return { bundle, input: planInput, plan: createSeedClaimPlan(planInput) };
}
export const context = () => ({ now: NOW, usage: { revocation_nonce: 0, intent_count: 0, spent: [], host_verified_approval_ids: [] as string[] } });
export async function authorized() {
  const { bundle, input, plan } = await planned();
  const result: SeedSimulationResult = { status: "succeeded", plan_id: plan.plan_id, simulation_tx_bytes_hash: plan.simulation_tx_bytes_hash,
    evidence: observation().evidence, code: 0, gas_wanted: "18446744073709551615", gas_used: "85000" };
  const receiptInput = { plan, intent: bundle.intent, result, adapter: simulationAdapter.key, simulation_id: "66666666-6666-4666-8666-666666666666",
    simulated_at: NOW, valid_until: "2026-09-08T08:01:00.000Z" };
  const core = createSeedSimulationReceiptCore(receiptInput);
  const simulation = await sealSimulationReceipt(core, simulationAdapter.signer);
  const binding = createSeedSimulationBinding({ plan, simulation, result });
  const authorizationInput = { profile: PROFILE, policy: POLICY, ...bundle, simulation, context: context() };
  const authorization = authorizeSeedClaim(authorizationInput);
  const requestInput = { plan, simulation, binding, authorization, request_id: "77777777-7777-4777-8777-777777777777" };
  return { bundle, input, plan, result, core, simulation, binding, authorization, receiptInput, authorizationInput, requestInput, request: createSeedSigningRequest(requestInput) };
}
export { SOURCE_ADDRESS, RECIPIENT_ADDRESS, owner, delegate, simulationAdapter };
