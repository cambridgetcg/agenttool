import { sha256 } from "@noble/hashes/sha2.js";

import { base64UrlDecode, bytesToHex } from "./bytes.js";
import { snapshotJsonData } from "./canonical.js";
import { LIMITS, RECORD_SCHEMAS, WALLET_ACTIONS } from "./constants.js";
import { invalid, limit } from "./errors.js";
import {
  assertAmount,
  assertBoundedString,
  assertCaip10,
  assertCaip19,
  assertCaip2,
  assertEd25519PublicKey,
  assertEd25519Signature,
  assertMethod,
  assertSha256Id,
  assertTimestamp,
  assertUuid,
  chainFromAccount,
  chainFromAsset,
  keyIdForPublicKey,
  timestampMs,
} from "./identifiers.js";
import type {
  AssetAmount,
  CallRule,
  ContinuityEvent,
  ContinuityEventCore,
  Ed25519PublicKey,
  FeeLimit,
  IntentCall,
  RecordSignature,
  SignedRecordFields,
  SigningReceipt,
  SigningReceiptCore,
  SimulationEffect,
  SimulationReceipt,
  SimulationReceiptCore,
  SpendLimit,
  TransactionIntent,
  TransactionIntentCore,
  WalletAccount,
  WalletAction,
  WalletCapability,
  WalletCapabilityCore,
  WalletDescriptor,
  WalletDescriptorCore,
} from "./types.js";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown, label: string): UnknownRecord {
  const snapshot = snapshotJsonData(value);
  if (snapshot === null || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    invalid(`${label} must be a plain object.`, label);
  }
  const prototype = Object.getPrototypeOf(snapshot);
  if (prototype !== Object.prototype && prototype !== null) {
    invalid(`${label} must be a plain object.`, label);
  }
  return snapshot as UnknownRecord;
}

function exactKeys(value: UnknownRecord, required: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...required].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    invalid(`${label} must contain exactly: ${expected.join(", ")}.`, label);
  }
}

function array(value: unknown, label: string, min: number, max: number): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    invalid(`${label} must contain ${min}..${max} items.`, label);
  }
  return value;
}

function safeInteger(value: unknown, label: string, min: number, max: number): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    invalid(`${label} must be a safe integer from ${min} through ${max}.`, label);
  }
}

function boolean(value: unknown, label: string): asserts value is boolean {
  if (typeof value !== "boolean") invalid(`${label} must be boolean.`, label);
}

function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): asserts value is T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    invalid(`${label} must be one of: ${allowed.join(", ")}.`, label);
  }
}

function assertSortedUnique(values: readonly string[], label: string): void {
  for (let index = 1; index < values.length; index += 1) {
    if (values[index - 1]! >= values[index]!) {
      invalid(`${label} must be sorted and unique.`, label);
    }
  }
}

function assertTimeWindow(
  start: string,
  end: string,
  maxLifetimeMs: number,
  label: string,
): void {
  const lifetime = timestampMs(end) - timestampMs(start);
  if (lifetime <= 0 || lifetime > maxLifetimeMs) {
    invalid(`${label} must be positive and no longer than ${maxLifetimeMs}ms.`, label);
  }
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function frozenClone<T>(value: T): Readonly<T> {
  return deepFreeze(structuredClone(value));
}

function publicKey(value: unknown, label: string): Ed25519PublicKey {
  const item = record(value, label);
  exactKeys(item, ["algorithm", "key_id", "public_key"], label);
  if (item.algorithm !== "Ed25519") invalid(`${label}.algorithm must be Ed25519.`, `${label}.algorithm`);
  assertSha256Id(item.key_id, `${label}.key_id`);
  assertEd25519PublicKey(item.public_key, `${label}.public_key`);
  if (item.key_id !== keyIdForPublicKey(item.public_key)) {
    invalid(`${label}.key_id does not match public_key.`, `${label}.key_id`);
  }
  return item as unknown as Ed25519PublicKey;
}

function signature(value: unknown, label: string): RecordSignature {
  const item = record(value, label);
  exactKeys(item, ["algorithm", "value"], label);
  if (item.algorithm !== "Ed25519") invalid(`${label}.algorithm must be Ed25519.`, `${label}.algorithm`);
  assertEd25519Signature(item.value, `${label}.value`);
  return item as unknown as RecordSignature;
}

function signedFields(value: UnknownRecord, label: string): SignedRecordFields {
  assertSha256Id(value.record_id, `${label}.record_id`);
  return {
    record_id: value.record_id,
    signature: signature(value.signature, `${label}.signature`),
  };
}

function walletAccount(value: unknown, label: string): WalletAccount {
  const item = record(value, label);
  exactKeys(item, ["account_id", "account_kind"], label);
  assertCaip10(item.account_id, `${label}.account_id`);
  enumValue(item.account_kind, ["eoa", "smart_account", "program_account", "unknown"], `${label}.account_kind`);
  return item as unknown as WalletAccount;
}

function assetAmount(value: unknown, label: string): AssetAmount {
  const item = record(value, label);
  exactKeys(item, ["amount_atomic", "asset_id"], label);
  assertCaip19(item.asset_id, `${label}.asset_id`);
  assertAmount(item.amount_atomic, `${label}.amount_atomic`);
  return item as unknown as AssetAmount;
}

function callRule(value: unknown, label: string): CallRule {
  const item = record(value, label);
  exactKeys(item, ["actions", "methods", "requires_approval", "target_account"], label);
  assertCaip10(item.target_account, `${label}.target_account`);
  const actions = array(item.actions, `${label}.actions`, 1, WALLET_ACTIONS.length);
  for (const [index, action] of actions.entries()) {
    enumValue(action, WALLET_ACTIONS, `${label}.actions[${index}]`);
  }
  assertSortedUnique(actions as string[], `${label}.actions`);
  const methods = array(item.methods, `${label}.methods`, 0, 32);
  for (const [index, method] of methods.entries()) assertMethod(method, `${label}.methods[${index}]`);
  assertSortedUnique(methods as string[], `${label}.methods`);
  boolean(item.requires_approval, `${label}.requires_approval`);
  if ((actions as WalletAction[]).some((action) => action !== "transfer") && methods.length === 0) {
    invalid(`${label}.methods must explicitly bind call and approve actions.`, `${label}.methods`);
  }
  if ((actions as WalletAction[]).every((action) => action === "transfer") && methods.length !== 0) {
    invalid(`${label}.methods must be empty for a transfer-only rule.`, `${label}.methods`);
  }
  return item as unknown as CallRule;
}

function spendLimit(value: unknown, label: string): SpendLimit {
  const item = record(value, label);
  exactKeys(item, ["asset_id", "max_per_intent", "max_total"], label);
  assertCaip19(item.asset_id, `${label}.asset_id`);
  assertAmount(item.max_per_intent, `${label}.max_per_intent`);
  assertAmount(item.max_total, `${label}.max_total`);
  if (BigInt(item.max_total) < BigInt(item.max_per_intent)) {
    invalid(`${label}.max_total must be at least max_per_intent.`, `${label}.max_total`);
  }
  return item as unknown as SpendLimit;
}

function feeLimit(value: unknown, label: string): FeeLimit {
  const item = record(value, label);
  exactKeys(item, ["asset_id", "max_per_intent"], label);
  assertCaip19(item.asset_id, `${label}.asset_id`);
  assertAmount(item.max_per_intent, `${label}.max_per_intent`);
  return item as unknown as FeeLimit;
}

function assertAssetChains(items: readonly { asset_id: string }[], chainId: string, label: string): void {
  for (const [index, item] of items.entries()) {
    if (chainFromAsset(item.asset_id) !== chainId) {
      invalid(`${label}[${index}] belongs to a different chain.`, `${label}[${index}].asset_id`);
    }
  }
}

export function validateDescriptorCore(value: unknown): Readonly<WalletDescriptorCore> {
  const item = record(value, "descriptor");
  exactKeys(item, [
    "accounts", "authority", "created_at", "custody_mode", "owner_identity_id",
    "recovery_mode", "schema", "wallet_id",
  ], "descriptor");
  if (item.schema !== RECORD_SCHEMAS.descriptor) invalid("descriptor.schema is unsupported.", "descriptor.schema");
  assertUuid(item.wallet_id, "descriptor.wallet_id");
  assertBoundedString(item.owner_identity_id, "descriptor.owner_identity_id");
  publicKey(item.authority, "descriptor.authority");
  enumValue(item.custody_mode, [
    "self_custodied", "delegated_signer", "platform_custodied", "watch_only",
  ], "descriptor.custody_mode");
  const accounts = array(item.accounts, "descriptor.accounts", 1, LIMITS.max_accounts)
    .map((account, index) => walletAccount(account, `descriptor.accounts[${index}]`));
  assertSortedUnique(accounts.map(({ account_id }) => account_id), "descriptor.accounts");
  enumValue(item.recovery_mode, ["none", "owner_rotation", "guardian", "provider"], "descriptor.recovery_mode");
  assertTimestamp(item.created_at, "descriptor.created_at");
  return frozenClone(item as unknown as WalletDescriptorCore);
}

export function validateWalletDescriptor(value: unknown): Readonly<WalletDescriptor> {
  const item = record(value, "descriptor");
  exactKeys(item, [
    "accounts", "authority", "created_at", "custody_mode", "owner_identity_id",
    "record_id", "recovery_mode", "schema", "signature", "wallet_id",
  ], "descriptor");
  const { record_id: _recordId, signature: _signature, ...core } = item;
  validateDescriptorCore(core);
  signedFields(item, "descriptor");
  return frozenClone(item as unknown as WalletDescriptor);
}

export function validateCapabilityCore(value: unknown): Readonly<WalletCapabilityCore> {
  const item = record(value, "capability");
  exactKeys(item, [
    "accounts", "approval_threshold", "call_rules", "delegate", "descriptor_id",
    "expires_at", "fee_limits", "grant_id", "issued_at", "issuer", "max_intents",
    "not_before", "policy_hash", "purpose", "revocation_nonce", "schema",
    "spend_limits", "wallet_id",
  ], "capability");
  if (item.schema !== RECORD_SCHEMAS.capability) invalid("capability.schema is unsupported.", "capability.schema");
  assertUuid(item.grant_id, "capability.grant_id");
  assertUuid(item.wallet_id, "capability.wallet_id");
  assertSha256Id(item.descriptor_id, "capability.descriptor_id");
  publicKey(item.issuer, "capability.issuer");
  publicKey(item.delegate, "capability.delegate");
  const accounts = array(item.accounts, "capability.accounts", 1, LIMITS.max_accounts);
  for (const [index, account] of accounts.entries()) assertCaip10(account, `capability.accounts[${index}]`);
  assertSortedUnique(accounts as string[], "capability.accounts");
  const chains = new Set((accounts as string[]).map(chainFromAccount));
  const rules = array(item.call_rules, "capability.call_rules", 1, LIMITS.max_call_rules)
    .map((rule, index) => callRule(rule, `capability.call_rules[${index}]`));
  const ruleKeys = rules.map((rule) => `${rule.target_account}\0${rule.actions.join(",")}\0${rule.methods.join(",")}`);
  assertSortedUnique(ruleKeys, "capability.call_rules");
  for (const [index, rule] of rules.entries()) {
    if (!chains.has(chainFromAccount(rule.target_account))) {
      invalid("Call rule target chain is not granted by accounts.", `capability.call_rules[${index}].target_account`);
    }
  }
  const spend = array(item.spend_limits, "capability.spend_limits", 0, LIMITS.max_spend_limits)
    .map((entry, index) => spendLimit(entry, `capability.spend_limits[${index}]`));
  assertSortedUnique(spend.map(({ asset_id }) => asset_id), "capability.spend_limits");
  const fees = array(item.fee_limits, "capability.fee_limits", 1, LIMITS.max_fee_limits)
    .map((entry, index) => feeLimit(entry, `capability.fee_limits[${index}]`));
  assertSortedUnique(fees.map(({ asset_id }) => asset_id), "capability.fee_limits");
  for (const [index, entry] of [...spend, ...fees].entries()) {
    if (!chains.has(chainFromAsset(entry.asset_id))) {
      invalid("Asset limit chain is not granted by accounts.", `capability.asset_limits[${index}]`);
    }
  }
  safeInteger(item.max_intents, "capability.max_intents", 1, LIMITS.max_intents);
  safeInteger(item.approval_threshold, "capability.approval_threshold", 0, 16);
  if (rules.some(({ requires_approval }) => requires_approval) && item.approval_threshold === 0) {
    invalid("Approval-gated rules require a positive approval_threshold.", "capability.approval_threshold");
  }
  assertTimestamp(item.issued_at, "capability.issued_at");
  assertTimestamp(item.not_before, "capability.not_before");
  assertTimestamp(item.expires_at, "capability.expires_at");
  if (timestampMs(item.not_before) < timestampMs(item.issued_at)) {
    invalid("capability.not_before must not precede issued_at.", "capability.not_before");
  }
  assertTimeWindow(item.not_before, item.expires_at, LIMITS.max_capability_lifetime_ms, "capability lifetime");
  safeInteger(item.revocation_nonce, "capability.revocation_nonce", 0, Number.MAX_SAFE_INTEGER);
  assertSha256Id(item.policy_hash, "capability.policy_hash");
  assertBoundedString(item.purpose, "capability.purpose", 512);
  return frozenClone(item as unknown as WalletCapabilityCore);
}

export function validateWalletCapability(value: unknown): Readonly<WalletCapability> {
  const item = record(value, "capability");
  const keys = [
    "accounts", "approval_threshold", "call_rules", "delegate", "descriptor_id",
    "expires_at", "fee_limits", "grant_id", "issued_at", "issuer", "max_intents",
    "not_before", "policy_hash", "purpose", "record_id", "revocation_nonce", "schema",
    "signature", "spend_limits", "wallet_id",
  ];
  exactKeys(item, keys, "capability");
  const { record_id: _recordId, signature: _signature, ...core } = item;
  validateCapabilityCore(core);
  signedFields(item, "capability");
  return frozenClone(item as unknown as WalletCapability);
}

function intentCall(value: unknown, label: string, chainId: string): IntentCall {
  const item = record(value, label);
  exactKeys(item, [
    "action", "method", "native_value", "payload_b64u", "payload_hash", "target_account",
  ], label);
  enumValue(item.action, WALLET_ACTIONS, `${label}.action`);
  assertCaip10(item.target_account, `${label}.target_account`);
  if (chainFromAccount(item.target_account) !== chainId) {
    invalid(`${label}.target_account belongs to a different chain.`, `${label}.target_account`);
  }
  if (item.action === "transfer") {
    if (item.method !== null || item.payload_b64u !== "") {
      invalid(`${label} transfer must have null method and empty payload.`, label);
    }
  } else {
    assertMethod(item.method, `${label}.method`);
    if (typeof item.payload_b64u !== "string" || item.payload_b64u.length === 0) {
      invalid(`${label}.payload_b64u must be non-empty for call/approve.`, `${label}.payload_b64u`);
    }
  }
  if (typeof item.payload_b64u !== "string") invalid(`${label}.payload_b64u must be base64url.`, `${label}.payload_b64u`);
  const payload = base64UrlDecode(item.payload_b64u, `${label}.payload_b64u`);
  if (payload.byteLength > LIMITS.max_payload_bytes) limit(`${label}.payload_b64u is too large.`, `${label}.payload_b64u`);
  assertSha256Id(item.payload_hash, `${label}.payload_hash`);
  const actualHash = `sha256:${bytesToHex(sha256(payload))}`;
  if (item.payload_hash !== actualHash) invalid(`${label}.payload_hash does not match payload_b64u.`, `${label}.payload_hash`);
  if (item.native_value !== null) {
    const amount = assetAmount(item.native_value, `${label}.native_value`);
    assertAssetChains([amount], chainId, `${label}.native_value`);
  }
  return item as unknown as IntentCall;
}

export function validateIntentCore(value: unknown): Readonly<TransactionIntentCore> {
  const item = record(value, "intent");
  exactKeys(item, [
    "calls", "capability_record_id", "chain_id", "declared_spends", "delegate",
    "descriptor_id", "expires_at", "grant_id", "intent_id", "issued_at", "max_fee",
    "nonce", "schema", "source_account", "wallet_id",
  ], "intent");
  if (item.schema !== RECORD_SCHEMAS.intent) invalid("intent.schema is unsupported.", "intent.schema");
  assertUuid(item.intent_id, "intent.intent_id");
  assertUuid(item.wallet_id, "intent.wallet_id");
  assertSha256Id(item.descriptor_id, "intent.descriptor_id");
  assertUuid(item.grant_id, "intent.grant_id");
  assertSha256Id(item.capability_record_id, "intent.capability_record_id");
  publicKey(item.delegate, "intent.delegate");
  assertCaip2(item.chain_id, "intent.chain_id");
  assertCaip10(item.source_account, "intent.source_account");
  if (chainFromAccount(item.source_account) !== item.chain_id) {
    invalid("intent.source_account does not belong to chain_id.", "intent.source_account");
  }
  array(item.calls, "intent.calls", 1, LIMITS.max_calls_per_intent)
    .forEach((call, index) => intentCall(call, `intent.calls[${index}]`, item.chain_id as string));
  const spends = array(item.declared_spends, "intent.declared_spends", 0, LIMITS.max_spend_limits)
    .map((entry, index) => assetAmount(entry, `intent.declared_spends[${index}]`));
  assertSortedUnique(spends.map(({ asset_id }) => asset_id), "intent.declared_spends");
  assertAssetChains(spends, item.chain_id as string, "intent.declared_spends");
  const fee = assetAmount(item.max_fee, "intent.max_fee");
  assertAssetChains([fee], item.chain_id as string, "intent.max_fee");
  assertTimestamp(item.issued_at, "intent.issued_at");
  assertTimestamp(item.expires_at, "intent.expires_at");
  assertTimeWindow(item.issued_at, item.expires_at, LIMITS.max_intent_lifetime_ms, "intent lifetime");
  assertBoundedString(item.nonce, "intent.nonce", 256);
  return frozenClone(item as unknown as TransactionIntentCore);
}

export function validateTransactionIntent(value: unknown): Readonly<TransactionIntent> {
  const item = record(value, "intent");
  exactKeys(item, [
    "calls", "capability_record_id", "chain_id", "declared_spends", "delegate",
    "descriptor_id", "expires_at", "grant_id", "intent_id", "issued_at", "max_fee",
    "nonce", "record_id", "schema", "signature", "source_account", "wallet_id",
  ], "intent");
  const { record_id: _recordId, signature: _signature, ...core } = item;
  validateIntentCore(core);
  signedFields(item, "intent");
  return frozenClone(item as unknown as TransactionIntent);
}

function simulationEffect(value: unknown, label: string, chainId: string): SimulationEffect {
  const item = record(value, label);
  exactKeys(item, ["action", "amount_atomic", "asset_id", "method", "target_account"], label);
  enumValue(item.action, WALLET_ACTIONS, `${label}.action`);
  assertCaip10(item.target_account, `${label}.target_account`);
  if (chainFromAccount(item.target_account) !== chainId) {
    invalid(`${label}.target_account belongs to a different chain.`, `${label}.target_account`);
  }
  assertAmount(item.amount_atomic, `${label}.amount_atomic`);
  if (item.action === "call") {
    assertMethod(item.method, `${label}.method`);
    if (item.asset_id !== null || item.amount_atomic !== "0") {
      invalid(`${label} call effects must have null asset_id and zero amount.`, label);
    }
  } else {
    if (item.action === "transfer" && item.method !== null) {
      invalid(`${label} transfer effects must have null method.`, `${label}.method`);
    }
    if (item.action === "approve") assertMethod(item.method, `${label}.method`);
    assertCaip19(item.asset_id, `${label}.asset_id`);
    if (chainFromAsset(item.asset_id) !== chainId) {
      invalid(`${label} asset effect must belong to chain_id.`, label);
    }
    if (item.action === "transfer" && BigInt(item.amount_atomic as string) === 0n) {
      invalid(`${label} transfer effect must be positive.`, label);
    }
  }
  return item as unknown as SimulationEffect;
}

export function validateSimulationCore(value: unknown): Readonly<SimulationReceiptCore> {
  const item = record(value, "simulation");
  exactKeys(item, [
    "adapter", "block_hash", "block_ref", "chain_id", "effects", "estimated_fee",
    "intent_id", "intent_record_id", "schema", "simulated_at", "simulation_id",
    "source_account", "success", "valid_until",
  ], "simulation");
  if (item.schema !== RECORD_SCHEMAS.simulation) invalid("simulation.schema is unsupported.", "simulation.schema");
  assertUuid(item.simulation_id, "simulation.simulation_id");
  assertUuid(item.intent_id, "simulation.intent_id");
  assertSha256Id(item.intent_record_id, "simulation.intent_record_id");
  assertCaip2(item.chain_id, "simulation.chain_id");
  assertCaip10(item.source_account, "simulation.source_account");
  if (chainFromAccount(item.source_account) !== item.chain_id) {
    invalid("simulation.source_account does not belong to chain_id.", "simulation.source_account");
  }
  publicKey(item.adapter, "simulation.adapter");
  assertBoundedString(item.block_ref, "simulation.block_ref", 512);
  if (item.block_hash !== null) assertBoundedString(item.block_hash, "simulation.block_hash", 512);
  boolean(item.success, "simulation.success");
  array(item.effects, "simulation.effects", 0, LIMITS.max_effects_per_simulation)
    .forEach((effect, index) => simulationEffect(effect, `simulation.effects[${index}]`, item.chain_id as string));
  const fee = assetAmount(item.estimated_fee, "simulation.estimated_fee");
  assertAssetChains([fee], item.chain_id as string, "simulation.estimated_fee");
  assertTimestamp(item.simulated_at, "simulation.simulated_at");
  assertTimestamp(item.valid_until, "simulation.valid_until");
  assertTimeWindow(item.simulated_at, item.valid_until, LIMITS.max_simulation_lifetime_ms, "simulation lifetime");
  return frozenClone(item as unknown as SimulationReceiptCore);
}

export function validateSimulationReceipt(value: unknown): Readonly<SimulationReceipt> {
  const item = record(value, "simulation");
  exactKeys(item, [
    "adapter", "block_hash", "block_ref", "chain_id", "effects", "estimated_fee",
    "intent_id", "intent_record_id", "record_id", "schema", "signature", "simulated_at",
    "simulation_id", "source_account", "success", "valid_until",
  ], "simulation");
  const { record_id: _recordId, signature: _signature, ...core } = item;
  validateSimulationCore(core);
  signedFields(item, "simulation");
  return frozenClone(item as unknown as SimulationReceipt);
}

export function validateSigningReceiptCore(value: unknown): Readonly<SigningReceiptCore> {
  const item = record(value, "signing_receipt");
  exactKeys(item, [
    "capability_record_id", "descriptor_id", "grant_id", "intent_id", "intent_record_id",
    "operation_id", "policy_hash", "receipt_authority", "receipt_id", "request_id",
    "schema", "signed_at", "signed_payload_hash", "signer_key_id", "simulation_record_id",
    "source_account", "unsigned_payload_hash", "wallet_id",
  ], "signing_receipt");
  if (item.schema !== RECORD_SCHEMAS.signing_receipt) {
    invalid("signing_receipt.schema is unsupported.", "signing_receipt.schema");
  }
  for (const field of ["receipt_id", "request_id", "wallet_id", "grant_id", "intent_id"] as const) {
    assertUuid(item[field], `signing_receipt.${field}`);
  }
  for (const field of [
    "descriptor_id", "capability_record_id", "intent_record_id", "simulation_record_id",
    "signer_key_id", "unsigned_payload_hash", "signed_payload_hash", "policy_hash",
  ] as const) {
    assertSha256Id(item[field], `signing_receipt.${field}`);
  }
  assertCaip10(item.source_account, "signing_receipt.source_account");
  publicKey(item.receipt_authority, "signing_receipt.receipt_authority");
  if (item.operation_id !== null) assertBoundedString(item.operation_id, "signing_receipt.operation_id", 512);
  assertTimestamp(item.signed_at, "signing_receipt.signed_at");
  return frozenClone(item as unknown as SigningReceiptCore);
}

export function validateSigningReceipt(value: unknown): Readonly<SigningReceipt> {
  const item = record(value, "signing_receipt");
  exactKeys(item, [
    "capability_record_id", "descriptor_id", "grant_id", "intent_id", "intent_record_id",
    "operation_id", "policy_hash", "receipt_authority", "receipt_id", "record_id", "request_id",
    "schema", "signature", "signed_at", "signed_payload_hash", "signer_key_id",
    "simulation_record_id", "source_account", "unsigned_payload_hash", "wallet_id",
  ], "signing_receipt");
  const { record_id: _recordId, signature: _signature, ...core } = item;
  validateSigningReceiptCore(core);
  signedFields(item, "signing_receipt");
  return frozenClone(item as unknown as SigningReceipt);
}

export function validateContinuityCore(value: unknown): Readonly<ContinuityEventCore> {
  const item = record(value, "continuity");
  exactKeys(item, [
    "actor", "effective_at", "event_id", "event_kind", "next_value", "previous_record_id",
    "previous_value", "reason", "revocation_nonce", "schema", "sequence", "wallet_id",
  ], "continuity");
  if (item.schema !== RECORD_SCHEMAS.continuity) invalid("continuity.schema is unsupported.", "continuity.schema");
  assertUuid(item.event_id, "continuity.event_id");
  assertUuid(item.wallet_id, "continuity.wallet_id");
  safeInteger(item.sequence, "continuity.sequence", 1, Number.MAX_SAFE_INTEGER);
  if (item.previous_record_id !== null) assertSha256Id(item.previous_record_id, "continuity.previous_record_id");
  if (item.sequence === 1 && item.previous_record_id !== null) {
    invalid("Continuity genesis must have a null previous_record_id.", "continuity.previous_record_id");
  }
  if (item.sequence > 1 && item.previous_record_id === null) {
    invalid("Non-genesis continuity requires previous_record_id.", "continuity.previous_record_id");
  }
  enumValue(item.event_kind, [
    "authority_rotated", "signer_rotated", "capability_revoked", "recovery_changed", "account_migrated",
  ], "continuity.event_kind");
  if (item.previous_value !== null) assertBoundedString(item.previous_value, "continuity.previous_value", 512);
  if (item.next_value !== null) assertBoundedString(item.next_value, "continuity.next_value", 512);
  if (item.event_kind === "capability_revoked") {
    if (item.previous_value !== null || item.next_value !== null) {
      invalid("capability_revoked uses revocation_nonce and null value fields.", "continuity");
    }
  } else if (
    item.previous_value === null
    || item.next_value === null
    || item.previous_value === item.next_value
  ) {
    invalid("Continuity rotation/migration values must be present and different.", "continuity");
  }
  if (item.event_kind === "authority_rotated" || item.event_kind === "signer_rotated") {
    assertSha256Id(item.previous_value, "continuity.previous_value");
    assertSha256Id(item.next_value, "continuity.next_value");
  }
  if (item.event_kind === "recovery_changed") {
    enumValue(item.previous_value, ["none", "owner_rotation", "guardian", "provider"], "continuity.previous_value");
    enumValue(item.next_value, ["none", "owner_rotation", "guardian", "provider"], "continuity.next_value");
  }
  if (item.event_kind === "account_migrated") {
    assertCaip10(item.previous_value, "continuity.previous_value");
    assertCaip10(item.next_value, "continuity.next_value");
  }
  safeInteger(item.revocation_nonce, "continuity.revocation_nonce", 0, Number.MAX_SAFE_INTEGER);
  publicKey(item.actor, "continuity.actor");
  assertBoundedString(item.reason, "continuity.reason", 512);
  assertTimestamp(item.effective_at, "continuity.effective_at");
  return frozenClone(item as unknown as ContinuityEventCore);
}

export function validateContinuityEvent(value: unknown): Readonly<ContinuityEvent> {
  const item = record(value, "continuity");
  exactKeys(item, [
    "actor", "effective_at", "event_id", "event_kind", "next_value", "previous_record_id",
    "previous_value", "reason", "record_id", "revocation_nonce", "schema", "sequence",
    "signature", "wallet_id",
  ], "continuity");
  const { record_id: _recordId, signature: _signature, ...core } = item;
  validateContinuityCore(core);
  signedFields(item, "continuity");
  return frozenClone(item as unknown as ContinuityEvent);
}

export function unsignedRecord<T extends SignedRecordFields>(value: T): Omit<T, keyof SignedRecordFields> {
  const { record_id: _recordId, signature: _signature, ...core } = value;
  return core;
}
