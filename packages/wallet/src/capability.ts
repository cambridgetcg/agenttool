import { WalletProtocolError, invalid } from "./errors.js";
import {
  assertAmount,
  assertBoundedString,
  assertCaip10,
  assertCaip19,
  assertTimestamp,
  chainFromAsset,
  timestampMs,
} from "./identifiers.js";
import { assertVerifiedRecord } from "./signatures.js";
import type {
  AssetAmount,
  AuthorizationContext,
  AuthorizedIntent,
  CallRule,
  SimulationEffect,
  SimulationReceipt,
  TransactionIntent,
  Verified,
  WalletCapability,
  WalletDescriptor,
} from "./types.js";

const authorizedIntents = new WeakSet<object>();

export function assertAuthorizedIntent(
  authorization: object,
): asserts authorization is AuthorizedIntent {
  if (!authorizedIntents.has(authorization)) {
    throw new WalletProtocolError(
      "CAPABILITY_DENIED",
      "Authorization must be returned by assertIntentWithinCapabilityStatic in this process.",
    );
  }
}

function sameKey(
  left: { key_id: string; public_key: string },
  right: { key_id: string; public_key: string },
): boolean {
  return left.key_id === right.key_id && left.public_key === right.public_key;
}

function assertReferences(
  descriptor: WalletDescriptor,
  capability: WalletCapability,
  intent: TransactionIntent,
  simulation: SimulationReceipt,
): void {
  if (
    capability.wallet_id !== descriptor.wallet_id
    || capability.descriptor_id !== descriptor.record_id
  ) {
    throw new WalletProtocolError("AUTHORITY_MISMATCH", "Capability is not bound to this wallet descriptor.");
  }
  if (!sameKey(capability.issuer, descriptor.authority)) {
    throw new WalletProtocolError("AUTHORITY_MISMATCH", "Capability issuer is not the descriptor authority.");
  }
  const descriptorAccounts = new Set(descriptor.accounts.map(({ account_id }) => account_id));
  if (capability.accounts.some((account) => !descriptorAccounts.has(account))) {
    throw new WalletProtocolError(
      "CAPABILITY_DENIED",
      "Capability grants a source account absent from the bound wallet descriptor.",
    );
  }
  if (
    intent.wallet_id !== descriptor.wallet_id
    || intent.descriptor_id !== descriptor.record_id
    || intent.grant_id !== capability.grant_id
    || intent.capability_record_id !== capability.record_id
  ) {
    throw new WalletProtocolError("CAPABILITY_DENIED", "Intent references do not bind the exact capability and descriptor.");
  }
  if (!sameKey(intent.delegate, capability.delegate)) {
    throw new WalletProtocolError("CAPABILITY_DENIED", "Intent delegate does not match the capability delegate.");
  }
  if (
    simulation.intent_id !== intent.intent_id
    || simulation.intent_record_id !== intent.record_id
    || simulation.chain_id !== intent.chain_id
    || simulation.source_account !== intent.source_account
  ) {
    throw new WalletProtocolError("SIMULATION_INVALID", "Simulation does not bind the exact intent, chain, and account.");
  }
}

function validateContext(context: AuthorizationContext): void {
  assertTimestamp(context.now, "authorization.now");
  if (!context.usage || typeof context.usage !== "object") invalid("authorization.usage is required.");
  if (
    !Number.isSafeInteger(context.usage.revocation_nonce)
    || context.usage.revocation_nonce < 0
    || !Number.isSafeInteger(context.usage.intent_count)
    || context.usage.intent_count < 0
  ) {
    invalid("Authorization counters must be non-negative safe integers.", "authorization.usage");
  }
  if (!Array.isArray(context.usage.spent)) invalid("authorization.usage.spent must be an array.");
  const assets: string[] = [];
  for (const [index, entry] of context.usage.spent.entries()) {
    if (!entry || typeof entry !== "object") invalid("Spent entries must be objects.", `authorization.usage.spent[${index}]`);
    assertCaip19(entry.asset_id, `authorization.usage.spent[${index}].asset_id`);
    assertAmount(entry.amount_atomic, `authorization.usage.spent[${index}].amount_atomic`);
    assets.push(entry.asset_id);
  }
  for (let index = 1; index < assets.length; index += 1) {
    if (assets[index - 1]! >= assets[index]!) invalid("Spent entries must be sorted and unique.", "authorization.usage.spent");
  }
  if (!Array.isArray(context.usage.host_verified_approval_ids)) {
    invalid("authorization.usage.host_verified_approval_ids must be an array.");
  }
  const approvals = [...context.usage.host_verified_approval_ids];
  for (const [index, approval] of approvals.entries()) {
    assertBoundedString(approval, `authorization.usage.host_verified_approval_ids[${index}]`, 256);
  }
  if (new Set(approvals).size !== approvals.length) {
    invalid("Host-verified approval identities must be distinct.", "authorization.usage.host_verified_approval_ids");
  }
}

function findRule(capability: WalletCapability, effect: {
  target_account: string;
  action: string;
  method: string | null;
}): CallRule | undefined {
  return capability.call_rules.find((rule) =>
    rule.target_account === effect.target_account
    && rule.actions.includes(effect.action as CallRule["actions"][number])
    && (effect.action === "transfer" || (effect.method !== null && rule.methods.includes(effect.method))));
}

function aggregateAssets(entries: readonly AssetAmount[]): Map<string, bigint> {
  const totals = new Map<string, bigint>();
  for (const entry of entries) {
    totals.set(entry.asset_id, (totals.get(entry.asset_id) ?? 0n) + BigInt(entry.amount_atomic));
  }
  return totals;
}

function effectAmounts(effects: readonly SimulationEffect[]): AssetAmount[] {
  return effects.flatMap((effect) => effect.asset_id === null
    ? []
    : [{ asset_id: effect.asset_id, amount_atomic: effect.amount_atomic }]);
}

function mapsEqual(left: Map<string, bigint>, right: Map<string, bigint>): boolean {
  if (left.size !== right.size) return false;
  for (const [key, value] of left) if (right.get(key) !== value) return false;
  return true;
}

function checkRules(
  capability: WalletCapability,
  intent: TransactionIntent,
  simulation: SimulationReceipt,
  approvalCount: number,
): void {
  for (const call of intent.calls) {
    const rule = findRule(capability, call);
    if (!rule) throw new WalletProtocolError("CAPABILITY_DENIED", "Intent call is outside the target/action/method allowlist.");
    if (rule.requires_approval && approvalCount < capability.approval_threshold) {
      throw new WalletProtocolError("CAPABILITY_DENIED", "Intent call requires more distinct host-verified approval IDs.");
    }
  }
  for (const effect of simulation.effects) {
    const rule = findRule(capability, effect);
    if (!rule) throw new WalletProtocolError("CAPABILITY_DENIED", "Simulation revealed an effect outside the allowlist.");
    if (rule.requires_approval && approvalCount < capability.approval_threshold) {
      throw new WalletProtocolError("CAPABILITY_DENIED", "Simulation effect requires more distinct host-verified approval IDs.");
    }
  }
}

function checkSpend(
  capability: WalletCapability,
  intent: TransactionIntent,
  simulation: SimulationReceipt,
  prior: readonly AssetAmount[],
): void {
  const declared = aggregateAssets(intent.declared_spends);
  const simulated = aggregateAssets(effectAmounts(simulation.effects));
  if (!mapsEqual(declared, simulated)) {
    throw new WalletProtocolError(
      "SIMULATION_INVALID",
      "Simulation-derived transfer/approval totals do not equal the intent declaration.",
    );
  }

  const nativeDeclared = aggregateAssets(
    intent.calls.flatMap((call) => call.native_value === null ? [] : [call.native_value]),
  );
  for (const [asset, amount] of nativeDeclared) {
    if ((declared.get(asset) ?? 0n) < amount) {
      throw new WalletProtocolError("CAPABILITY_DENIED", "Declared spend omits native value from an exact call.");
    }
  }

  const priorMap = aggregateAssets(prior);
  for (const [asset, amount] of simulated) {
    const limit = capability.spend_limits.find((candidate) => candidate.asset_id === asset);
    if (!limit) throw new WalletProtocolError("CAPABILITY_DENIED", `No spend limit grants asset ${asset}.`);
    if (amount > BigInt(limit.max_per_intent)) {
      throw new WalletProtocolError("CAPABILITY_DENIED", `Per-intent spend limit exceeded for ${asset}.`);
    }
    if ((priorMap.get(asset) ?? 0n) + amount > BigInt(limit.max_total)) {
      throw new WalletProtocolError("CAPABILITY_EXHAUSTED", `Cumulative spend limit exceeded for ${asset}.`);
    }
  }
}

function checkFee(capability: WalletCapability, intent: TransactionIntent, simulation: SimulationReceipt): void {
  const requested = BigInt(intent.max_fee.amount_atomic);
  const estimated = BigInt(simulation.estimated_fee.amount_atomic);
  if (
    intent.max_fee.asset_id !== simulation.estimated_fee.asset_id
    || estimated > requested
  ) {
    throw new WalletProtocolError("SIMULATION_INVALID", "Simulation fee exceeds or changes the intent fee bound.");
  }
  const limit = capability.fee_limits.find(({ asset_id }) => asset_id === intent.max_fee.asset_id);
  if (!limit || requested > BigInt(limit.max_per_intent)) {
    throw new WalletProtocolError("CAPABILITY_DENIED", "Intent fee is outside the capability fee limit.");
  }
}

/**
 * Checks only signed records and supplied durable usage state. It does not
 * decode chain payloads, verify adapter authority, reserve a budget, or lock a
 * database. Callers must do those things and repeat this check atomically at
 * sign time.
 */
export function assertIntentWithinCapabilityStatic(options: {
  descriptor: Verified<WalletDescriptor>;
  capability: Verified<WalletCapability>;
  intent: Verified<TransactionIntent>;
  simulation: Verified<SimulationReceipt>;
  context: AuthorizationContext;
}): Readonly<AuthorizedIntent> {
  assertVerifiedRecord(options.descriptor);
  assertVerifiedRecord(options.capability);
  assertVerifiedRecord(options.intent);
  assertVerifiedRecord(options.simulation);
  validateContext(options.context);
  assertReferences(options.descriptor, options.capability, options.intent, options.simulation);

  if (options.descriptor.custody_mode === "watch_only") {
    throw new WalletProtocolError("CAPABILITY_DENIED", "A watch-only descriptor cannot authorize signing.");
  }
  const now = timestampMs(options.context.now);
  if (now < timestampMs(options.capability.not_before) || now >= timestampMs(options.capability.expires_at)) {
    throw new WalletProtocolError("CAPABILITY_INACTIVE", "Capability is not active at sign time.");
  }
  if (
    timestampMs(options.capability.issued_at) < timestampMs(options.descriptor.created_at)
    || timestampMs(options.intent.issued_at) < timestampMs(options.capability.issued_at)
  ) {
    throw new WalletProtocolError("CAPABILITY_INACTIVE", "Descriptor, capability, and intent chronology is invalid.");
  }
  if (
    timestampMs(options.intent.issued_at) < timestampMs(options.capability.not_before)
    || timestampMs(options.intent.expires_at) > timestampMs(options.capability.expires_at)
    || now < timestampMs(options.intent.issued_at)
    || now >= timestampMs(options.intent.expires_at)
  ) {
    throw new WalletProtocolError("CAPABILITY_INACTIVE", "Intent lifetime is outside the active capability.");
  }
  if (
    timestampMs(options.simulation.simulated_at) < timestampMs(options.intent.issued_at)
    || now < timestampMs(options.simulation.simulated_at)
    || now >= timestampMs(options.simulation.valid_until)
  ) {
    throw new WalletProtocolError("SIMULATION_STALE", "Simulation is not current at sign time.");
  }
  if (!options.simulation.success) {
    throw new WalletProtocolError("SIMULATION_INVALID", "Simulation reverted or otherwise failed.");
  }
  if (options.context.usage.revocation_nonce !== options.capability.revocation_nonce) {
    throw new WalletProtocolError("CAPABILITY_REVOKED", "Capability revocation epoch is not current.");
  }
  if (options.context.usage.intent_count >= options.capability.max_intents) {
    throw new WalletProtocolError("CAPABILITY_EXHAUSTED", "Capability intent count is exhausted.");
  }
  if (!options.capability.accounts.includes(options.intent.source_account)) {
    throw new WalletProtocolError("CAPABILITY_DENIED", "Source account is not granted by the capability.");
  }
  checkRules(
    options.capability,
    options.intent,
    options.simulation,
    options.context.usage.host_verified_approval_ids.length,
  );
  checkSpend(options.capability, options.intent, options.simulation, options.context.usage.spent);
  checkFee(options.capability, options.intent, options.simulation);

  const authorization = Object.freeze({
    wallet_id: options.descriptor.wallet_id,
    grant_id: options.capability.grant_id,
    capability_record_id: options.capability.record_id,
    intent_record_id: options.intent.record_id,
    simulation_record_id: options.simulation.record_id,
    policy_hash: options.capability.policy_hash,
    checked_at: options.context.now,
  }) as AuthorizedIntent;
  authorizedIntents.add(authorization);
  return authorization;
}

export function assertAssetBelongsToSource(assetId: string, sourceAccount: string): void {
  assertCaip19(assetId, "asset_id");
  assertCaip10(sourceAccount, "source_account");
  if (chainFromAsset(assetId) !== sourceAccount.split(":").slice(0, 2).join(":")) {
    throw new WalletProtocolError("CAPABILITY_DENIED", "Asset and source account chains differ.");
  }
}
