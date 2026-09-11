// Disposable, offline source-candidate smoke. No Cosmos signing, files, or network.
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { bech32 } from "@scure/base";
import { sha256 } from "@noble/hashes/sha2.js";
import { base64UrlEncode, keyIdForPublicKey, sealWalletDescriptor, sealWalletCapability, sealTransactionIntent, sealSimulationReceipt, sha256BytesId } from "@agenttool/wallet";
import * as seed from "@agenttool/wallet-zerone/bootstrap/v1";
import * as legacy from "@agenttool/wallet-zerone";

assert.equal(seed.SEED_BOOTSTRAP_RELEASE_STATUS, "developer-preview");
assert.equal(legacy.getZeroneProfile("mainnet").chain_reference, "zerone-1");
assert.deepEqual(Object.keys(legacy).filter((name) => /seed/iu.test(name)), []);
assert.deepEqual(Object.keys(seed).filter((name) => /signed|private|secret|signAndSend/iu.test(name)), []);
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const publicKeyB64u = base64UrlEncode(publicKey.export({ type: "spki", format: "der" }).subarray(-32));
const key = { algorithm: "Ed25519", key_id: keyIdForPublicKey(publicKeyB64u), public_key: publicKeyB64u };
const signer = { public_key: publicKeyB64u, sign_digest: (digest) => base64UrlEncode(sign(null, digest, privateKey)) };
const zkey = base64UrlEncode(Buffer.from("0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798", "hex"));
const source = legacy.zeroneAddressFromSecp256k1PublicKey(Buffer.from(zkey, "base64url"));
const sponsor = bech32.encodeFromBytes("zrn", new Uint8Array(20).fill(2));
const digest = `sha256:${"a".repeat(64)}`;
const moduleAddress = bech32.encodeFromBytes("zrn", sha256(new TextEncoder().encode("claiming_pot")).subarray(0, 20));
const profile = seed.createSeedProfile({ protocol: "agent-wallet-zerone.seed-profile/0.1", chain_reference: "seed-smoke-1", chain_id: "cosmos:seed-smoke-1",
  native_asset_id: "cosmos:seed-smoke-1/denom:uzrn", claiming_pot_account: `cosmos:seed-smoke-1:${moduleAddress}`, genesis_hash: digest, source_digest: digest,
  zerone_core_commit: "a".repeat(40), cosmos_sdk_version: "v0.53.8", runtime_sha256: digest, helper_sha256: digest, native_denom: "uzrn", bech32_prefix: "zrn",
  seed_amount_uzrn: "222000", claim_type_url: seed.SEED_CLAIM_TYPE_URL, claim_gas_floor: "22222", tx_gas_cap: "11111111", min_gas_price_uzrn: "1", confirmation_depth: 1 });
const start = "2026-09-08T00:00:00.000Z";
const now = "2026-09-08T00:00:10.000Z";
const end = "2026-09-08T00:01:00.000Z";
const policy = seed.createSeedPolicy(profile, { protocol: "agent-wallet-zerone.seed-policy/0.1", profile_id: profile.profile_id, node_trust_id: digest,
  claimant_account: `${profile.chain_id}:${source}`, sponsor_account: `${profile.chain_id}:${sponsor}`, pot_id: `bootstrap-${source}`, max_intents: 1, seed_amount_uzrn: "222000",
  max_fee_uzrn: "100000", max_gas: "100000", grant_spend_limit_uzrn: "100000", grant_expires_at: end, setup_fee_budget_uzrn: "0", not_before: start, expires_at: end,
  timeout_height: "100", max_observation_age_seconds: 60, max_height_lag: 1 });
const evidence = { trust: "configured_full_node", node_trust_id: digest, profile_id: profile.profile_id, chain_id: profile.chain_id, genesis_hash: digest,
  anchor: { height: "10", block_hash: digest, block_time: start }, latest_height: "10", catching_up: false, observed_at: now };
const observation = { protocol: "agent-wallet-zerone.seed-observation/0.1", status: "observed", evidence,
  claimant: { status: "found", account: policy.claimant_account, account_number: "7", sequence: "0", public_key: null }, sponsor_account: policy.sponsor_account, sponsor_balance_uzrn: "100000",
  pot: { pot_id: policy.pot_id, status: "active", total_amount_uzrn: "222000", claimed_amount_uzrn: "0", start_block: "1", end_block: "2", cliff_blocks: "0", period_blocks: "0", min_staking_tier: 0, min_registration_age: "0", whitelist: [source] },
  prior_claim: null, min_claim_amount_uzrn: "1000", allowance: { status: "found", granter: sponsor, grantee: source, type_url: "/cosmos.feegrant.v1beta1.AllowedMsgAllowance", inner_type_url: "/cosmos.feegrant.v1beta1.BasicAllowance", allowed_messages: [seed.SEED_CLAIM_TYPE_URL], spend_limit_uzrn: "100000", expires_at: end },
  supply: { total_minted_uzrn: "0", current_supply_uzrn: "0", max_supply_uzrn: "222000" } };
const descriptor = await sealWalletDescriptor({ schema: "agent-wallet/descriptor/0.1", wallet_id: "33333333-3333-4333-8333-333333333333", owner_identity_id: "did:at:disposable-smoke", authority: key,
  custody_mode: "delegated_signer", accounts: [{ account_id: policy.claimant_account, account_kind: "eoa" }], recovery_mode: "none", created_at: start }, signer);
const capability = await sealWalletCapability({ schema: "agent-wallet/capability/0.1", grant_id: "44444444-4444-4444-8444-444444444444", wallet_id: descriptor.wallet_id, descriptor_id: descriptor.record_id,
  issuer: key, delegate: key, accounts: [policy.claimant_account], call_rules: [{ target_account: profile.claiming_pot_account, actions: ["call"], methods: [seed.SEED_CLAIM_METHOD], requires_approval: false }],
  spend_limits: [], fee_limits: [{ asset_id: profile.native_asset_id, max_per_intent: "100000" }], max_intents: 1, approval_threshold: 0, issued_at: start, not_before: start, expires_at: end, revocation_nonce: 0, policy_hash: policy.policy_hash, purpose: "Disposable source-candidate smoke" }, signer);
const claim = seed.encodeSeedMsgClaim({ claimant: source, pot_id: policy.pot_id });
const intent = await sealTransactionIntent({ schema: "agent-wallet/intent/0.1", intent_id: "55555555-5555-4555-8555-555555555555", wallet_id: descriptor.wallet_id, descriptor_id: descriptor.record_id,
  grant_id: capability.grant_id, capability_record_id: capability.record_id, delegate: key, chain_id: profile.chain_id, source_account: policy.claimant_account,
  calls: [{ action: "call", target_account: profile.claiming_pot_account, method: seed.SEED_CLAIM_METHOD, payload_b64u: base64UrlEncode(claim), payload_hash: sha256BytesId(claim), native_value: null }],
  declared_spends: [], max_fee: { asset_id: profile.native_asset_id, amount_atomic: "100000" }, issued_at: start, expires_at: end, nonce: "disposable-smoke" }, signer);
const plan = seed.createSeedClaimPlan({ profile, policy, observation, signer_public_key_b64u: zkey, now, capability, intent, fee_amount_uzrn: "100000", gas_limit: "100000" });
seed.assertSeedClaimPlan(JSON.parse(JSON.stringify(plan)), profile, policy);
const result = { status: "succeeded", plan_id: plan.plan_id, simulation_tx_bytes_hash: plan.simulation_tx_bytes_hash, evidence, code: 0, gas_wanted: "18446744073709551615", gas_used: "85000" };
const core = seed.createSeedSimulationReceiptCore({ plan, intent, result, adapter: key, simulation_id: "66666666-6666-4666-8666-666666666666", simulated_at: now, valid_until: end });
const simulation = await sealSimulationReceipt(core, signer);
const binding = seed.createSeedSimulationBinding({ plan, simulation, result });
const authorization = seed.authorizeSeedClaim({ profile, policy, descriptor, capability, intent, simulation, context: { now, usage: { revocation_nonce: 0, intent_count: 0, spent: [], host_verified_approval_ids: [] } } });
const request = seed.createSeedSigningRequest({ plan, simulation, binding, authorization, request_id: "77777777-7777-4777-8777-777777777777" });
assert.equal(request.unsigned_payload_hash, plan.sign_doc_bytes_hash);
assert.throws(() => seed.createSeedSigningRequest({ plan, simulation, binding: JSON.parse(JSON.stringify(binding)), authorization, request_id: request.request_id }));
console.log("wallet-zerone bootstrap/v1 Node ESM unsigned journey passed (source candidate)");
