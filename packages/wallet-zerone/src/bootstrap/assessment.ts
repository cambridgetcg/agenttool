/** All-or-unknown supplied full-node evidence, never a state proof. Doctrine: docs/specs/ZERONE-SEED-IO-0.1.md */
import { sha256Id } from "@agenttool/wallet";
import { zeroneAddressFromSecp256k1PublicKey, assertZeroneAddress } from "../profiles.js";
import { checkedPolicy, checkedProfile, SEED_CLAIM_TYPE_URL } from "./policy.js";
import type { AssessSeedInput, SeedAssessment, SeedAssessmentReason, SeedObservation, SeedPolicy, SeedProfile, SeedReadEvidence } from "./types.js";
import { amount, ascii, assertUint64, closed, evidenceShape, freeze, hash, integer, invalid, publicKey, rawAccount, snapshot, timestamp } from "./validation.js";

const UNKNOWN = ["unavailable", "not_found_unproven", "unsupported_state", "incoherent_height", "chain_mismatch", "genesis_mismatch", "stale", "catching_up", "response_limit", "invalid_response"];
export function checkedObservation(input: SeedObservation): SeedObservation {
  const value = snapshot(input);
  if (value.status === "unknown") {
    closed(value, "protocol status profile_id reason", "observation");
    hash(value.profile_id, "profile_id");
    if (!UNKNOWN.includes(value.reason)) invalid("Unsupported unknown observation reason.");
  } else {
    closed(value, "protocol status evidence claimant sponsor_account sponsor_balance_uzrn pot prior_claim min_claim_amount_uzrn allowance supply", "observation");
    if (value.status !== "observed") invalid("Unsupported observation status.");
    evidenceShape(value.evidence);
    const account = value.claimant;
    if (account.status === "absent") closed(account, "status account", "claimant");
    else {
      closed(account, "status account account_number sequence public_key", "claimant");
      if (account.status !== "found") invalid("Unsupported account status.");
      assertUint64(account.account_number, "account_number"); assertUint64(account.sequence, "sequence");
      if (account.public_key !== null) {
        closed(account.public_key, "type_url key_b64u", "public_key");
        if (account.public_key.type_url !== "/cosmos.crypto.secp256k1.PubKey") invalid("Unsupported account public key.");
        publicKey(account.public_key.key_b64u);
      }
    }
    ascii(account.account, "claimant.account"); ascii(value.sponsor_account, "sponsor_account");
    amount(value.sponsor_balance_uzrn, "sponsor_balance_uzrn"); amount(value.min_claim_amount_uzrn, "min_claim_amount_uzrn");
    if (value.pot !== null) {
      const pot = value.pot;
      closed(pot, "pot_id status total_amount_uzrn claimed_amount_uzrn start_block end_block cliff_blocks period_blocks min_staking_tier min_registration_age whitelist", "pot");
      ascii(pot.pot_id, "pot_id");
      if (!["active", "depleted", "expired", "unspecified"].includes(pot.status)) invalid("Unsupported pot status.");
      amount(pot.total_amount_uzrn, "total_amount_uzrn"); amount(pot.claimed_amount_uzrn, "claimed_amount_uzrn");
      for (const key of ["start_block", "end_block", "cliff_blocks", "period_blocks", "min_registration_age"] as const) assertUint64(pot[key], key);
      integer(pot.min_staking_tier, 0, 0x7fffffff, "min_staking_tier");
      if (!Array.isArray(pot.whitelist) || pot.whitelist.length > 1) invalid("Unsupported seed whitelist width.");
      for (const address of pot.whitelist) assertZeroneAddress(address);
    }
    if (value.prior_claim !== null) {
      const claim = value.prior_claim;
      closed(claim, "pot_id claimant amount_uzrn claimed_at", "prior_claim");
      ascii(claim.pot_id, "prior_claim.pot_id"); assertZeroneAddress(claim.claimant);
      amount(claim.amount_uzrn, "prior_claim.amount_uzrn"); assertUint64(claim.claimed_at, "prior_claim.claimed_at");
    }
    const allowance = value.allowance;
    if (allowance.status === "absent") closed(allowance, "status", "allowance");
    else {
      closed(allowance, "status granter grantee type_url inner_type_url allowed_messages spend_limit_uzrn expires_at", "allowance");
      if (allowance.status !== "found" || allowance.type_url !== "/cosmos.feegrant.v1beta1.AllowedMsgAllowance"
        || allowance.inner_type_url !== "/cosmos.feegrant.v1beta1.BasicAllowance"
        || !Array.isArray(allowance.allowed_messages) || allowance.allowed_messages.length !== 1
        || allowance.allowed_messages[0] !== SEED_CLAIM_TYPE_URL) invalid("Unsupported allowance shape.");
      assertZeroneAddress(allowance.granter); assertZeroneAddress(allowance.grantee);
      amount(allowance.spend_limit_uzrn, "spend_limit_uzrn"); timestamp(allowance.expires_at, "allowance.expires_at");
    }
    closed(value.supply, "total_minted_uzrn current_supply_uzrn max_supply_uzrn", "supply");
    for (const key of ["total_minted_uzrn", "current_supply_uzrn", "max_supply_uzrn"] as const) amount(value.supply[key], key);
  }
  if (value.protocol !== "agent-wallet-zerone.seed-observation/0.1") invalid("Unsupported observation protocol.");
  return freeze(value);
}

export function evidenceReason(e: SeedReadEvidence, profile: SeedProfile, policy: SeedPolicy, now: string): SeedAssessmentReason | null {
  evidenceShape(e);
  if (e.profile_id !== profile.profile_id || e.node_trust_id !== policy.node_trust_id) return "policy_mismatch";
  if (e.chain_id !== profile.chain_id) return "chain_mismatch";
  if (e.genesis_hash !== profile.genesis_hash) return "genesis_mismatch";
  if (e.catching_up) return "catching_up";
  const height = BigInt(e.anchor.height); const latest = BigInt(e.latest_height);
  if (height > latest || latest - height > BigInt(policy.max_height_lag)) return "incoherent_height";
  const time = timestamp(now, "now"); const seen = timestamp(e.observed_at, "observed_at"); const block = timestamp(e.anchor.block_time, "block_time");
  if (block > seen || seen > time || time - block > policy.max_observation_age_seconds * 1000
    || time - seen > policy.max_observation_age_seconds * 1000) return "stale";
  if (latest >= BigInt(policy.timeout_height)) return "timeout_height";
  return null;
}

export function assessSeedClaim(input: AssessSeedInput): Readonly<SeedAssessment> {
  input = closed(input, "profile policy observation signer_public_key_b64u now", "assessment input");
  const profile = checkedProfile(input.profile); const policy = checkedPolicy(profile, input.policy);
  const now = timestamp(input.now, "now");
  const blocked = (reason: SeedAssessmentReason): SeedAssessment => freeze({ status: "blocked", reason });
  const unknown = (reason: SeedAssessmentReason): SeedAssessment => freeze({ status: "unknown", reason });
  if (now < timestamp(policy.not_before, "not_before")) return blocked("not_yet_valid");
  if (now >= timestamp(policy.expires_at, "expires_at")) return blocked("expired");
  let observation: SeedObservation;
  try { observation = checkedObservation(input.observation); } catch { return unknown("invalid_response"); }
  if (observation.status === "unknown") return unknown(observation.profile_id === profile.profile_id ? observation.reason : "policy_mismatch");
  const reason = evidenceReason(observation.evidence, profile, policy, input.now);
  if (reason) return unknown(reason);
  const claimant = rawAccount(policy.claimant_account, profile, "claimant");
  const sponsor = rawAccount(policy.sponsor_account, profile, "sponsor");
  if (observation.claimant.account !== policy.claimant_account || observation.sponsor_account !== policy.sponsor_account) return blocked("policy_mismatch");
  try {
    const key = publicKey(input.signer_public_key_b64u);
    if (zeroneAddressFromSecp256k1PublicKey(key) !== claimant) return blocked("key_mismatch");
    if (observation.claimant.status === "found" && observation.claimant.public_key !== null
      && observation.claimant.public_key.key_b64u !== input.signer_public_key_b64u) return blocked("key_mismatch");
  } catch { return blocked("key_mismatch"); }
  const pot = observation.pot;
  if (pot === null) return blocked("pot_missing");
  if (pot.pot_id !== policy.pot_id || pot.total_amount_uzrn !== "222000"
    || BigInt(pot.claimed_amount_uzrn) > BigInt(pot.total_amount_uzrn)
    || BigInt(pot.end_block) !== BigInt(pot.start_block) + 1n || pot.cliff_blocks !== "0" || pot.period_blocks !== "0"
    || pot.min_staking_tier !== 0 || pot.min_registration_age !== "0" || pot.whitelist.length !== 1 || pot.whitelist[0] !== claimant) return blocked("pot_shape");
  if (pot.status !== "active") return blocked("pot_inactive");
  if (observation.prior_claim !== null) {
    if (observation.prior_claim.pot_id !== policy.pot_id || observation.prior_claim.claimant !== claimant) return unknown("invalid_response");
    return blocked("already_claimed");
  }
  // A single-recipient seed has no unexplained prior issuance.
  if (pot.claimed_amount_uzrn !== "0") return unknown("invalid_response");
  if (BigInt(observation.evidence.anchor.height) < BigInt(pot.end_block)) return blocked("not_vested");
  const remaining = BigInt(pot.total_amount_uzrn) - BigInt(pot.claimed_amount_uzrn);
  if (remaining === 0n || remaining < BigInt(observation.min_claim_amount_uzrn)) return blocked("below_minimum");
  // Native minimum is checked BEFORE supply clipping; total_minted is not headroom.
  const headroom = BigInt(observation.supply.max_supply_uzrn) - BigInt(observation.supply.current_supply_uzrn);
  if (headroom <= 0n) return blocked("supply_exhausted");
  if (observation.claimant.status === "absent") return blocked("account_missing");
  const allowance = observation.allowance;
  if (allowance.status === "absent") return blocked("allowance_missing");
  if (allowance.granter !== sponsor || allowance.grantee !== claimant
    || allowance.spend_limit_uzrn !== policy.grant_spend_limit_uzrn || allowance.expires_at !== policy.grant_expires_at
    || timestamp(allowance.expires_at, "expires_at") <= now) return blocked("allowance_mismatch");
  const exposure = BigInt(policy.grant_spend_limit_uzrn) + BigInt(policy.setup_fee_budget_uzrn);
  if (BigInt(observation.sponsor_balance_uzrn) < exposure) return blocked("sponsor_underfunded");
  return freeze({ status: "ready", observation_hash: sha256Id(observation), expected_credit_uzrn: (remaining < headroom ? remaining : headroom).toString(), sponsor_exposure_uzrn: exposure.toString() });
}
