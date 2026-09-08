/** Source-bound Claim-only candidate. Doctrine: docs/specs/ZERONE-SEED-IO-0.1.md */
import { assertCaip2, sha256Id } from "@agenttool/wallet";
import { bech32 } from "@scure/base";
import { sha256 } from "@noble/hashes/sha2.js";
import type { SeedProfileCore, SeedProfile, SeedPolicyCore, SeedPolicy } from "./types.js";
import { amount, ascii, assertUint64, closed, freeze, hash, integer, invalid, mismatch, rawAccount, snapshot, timestamp, UINT256_MAX } from "./validation.js";

const PROFILE_KEYS = "protocol chain_reference chain_id native_asset_id claiming_pot_account genesis_hash source_digest zerone_core_commit cosmos_sdk_version runtime_sha256 helper_sha256 native_denom bech32_prefix seed_amount_uzrn claim_type_url claim_gas_floor tx_gas_cap min_gas_price_uzrn confirmation_depth";
const POLICY_KEYS = "protocol profile_id node_trust_id claimant_account sponsor_account pot_id max_intents seed_amount_uzrn max_fee_uzrn max_gas grant_spend_limit_uzrn grant_expires_at setup_fee_budget_uzrn not_before expires_at timeout_height max_observation_age_seconds max_height_lag";
export const SEED_CLAIM_TYPE_URL = "/zerone.claiming_pot.v1.MsgClaim" as const;
export const SEED_CLAIM_METHOD = "zerone.claiming_pot.v1.MsgClaim" as const;
// Maturity only; distribution and production authority require separate evidence.
export const SEED_BOOTSTRAP_RELEASE_STATUS = "developer-preview" as const;
// Same Cosmos module-address derivation as existing profiles.ts; no old network retargeting.
const MODULE_ADDRESS = bech32.encodeFromBytes("zrn", sha256(new TextEncoder().encode("claiming_pot")).subarray(0, 20));

export function createSeedProfile(input: SeedProfileCore): Readonly<SeedProfile> {
  const core = snapshot(input);
  closed(core, PROFILE_KEYS, "profile");
  ascii(core.chain_reference, "chain_reference"); assertCaip2(core.chain_id, "chain_id");
  if (core.protocol !== "agent-wallet-zerone.seed-profile/0.1"
    || core.chain_id !== `cosmos:${core.chain_reference}`
    || core.native_asset_id !== `${core.chain_id}/denom:uzrn`
    || core.claiming_pot_account !== `${core.chain_id}:${MODULE_ADDRESS}`
    || core.cosmos_sdk_version !== "v0.53.8" || core.native_denom !== "uzrn" || core.bech32_prefix !== "zrn"
    || core.seed_amount_uzrn !== "222000" || core.claim_type_url !== SEED_CLAIM_TYPE_URL
    || core.claim_gas_floor !== "22222" || core.tx_gas_cap !== "11111111" || core.min_gas_price_uzrn !== "1"
    || core.confirmation_depth !== 1) invalid("Unsupported source-bound seed profile.");
  ascii(core.zerone_core_commit, "zerone_core_commit");
  if (!/^[0-9a-f]{40}$/u.test(core.zerone_core_commit)) invalid("zerone_core_commit must be an exact source revision.");
  for (const key of ["genesis_hash", "source_digest", "runtime_sha256", "helper_sha256"] as const) hash(core[key], key);
  return freeze({ ...core, profile_id: sha256Id(core) });
}

export function checkedProfile(input: SeedProfile): Readonly<SeedProfile> {
  const value = snapshot(input);
  closed(value, `${PROFILE_KEYS} profile_id`, "profile"); hash(value.profile_id, "profile_id");
  const { profile_id, ...core } = value;
  const expected = createSeedProfile(core);
  if (expected.profile_id !== profile_id) mismatch("Profile ID does not match its exact content.");
  return expected;
}

export function createSeedPolicy(inputProfile: SeedProfile, input: SeedPolicyCore): Readonly<SeedPolicy> {
  const profile = checkedProfile(inputProfile);
  const core = snapshot(input);
  closed(core, POLICY_KEYS, "policy");
  hash(core.profile_id, "profile_id"); hash(core.node_trust_id, "node_trust_id");
  const claimant = rawAccount(core.claimant_account, profile, "claimant_account");
  rawAccount(core.sponsor_account, profile, "sponsor_account");
  if (core.protocol !== "agent-wallet-zerone.seed-policy/0.1" || core.profile_id !== profile.profile_id
    || core.claimant_account === core.sponsor_account || core.pot_id !== `bootstrap-${claimant}`
    || core.max_intents !== 1 || core.seed_amount_uzrn !== "222000") mismatch("Policy differs from the one-claim seed profile.");
  amount(core.max_fee_uzrn, "max_fee_uzrn", true); amount(core.grant_spend_limit_uzrn, "grant_spend_limit_uzrn", true);
  amount(core.setup_fee_budget_uzrn, "setup_fee_budget_uzrn");
  assertUint64(core.max_gas, "max_gas", { positive: true }); assertUint64(core.timeout_height, "timeout_height", { positive: true });
  if (BigInt(core.max_gas) < BigInt(profile.claim_gas_floor) || BigInt(core.max_gas) > BigInt(profile.tx_gas_cap)
    || BigInt(core.max_fee_uzrn) < BigInt(profile.claim_gas_floor)
    || BigInt(core.max_fee_uzrn) > BigInt(core.grant_spend_limit_uzrn)
    || BigInt(core.grant_spend_limit_uzrn) + BigInt(core.setup_fee_budget_uzrn) > UINT256_MAX) invalid("Policy fee/gas/exposure caps are inconsistent.");
  const start = timestamp(core.not_before, "not_before"); const end = timestamp(core.expires_at, "expires_at");
  const grantEnd = timestamp(core.grant_expires_at, "grant_expires_at");
  if (start >= end || end > grantEnd) invalid("Policy must have a finite interval within the grant lifetime.");
  integer(core.max_observation_age_seconds, 1, 300, "max_observation_age_seconds"); integer(core.max_height_lag, 0, 100, "max_height_lag");
  return freeze({ ...core, policy_hash: sha256Id(core) });
}

export function checkedPolicy(profile: SeedProfile, input: SeedPolicy): Readonly<SeedPolicy> {
  const value = snapshot(input);
  closed(value, `${POLICY_KEYS} policy_hash`, "policy"); hash(value.policy_hash, "policy_hash");
  const { policy_hash, ...core } = value;
  const expected = createSeedPolicy(profile, core);
  if (expected.policy_hash !== policy_hash) mismatch("Policy hash does not match its exact content.");
  return expected;
}
