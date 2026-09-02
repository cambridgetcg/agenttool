import {
  canonicalJson,
  decodeFixedBase64Url,
  keyIdForPublicKey,
  sha256BytesId,
  type Sha256Id,
} from "@agenttool/wallet";
import {
  getZeroneProfile,
  assertZeroneAccountId,
  assertSecp256k1PublicKey,
  type ZeroneAccountId,
  type ZeroneCaip2,
} from "@agenttool/wallet-zerone";
import type { TreasuryPurpose } from "@agenttool/zerone-agent-economy";

import {
  ACTIVATION_CURRENTNESS_HASH_DOMAIN,
  BINDING_CURRENTNESS_HASH_DOMAIN,
  BINDING_CURRENTNESS_VERIFIER_TRUST_HASH_DOMAIN,
  SIMULATION_ADAPTER_TRUST_HASH_DOMAIN,
  TREASURY_PURPOSES,
} from "./constants.js";
import { fail } from "./errors.js";
import type {
  BindingCurrentnessAssertion,
  BindingCurrentnessAssertionCore,
  CreateTrustedBindingCurrentnessVerifierAssertionInput,
  CreateTrustedSimulationAdapterAssertionInput,
  CreateZeroneEconomyActivationCurrentnessAssertionInput,
  CreateBindingCurrentnessAssertionInput,
  TrustedSimulationAdapterAssertion,
  TrustedSimulationAdapterAssertionCore,
  TrustedBindingCurrentnessVerifierAssertion,
  TrustedBindingCurrentnessVerifierAssertionCore,
  ZeroneEconomyActivationCurrentnessAssertion,
  ZeroneEconomyActivationCurrentnessAssertionCore,
  ZeroneAccountSnapshot,
} from "./types.js";

const UINT64_MAX = (1n << 64n) - 1n;
const SHA256_ID = /^sha256:[0-9a-f]{64}$/u;
const TX_HASH = /^[0-9A-F]{64}$/u;
const BLOCK_HASH = /^[0-9A-F]{64}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const UTF8 = new TextEncoder();
const CURRENTNESS_CORE_KEYS = [
  "binding_revision",
  "binding_id",
  "currentness",
  "effects_performed",
  "external_verification_id",
  "format",
  "identity_authority",
  "identity_root_observation_id",
  "lifecycle_status",
  "owner_identity_id",
  "proof_id",
  "valid_until",
  "verified_at",
  "verifier_id",
  "wallet_continuity_observation_id",
  "wallet_continuity_sequence",
  "wallet_descriptor_id",
  "wallet_descriptor_observation_id",
  "wallet_id",
  "wallet_revocation_nonce",
] as const;
const ACTIVATION_CURRENTNESS_CORE_KEYS = [
  "activation_observation_hash", "block_hash", "chain_id", "cosmos_sdk",
  "currentness", "effects_performed", "external_verification_id", "format",
  "knowledge_consensus_version", "network", "observed_at_height",
  "sponsorship_consensus_version", "valid_until", "verified_at", "verifier_id",
  "zerone_core_commit",
] as const;
const BINDING_CURRENTNESS_VERIFIER_TRUST_CORE_KEYS = [
  "effects_performed", "external_verification_id", "format", "trust",
  "valid_until", "verified_at", "verifier_id",
] as const;
const SIMULATION_ADAPTER_TRUST_CORE_KEYS = [
  "adapter", "chain_id", "effects_performed", "external_verification_id",
  "format", "trust", "valid_until", "verified_at", "verifier_id",
] as const;
const ACCOUNT_SNAPSHOT_KEYS = [
  "account", "account_number", "balance_uzrn", "block_hash", "chain_id",
  "observed_at", "observed_at_height", "public_key_b64u",
  "public_key_type_url", "sequence", "valid_until",
] as const;

export function assertSha256Id(value: unknown, label: string): asserts value is Sha256Id {
  if (typeof value !== "string" || !SHA256_ID.test(value)) {
    fail("invalid_input", `${label} must be sha256:<64 lowercase hexadecimal characters>`);
  }
}

export function assertTxHash(value: unknown, label = "tx_hash"): asserts value is string {
  if (typeof value !== "string" || !TX_HASH.test(value)) {
    fail("invalid_input", `${label} must be 64 uppercase hexadecimal characters`);
  }
}

export function assertBlockHash(value: unknown, label = "block_hash"): asserts value is string {
  if (typeof value !== "string" || !BLOCK_HASH.test(value)) {
    fail("invalid_input", `${label} must be 64 uppercase hexadecimal characters`);
  }
}

export function assertIdentifier(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) {
    fail("invalid_input", `${label} must be a bounded identifier`);
  }
}

export function parseUint64(value: unknown, label: string, positive = false): bigint {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,19})$/u.test(value)) {
    fail("invalid_input", `${label} must be a canonical uint64 decimal string`);
  }
  const parsed = BigInt(value);
  if (parsed > UINT64_MAX || (positive && parsed === 0n)) {
    fail("invalid_input", `${label} is outside uint64`);
  }
  return parsed;
}

export function assertCount(value: unknown, label: string, positive = false): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < (positive ? 1 : 0)) {
    fail("invalid_input", `${label} must be a ${positive ? "positive" : "non-negative"} safe integer`);
  }
}

export function assertTimestamp(value: unknown, label: string): asserts value is string {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  if (
    typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
    || !Number.isFinite(parsed)
    || new Date(parsed).toISOString() !== value
  ) {
    fail("invalid_input", `${label} must be a canonical millisecond UTC timestamp`);
  }
}

export function assertPurpose(value: unknown, label: string): asserts value is TreasuryPurpose {
  if (typeof value !== "string" || !(TREASURY_PURPOSES as readonly string[]).includes(value)) {
    fail("invalid_input", `${label} is not a supported treasury purpose`);
  }
}

function closedDataSnapshot(
  value: unknown,
  expectedKeys: readonly string[],
  label: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("invalid_input", `${label} must be a plain data object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail("invalid_input", `${label} must be a plain data object`);
  }
  let descriptors: PropertyDescriptorMap;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    fail("invalid_input", `${label} properties could not be snapshotted`);
  }
  const ownKeys = Reflect.ownKeys(descriptors);
  if (ownKeys.some((key) => typeof key !== "string")) {
    fail("invalid_input", `${label} must contain only string-named fields`);
  }
  const actual = (ownKeys as string[]).sort();
  const expected = [...expectedKeys].sort();
  if (
    actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])
  ) {
    fail("invalid_input", `${label} must contain only the closed data field set`);
  }
  const snapshot: Record<string, unknown> = {};
  for (const key of expectedKeys) {
    const descriptor = descriptors[key];
    if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) {
      fail("invalid_input", `${label} fields must be enumerable data properties`);
    }
    snapshot[key] = descriptor.value;
  }
  return snapshot;
}

function currentnessId(core: BindingCurrentnessAssertionCore): Sha256Id {
  return sha256BytesId(UTF8.encode(
    `${BINDING_CURRENTNESS_HASH_DOMAIN}\0${canonicalJson(core)}`,
  ));
}

export function validateBindingCurrentnessAssertion(
  value: BindingCurrentnessAssertion,
): BindingCurrentnessAssertion {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("invalid_input", "Binding currentness assertion must be an object");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail("invalid_input", "Binding currentness assertion must be a plain data object");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const ownKeys = Reflect.ownKeys(descriptors);
  if (ownKeys.some((key) => typeof key !== "string")) {
    fail("invalid_input", "Binding currentness assertion must contain only string-named fields");
  }
  const actualKeys = (ownKeys as string[]).sort();
  const expectedKeys = [...CURRENTNESS_CORE_KEYS, "currentness_id"].sort();
  if (
    actualKeys.length !== expectedKeys.length
    || actualKeys.some((key, index) => key !== expectedKeys[index])
    || actualKeys.some((key) => {
      const descriptor = descriptors[key];
      return descriptor === undefined
        || !("value" in descriptor)
        || descriptor.enumerable !== true;
    })
  ) {
    fail("invalid_input", "Binding currentness assertion must contain only the closed data field set");
  }
  const snapshot = Object.fromEntries(actualKeys.map((key) => [
    key,
    (descriptors[key] as PropertyDescriptor & { value: unknown }).value,
  ])) as unknown as BindingCurrentnessAssertion;
  const identityAuthority = closedDataSnapshot(
    snapshot.identity_authority,
    ["algorithm", "key_id", "public_key"],
    "Binding currentness identity authority",
  ) as unknown as BindingCurrentnessAssertion["identity_authority"];
  if (
    snapshot.format !== "agenttool.zerone-binding-currentness-assertion/0.2"
    || snapshot.currentness !== "attested_by_configured_identity_wallet_resolver"
    || snapshot.lifecycle_status !== "active"
    || snapshot.effects_performed !== false
    || identityAuthority.algorithm !== "Ed25519"
  ) {
    fail("invalid_input", "Binding currentness assertion boundary is invalid");
  }
  assertSha256Id(snapshot.currentness_id, "currentness.currentness_id");
  assertSha256Id(snapshot.external_verification_id, "currentness.external_verification_id");
  assertSha256Id(snapshot.binding_id, "currentness.binding_id");
  assertSha256Id(snapshot.proof_id, "currentness.proof_id");
  assertIdentifier(snapshot.owner_identity_id, "currentness.owner_identity_id");
  assertIdentifier(snapshot.wallet_id, "currentness.wallet_id");
  assertSha256Id(snapshot.wallet_descriptor_id, "currentness.wallet_descriptor_id");
  assertSha256Id(identityAuthority.key_id, "currentness.identity_authority.key_id");
  if (typeof identityAuthority.public_key !== "string") {
    fail("invalid_input", "Binding currentness identity authority public key is invalid");
  }
  decodeFixedBase64Url(
    identityAuthority.public_key,
    32,
    "currentness.identity_authority.public_key",
  );
  if (identityAuthority.key_id !== keyIdForPublicKey(identityAuthority.public_key)) {
    fail("invalid_input", "Binding currentness identity authority key ID does not match");
  }
  assertCount(snapshot.binding_revision, "currentness.binding_revision", true);
  assertCount(
    snapshot.wallet_continuity_sequence,
    "currentness.wallet_continuity_sequence",
  );
  assertSha256Id(
    snapshot.identity_root_observation_id,
    "currentness.identity_root_observation_id",
  );
  assertSha256Id(
    snapshot.wallet_descriptor_observation_id,
    "currentness.wallet_descriptor_observation_id",
  );
  assertSha256Id(
    snapshot.wallet_continuity_observation_id,
    "currentness.wallet_continuity_observation_id",
  );
  assertIdentifier(snapshot.verifier_id, "currentness.verifier_id");
  boundedFreshnessInterval(snapshot.verified_at, snapshot.valid_until, "currentness");
  assertCount(snapshot.wallet_revocation_nonce, "currentness.wallet_revocation_nonce");
  const { currentness_id: suppliedId, ...coreValue } = snapshot;
  const core = Object.freeze({
    ...coreValue,
    identity_authority: Object.freeze({ ...identityAuthority }),
  }) as BindingCurrentnessAssertionCore;
  if (suppliedId !== currentnessId(core)) {
    fail("invalid_input", "currentness_id does not match the canonical assertion core");
  }
  return Object.freeze({ ...core, currentness_id: suppliedId });
}

export function createBindingCurrentnessAssertion(
  input: CreateBindingCurrentnessAssertionInput,
): BindingCurrentnessAssertion {
  const core: BindingCurrentnessAssertionCore = Object.freeze({
    format: "agenttool.zerone-binding-currentness-assertion/0.2",
    external_verification_id: input.external_verification_id,
    binding_id: input.binding_id,
    proof_id: input.proof_id,
    owner_identity_id: input.owner_identity_id,
    wallet_id: input.wallet_id,
    wallet_descriptor_id: input.wallet_descriptor_id,
    identity_authority: Object.freeze({ ...input.identity_authority }),
    binding_revision: input.binding_revision,
    wallet_continuity_sequence: input.wallet_continuity_sequence,
    identity_root_observation_id: input.identity_root_observation_id,
    wallet_descriptor_observation_id: input.wallet_descriptor_observation_id,
    wallet_continuity_observation_id: input.wallet_continuity_observation_id,
    verifier_id: input.verifier_id,
    verified_at: input.verified_at,
    valid_until: input.valid_until,
    wallet_revocation_nonce: input.wallet_revocation_nonce,
    lifecycle_status: "active",
    currentness: "attested_by_configured_identity_wallet_resolver",
    effects_performed: false,
  });
  return validateBindingCurrentnessAssertion({
    ...core,
    currentness_id: currentnessId(core),
  });
}

function trustedBindingCurrentnessVerifierId(
  core: TrustedBindingCurrentnessVerifierAssertionCore,
): Sha256Id {
  return sha256BytesId(UTF8.encode(
    `${BINDING_CURRENTNESS_VERIFIER_TRUST_HASH_DOMAIN}\0${canonicalJson(core)}`,
  ));
}

export function validateTrustedBindingCurrentnessVerifierAssertion(
  value: TrustedBindingCurrentnessVerifierAssertion,
): TrustedBindingCurrentnessVerifierAssertion {
  const item = closedDataSnapshot(
    value,
    [...BINDING_CURRENTNESS_VERIFIER_TRUST_CORE_KEYS, "trust_id"],
    "Binding currentness verifier trust assertion",
  ) as unknown as TrustedBindingCurrentnessVerifierAssertion;
  if (
    item.format !== "agenttool.zerone-binding-currentness-verifier-trust/0.1"
    || item.trust !== "configured_host_allowlist"
    || item.effects_performed !== false
  ) {
    fail("invalid_input", "Binding currentness verifier trust boundary is invalid");
  }
  assertSha256Id(item.trust_id, "binding_verifier_trust.trust_id");
  assertSha256Id(
    item.external_verification_id,
    "binding_verifier_trust.external_verification_id",
  );
  assertIdentifier(item.verifier_id, "binding_verifier_trust.verifier_id");
  boundedFreshnessInterval(
    item.verified_at,
    item.valid_until,
    "binding_verifier_trust",
    MAX_TRUST_EPOCH_LIFETIME_MS,
  );
  const { trust_id: suppliedId, ...coreValue } = item;
  const core = Object.freeze({ ...coreValue }) as TrustedBindingCurrentnessVerifierAssertionCore;
  if (suppliedId !== trustedBindingCurrentnessVerifierId(core)) {
    fail("invalid_input", "Binding currentness verifier trust ID does not match its canonical core");
  }
  return Object.freeze({ ...core, trust_id: suppliedId });
}

export function createTrustedBindingCurrentnessVerifierAssertion(
  input: CreateTrustedBindingCurrentnessVerifierAssertionInput,
): TrustedBindingCurrentnessVerifierAssertion {
  const core: TrustedBindingCurrentnessVerifierAssertionCore = Object.freeze({
    format: "agenttool.zerone-binding-currentness-verifier-trust/0.1",
    external_verification_id: input.external_verification_id,
    verifier_id: input.verifier_id,
    verified_at: input.verified_at,
    valid_until: input.valid_until,
    trust: "configured_host_allowlist",
    effects_performed: false,
  });
  return validateTrustedBindingCurrentnessVerifierAssertion({
    ...core,
    trust_id: trustedBindingCurrentnessVerifierId(core),
  });
}

const MAX_FRESHNESS_LIFETIME_MS = 5 * 60 * 1000;
const MAX_TRUST_EPOCH_LIFETIME_MS = 24 * 60 * 60 * 1000;

function boundedFreshnessInterval(
  verifiedAt: string,
  validUntil: string,
  label: string,
  maxLifetimeMs = MAX_FRESHNESS_LIFETIME_MS,
): void {
  assertTimestamp(verifiedAt, `${label}.verified_at`);
  assertTimestamp(validUntil, `${label}.valid_until`);
  const lifetime = Date.parse(validUntil) - Date.parse(verifiedAt);
  if (lifetime <= 0 || lifetime > maxLifetimeMs) {
    fail(
      "invalid_input",
      `${label} lifetime must be positive and no longer than ${maxLifetimeMs}ms`,
    );
  }
}

function activationCurrentnessId(
  core: ZeroneEconomyActivationCurrentnessAssertionCore,
): Sha256Id {
  return sha256BytesId(UTF8.encode(
    `${ACTIVATION_CURRENTNESS_HASH_DOMAIN}\0${canonicalJson(core)}`,
  ));
}

export function validateZeroneEconomyActivationCurrentnessAssertion(
  value: ZeroneEconomyActivationCurrentnessAssertion,
): ZeroneEconomyActivationCurrentnessAssertion {
  const item = closedDataSnapshot(
    value,
    [...ACTIVATION_CURRENTNESS_CORE_KEYS, "currentness_id"],
    "Activation currentness assertion",
  ) as unknown as ZeroneEconomyActivationCurrentnessAssertion;
  if (
    item.format !== "agenttool.zerone-activation-currentness-assertion/0.1"
    || item.currentness !== "asserted_by_injected_resolver"
    || item.effects_performed !== false
    || item.zerone_core_commit !== "a5b82e82b2a32be2b75bd11575964b0a69aa34ac"
    || item.cosmos_sdk !== "v0.53.8"
    || item.sponsorship_consensus_version !== 2
    || item.knowledge_consensus_version !== 7
    || !(
      (item.network === "mainnet" && item.chain_id === "cosmos:zerone-1")
      || (item.network === "testnet" && item.chain_id === "cosmos:zerone-testnet-1")
    )
  ) {
    fail("invalid_input", "Activation currentness assertion boundary or source tuple is invalid");
  }
  assertSha256Id(item.currentness_id, "activation_currentness.currentness_id");
  assertSha256Id(
    item.external_verification_id,
    "activation_currentness.external_verification_id",
  );
  assertSha256Id(
    item.activation_observation_hash,
    "activation_currentness.activation_observation_hash",
  );
  assertIdentifier(item.verifier_id, "activation_currentness.verifier_id");
  parseUint64(item.observed_at_height, "activation_currentness.observed_at_height", true);
  assertBlockHash(item.block_hash, "activation_currentness.block_hash");
  boundedFreshnessInterval(
    item.verified_at,
    item.valid_until,
    "activation_currentness",
  );
  const { currentness_id: suppliedId, ...coreValue } = item;
  const core = Object.freeze({ ...coreValue }) as ZeroneEconomyActivationCurrentnessAssertionCore;
  if (suppliedId !== activationCurrentnessId(core)) {
    fail("invalid_input", "Activation currentness ID does not match its canonical core");
  }
  return Object.freeze({ ...core, currentness_id: suppliedId });
}

export function createZeroneEconomyActivationCurrentnessAssertion(
  input: CreateZeroneEconomyActivationCurrentnessAssertionInput,
): ZeroneEconomyActivationCurrentnessAssertion {
  const core: ZeroneEconomyActivationCurrentnessAssertionCore = Object.freeze({
    format: "agenttool.zerone-activation-currentness-assertion/0.1",
    external_verification_id: input.external_verification_id,
    verifier_id: input.verifier_id,
    network: input.network,
    chain_id: input.chain_id,
    zerone_core_commit: "a5b82e82b2a32be2b75bd11575964b0a69aa34ac",
    cosmos_sdk: "v0.53.8",
    sponsorship_consensus_version: 2,
    knowledge_consensus_version: 7,
    activation_observation_hash: input.activation_observation_hash,
    observed_at_height: input.observed_at_height,
    block_hash: input.block_hash,
    verified_at: input.verified_at,
    valid_until: input.valid_until,
    currentness: "asserted_by_injected_resolver",
    effects_performed: false,
  });
  return validateZeroneEconomyActivationCurrentnessAssertion({
    ...core,
    currentness_id: activationCurrentnessId(core),
  });
}

function trustedSimulationAdapterId(core: TrustedSimulationAdapterAssertionCore): Sha256Id {
  return sha256BytesId(UTF8.encode(
    `${SIMULATION_ADAPTER_TRUST_HASH_DOMAIN}\0${canonicalJson(core)}`,
  ));
}

export function validateTrustedSimulationAdapterAssertion(
  value: TrustedSimulationAdapterAssertion,
): TrustedSimulationAdapterAssertion {
  const item = closedDataSnapshot(
    value,
    [...SIMULATION_ADAPTER_TRUST_CORE_KEYS, "trust_id"],
    "Simulation adapter trust assertion",
  ) as unknown as TrustedSimulationAdapterAssertion;
  const adapter = closedDataSnapshot(
    item.adapter,
    ["algorithm", "key_id", "public_key"],
    "Simulation adapter trust assertion adapter",
  ) as unknown as TrustedSimulationAdapterAssertion["adapter"];
  if (
    item.format !== "agenttool.zerone-simulation-adapter-trust/0.1"
    || item.trust !== "configured_host_allowlist"
    || item.effects_performed !== false
    || adapter.algorithm !== "Ed25519"
    || (item.chain_id !== "cosmos:zerone-1" && item.chain_id !== "cosmos:zerone-testnet-1")
  ) {
    fail("invalid_input", "Simulation adapter trust assertion boundary is invalid");
  }
  assertSha256Id(item.trust_id, "simulation_adapter_trust.trust_id");
  assertSha256Id(
    item.external_verification_id,
    "simulation_adapter_trust.external_verification_id",
  );
  assertIdentifier(item.verifier_id, "simulation_adapter_trust.verifier_id");
  assertSha256Id(adapter.key_id, "simulation_adapter_trust.adapter.key_id");
  if (typeof adapter.public_key !== "string") {
    fail("invalid_input", "Simulation adapter public key must be canonical base64url");
  }
  decodeFixedBase64Url(adapter.public_key, 32, "simulation_adapter_trust.adapter.public_key");
  if (adapter.key_id !== keyIdForPublicKey(adapter.public_key)) {
    fail("invalid_input", "Simulation adapter key ID does not match its exact public key");
  }
  boundedFreshnessInterval(
    item.verified_at,
    item.valid_until,
    "simulation_adapter_trust",
    MAX_TRUST_EPOCH_LIFETIME_MS,
  );
  const { trust_id: suppliedId, ...coreValue } = item;
  const core = Object.freeze({
    ...coreValue,
    adapter: Object.freeze({ ...adapter }),
  }) as TrustedSimulationAdapterAssertionCore;
  if (suppliedId !== trustedSimulationAdapterId(core)) {
    fail("invalid_input", "Simulation adapter trust ID does not match its canonical core");
  }
  return Object.freeze({ ...core, trust_id: suppliedId });
}

export function createTrustedSimulationAdapterAssertion(
  input: CreateTrustedSimulationAdapterAssertionInput,
): TrustedSimulationAdapterAssertion {
  const core: TrustedSimulationAdapterAssertionCore = Object.freeze({
    format: "agenttool.zerone-simulation-adapter-trust/0.1",
    external_verification_id: input.external_verification_id,
    verifier_id: input.verifier_id,
    chain_id: input.chain_id,
    adapter: Object.freeze({ ...input.adapter }),
    verified_at: input.verified_at,
    valid_until: input.valid_until,
    trust: "configured_host_allowlist",
    effects_performed: false,
  });
  return validateTrustedSimulationAdapterAssertion({
    ...core,
    trust_id: trustedSimulationAdapterId(core),
  });
}

export function validateAccountSnapshot(value: ZeroneAccountSnapshot): ZeroneAccountSnapshot {
  const item = closedDataSnapshot(
    value,
    ACCOUNT_SNAPSHOT_KEYS,
    "Account snapshot",
  ) as unknown as ZeroneAccountSnapshot;
  const network = item.chain_id === "cosmos:zerone-1"
    ? "mainnet"
    : item.chain_id === "cosmos:zerone-testnet-1"
      ? "testnet"
      : null;
  if (network === null) fail("invalid_input", "account_snapshot.chain_id is not a Zerone profile");
  const profile = getZeroneProfile(network);
  try {
    assertZeroneAccountId(item.account, profile, "account_snapshot.account");
  } catch {
    fail("invalid_input", "account_snapshot.account does not match chain_id");
  }
  parseUint64(item.account_number, "account_snapshot.account_number");
  parseUint64(item.sequence, "account_snapshot.sequence");
  parseUint64(item.balance_uzrn, "account_snapshot.balance_uzrn");
  parseUint64(item.observed_at_height, "account_snapshot.observed_at_height", true);
  assertBlockHash(item.block_hash, "account_snapshot.block_hash");
  boundedFreshnessInterval(item.observed_at, item.valid_until, "account_snapshot");
  const noKey = item.public_key_type_url === null && item.public_key_b64u === null;
  const exactKey = item.public_key_type_url === "/cosmos.crypto.secp256k1.PubKey"
    && typeof item.public_key_b64u === "string";
  if (!noKey && !exactKey) {
    fail("invalid_input", "Account public-key fields must both be unset or exact Cosmos secp256k1");
  }
  if (exactKey) {
    const key = decodeFixedBase64Url(
      item.public_key_b64u as string,
      33,
      "account_snapshot.public_key_b64u",
    );
    try {
      assertSecp256k1PublicKey(key);
    } catch {
      fail("invalid_input", "Account public key must be compressed secp256k1");
    }
  }
  return Object.freeze({ ...item }) as ZeroneAccountSnapshot;
}

export function networkForChain(chainId: ZeroneCaip2): "mainnet" | "testnet" {
  return chainId === "cosmos:zerone-1" ? "mainnet" : "testnet";
}

export function asZeroneAccount(value: string): ZeroneAccountId {
  return value as ZeroneAccountId;
}
