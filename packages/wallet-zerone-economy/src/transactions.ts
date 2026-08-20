import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  LIMITS,
  assertAuthorizedIntent,
  assertSha256Id,
  assertSignedPayloadMatchesRequest,
  assertTimestamp,
  assertUuid,
  assertVerifiedRecord,
  base64UrlDecode,
  base64UrlEncode,
  bytesToHex,
  canonicalJsonBytes,
  concatBytes,
  createSigningRequest,
  decodeFixedBase64Url,
  equalBytes,
  keyIdForPublicKey,
  sha256Id,
  sha256BytesId,
  signingDigest,
  strictEd25519Verify,
  timestampMs,
  type Ed25519PublicKey,
  type RecordSignature,
  type RecordSigner,
  type Sha256Id,
  type SignedPayload,
  type SimulationEffect,
  type SimulationReceipt,
  type SimulationReceiptCore,
  type Verified,
} from "@agenttool/wallet";
import {
  addressFromZeroneAccountId,
  assertSecp256k1PublicKey,
  assertZeroneAccountId,
  describeZeronePublicKey,
  getZeroneProfile,
  type ZeroneSimulationResult,
} from "@agenttool/wallet-zerone";

import {
  COSMOS_SECP256K1_PUBLIC_KEY_TYPE_URL,
  ECONOMY_ACTIVATION_OBSERVATION_PROTOCOL,
  ECONOMY_ADAPTER_PROTOCOL,
  ECONOMY_DURABLE_PLAN_HASH_DOMAIN,
  ECONOMY_GAS,
  ECONOMY_LIMITS,
  ECONOMY_PLAN_HASH_DOMAIN,
  ECONOMY_SIMULATION_BINDING_PROTOCOL,
  ECONOMY_SIMULATION_EVIDENCE_SCHEMA,
  ECONOMY_SIMULATION_EVIDENCE_SIGNING_DOMAIN,
  EXECUTION_SUPPORT,
  ZERONE_DENOM,
  ZERONE_DIRECT_SIGN_ALGORITHM,
  ZERONE_ECONOMY_CORE_COMMIT,
  ZERONE_ECONOMY_COSMOS_SDK,
  ZERONE_KNOWLEDGE_CONSENSUS_VERSION,
  ZERONE_MIN_GAS_PRICE_UZRN,
  ZERONE_SPONSORSHIP_CONSENSUS_VERSION,
} from "./constants.js";
import { fail } from "./errors.js";
import { bindEconomyIntentMessages } from "./projections.js";
import type {
  CreateZeroneEconomyDirectSignPlanInput,
  CreateZeroneEconomySignedPayloadInput,
  CreateZeroneEconomySigningRequestInput,
  CreateZeroneEconomySimulationBindingInput,
  CreateZeroneEconomySimulationEvidenceInput,
  ReconstructZeroneEconomyDirectSignPlanInput,
  VerifiedZeroneEconomySimulationEvidence,
  VerifiedZeroneEconomyTransaction,
  ZeroneEconomyActivationObservation,
  ZeroneEconomyDirectSignPlan,
  ZeroneEconomySimulationBinding,
  ZeroneEconomySimulationEvidence,
  ZeroneEconomySimulationEvidenceContent,
  ZeroneEconomySimulationEvidenceCore,
  ZeroneEconomySimulationReceiptInput,
} from "./types.js";
import {
  assertAtomicAmount,
  assertBoundedText,
  assertSafeCode,
  assertUint64,
  closedRecord,
} from "./validation.js";
import {
  decodeEconomyAuthInfo,
  decodeEconomySignDoc,
  decodeEconomyTxBody,
  decodeEconomyTxRaw,
  encodeEconomyAuthInfo,
  encodeEconomySignDoc,
  encodeEconomyTxBody,
  encodeEconomyTxRaw,
} from "./wire.js";

const directSignPlans = new WeakSet<object>();
const verifiedTransactions = new WeakSet<object>();
const verifiedSimulationEvidence = new WeakSet<object>();
const simulationBindings = new WeakMap<
  object,
  Readonly<{
    plan: ZeroneEconomyDirectSignPlan;
    simulation: Verified<SimulationReceipt>;
    evidence: VerifiedZeroneEconomySimulationEvidence;
  }>
>();
const economySigningRequests = new WeakMap<
  object,
  Readonly<{
    plan: ZeroneEconomyDirectSignPlan;
    binding: ZeroneEconomySimulationBinding;
    simulation: Verified<SimulationReceipt>;
  }>
>();

function validateActivationObservation(
  value: ZeroneEconomyActivationObservation,
  inputNetwork: CreateZeroneEconomyDirectSignPlanInput["network"],
): Readonly<ZeroneEconomyActivationObservation> {
  const item = closedRecord(value, [
    "chain_id",
    "cosmos_sdk",
    "currentness_proven",
    "evidence_scope",
    "knowledge_consensus_version",
    "network",
    "observed_at_height",
    "protocol",
    "sponsorship_consensus_version",
    "status",
    "zerone_core_commit",
  ], "activation_observation");
  const profile = getZeroneProfile(inputNetwork);
  assertUint64(item.observed_at_height, "activation_observation.observed_at_height", {
    positive: true,
  });
  if (
    item.protocol !== ECONOMY_ACTIVATION_OBSERVATION_PROTOCOL
    || item.evidence_scope !== "caller_supplied_structural_only"
    || item.currentness_proven !== false
    || item.status !== "reported_activated"
    || item.network !== inputNetwork
    || item.chain_id !== profile.chain_id
    || item.zerone_core_commit !== ZERONE_ECONOMY_CORE_COMMIT
    || item.cosmos_sdk !== ZERONE_ECONOMY_COSMOS_SDK
    || item.sponsorship_consensus_version
      !== ZERONE_SPONSORSHIP_CONSENSUS_VERSION
    || item.knowledge_consensus_version
      !== ZERONE_KNOWLEDGE_CONSENSUS_VERSION
  ) {
    fail(
      "activation_mismatch",
      "Activation observation must report the exact reviewed source commit, SDK, chain, and module versions without claiming currentness.",
      "activation_observation",
    );
  }
  return Object.freeze({ ...item }) as unknown as Readonly<ZeroneEconomyActivationObservation>;
}

function activationHash(value: ZeroneEconomyActivationObservation): `sha256:${string}` {
  return sha256BytesId(canonicalJsonBytes(value));
}

function validateAccountObservation(input: {
  readonly planInput: CreateZeroneEconomyDirectSignPlanInput;
  readonly publicKey: Uint8Array;
  readonly activation: ZeroneEconomyActivationObservation;
}): Readonly<CreateZeroneEconomyDirectSignPlanInput["account_observation"]> {
  const profile = getZeroneProfile(input.planInput.network);
  const account = closedRecord(input.planInput.account_observation, [
    "account",
    "account_number",
    "observed_at_height",
    "public_key_b64u",
    "public_key_type_url",
    "sequence",
    "status",
  ], "account_observation") as unknown as CreateZeroneEconomyDirectSignPlanInput[
    "account_observation"
  ];
  if (
    account.status !== "found"
    || account.account !== input.planInput.intent.source_account
  ) {
    fail(
      "account_mismatch",
      "Account observation does not bind the exact Wallet intent source.",
      "account_observation.account",
    );
  }
  assertUint64(account.account_number, "account_observation.account_number");
  assertUint64(account.sequence, "account_observation.sequence");
  assertUint64(account.observed_at_height, "account_observation.observed_at_height", {
    positive: true,
  });
  if (BigInt(account.observed_at_height) < BigInt(input.activation.observed_at_height)) {
    fail(
      "activation_mismatch",
      "Account observation predates the reported activation observation.",
      "account_observation.observed_at_height",
    );
  }
  try {
    assertZeroneAccountId(account.account, profile, "account_observation.account");
  } catch {
    fail("account_mismatch", "Account observation belongs to another chain.");
  }
  const hasNoRegisteredKey =
    account.public_key_type_url === null
    && account.public_key_b64u === null;
  if (!hasNoRegisteredKey) {
    if (
      account.public_key_type_url !== COSMOS_SECP256K1_PUBLIC_KEY_TYPE_URL
      || account.public_key_b64u === null
    ) {
      fail(
        "account_mismatch",
        "Account key must be unset or the exact Cosmos secp256k1 signer key.",
        "account_observation.public_key_type_url",
      );
    }
    let observedPublicKey: Uint8Array;
    try {
      observedPublicKey = base64UrlDecode(
        account.public_key_b64u,
        "account_observation.public_key_b64u",
      );
    } catch {
      fail("account_mismatch", "Account public key is not canonical base64url.");
    }
    if (!equalBytes(observedPublicKey, input.publicKey)) {
      fail(
        "account_mismatch",
        "Account observation contains a different registered public key.",
        "account_observation.public_key_b64u",
      );
    }
  }
  return Object.freeze({ ...account }) as unknown as Readonly<
    CreateZeroneEconomyDirectSignPlanInput["account_observation"]
  >;
}

function computePlanId(input: {
  readonly activation_observation_hash: string;
  readonly account_observed_at_height: string;
  readonly sign_doc_bytes_hash: string;
  readonly projection_hashes: readonly string[];
}): `sha256:${string}` {
  return sha256BytesId(concatBytes(
    new TextEncoder().encode(ECONOMY_PLAN_HASH_DOMAIN),
    canonicalJsonBytes(input),
  ));
}

export function createZeroneEconomyDirectSignPlan(
  input: CreateZeroneEconomyDirectSignPlanInput,
): Readonly<ZeroneEconomyDirectSignPlan> {
  // Read each caller-controlled top-level property exactly once before any
  // validation so an accessor/proxy cannot change a checked scalar later.
  const intent = input.intent;
  const projections = input.projections;
  const network = input.network;
  const signerPublicKey = Uint8Array.from(input.signer_public_key);
  const accountObservation = input.account_observation;
  const activationObservation = input.activation_observation;
  const feeAmountUZRN = input.fee_amount_uzrn;
  const gasLimitText = input.gas_limit;
  const stableInput = Object.freeze({
    intent,
    projections,
    network,
    signer_public_key: signerPublicKey,
    account_observation: accountObservation,
    activation_observation: activationObservation,
    fee_amount_uzrn: feeAmountUZRN,
    gas_limit: gasLimitText,
  });

  assertVerifiedRecord(intent);
  const profile = getZeroneProfile(network);
  const activation = validateActivationObservation(
    activationObservation,
    network,
  );
  if (intent.chain_id !== profile.chain_id) {
    fail("projection_mismatch", "Wallet intent chain does not match the selected network.");
  }
  try {
    assertZeroneAccountId(intent.source_account, profile, "intent.source_account");
    assertSecp256k1PublicKey(signerPublicKey);
  } catch {
    fail("signer_mismatch", "Source account or signer key is invalid for Zerone.");
  }
  const publicKey = signerPublicKey;
  const signer = describeZeronePublicKey(publicKey);
  const sourceAddress = addressFromZeroneAccountId(
    intent.source_account as never,
    profile,
  );
  if (signer.address !== sourceAddress) {
    fail(
      "signer_mismatch",
      "Signer public key does not derive the exact intent source account.",
      "signer_public_key",
    );
  }
  const account = validateAccountObservation({
    planInput: stableInput,
    publicKey,
    activation,
  });

  assertAtomicAmount(feeAmountUZRN, "fee_amount_uzrn", { positive: true });
  assertUint64(gasLimitText, "gas_limit", { positive: true });
  const gasLimit = BigInt(gasLimitText);
  if (gasLimit > ECONOMY_GAS.max_gas_limit) {
    fail(
      "gas_policy_mismatch",
      `gas_limit exceeds the pinned per-transaction cap ${ECONOMY_GAS.max_gas_limit}.`,
      "gas_limit",
    );
  }
  if (BigInt(feeAmountUZRN) < gasLimit * ZERONE_MIN_GAS_PRICE_UZRN) {
    fail(
      "gas_policy_mismatch",
      "fee_amount_uzrn is below the pinned consensus minimum for the declared gas limit.",
      "fee_amount_uzrn",
    );
  }
  if (
    intent.max_fee.asset_id !== profile.native_asset_id
    || BigInt(feeAmountUZRN) > BigInt(intent.max_fee.amount_atomic)
  ) {
    fail(
      "gas_policy_mismatch",
      "Exact transaction fee exceeds or changes the Wallet intent fee bound.",
      "fee_amount_uzrn",
    );
  }

  const bound = bindEconomyIntentMessages({
    intent,
    projections,
    network,
  });
  const summedGas = bound.messages.reduce(
    (sum, message) => sum + BigInt(message.required_gas),
    0n,
  );
  const requiredGas = summedGas < ECONOMY_GAS.min_gas_limit
    ? ECONOMY_GAS.min_gas_limit
    : summedGas;
  if (gasLimit < requiredGas) {
    fail(
      "gas_policy_mismatch",
      `gas_limit is below the pinned ordered-message requirement ${requiredGas}.`,
      "gas_limit",
    );
  }

  const fee = Object.freeze({
    denom: ZERONE_DENOM,
    amount: feeAmountUZRN,
  });
  const bodyBytes = encodeEconomyTxBody(bound.protoMessages);
  const authInfoBytes = encodeEconomyAuthInfo(
    publicKey,
    BigInt(account.sequence),
    fee,
    gasLimit,
  );
  const signDocBytes = encodeEconomySignDoc(
    bodyBytes,
    authInfoBytes,
    profile.chain_reference,
    BigInt(account.account_number),
  );
  const simulationTxBytes = encodeEconomyTxRaw(
    bodyBytes,
    authInfoBytes,
    new Uint8Array(),
  );
  for (const [label, bytes] of [
    ["body", bodyBytes],
    ["auth_info", authInfoBytes],
    ["sign_doc", signDocBytes],
    ["simulation_tx", simulationTxBytes],
  ] as const) {
    if (bytes.byteLength > ECONOMY_LIMITS.max_transaction_bytes) {
      fail("invalid_input", `${label} exceeds the transaction byte boundary.`);
    }
  }
  // Exercise the same strict decoders later used during signature verification.
  decodeEconomyTxBody(bodyBytes);
  decodeEconomyAuthInfo(authInfoBytes);
  decodeEconomySignDoc(signDocBytes);
  decodeEconomyTxRaw(simulationTxBytes);

  const activationObservationHash = activationHash(activation);
  const signDocHash = sha256BytesId(signDocBytes);
  const planId = computePlanId({
    activation_observation_hash: activationObservationHash,
    account_observed_at_height: account.observed_at_height,
    sign_doc_bytes_hash: signDocHash,
    projection_hashes: bound.messages.map(({ projection_hash }) => projection_hash),
  });
  const plan: ZeroneEconomyDirectSignPlan = Object.freeze({
    protocol: ECONOMY_ADAPTER_PROTOCOL,
    execution_support: EXECUTION_SUPPORT,
    zerone_core_commit: ZERONE_ECONOMY_CORE_COMMIT,
    cosmos_sdk: ZERONE_ECONOMY_COSMOS_SDK,
    sponsorship_consensus_version: ZERONE_SPONSORSHIP_CONSENSUS_VERSION,
    knowledge_consensus_version: ZERONE_KNOWLEDGE_CONSENSUS_VERSION,
    activation_observation_hash: activationObservationHash,
    activation_observed_at_height: activation.observed_at_height,
    plan_id: planId,
    network,
    chain_id: profile.chain_id,
    chain_reference: profile.chain_reference,
    source_account: intent.source_account as never,
    intent_record_id: intent.record_id,
    signer_key_id: signer.signer_key_id,
    signer_public_key_b64u: signer.public_key_b64u,
    account_number: account.account_number,
    sequence: account.sequence,
    account_observed_at_height: account.observed_at_height,
    fee,
    gas_limit: gasLimitText,
    required_gas_limit: requiredGas.toString(),
    total_reserved_spend_uzrn: bound.totalReservedSpend.toString(),
    messages: bound.messages,
    simulation_effects: bound.simulationEffects,
    economic_effects: bound.economicEffects,
    body_bytes_b64u: base64UrlEncode(bodyBytes),
    body_bytes_hash: sha256BytesId(bodyBytes),
    auth_info_bytes_b64u: base64UrlEncode(authInfoBytes),
    auth_info_bytes_hash: sha256BytesId(authInfoBytes),
    sign_doc_bytes_b64u: base64UrlEncode(signDocBytes),
    sign_doc_bytes_hash: signDocHash,
    simulation_tx_bytes_b64u: base64UrlEncode(simulationTxBytes),
    simulation_tx_bytes_hash: sha256BytesId(simulationTxBytes),
  });
  directSignPlans.add(plan);
  return plan;
}

export function assertZeroneEconomyDirectSignPlan(
  plan: ZeroneEconomyDirectSignPlan,
): void {
  if (!directSignPlans.has(plan)) {
    fail(
      "invalid_state",
      "Economy sign plan must be created and retained in this process.",
    );
  }
}

/**
 * Commits every canonical field of a process-branded plan. `plan_id` remains
 * the narrower transaction identity; durable hosts must use this full content
 * commitment when reconstructing a plan after a process boundary.
 */
export function zeroneEconomyDirectSignPlanContentId(
  plan: ZeroneEconomyDirectSignPlan,
): Sha256Id {
  assertZeroneEconomyDirectSignPlan(plan);
  return sha256BytesId(concatBytes(
    new TextEncoder().encode(ECONOMY_DURABLE_PLAN_HASH_DOMAIN),
    canonicalJsonBytes(plan),
  ));
}

/**
 * Recreates the plan through the ordinary verified-input path and restores its
 * process brand only when every resulting canonical field matches the durable
 * commitment. Serialized plan JSON is deliberately not an input to this API.
 */
export function reconstructZeroneEconomyDirectSignPlan(
  input: ReconstructZeroneEconomyDirectSignPlanInput,
): Readonly<ZeroneEconomyDirectSignPlan> {
  // Snapshot caller-controlled top-level properties exactly once. The ordinary
  // constructor then rechecks the Wallet runtime brand and all strict source
  // projections/observations before it creates a new branded object.
  const expectedPlanContentId = input.expected_plan_content_id;
  const intent = input.intent;
  const projections = input.projections;
  const network = input.network;
  const signerPublicKey = input.signer_public_key;
  const accountObservation = input.account_observation;
  const activationObservation = input.activation_observation;
  const feeAmountUZRN = input.fee_amount_uzrn;
  const gasLimit = input.gas_limit;
  assertSha256Id(expectedPlanContentId, "expected_plan_content_id");

  const plan = createZeroneEconomyDirectSignPlan(Object.freeze({
    intent,
    projections,
    network,
    signer_public_key: signerPublicKey,
    account_observation: accountObservation,
    activation_observation: activationObservation,
    fee_amount_uzrn: feeAmountUZRN,
    gas_limit: gasLimit,
  }));
  if (zeroneEconomyDirectSignPlanContentId(plan) !== expectedPlanContentId) {
    fail(
      "invalid_state",
      "Reconstructed economy sign plan does not match the expected full durable content commitment.",
      "expected_plan_content_id",
    );
  }
  return plan;
}

function sameSimulationEffects(
  left: readonly SimulationEffect[],
  right: readonly SimulationEffect[],
): boolean {
  return left.length === right.length && left.every((effect, index) => {
    const other = right[index];
    return other !== undefined
      && effect.action === other.action
      && effect.target_account === other.target_account
      && effect.method === other.method
      && effect.asset_id === other.asset_id
      && effect.amount_atomic === other.amount_atomic;
  });
}

function validateSimulationResult(
  plan: ZeroneEconomyDirectSignPlan,
  result: ZeroneSimulationResult,
  requireSuccess: boolean,
): Readonly<ZeroneSimulationResult> {
  const item = closedRecord(result, [
    "code",
    "codespace",
    "gas_used",
    "gas_wanted",
    "observed_at_height",
    "simulation_tx_bytes_hash",
    "status",
  ], "simulation_result");
  assertSafeCode(item.code, "simulation_result.code");
  assertBoundedText(item.codespace, "simulation_result.codespace", 128, {
    allowEmpty: true,
  });
  assertUint64(item.gas_wanted, "simulation_result.gas_wanted");
  assertUint64(item.gas_used, "simulation_result.gas_used");
  assertUint64(item.observed_at_height, "simulation_result.observed_at_height", {
    positive: true,
  });
  if (
    (item.status !== "succeeded" && item.status !== "failed")
    || (item.status === "succeeded") !== (item.code === 0)
  ) {
    fail(
      "simulation_mismatch",
      "Simulation status and code disagree.",
      "simulation_result",
    );
  }
  if (requireSuccess && item.status !== "succeeded") {
    fail(
      "simulation_mismatch",
      "Only a successful simulation can authorize an economy signing request.",
    );
  }
  if (
    item.simulation_tx_bytes_hash !== plan.simulation_tx_bytes_hash
    || BigInt(item.observed_at_height) < BigInt(plan.activation_observed_at_height)
    || BigInt(item.observed_at_height) < BigInt(plan.account_observed_at_height)
  ) {
    fail(
      "simulation_mismatch",
      "Simulation must observe the exact planned TxRaw after activation and account observations.",
    );
  }
  return Object.freeze({ ...item }) as unknown as Readonly<ZeroneSimulationResult>;
}

function sameAdapter(
  left: Ed25519PublicKey,
  right: Ed25519PublicKey,
): boolean {
  return left.algorithm === right.algorithm
    && left.key_id === right.key_id
    && left.public_key === right.public_key;
}

function assertSimulationReceiptMatchesResult(input: {
  readonly plan: ZeroneEconomyDirectSignPlan;
  readonly simulation: Verified<SimulationReceipt>;
  readonly result: Readonly<ZeroneSimulationResult>;
}): void {
  const profile = getZeroneProfile(input.plan.network);
  if (
    input.simulation.intent_record_id !== input.plan.intent_record_id
    || input.simulation.chain_id !== input.plan.chain_id
    || input.simulation.source_account !== input.plan.source_account
    || input.simulation.success !== (input.result.status === "succeeded")
    || input.simulation.block_ref
      !== `${input.plan.chain_reference}:${input.result.observed_at_height}`
    || !sameSimulationEffects(input.simulation.effects, input.plan.simulation_effects)
    || input.simulation.estimated_fee.asset_id !== profile.native_asset_id
    || input.simulation.estimated_fee.amount_atomic !== input.plan.fee.amount
  ) {
    fail(
      "simulation_mismatch",
      "Verified simulation receipt does not describe the exact economy plan and result.",
    );
  }
}

function validateEvidenceAdapter(value: unknown): Readonly<Ed25519PublicKey> {
  const item = closedRecord(value, [
    "algorithm",
    "key_id",
    "public_key",
  ], "simulation_evidence.adapter");
  if (item.algorithm !== "Ed25519") {
    fail(
      "signature_invalid",
      "Simulation evidence adapter must use Ed25519.",
      "simulation_evidence.adapter.algorithm",
    );
  }
  assertSha256Id(item.key_id, "simulation_evidence.adapter.key_id");
  if (typeof item.public_key !== "string") {
    fail(
      "signature_invalid",
      "Simulation evidence adapter public key must be canonical base64url.",
      "simulation_evidence.adapter.public_key",
    );
  }
  decodeFixedBase64Url(
    item.public_key,
    32,
    "simulation_evidence.adapter.public_key",
  );
  if (item.key_id !== keyIdForPublicKey(item.public_key)) {
    fail(
      "signature_invalid",
      "Simulation evidence adapter key_id does not match its public key.",
      "simulation_evidence.adapter.key_id",
    );
  }
  return Object.freeze({
    algorithm: "Ed25519",
    key_id: item.key_id,
    public_key: item.public_key,
  });
}

function validateEvidenceSignature(value: unknown): Readonly<RecordSignature> {
  const item = closedRecord(value, [
    "algorithm",
    "value",
  ], "simulation_evidence.signature");
  if (item.algorithm !== "Ed25519" || typeof item.value !== "string") {
    fail(
      "signature_invalid",
      "Simulation evidence signature must be an Ed25519 signature.",
      "simulation_evidence.signature",
    );
  }
  decodeFixedBase64Url(
    item.value,
    64,
    "simulation_evidence.signature.value",
  );
  return Object.freeze({ algorithm: "Ed25519", value: item.value });
}

function validateSimulationEvidenceRecord(value: unknown): Readonly<{
  readonly content: ZeroneEconomySimulationEvidenceContent;
  readonly core: ZeroneEconomySimulationEvidenceCore;
  readonly record: ZeroneEconomySimulationEvidence;
}> {
  const item = closedRecord(value, [
    "activation_observation_hash",
    "adapter",
    "block_hash",
    "block_ref",
    "chain_id",
    "code",
    "codespace",
    "content_id",
    "cosmos_sdk",
    "gas_used",
    "gas_wanted",
    "intent_id",
    "intent_record_id",
    "knowledge_consensus_version",
    "observed_at_height",
    "plan_id",
    "record_id",
    "schema",
    "signature",
    "simulated_at",
    "simulation_id",
    "simulation_record_id",
    "simulation_tx_bytes_hash",
    "source_account",
    "sponsorship_consensus_version",
    "status",
    "valid_until",
    "zerone_core_commit",
  ], "simulation_evidence");

  if (
    item.schema !== ECONOMY_SIMULATION_EVIDENCE_SCHEMA
    || item.zerone_core_commit !== ZERONE_ECONOMY_CORE_COMMIT
    || item.cosmos_sdk !== ZERONE_ECONOMY_COSMOS_SDK
    || item.sponsorship_consensus_version
      !== ZERONE_SPONSORSHIP_CONSENSUS_VERSION
    || item.knowledge_consensus_version
      !== ZERONE_KNOWLEDGE_CONSENSUS_VERSION
  ) {
    fail(
      "simulation_mismatch",
      "Simulation evidence must pin the exact private planner schema and reviewed Core tuple.",
      "simulation_evidence",
    );
  }
  assertSha256Id(
    item.activation_observation_hash,
    "simulation_evidence.activation_observation_hash",
  );
  assertSha256Id(item.plan_id, "simulation_evidence.plan_id");
  assertUuid(item.intent_id, "simulation_evidence.intent_id");
  assertSha256Id(item.intent_record_id, "simulation_evidence.intent_record_id");
  assertUuid(item.simulation_id, "simulation_evidence.simulation_id");
  assertSha256Id(
    item.simulation_record_id,
    "simulation_evidence.simulation_record_id",
  );
  assertSha256Id(
    item.simulation_tx_bytes_hash,
    "simulation_evidence.simulation_tx_bytes_hash",
  );
  assertSha256Id(item.content_id, "simulation_evidence.content_id");
  assertSha256Id(item.record_id, "simulation_evidence.record_id");

  if (typeof item.chain_id !== "string") {
    fail("simulation_mismatch", "Simulation evidence chain is not Zerone.");
  }
  const profile = (["mainnet", "testnet"] as const)
    .map((network) => getZeroneProfile(network))
    .find((candidate) => candidate.chain_id === item.chain_id);
  if (profile === undefined || typeof item.source_account !== "string") {
    fail("simulation_mismatch", "Simulation evidence chain or source is not Zerone.");
  }
  try {
    assertZeroneAccountId(
      item.source_account,
      profile,
      "simulation_evidence.source_account",
    );
  } catch {
    fail(
      "simulation_mismatch",
      "Simulation evidence source does not belong to its exact Zerone chain.",
      "simulation_evidence.source_account",
    );
  }

  if (item.status !== "succeeded" && item.status !== "failed") {
    fail("simulation_mismatch", "Simulation evidence status is unsupported.");
  }
  assertSafeCode(item.code, "simulation_evidence.code");
  if ((item.status === "succeeded") !== (item.code === 0)) {
    fail(
      "simulation_mismatch",
      "Simulation evidence status and code disagree.",
      "simulation_evidence.status",
    );
  }
  assertBoundedText(item.codespace, "simulation_evidence.codespace", 128, {
    allowEmpty: true,
  });
  assertUint64(item.gas_wanted, "simulation_evidence.gas_wanted");
  assertUint64(item.gas_used, "simulation_evidence.gas_used");
  assertUint64(
    item.observed_at_height,
    "simulation_evidence.observed_at_height",
    { positive: true },
  );
  assertBoundedText(item.block_ref, "simulation_evidence.block_ref", 512);
  if (item.block_hash !== null) {
    assertBoundedText(item.block_hash, "simulation_evidence.block_hash", 512);
  }
  assertTimestamp(item.simulated_at, "simulation_evidence.simulated_at");
  assertTimestamp(item.valid_until, "simulation_evidence.valid_until");
  const lifetime = timestampMs(item.valid_until) - timestampMs(item.simulated_at);
  if (lifetime <= 0 || lifetime > LIMITS.max_simulation_lifetime_ms) {
    fail(
      "simulation_mismatch",
      `Simulation evidence lifetime must be positive and no longer than ${LIMITS.max_simulation_lifetime_ms}ms.`,
      "simulation_evidence.valid_until",
    );
  }

  const adapter = validateEvidenceAdapter(item.adapter);
  const content: ZeroneEconomySimulationEvidenceContent = Object.freeze({
    schema: ECONOMY_SIMULATION_EVIDENCE_SCHEMA,
    zerone_core_commit: ZERONE_ECONOMY_CORE_COMMIT,
    cosmos_sdk: ZERONE_ECONOMY_COSMOS_SDK,
    sponsorship_consensus_version: ZERONE_SPONSORSHIP_CONSENSUS_VERSION,
    knowledge_consensus_version: ZERONE_KNOWLEDGE_CONSENSUS_VERSION,
    activation_observation_hash: item.activation_observation_hash,
    plan_id: item.plan_id,
    intent_id: item.intent_id,
    intent_record_id: item.intent_record_id,
    simulation_id: item.simulation_id,
    simulation_record_id: item.simulation_record_id,
    simulation_tx_bytes_hash: item.simulation_tx_bytes_hash,
    chain_id: profile.chain_id,
    source_account: item.source_account,
    adapter,
    status: item.status,
    code: item.code,
    codespace: item.codespace,
    gas_wanted: item.gas_wanted,
    gas_used: item.gas_used,
    observed_at_height: item.observed_at_height,
    block_ref: item.block_ref,
    block_hash: item.block_hash,
    simulated_at: item.simulated_at,
    valid_until: item.valid_until,
  });
  if (sha256Id(content) !== item.content_id) {
    fail(
      "signature_invalid",
      "Simulation evidence content_id does not match its canonical unsigned content.",
      "simulation_evidence.content_id",
    );
  }
  const core: ZeroneEconomySimulationEvidenceCore = Object.freeze({
    ...content,
    content_id: item.content_id,
  });
  const signature = validateEvidenceSignature(item.signature);
  if (sha256Id({ ...core, signature }) !== item.record_id) {
    fail(
      "signature_invalid",
      "Simulation evidence record_id does not match its canonical signed record.",
      "simulation_evidence.record_id",
    );
  }
  const record: ZeroneEconomySimulationEvidence = Object.freeze({
    ...core,
    record_id: item.record_id,
    signature,
  });
  return Object.freeze({ content, core, record });
}

export function verifyZeroneEconomySimulationEvidence(
  value: unknown,
): VerifiedZeroneEconomySimulationEvidence {
  const checked = validateSimulationEvidenceRecord(value);
  const signature = decodeFixedBase64Url(
    checked.record.signature.value,
    64,
    "simulation_evidence.signature.value",
  );
  const publicKey = decodeFixedBase64Url(
    checked.record.adapter.public_key,
    32,
    "simulation_evidence.adapter.public_key",
  );
  let valid = false;
  try {
    valid = strictEd25519Verify(
      signature,
      signingDigest(
        ECONOMY_SIMULATION_EVIDENCE_SIGNING_DOMAIN,
        checked.core,
      ),
      publicKey,
    );
  } catch {
    valid = false;
  }
  if (!valid) {
    fail(
      "signature_invalid",
      "Simulation evidence has an invalid strict Ed25519 signature.",
      "simulation_evidence.signature",
    );
  }
  verifiedSimulationEvidence.add(checked.record);
  return checked.record as VerifiedZeroneEconomySimulationEvidence;
}

export function assertVerifiedZeroneEconomySimulationEvidence(
  evidence: ZeroneEconomySimulationEvidence,
): asserts evidence is VerifiedZeroneEconomySimulationEvidence {
  if (!verifiedSimulationEvidence.has(evidence)) {
    fail(
      "invalid_state",
      "Simulation evidence must be created or reload-verified by this private planner.",
      "simulation_evidence",
    );
  }
}

export async function createZeroneEconomySimulationEvidence(
  input: CreateZeroneEconomySimulationEvidenceInput,
): Promise<VerifiedZeroneEconomySimulationEvidence> {
  const plan = input.plan;
  const simulation = input.simulation;
  const suppliedResult = input.simulation_result;
  const signer: RecordSigner = input.signer;
  assertZeroneEconomyDirectSignPlan(plan);
  assertVerifiedRecord(simulation);
  const result = validateSimulationResult(plan, suppliedResult, false);
  assertSimulationReceiptMatchesResult({ plan, simulation, result });
  if (signer.public_key !== simulation.adapter.public_key) {
    fail(
      "signer_mismatch",
      "Simulation evidence signer must be the Wallet receipt's exact adapter authority.",
      "simulation_evidence.adapter",
    );
  }

  const content: ZeroneEconomySimulationEvidenceContent = Object.freeze({
    schema: ECONOMY_SIMULATION_EVIDENCE_SCHEMA,
    zerone_core_commit: ZERONE_ECONOMY_CORE_COMMIT,
    cosmos_sdk: ZERONE_ECONOMY_COSMOS_SDK,
    sponsorship_consensus_version: ZERONE_SPONSORSHIP_CONSENSUS_VERSION,
    knowledge_consensus_version: ZERONE_KNOWLEDGE_CONSENSUS_VERSION,
    activation_observation_hash: plan.activation_observation_hash,
    plan_id: plan.plan_id,
    intent_id: simulation.intent_id,
    intent_record_id: plan.intent_record_id,
    simulation_id: simulation.simulation_id,
    simulation_record_id: simulation.record_id,
    simulation_tx_bytes_hash: plan.simulation_tx_bytes_hash,
    chain_id: plan.chain_id,
    source_account: plan.source_account,
    adapter: Object.freeze({ ...simulation.adapter }),
    status: result.status,
    code: result.code,
    codespace: result.codespace,
    gas_wanted: result.gas_wanted,
    gas_used: result.gas_used,
    observed_at_height: result.observed_at_height,
    block_ref: simulation.block_ref,
    block_hash: simulation.block_hash,
    simulated_at: simulation.simulated_at,
    valid_until: simulation.valid_until,
  });
  const core: ZeroneEconomySimulationEvidenceCore = Object.freeze({
    ...content,
    content_id: sha256Id(content),
  });
  const digest = signingDigest(
    ECONOMY_SIMULATION_EVIDENCE_SIGNING_DOMAIN,
    core,
  );
  const signatureValue = await signer.sign_digest(Uint8Array.from(digest));
  if (typeof signatureValue !== "string") {
    fail(
      "signature_invalid",
      "Simulation evidence signer returned a non-string signature.",
    );
  }
  const signature: RecordSignature = Object.freeze({
    algorithm: "Ed25519",
    value: signatureValue,
  });
  const candidate: ZeroneEconomySimulationEvidence = Object.freeze({
    ...core,
    record_id: sha256Id({ ...core, signature }),
    signature,
  });
  return verifyZeroneEconomySimulationEvidence(candidate);
}

export function createZeroneEconomySimulationBinding(
  input: CreateZeroneEconomySimulationBindingInput,
): Readonly<ZeroneEconomySimulationBinding> {
  const plan = input.plan;
  const simulation = input.simulation;
  const evidence = input.evidence;
  assertZeroneEconomyDirectSignPlan(plan);
  assertVerifiedRecord(simulation);
  assertVerifiedZeroneEconomySimulationEvidence(evidence);
  const simulationResult = validateSimulationResult(plan, {
    status: evidence.status,
    simulation_tx_bytes_hash: evidence.simulation_tx_bytes_hash,
    code: evidence.code,
    codespace: evidence.codespace,
    gas_wanted: evidence.gas_wanted,
    gas_used: evidence.gas_used,
    observed_at_height: evidence.observed_at_height,
  }, true);
  assertSimulationReceiptMatchesResult({
    plan,
    simulation,
    result: simulationResult,
  });
  if (
    evidence.zerone_core_commit !== plan.zerone_core_commit
    || evidence.cosmos_sdk !== plan.cosmos_sdk
    || evidence.sponsorship_consensus_version
      !== plan.sponsorship_consensus_version
    || evidence.knowledge_consensus_version
      !== plan.knowledge_consensus_version
    || evidence.activation_observation_hash !== plan.activation_observation_hash
    || evidence.plan_id !== plan.plan_id
    || evidence.intent_id !== simulation.intent_id
    || evidence.intent_record_id !== plan.intent_record_id
    || evidence.intent_record_id !== simulation.intent_record_id
    || evidence.simulation_id !== simulation.simulation_id
    || evidence.simulation_record_id !== simulation.record_id
    || evidence.simulation_tx_bytes_hash !== plan.simulation_tx_bytes_hash
    || evidence.chain_id !== plan.chain_id
    || evidence.chain_id !== simulation.chain_id
    || evidence.source_account !== plan.source_account
    || evidence.source_account !== simulation.source_account
    || !sameAdapter(evidence.adapter, simulation.adapter)
    || evidence.block_ref !== simulation.block_ref
    || evidence.block_hash !== simulation.block_hash
    || evidence.simulated_at !== simulation.simulated_at
    || evidence.valid_until !== simulation.valid_until
  ) {
    fail(
      "simulation_mismatch",
      "Verified simulation evidence does not bind every exact plan and Wallet receipt field.",
    );
  }
  const binding: ZeroneEconomySimulationBinding = Object.freeze({
    protocol: ECONOMY_SIMULATION_BINDING_PROTOCOL,
    plan_id: plan.plan_id,
    intent_record_id: plan.intent_record_id,
    simulation_record_id: simulation.record_id,
    simulation_tx_bytes_hash: plan.simulation_tx_bytes_hash,
    simulation_evidence_content_id: evidence.content_id,
    simulation_evidence_record_id: evidence.record_id,
    activation_observation_hash: plan.activation_observation_hash,
  });
  simulationBindings.set(binding, Object.freeze({
    plan,
    simulation,
    evidence,
  }));
  return binding;
}

export function createZeroneEconomySigningRequest(
  input: CreateZeroneEconomySigningRequestInput,
): ReturnType<typeof createSigningRequest> {
  const plan = input.plan;
  const simulation = input.simulation;
  const binding = input.binding;
  const authorization = input.authorization;
  const requestId = input.request_id;
  const requestedAt = input.requested_at;
  assertZeroneEconomyDirectSignPlan(plan);
  assertVerifiedRecord(simulation);
  assertAuthorizedIntent(authorization);
  assertTimestamp(requestedAt, "signing_request.requested_at");
  const bound = simulationBindings.get(binding);
  if (
    bound === undefined
    || bound.plan !== plan
    || bound.simulation !== simulation
    || binding.protocol !== ECONOMY_SIMULATION_BINDING_PROTOCOL
    || binding.plan_id !== plan.plan_id
    || binding.intent_record_id !== plan.intent_record_id
    || binding.simulation_record_id !== simulation.record_id
    || binding.simulation_tx_bytes_hash !== plan.simulation_tx_bytes_hash
    || binding.simulation_evidence_content_id !== bound.evidence.content_id
    || binding.simulation_evidence_record_id !== bound.evidence.record_id
    || binding.activation_observation_hash !== plan.activation_observation_hash
  ) {
    fail(
      "simulation_mismatch",
      "Simulation binding was not created for this exact activation-bound plan and receipt.",
    );
  }
  if (
    authorization.intent_record_id !== plan.intent_record_id
    || authorization.simulation_record_id !== simulation.record_id
    || authorization.simulation_record_id !== binding.simulation_record_id
  ) {
    fail(
      "simulation_mismatch",
      "Wallet authorization does not bind the plan's exact intent and simulation.",
    );
  }
  const requestedAtMs = timestampMs(requestedAt);
  if (
    requestedAt !== authorization.checked_at
    || requestedAtMs < timestampMs(bound.evidence.simulated_at)
    || requestedAtMs >= timestampMs(bound.evidence.valid_until)
  ) {
    fail(
      "simulation_mismatch",
      "Signing request time must equal the authorization check and remain inside the signed simulation evidence window.",
      "signing_request.requested_at",
    );
  }
  const request = createSigningRequest({
    request_id: requestId,
    authorization,
    signer_key_id: plan.signer_key_id,
    unsigned_payload: base64UrlDecode(
      plan.sign_doc_bytes_b64u,
      "plan.sign_doc_bytes_b64u",
    ),
  });
  economySigningRequests.set(request, Object.freeze({
    plan,
    binding,
    simulation,
  }));
  return request;
}

function assertEconomySigningRequest(
  plan: ZeroneEconomyDirectSignPlan,
  request: object,
): void {
  const bound = economySigningRequests.get(request);
  if (
    bound === undefined
    || bound.plan !== plan
    || simulationBindings.get(bound.binding)?.plan !== plan
    || simulationBindings.get(bound.binding)?.simulation !== bound.simulation
  ) {
    fail(
      "invalid_state",
      "Signing request must be created for this exact simulation-bound economy plan.",
    );
  }
}

function transactionHash(txBytes: Uint8Array): string {
  return bytesToHex(sha256(txBytes)).toUpperCase();
}

export function createZeroneEconomySignedPayload(
  input: CreateZeroneEconomySignedPayloadInput,
): Readonly<SignedPayload> {
  assertZeroneEconomyDirectSignPlan(input.plan);
  assertEconomySigningRequest(input.plan, input.request);
  if (
    input.request.authorization.intent_record_id !== input.plan.intent_record_id
    || input.request.signer_key_id !== input.plan.signer_key_id
    || input.request.unsigned_payload_hash !== input.plan.sign_doc_bytes_hash
    || input.request.unsigned_payload_b64u !== input.plan.sign_doc_bytes_b64u
  ) {
    fail("signature_invalid", "Signing request does not bind the exact economy plan.");
  }
  if (!(input.signature instanceof Uint8Array) || input.signature.byteLength !== 64) {
    fail(
      "signature_invalid",
      "Signer signature must be compact 64-byte secp256k1.",
      "signature",
    );
  }
  const txBytes = encodeEconomyTxRaw(
    base64UrlDecode(input.plan.body_bytes_b64u),
    base64UrlDecode(input.plan.auth_info_bytes_b64u),
    input.signature,
  );
  const result: SignedPayload = {
    request_id: input.request.request_id,
    signer_key_id: input.plan.signer_key_id,
    unsigned_payload_hash: input.plan.sign_doc_bytes_hash,
    signed_payload_b64u: base64UrlEncode(txBytes),
    signed_payload_hash: sha256BytesId(txBytes),
    operation_id: input.signer_operation_id ?? null,
  };
  const checked = assertSignedPayloadMatchesRequest(input.request, result);
  verifyZeroneEconomySignedPayload({
    plan: input.plan,
    request: input.request,
    payload: checked,
  });
  return checked;
}

export function verifyZeroneEconomySignedPayload(input: {
  readonly plan: ZeroneEconomyDirectSignPlan;
  readonly request: Parameters<typeof assertSignedPayloadMatchesRequest>[0];
  readonly payload: Parameters<typeof assertSignedPayloadMatchesRequest>[1];
}): Readonly<VerifiedZeroneEconomyTransaction> {
  assertZeroneEconomyDirectSignPlan(input.plan);
  assertEconomySigningRequest(input.plan, input.request);
  if (
    input.request.authorization.intent_record_id !== input.plan.intent_record_id
    || input.request.signer_key_id !== input.plan.signer_key_id
    || input.request.unsigned_payload_hash !== input.plan.sign_doc_bytes_hash
    || input.request.unsigned_payload_b64u !== input.plan.sign_doc_bytes_b64u
  ) {
    fail("signature_invalid", "Signing request does not bind the exact economy SignDoc.");
  }
  const payload = assertSignedPayloadMatchesRequest(input.request, input.payload);
  const txBytes = base64UrlDecode(payload.signed_payload_b64u, "signed_payload_b64u");
  const decodedTx = decodeEconomyTxRaw(txBytes);
  const expectedBody = base64UrlDecode(input.plan.body_bytes_b64u);
  const expectedAuth = base64UrlDecode(input.plan.auth_info_bytes_b64u);
  if (
    !equalBytes(decodedTx.bodyBytes, expectedBody)
    || !equalBytes(decodedTx.authInfoBytes, expectedAuth)
  ) {
    fail(
      "signature_invalid",
      "Signed TxRaw does not contain the exact planned TxBody and AuthInfo.",
    );
  }
  const decodedBody = decodeEconomyTxBody(decodedTx.bodyBytes);
  if (
    decodedBody.length !== input.plan.messages.length
    || decodedBody.some((message, index) => (
      message.typeUrl !== input.plan.messages[index]?.type_url
      || sha256BytesId(message.value) !== input.plan.messages[index]?.value_hash
    ))
  ) {
    fail("signature_invalid", "Signed TxBody messages differ from the exact economy plan.");
  }
  const auth = decodeEconomyAuthInfo(decodedTx.authInfoBytes);
  const expectedPublicKey = base64UrlDecode(
    input.plan.signer_public_key_b64u,
    "plan.signer_public_key_b64u",
  );
  if (
    !equalBytes(auth.publicKey, expectedPublicKey)
    || auth.sequence !== input.plan.sequence
    || auth.feeAmount !== input.plan.fee.amount
    || auth.gasLimit !== input.plan.gas_limit
  ) {
    fail(
      "signature_invalid",
      "Signed AuthInfo differs from the signer, sequence, fee, or gas plan.",
    );
  }
  const signDocBytes = base64UrlDecode(input.plan.sign_doc_bytes_b64u);
  const decodedSignDoc = decodeEconomySignDoc(signDocBytes);
  if (
    !equalBytes(decodedSignDoc.bodyBytes, expectedBody)
    || !equalBytes(decodedSignDoc.authInfoBytes, expectedAuth)
    || decodedSignDoc.chainId !== input.plan.chain_reference
    || decodedSignDoc.accountNumber !== input.plan.account_number
  ) {
    fail("signature_invalid", "SignDoc fields differ from the exact economy plan.");
  }
  if (decodedTx.signature.byteLength !== 64) {
    fail("signature_invalid", "TxRaw must contain one compact secp256k1 signature.");
  }
  let signatureValid = false;
  try {
    signatureValid = secp256k1.verify(
      decodedTx.signature,
      signDocBytes,
      expectedPublicKey,
      { prehash: true, lowS: true, format: "compact" },
    );
  } catch {
    signatureValid = false;
  }
  if (!signatureValid) {
    fail(
      "signature_invalid",
      "Cosmos SIGN_MODE_DIRECT signature is invalid, high-S, or uses the wrong prehash semantics.",
    );
  }
  const transaction: VerifiedZeroneEconomyTransaction = Object.freeze({
    chain_id: input.plan.chain_id,
    intent_record_id: input.plan.intent_record_id,
    plan_id: input.plan.plan_id,
    tx_hash: transactionHash(txBytes),
    tx_bytes_b64u: payload.signed_payload_b64u,
    tx_bytes_hash: payload.signed_payload_hash,
    signed_payload: payload,
  });
  verifiedTransactions.add(transaction);
  return transaction;
}

export function assertVerifiedZeroneEconomyTransaction(
  transaction: VerifiedZeroneEconomyTransaction,
): void {
  if (!verifiedTransactions.has(transaction)) {
    fail(
      "invalid_state",
      "Transaction must be returned by the economy chain-native verifier.",
    );
  }
}

export function createZeroneEconomySimulationReceiptCore(
  input: ZeroneEconomySimulationReceiptInput,
): Readonly<SimulationReceiptCore> {
  assertZeroneEconomyDirectSignPlan(input.plan);
  assertVerifiedRecord(input.intent);
  const simulation = validateSimulationResult(input.plan, input.simulation, false);
  if (
    input.intent.record_id !== input.plan.intent_record_id
    || simulation.simulation_tx_bytes_hash
      !== input.plan.simulation_tx_bytes_hash
  ) {
    fail("simulation_mismatch", "Simulation does not bind the exact plan and intent.");
  }
  return Object.freeze({
    schema: "agent-wallet/simulation/0.1",
    simulation_id: input.simulation_id,
    intent_id: input.intent.intent_id,
    intent_record_id: input.intent.record_id,
    chain_id: input.plan.chain_id,
    source_account: input.plan.source_account,
    adapter: input.adapter,
    block_ref: `${input.plan.chain_reference}:${simulation.observed_at_height}`,
    block_hash: null,
    success: simulation.status === "succeeded",
    effects: [...input.plan.simulation_effects],
    estimated_fee: Object.freeze({
      asset_id: getZeroneProfile(input.plan.network).native_asset_id,
      amount_atomic: input.plan.fee.amount,
    }),
    simulated_at: input.simulated_at,
    valid_until: input.valid_until,
  });
}

export function zeroneEconomyDirectSignAlgorithm(): typeof ZERONE_DIRECT_SIGN_ALGORITHM {
  return ZERONE_DIRECT_SIGN_ALGORITHM;
}
