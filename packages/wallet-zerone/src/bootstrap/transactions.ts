/** Unsigned-only Claim planning with private provenance and portable commitments.
 * Doctrine: docs/specs/ZERONE-SEED-IO-0.1.md
 */
import {
  assertAuthorizedIntent, assertIntentWithinCapabilityStatic, assertVerifiedRecord,
  base64UrlEncode, concatBytes, createSigningRequest, sha256BytesId, sha256Id,
  snapshotJsonData, validateSimulationCore,
  type AuthorizedIntent, type SimulationEffect, type SimulationReceipt,
  type SimulationReceiptCore, type TransactionIntent, type Verified, type WalletCapability,
} from "@agenttool/wallet";
import { assertZeroneAddress, zeroneAddressFromSecp256k1PublicKey } from "../profiles.js";
import { assertCanonicalProtobuf, bytesField, decodeFields, decodeUtf8, requireBytesField, stringField, uintField } from "../wire.js";
import { assessSeedClaim, checkedObservation, evidenceReason } from "./assessment.js";
import { checkedPolicy, checkedProfile, SEED_CLAIM_METHOD, SEED_CLAIM_TYPE_URL } from "./policy.js";
import type {
  AuthorizeSeedClaimInput, CreateSeedClaimPlanInput, SeedClaimCommitment, SeedClaimPlan,
  SeedClaimPlanCore, SeedPlannerApi, SeedPolicy, SeedProfile, SeedSimulationBinding,
  SeedSimulationReceiptInput, SeedSimulationResult, SeedUnsignedBytes,
} from "./types.js";
import { amount, assertUint64, closed, evidenceShape, freeze, hash, integer, invalid, mismatch, publicKey, rawAccount, snapshot, timestamp, unsignedBytes } from "./validation.js";

interface PlanOrigin { profile: SeedProfile; policy: SeedPolicy; intent: Verified<TransactionIntent>; }
const plans = new WeakMap<object, PlanOrigin>();
const bindings = new WeakMap<object, { plan: SeedClaimPlan; simulation: Verified<SimulationReceipt>; result: SeedSimulationResult }>();
const authorizations = new WeakMap<object, { profile: SeedProfile; policy: SeedPolicy; simulation: Verified<SimulationReceipt> }>();
const COMMITMENT_KEYS = "protocol profile_id source_digest genesis_hash chain_id chain_reference policy_hash capability_record_id intent_record_id claimant_account sponsor_account pot_id signer_key_id signer_public_key_b64u account_number sequence fee_amount_uzrn gas_limit timeout_height expires_at grant_spend_limit_uzrn grant_expires_at";
const BYTE_KEYS = "body_bytes_b64u body_bytes_hash auth_info_bytes_b64u auth_info_bytes_hash sign_doc_bytes_b64u sign_doc_bytes_hash simulation_tx_bytes_b64u simulation_tx_bytes_hash";

export function encodeSeedMsgClaim(input: { readonly claimant: string; readonly pot_id: string }): Uint8Array {
  const message = snapshot(input);
  closed(message, "claimant pot_id", "MsgClaim"); assertZeroneAddress(message.claimant);
  if (message.pot_id !== `bootstrap-${message.claimant}`) mismatch("Claim pot must be bound to its exact claimant.");
  return concatBytes(stringField(1, message.claimant), stringField(2, message.pot_id));
}

/** Internal canonical decoder; this entrypoint deliberately has no signed-Tx API. */
export function decodeSeedMsgClaim(bytes: Uint8Array): Readonly<{ claimant: string; pot_id: string }> {
  const fields = decodeFields(bytes, 16_384);
  if (fields.length !== 2) invalid("MsgClaim must have exactly two fields.");
  const message = {
    claimant: decodeUtf8(requireBytesField(fields[0], 1, "claimant"), "claimant"),
    pot_id: decodeUtf8(requireBytesField(fields[1], 2, "pot_id"), "pot_id"),
  };
  assertCanonicalProtobuf(bytes, encodeSeedMsgClaim(message), "MsgClaim");
  return freeze(message);
}

function claimEffect(profile: SeedProfile): SimulationEffect {
  return { action: "call", target_account: profile.claiming_pot_account, method: SEED_CLAIM_METHOD, asset_id: null, amount_atomic: "0" };
}

function bindWallet(profile: SeedProfile, policy: SeedPolicy, capability: Verified<WalletCapability>, intent: Verified<TransactionIntent>): void {
  assertVerifiedRecord(capability); assertVerifiedRecord(intent);
  if (capability.schema !== "agent-wallet/capability/0.1" || intent.schema !== "agent-wallet/intent/0.1") mismatch("Wrong verified record kinds.");
  const rule = capability.call_rules[0]; const fee = capability.fee_limits[0];
  if (capability.policy_hash !== policy.policy_hash || capability.max_intents !== 1
    || capability.accounts.length !== 1 || capability.accounts[0] !== policy.claimant_account
    || capability.call_rules.length !== 1 || !rule || rule.target_account !== profile.claiming_pot_account
    || rule.actions.length !== 1 || rule.actions[0] !== "call" || rule.methods.length !== 1 || rule.methods[0] !== SEED_CLAIM_METHOD
    || capability.spend_limits.length !== 0 || capability.fee_limits.length !== 1
    || fee?.asset_id !== profile.native_asset_id || fee.max_per_intent !== policy.max_fee_uzrn
    || timestamp(capability.not_before, "capability.not_before") < timestamp(policy.not_before, "policy.not_before")
    || timestamp(capability.expires_at, "capability.expires_at") > timestamp(policy.expires_at, "policy.expires_at")) mismatch("Capability does not bind the exact seed policy.");
  if (intent.capability_record_id !== capability.record_id || intent.grant_id !== capability.grant_id
    || intent.wallet_id !== capability.wallet_id || intent.descriptor_id !== capability.descriptor_id
    || intent.delegate.key_id !== capability.delegate.key_id || intent.delegate.public_key !== capability.delegate.public_key
    || intent.chain_id !== profile.chain_id || intent.source_account !== policy.claimant_account
    || intent.calls.length !== 1 || intent.declared_spends.length !== 0
    || intent.max_fee.asset_id !== profile.native_asset_id || BigInt(intent.max_fee.amount_atomic) <= 0n
    || BigInt(intent.max_fee.amount_atomic) > BigInt(policy.max_fee_uzrn)
    || timestamp(intent.issued_at, "intent.issued_at") < timestamp(capability.not_before, "capability.not_before")
    || timestamp(intent.issued_at, "intent.issued_at") < timestamp(capability.issued_at, "capability.issued_at")
    || timestamp(intent.expires_at, "intent.expires_at") > timestamp(capability.expires_at, "capability.expires_at")) mismatch("Intent differs from the exact seed capability.");
  const call = intent.calls[0]!;
  if (call.action !== "call" || call.target_account !== profile.claiming_pot_account || call.method !== SEED_CLAIM_METHOD || call.native_value !== null) mismatch("Intent must contain only the zero-outgoing Claim call.");
  const payload = unsignedBytes(call.payload_b64u, "payload_b64u");
  const message = decodeSeedMsgClaim(payload);
  if (message.claimant !== rawAccount(policy.claimant_account, profile, "claimant") || message.pot_id !== policy.pot_id
    || call.payload_hash !== sha256BytesId(payload)) mismatch("Claim payload is not bound to policy and claimant.");
}

function feeCaps(profile: SeedProfile, policy: SeedPolicy, fee: string, gas: string): void {
  amount(fee, "fee_amount_uzrn", true); assertUint64(gas, "gas_limit", { positive: true });
  if (BigInt(gas) < BigInt(profile.claim_gas_floor) || BigInt(gas) > BigInt(profile.tx_gas_cap)
    || BigInt(gas) > BigInt(policy.max_gas) || BigInt(fee) < BigInt(gas) * BigInt(profile.min_gas_price_uzrn)
    || BigInt(fee) > BigInt(policy.max_fee_uzrn) || BigInt(fee) > BigInt(policy.grant_spend_limit_uzrn)) mismatch("Exact fee/gas violates ante floor or approved ceilings.");
}

function any(type: string, value: Uint8Array): Uint8Array {
  return concatBytes(stringField(1, type), bytesField(2, value));
}
/** Re-encoding comparison is also a canonical decoder: no unknown/default field survives. */
function encodeUnsigned(c: SeedClaimCommitment, profile: SeedProfile): SeedUnsignedBytes {
  const body = concatBytes(bytesField(1, any(SEED_CLAIM_TYPE_URL, encodeSeedMsgClaim({ claimant: rawAccount(c.claimant_account, profile, "claimant"), pot_id: c.pot_id }))), uintField(3, BigInt(c.timeout_height)));
  const signer = concatBytes(
    bytesField(1, any("/cosmos.crypto.secp256k1.PubKey", bytesField(1, publicKey(c.signer_public_key_b64u)))),
    bytesField(2, bytesField(1, uintField(1, 1n))), uintField(3, BigInt(c.sequence)),
  );
  const coin = concatBytes(stringField(1, "uzrn"), stringField(2, c.fee_amount_uzrn));
  const fee = concatBytes(bytesField(1, coin), uintField(2, BigInt(c.gas_limit)), stringField(4, rawAccount(c.sponsor_account, profile, "sponsor")));
  const auth = concatBytes(bytesField(1, signer), bytesField(2, fee));
  const signDoc = concatBytes(bytesField(1, body), bytesField(2, auth), stringField(3, c.chain_reference), uintField(4, BigInt(c.account_number)));
  const simulation = concatBytes(bytesField(1, body), bytesField(2, auth), bytesField(3, new Uint8Array(), { emitEmpty: true }));
  return {
    body_bytes_b64u: base64UrlEncode(body), body_bytes_hash: sha256BytesId(body),
    auth_info_bytes_b64u: base64UrlEncode(auth), auth_info_bytes_hash: sha256BytesId(auth),
    sign_doc_bytes_b64u: base64UrlEncode(signDoc), sign_doc_bytes_hash: sha256BytesId(signDoc),
    simulation_tx_bytes_b64u: base64UrlEncode(simulation), simulation_tx_bytes_hash: sha256BytesId(simulation),
  };
}

export function assertSeedClaimPlan(input: SeedClaimPlan, inputProfile: SeedProfile, inputPolicy: SeedPolicy): void {
  const profile = checkedProfile(inputProfile); const policy = checkedPolicy(profile, inputPolicy);
  const plan = snapshot(input);
  closed(plan, `protocol commitment commitment_hash observation_hash plan_id ${BYTE_KEYS}`, "plan");
  closed(plan.commitment, COMMITMENT_KEYS, "commitment");
  for (const key of ["plan_id", "commitment_hash", "observation_hash"] as const) hash(plan[key], key);
  const c = plan.commitment;
  for (const key of ["profile_id", "source_digest", "genesis_hash", "policy_hash", "capability_record_id", "intent_record_id", "signer_key_id"] as const) hash(c[key], key);
  if (plan.protocol !== "agent-wallet-zerone.seed-plan/0.1" || c.protocol !== "agent-wallet-zerone.seed-commitment/0.1"
    || c.profile_id !== profile.profile_id || c.source_digest !== profile.source_digest || c.genesis_hash !== profile.genesis_hash
    || c.chain_id !== profile.chain_id || c.chain_reference !== profile.chain_reference || c.policy_hash !== policy.policy_hash
    || c.claimant_account !== policy.claimant_account || c.sponsor_account !== policy.sponsor_account || c.pot_id !== policy.pot_id
    || c.timeout_height !== policy.timeout_height || c.grant_spend_limit_uzrn !== policy.grant_spend_limit_uzrn || c.grant_expires_at !== policy.grant_expires_at) mismatch("Commitment differs from source/profile/policy.");
  const key = publicKey(c.signer_public_key_b64u);
  if (sha256BytesId(key) !== c.signer_key_id || zeroneAddressFromSecp256k1PublicKey(key) !== rawAccount(c.claimant_account, profile, "claimant")) mismatch("Committed key does not derive the claimant.");
  assertUint64(c.account_number, "account_number"); assertUint64(c.sequence, "sequence");
  const expiry = timestamp(c.expires_at, "commitment.expires_at");
  if (expiry > timestamp(policy.expires_at, "policy.expires_at") || expiry <= timestamp(policy.not_before, "policy.not_before")) mismatch("Commitment expiry is outside policy.");
  feeCaps(profile, policy, c.fee_amount_uzrn, c.gas_limit);
  const encoded = encodeUnsigned(c, profile);
  for (const field of ["body_bytes", "auth_info_bytes", "sign_doc_bytes", "simulation_tx_bytes"] as const) {
    const bytesKey = `${field}_b64u` as const; const hashKey = `${field}_hash` as const;
    const bytes = unsignedBytes(plan[bytesKey], bytesKey); hash(plan[hashKey], hashKey);
    if (sha256BytesId(bytes) !== plan[hashKey] || plan[bytesKey] !== encoded[bytesKey] || plan[hashKey] !== encoded[hashKey]) mismatch("Plan unsigned bytes are noncanonical or substituted.");
  }
  if (sha256Id(c) !== plan.commitment_hash) mismatch("Commitment hash mismatch.");
  const { plan_id, ...core } = plan;
  if (sha256Id(core) !== plan_id) mismatch("Plan ID mismatch.");
}

export function createSeedClaimPlan(input: CreateSeedClaimPlanInput): Readonly<SeedClaimPlan> {
  input = closed(input, "profile policy observation signer_public_key_b64u now capability intent fee_amount_uzrn gas_limit", "plan input");
  const profile = checkedProfile(input.profile); const policy = checkedPolicy(profile, input.policy);
  bindWallet(profile, policy, input.capability, input.intent);
  const observation = checkedObservation(input.observation);
  const assessment = assessSeedClaim({ profile, policy, observation, signer_public_key_b64u: input.signer_public_key_b64u, now: input.now });
  if (assessment.status !== "ready" || observation.status !== "observed" || observation.claimant.status !== "found") mismatch("Seed assessment is not ready.");
  const now = timestamp(input.now, "now");
  if (now < timestamp(input.intent.issued_at, "intent.issued_at") || now >= timestamp(input.intent.expires_at, "intent.expires_at")) mismatch("Intent is not current at plan construction.");
  feeCaps(profile, policy, input.fee_amount_uzrn, input.gas_limit);
  if (BigInt(input.fee_amount_uzrn) > BigInt(input.intent.max_fee.amount_atomic)) mismatch("Exact fee exceeds intent ceiling.");
  const commitment: SeedClaimCommitment = {
    protocol: "agent-wallet-zerone.seed-commitment/0.1", profile_id: profile.profile_id,
    source_digest: profile.source_digest, genesis_hash: profile.genesis_hash, chain_id: profile.chain_id, chain_reference: profile.chain_reference,
    policy_hash: policy.policy_hash, capability_record_id: input.capability.record_id, intent_record_id: input.intent.record_id,
    claimant_account: policy.claimant_account, sponsor_account: policy.sponsor_account, pot_id: policy.pot_id,
    signer_key_id: sha256BytesId(publicKey(input.signer_public_key_b64u)), signer_public_key_b64u: input.signer_public_key_b64u,
    account_number: observation.claimant.account_number, sequence: observation.claimant.sequence,
    fee_amount_uzrn: input.fee_amount_uzrn, gas_limit: input.gas_limit, timeout_height: policy.timeout_height,
    expires_at: input.intent.expires_at, grant_spend_limit_uzrn: policy.grant_spend_limit_uzrn, grant_expires_at: policy.grant_expires_at,
  };
  const core: SeedClaimPlanCore = { protocol: "agent-wallet-zerone.seed-plan/0.1", commitment, commitment_hash: sha256Id(commitment), observation_hash: assessment.observation_hash, ...encodeUnsigned(commitment, profile) };
  const plan = freeze({ ...core, plan_id: sha256Id(core) });
  assertSeedClaimPlan(plan, profile, policy);
  plans.set(plan, { profile, policy, intent: input.intent });
  return plan;
}

function origin(plan: SeedClaimPlan): PlanOrigin {
  const value = plans.get(plan);
  if (!value) mismatch("Plan must be constructed from verified records in this process; portable validation is not provenance.");
  return value;
}

function checkedResult(plan: SeedClaimPlan, input: SeedSimulationResult, now: string): SeedSimulationResult {
  const { profile, policy } = origin(plan);
  const result = snapshot(input);
  closed(result, "status plan_id simulation_tx_bytes_hash evidence code gas_wanted gas_used", "simulation result");
  evidenceShape(result.evidence); hash(result.plan_id, "plan_id"); hash(result.simulation_tx_bytes_hash, "simulation_tx_bytes_hash");
  integer(result.code, 0, 0xffffffff, "code"); assertUint64(result.gas_wanted, "gas_wanted"); assertUint64(result.gas_used, "gas_used");
  if (!["succeeded", "failed"].includes(result.status) || (result.status === "succeeded") !== (result.code === 0)) mismatch("Simulation status/code disagree.");
  if (result.plan_id !== plan.plan_id || result.simulation_tx_bytes_hash !== plan.simulation_tx_bytes_hash) mismatch("Simulation does not bind exact final unsigned TxRaw.");
  if (evidenceReason(result.evidence, profile, policy, now)) mismatch("Simulation evidence is mismatched, stale, or past timeout.");
  // SDK0.53.8 simulation uses an infinite gas meter whose Limit() is uint64 max.
  // Preserve that observation, never promote it into finite gas/fee authority.
  const wantedMatches = result.gas_wanted === plan.commitment.gas_limit || result.gas_wanted === "18446744073709551615";
  if (result.status === "succeeded" && (!wantedMatches || BigInt(result.gas_used) > BigInt(plan.commitment.gas_limit) || result.gas_used === "0")) mismatch("Successful simulation exceeds or changes the final gas plan.");
  return freeze(result);
}

export function createSeedSimulationReceiptCore(input: SeedSimulationReceiptInput): SimulationReceiptCore {
  input = closed(input, "plan intent result adapter simulation_id simulated_at valid_until", "simulation receipt input");
  const { profile, intent } = origin(input.plan);
  assertVerifiedRecord(input.intent);
  if (input.intent.record_id !== intent.record_id) mismatch("Simulation intent differs from plan.");
  const result = checkedResult(input.plan, input.result, input.simulated_at);
  const start = timestamp(input.simulated_at, "simulated_at"); const end = timestamp(input.valid_until, "valid_until");
  if (start < timestamp(intent.issued_at, "intent.issued_at") || start >= end || end > timestamp(input.plan.commitment.expires_at, "expires_at")) mismatch("Simulation lifetime is outside the intent/plan.");
  const core: SimulationReceiptCore = {
    schema: "agent-wallet/simulation/0.1", simulation_id: input.simulation_id, intent_id: intent.intent_id, intent_record_id: intent.record_id,
    chain_id: profile.chain_id, source_account: intent.source_account, adapter: input.adapter,
    block_ref: `${profile.chain_reference}:${result.evidence.anchor.height}`, block_hash: result.evidence.anchor.block_hash,
    success: result.status === "succeeded", effects: [claimEffect(profile)],
    estimated_fee: { asset_id: profile.native_asset_id, amount_atomic: input.plan.commitment.fee_amount_uzrn },
    simulated_at: input.simulated_at, valid_until: input.valid_until,
  };
  // Wallet owns its own key/string/record schema rules, including non-Seed Unicode.
  return freeze(validateSimulationCore(core));
}

export const createSeedSimulationBinding: SeedPlannerApi["createSeedSimulationBinding"] = (input) => {
  input = closed(input, "plan simulation result", "simulation binding input");
  const { intent } = origin(input.plan); assertVerifiedRecord(input.simulation);
  const result = checkedResult(input.plan, input.result, input.simulation.simulated_at);
  const expected = createSeedSimulationReceiptCore({ plan: input.plan, intent, result, adapter: input.simulation.adapter,
    simulation_id: input.simulation.simulation_id, simulated_at: input.simulation.simulated_at, valid_until: input.simulation.valid_until });
  const { record_id: _record, signature: _signature, ...actual } = input.simulation;
  if (!expected.success || sha256Id(expected) !== sha256Id(actual)) mismatch("Verified simulation receipt differs from exact Claim result and fee.");
  const binding: SeedSimulationBinding = freeze({ protocol: "agent-wallet-zerone.seed-simulation-binding/0.1", plan_id: input.plan.plan_id,
    simulation_record_id: input.simulation.record_id, simulation_tx_bytes_hash: input.plan.simulation_tx_bytes_hash });
  bindings.set(binding, { plan: input.plan, simulation: input.simulation, result });
  return binding;
};

export function authorizeSeedClaim(input: AuthorizeSeedClaimInput): AuthorizedIntent {
  input = closed(input, "profile policy descriptor capability intent simulation context", "authorization input");
  const profile = checkedProfile(input.profile); const policy = checkedPolicy(profile, input.policy);
  bindWallet(profile, policy, input.capability, input.intent);
  assertVerifiedRecord(input.simulation);
  if (input.simulation.effects.length !== 1 || sha256Id(input.simulation.effects[0]) !== sha256Id(claimEffect(profile))) mismatch("Simulation must have exactly the zero-outgoing Claim effect.");
  // Preserve Wallet's Unicode rules while making current usage/time a single
  // data snapshot too; do not hand a dynamic options object to the core checker.
  const context = snapshotJsonData(input.context) as unknown as AuthorizeSeedClaimInput["context"];
  closed(context, "now usage", "authorization context");
  closed(context.usage, "revocation_nonce intent_count spent host_verified_approval_ids", "authorization usage");
  if (!Array.isArray(context.usage.spent)) invalid("Authorization spent must be an array.");
  for (const entry of context.usage.spent) closed(entry, "asset_id amount_atomic", "authorization spent entry");
  const now = timestamp(context.now, "now");
  if (now < timestamp(policy.not_before, "not_before") || now >= timestamp(policy.expires_at, "expires_at")) mismatch("Seed policy is not current.");
  const authorization = assertIntentWithinCapabilityStatic({ descriptor: input.descriptor, capability: input.capability, intent: input.intent, simulation: input.simulation, context });
  authorizations.set(authorization, { profile, policy, simulation: input.simulation });
  return authorization;
}

export const createSeedSigningRequest: SeedPlannerApi["createSeedSigningRequest"] = (input) => {
  input = closed(input, "plan simulation binding authorization request_id", "signing request input");
  const { profile, policy } = origin(input.plan);
  assertVerifiedRecord(input.simulation); assertAuthorizedIntent(input.authorization);
  const bound = bindings.get(input.binding); const authority = authorizations.get(input.authorization);
  if (!bound || bound.plan !== input.plan || bound.simulation !== input.simulation
    || !authority || authority.profile.profile_id !== profile.profile_id || authority.policy.policy_hash !== policy.policy_hash || authority.simulation !== input.simulation
    || input.authorization.policy_hash !== policy.policy_hash || input.authorization.capability_record_id !== input.plan.commitment.capability_record_id
    || input.authorization.intent_record_id !== input.plan.commitment.intent_record_id || input.authorization.simulation_record_id !== input.simulation.record_id) mismatch("Signing requires exact in-process Seed authorization and simulation binding.");
  checkedResult(input.plan, bound.result, input.authorization.checked_at);
  if (timestamp(input.authorization.checked_at, "checked_at") >= timestamp(input.plan.commitment.expires_at, "expires_at")) mismatch("Signing authorization is past plan expiry.");
  if (typeof input.request_id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(input.request_id)) invalid("Invalid seed request ID.");
  return createSigningRequest({ request_id: input.request_id, authorization: input.authorization, signer_key_id: input.plan.commitment.signer_key_id,
    unsigned_payload: unsignedBytes(input.plan.sign_doc_bytes_b64u, "sign_doc_bytes_b64u") });
};
