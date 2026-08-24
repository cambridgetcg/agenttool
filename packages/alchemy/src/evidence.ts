import { createHash } from "node:crypto";

/** Provider-neutral, privacy-explicit EVM observation evidence. */
export const EVM_OBSERVATION_EVIDENCE_FORMAT =
  "agenttool.evm-observation-evidence/0.1" as const;
export const EVM_OBSERVATION_EVIDENCE_DIGEST_DOMAIN =
  `${EVM_OBSERVATION_EVIDENCE_FORMAT}\0` as const;

/** A semantic mapping receipt. It performs no lifecycle or wallet action. */
export const EVM_EVIDENCE_TRANSITION_RECEIPT_FORMAT =
  "agenttool.evm-evidence-transition-receipt/0.1" as const;
export const EVM_EVIDENCE_TRANSITION_DIGEST_DOMAIN =
  `${EVM_EVIDENCE_TRANSITION_RECEIPT_FORMAT}\0` as const;

/** A pure projection into Math Cards measurement vocabulary, not registration. */
export const EVM_MEASUREMENT_PROJECTION_FORMAT =
  "agenttool.evm-measurement-projection/0.1" as const;

export const EVM_EVIDENCE_NON_GRANTS = [
  "action",
  "authority",
  "consent",
  "custody",
  "finality",
  "identity",
  "permission",
  "privacy",
  "provider_independence",
  "rights_status",
  "truth",
] as const;

export const EVM_EVIDENCE_PRIVACY_BOUNDARY = {
  classification: "private_linkable",
  digest_disclosure: "reveals_record_equality",
  direct_identifiers: "present",
  public_safe: false,
} as const;

export type Sha256Digest = `sha256:${string}`;
export type EvmCaip2ChainId = `eip155:${string}`;
export type CanonicalEvmAddress = `0x${string}`;
export type CanonicalEvmHash = `0x${string}`;
export type CanonicalUnsignedDecimal = string;

export type EvmObservationState =
  | "unavailable"
  | "not_observed"
  | "absent"
  | "live"
  | "removed"
  | "conflicting";

export type EvmCanonicalityAssertion =
  | "unavailable"
  | "not_observed"
  | "canonical"
  | "non_canonical"
  | "conflicting";

export type EvmConfirmationStatus =
  | "unavailable"
  | "not_observed"
  | "exact";

export type EvmSettlementAssertion =
  | "unavailable"
  | "not_observed"
  | "unsettled"
  | "provider_safe"
  | "provider_finalized"
  | "external_finalized"
  | "conflicting";

export interface EvmEvidenceGeneration {
  readonly block_number: CanonicalUnsignedDecimal;
  readonly block_hash: CanonicalEvmHash;
  readonly transaction_hash: CanonicalEvmHash;
  readonly log_index: CanonicalUnsignedDecimal;
}

export interface EvmAtomicQuantity {
  readonly atomic_value: CanonicalUnsignedDecimal;
  /** `eip155:<chain>/erc20:<lowercase-address>/base-unit`. */
  readonly atomic_unit: string;
}

export interface EvmTransferClaim {
  readonly kind: "erc20_transfer";
  readonly contract_address: CanonicalEvmAddress;
  readonly from_address: CanonicalEvmAddress | null;
  readonly to_address: CanonicalEvmAddress;
  readonly quantity: EvmAtomicQuantity;
}

export interface EvmFinalityAxes {
  readonly canonicality: EvmCanonicalityAssertion;
  readonly confirmations: {
    readonly status: EvmConfirmationStatus;
    readonly count: CanonicalUnsignedDecimal | null;
  };
  readonly settlement: EvmSettlementAssertion;
}

export type EvmObservationChannel =
  | "none"
  | "signed_delivery"
  | "rpc_read"
  | "indexed_read"
  | "combined"
  | "caller_supplied";

export interface EvmEvidenceBasis {
  readonly observation_channel: EvmObservationChannel;
  readonly observed_at: string | null;
  readonly source_receipt_digest: Sha256Digest | null;
}

export interface EvmObservationEvidenceContent {
  readonly _format: typeof EVM_OBSERVATION_EVIDENCE_FORMAT;
  readonly chain_id: EvmCaip2ChainId;
  readonly generation: EvmEvidenceGeneration;
  readonly observation_state: EvmObservationState;
  readonly transfer: EvmTransferClaim;
  readonly finality: EvmFinalityAxes;
  readonly basis: EvmEvidenceBasis;
  readonly privacy: typeof EVM_EVIDENCE_PRIVACY_BOUNDARY;
  readonly non_grants: typeof EVM_EVIDENCE_NON_GRANTS;
}

export interface EvmObservationEvidence
  extends EvmObservationEvidenceContent {
  readonly content_digest: Sha256Digest;
}

export interface CreateEvmObservationEvidenceInput {
  readonly chain_id: EvmCaip2ChainId;
  readonly generation: EvmEvidenceGeneration;
  readonly observation_state: EvmObservationState;
  readonly transfer: EvmTransferClaim;
  readonly finality: EvmFinalityAxes;
  readonly basis: EvmEvidenceBasis;
}

export type EvmFinalityComparison =
  | "equal"
  | "left_dominates"
  | "right_dominates"
  | "incomparable";

export const EVM_SEMANTIC_FACETS = [
  "chain_id",
  "block_generation",
  "transaction_identity",
  "transfer_parties",
  "atomic_quantity",
  "observation_state",
  "finality_axes",
  "basis",
] as const;
export type EvmSemanticFacet = (typeof EVM_SEMANTIC_FACETS)[number];

export const EVM_TRANSITION_ASSUMPTIONS = [
  "chain_mapping_accepted",
  "current_generation_selected",
  "logical_event_equivalent",
  "observation_channel_authentic",
  "policy_supplied",
] as const;
export type EvmTransitionAssumption =
  (typeof EVM_TRANSITION_ASSUMPTIONS)[number];

export type EvmTransitionRelation =
  | "initial_observation"
  | "same_generation"
  | "replacement_generation"
  | "removed_generation"
  | "conflicting_evidence"
  | "no_observation";

export type EvmTransitionCounterexample =
  | "unavailable_evidence"
  | "stale_generation"
  | "conflicting_block_hash"
  | "logical_identity_mismatch"
  | "removed_current_generation";

export type EvmTransitionStopCondition =
  | "continue_observing"
  | "hold_unavailable"
  | "hold_conflict"
  | "reject_exact_mismatch"
  | "credit_current_generation_once"
  | "reverse_current_generation_once"
  | "no_effect";

export interface EvmEvidenceTransitionReceiptContent {
  readonly _format: typeof EVM_EVIDENCE_TRANSITION_RECEIPT_FORMAT;
  readonly from_digest: Sha256Digest | null;
  readonly to_digest: Sha256Digest;
  readonly relation: EvmTransitionRelation;
  readonly preserved: readonly EvmSemanticFacet[];
  readonly discarded: readonly EvmSemanticFacet[];
  readonly assumptions: readonly EvmTransitionAssumption[];
  readonly counterexample: EvmTransitionCounterexample | null;
  readonly stop_condition: EvmTransitionStopCondition;
  readonly effect_boundary: "semantic_only_no_state_change";
  readonly privacy: typeof EVM_EVIDENCE_PRIVACY_BOUNDARY;
  readonly non_grants: typeof EVM_EVIDENCE_NON_GRANTS;
}

export interface EvmEvidenceTransitionReceipt
  extends EvmEvidenceTransitionReceiptContent {
  readonly content_digest: Sha256Digest;
}

export interface CreateEvmEvidenceTransitionReceiptInput {
  readonly from_digest: Sha256Digest | null;
  readonly to_digest: Sha256Digest;
  readonly relation: EvmTransitionRelation;
  readonly preserved: readonly EvmSemanticFacet[];
  readonly discarded: readonly EvmSemanticFacet[];
  readonly assumptions: readonly EvmTransitionAssumption[];
  readonly counterexample: EvmTransitionCounterexample | null;
  readonly stop_condition: EvmTransitionStopCondition;
}

export type EvmMeasurementReference = Sha256Digest;

export interface EvmMeasurementProjection {
  readonly _format: typeof EVM_MEASUREMENT_PROJECTION_FORMAT;
  readonly evidence_digest: Sha256Digest;
  readonly measurand: {
    readonly kind: "evm_transfer_atomic_quantity";
    readonly chain_id: EvmCaip2ChainId;
    readonly atomic_unit: string;
  };
  readonly operationalization: {
    readonly evidence_format: typeof EVM_OBSERVATION_EVIDENCE_FORMAT;
    readonly generation: EvmEvidenceGeneration;
    readonly observation_state: EvmObservationState;
    readonly atomic_value: CanonicalUnsignedDecimal;
  };
  readonly procedure_ref: EvmMeasurementReference;
  readonly calibration_ref: EvmMeasurementReference | null;
  readonly uncertainty_ref: EvmMeasurementReference;
  readonly host_contract: "not_registered";
  readonly effect_boundary: "projection_only_no_action";
  readonly privacy: typeof EVM_EVIDENCE_PRIVACY_BOUNDARY;
  readonly non_inheritance: readonly ["action", "permission", "authority"];
}

const MAX_UINT256 = (1n << 256n) - 1n;
const MAX_UINT64 = (1n << 64n) - 1n;
const CAIP2 = /^eip155:([1-9][0-9]{0,31})$/u;
const ADDRESS = /^0x[0-9a-f]{40}$/u;
const HASH = /^0x[0-9a-f]{64}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const DECIMAL = /^(0|[1-9][0-9]{0,77})$/u;
const TIMESTAMP =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/u;
const MEASUREMENT_REF = SHA256;

const OBSERVATION_STATES: readonly EvmObservationState[] = [
  "unavailable",
  "not_observed",
  "absent",
  "live",
  "removed",
  "conflicting",
];
const CANONICALITY_ASSERTIONS: readonly EvmCanonicalityAssertion[] = [
  "unavailable",
  "not_observed",
  "canonical",
  "non_canonical",
  "conflicting",
];
const CONFIRMATION_STATUSES: readonly EvmConfirmationStatus[] = [
  "unavailable",
  "not_observed",
  "exact",
];
const SETTLEMENT_ASSERTIONS: readonly EvmSettlementAssertion[] = [
  "unavailable",
  "not_observed",
  "unsettled",
  "provider_safe",
  "provider_finalized",
  "external_finalized",
  "conflicting",
];
const OBSERVATION_CHANNELS: readonly EvmObservationChannel[] = [
  "none",
  "signed_delivery",
  "rpc_read",
  "indexed_read",
  "combined",
  "caller_supplied",
];
const TRANSITION_RELATIONS: readonly EvmTransitionRelation[] = [
  "initial_observation",
  "same_generation",
  "replacement_generation",
  "removed_generation",
  "conflicting_evidence",
  "no_observation",
];
const TRANSITION_COUNTEREXAMPLES: readonly EvmTransitionCounterexample[] = [
  "unavailable_evidence",
  "stale_generation",
  "conflicting_block_hash",
  "logical_identity_mismatch",
  "removed_current_generation",
];
const TRANSITION_STOP_CONDITIONS: readonly EvmTransitionStopCondition[] = [
  "continue_observing",
  "hold_unavailable",
  "hold_conflict",
  "reject_exact_mismatch",
  "credit_current_generation_once",
  "reverse_current_generation_once",
  "no_effect",
];

type PlainRecord = Record<string, unknown>;
type AxisOrder = -1 | 0 | 1 | null;

function fail(path: string, message: string): never {
  throw new TypeError(`${path}: ${message}`);
}

function exactRecord(
  value: unknown,
  path: string,
  keys: readonly string[],
): PlainRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(path, "expected an object");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail(path, "expected a plain object");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!("value" in descriptor)) {
      fail(`${path}.${key}`, "accessors are not accepted");
    }
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    fail(path, `expected exactly keys ${expected.join(", ")}`);
  }
  return value as PlainRecord;
}

function exactString<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    fail(path, `expected one of ${allowed.join(", ")}`);
  }
  return value as T;
}

function canonicalDecimal(
  value: unknown,
  path: string,
  maximum = MAX_UINT256,
): CanonicalUnsignedDecimal {
  if (typeof value !== "string" || !DECIMAL.test(value)) {
    fail(path, "expected a canonical unsigned decimal string");
  }
  if (BigInt(value) > maximum) {
    fail(path, "exceeds the supported unsigned integer bound");
  }
  return value;
}

function caip2(value: unknown, path: string): EvmCaip2ChainId {
  if (typeof value !== "string" || !CAIP2.test(value)) {
    fail(path, "expected exact canonical eip155 CAIP-2 chain identity");
  }
  return value as EvmCaip2ChainId;
}

function address(value: unknown, path: string): CanonicalEvmAddress {
  if (typeof value !== "string" || !ADDRESS.test(value)) {
    fail(path, "expected a lowercase 20-byte EVM address");
  }
  return value as CanonicalEvmAddress;
}

function nullableAddress(
  value: unknown,
  path: string,
): CanonicalEvmAddress | null {
  return value === null ? null : address(value, path);
}

function hash(value: unknown, path: string): CanonicalEvmHash {
  if (typeof value !== "string" || !HASH.test(value)) {
    fail(path, "expected a lowercase 32-byte EVM hash");
  }
  return value as CanonicalEvmHash;
}

function digest(value: unknown, path: string): Sha256Digest {
  if (typeof value !== "string" || !SHA256.test(value)) {
    fail(path, "expected sha256:<64 lowercase hex>");
  }
  return value as Sha256Digest;
}

function nullableDigest(value: unknown, path: string): Sha256Digest | null {
  return value === null ? null : digest(value, path);
}

function canonicalTimestamp(value: unknown, path: string): string {
  if (typeof value !== "string" || !TIMESTAMP.test(value)) {
    fail(path, "expected a canonical UTC timestamp");
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    fail(path, "expected a canonical millisecond UTC timestamp");
  }
  return value;
}

function nullableTimestamp(value: unknown, path: string): string | null {
  return value === null ? null : canonicalTimestamp(value, path);
}

function canonicalArray<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
  minimumLength: number,
): readonly T[] {
  if (!Array.isArray(value) || value.length < minimumLength || value.length > allowed.length) {
    fail(path, `expected ${minimumLength}-${allowed.length} canonical entries`);
  }
  const normalized = value.map((entry, index) =>
    exactString(entry, allowed, `${path}[${index}]`),
  );
  const indexes = normalized.map((entry) => allowed.indexOf(entry));
  if (indexes.some((entry, index) => index > 0 && entry <= indexes[index - 1]!)) {
    fail(path, "entries must be unique and in canonical vocabulary order");
  }
  return normalized;
}

function exactConstantArray(
  value: unknown,
  expected: readonly string[],
  path: string,
): void {
  if (
    !Array.isArray(value) ||
    value.length !== expected.length ||
    value.some((entry, index) => entry !== expected[index])
  ) {
    fail(path, "does not match the required closed boundary");
  }
}

function privacyBoundary(
  value: unknown,
  path: string,
): typeof EVM_EVIDENCE_PRIVACY_BOUNDARY {
  const record = exactRecord(value, path, [
    "classification",
    "digest_disclosure",
    "direct_identifiers",
    "public_safe",
  ]);
  if (
    record.classification !== EVM_EVIDENCE_PRIVACY_BOUNDARY.classification ||
    record.digest_disclosure !== EVM_EVIDENCE_PRIVACY_BOUNDARY.digest_disclosure ||
    record.direct_identifiers !== EVM_EVIDENCE_PRIVACY_BOUNDARY.direct_identifiers ||
    record.public_safe !== false
  ) {
    fail(path, "does not match the required private/linkable boundary");
  }
  return EVM_EVIDENCE_PRIVACY_BOUNDARY;
}

function normalizeGeneration(
  value: unknown,
  path: string,
): EvmEvidenceGeneration {
  const record = exactRecord(value, path, [
    "block_number",
    "block_hash",
    "transaction_hash",
    "log_index",
  ]);
  return {
    block_number: canonicalDecimal(record.block_number, `${path}.block_number`),
    block_hash: hash(record.block_hash, `${path}.block_hash`),
    transaction_hash: hash(record.transaction_hash, `${path}.transaction_hash`),
    log_index: canonicalDecimal(record.log_index, `${path}.log_index`, MAX_UINT64),
  };
}

function normalizeTransfer(
  value: unknown,
  chainId: EvmCaip2ChainId,
  path: string,
): EvmTransferClaim {
  const record = exactRecord(value, path, [
    "kind",
    "contract_address",
    "from_address",
    "to_address",
    "quantity",
  ]);
  if (record.kind !== "erc20_transfer") {
    fail(`${path}.kind`, "expected erc20_transfer");
  }
  const contractAddress = address(record.contract_address, `${path}.contract_address`);
  const quantity = exactRecord(record.quantity, `${path}.quantity`, [
    "atomic_value",
    "atomic_unit",
  ]);
  const expectedUnit = `${chainId}/erc20:${contractAddress}/base-unit`;
  if (quantity.atomic_unit !== expectedUnit) {
    fail(
      `${path}.quantity.atomic_unit`,
      "must exactly bind the CAIP-2 chain and ERC-20 contract",
    );
  }
  return {
    kind: "erc20_transfer",
    contract_address: contractAddress,
    from_address: nullableAddress(record.from_address, `${path}.from_address`),
    to_address: address(record.to_address, `${path}.to_address`),
    quantity: {
      atomic_value: canonicalDecimal(
        quantity.atomic_value,
        `${path}.quantity.atomic_value`,
      ),
      atomic_unit: expectedUnit,
    },
  };
}

function normalizeFinality(value: unknown, path: string): EvmFinalityAxes {
  const record = exactRecord(value, path, [
    "canonicality",
    "confirmations",
    "settlement",
  ]);
  const confirmations = exactRecord(
    record.confirmations,
    `${path}.confirmations`,
    ["status", "count"],
  );
  const status = exactString(
    confirmations.status,
    CONFIRMATION_STATUSES,
    `${path}.confirmations.status`,
  );
  const count =
    confirmations.count === null
      ? null
      : canonicalDecimal(confirmations.count, `${path}.confirmations.count`);
  if ((status === "exact") !== (count !== null)) {
    fail(
      `${path}.confirmations`,
      "exact status requires a count and other statuses require null",
    );
  }
  return {
    canonicality: exactString(
      record.canonicality,
      CANONICALITY_ASSERTIONS,
      `${path}.canonicality`,
    ),
    confirmations: { status, count },
    settlement: exactString(
      record.settlement,
      SETTLEMENT_ASSERTIONS,
      `${path}.settlement`,
    ),
  };
}

function normalizeBasis(value: unknown, path: string): EvmEvidenceBasis {
  const record = exactRecord(value, path, [
    "observation_channel",
    "observed_at",
    "source_receipt_digest",
  ]);
  return {
    observation_channel: exactString(
      record.observation_channel,
      OBSERVATION_CHANNELS,
      `${path}.observation_channel`,
    ),
    observed_at: nullableTimestamp(record.observed_at, `${path}.observed_at`),
    source_receipt_digest: nullableDigest(
      record.source_receipt_digest,
      `${path}.source_receipt_digest`,
    ),
  };
}

function enforceEvidenceStateConsistency(
  state: EvmObservationState,
  finality: EvmFinalityAxes,
  basis: EvmEvidenceBasis,
): void {
  if (state === "not_observed") {
    if (
      basis.observation_channel !== "none" ||
      basis.observed_at !== null ||
      basis.source_receipt_digest !== null ||
      finality.canonicality !== "not_observed" ||
      finality.confirmations.status !== "not_observed" ||
      finality.settlement !== "not_observed"
    ) {
      fail("evidence", "not_observed must carry only not-observed axes and no source");
    }
    return;
  }
  if (state === "unavailable") {
    if (
      basis.observation_channel === "none" ||
      basis.observed_at === null ||
      finality.canonicality !== "unavailable" ||
      finality.confirmations.status !== "unavailable" ||
      finality.settlement !== "unavailable"
    ) {
      fail("evidence", "unavailable must carry an attempted channel/time and unavailable axes");
    }
    return;
  }
  if (basis.observation_channel === "none" || basis.observed_at === null) {
    fail("evidence.basis", "an observed assertion requires a channel and observation time");
  }
}

function normalizeEvidenceInput(
  input: CreateEvmObservationEvidenceInput,
): CreateEvmObservationEvidenceInput {
  const record = exactRecord(input, "input", [
    "chain_id",
    "generation",
    "observation_state",
    "transfer",
    "finality",
    "basis",
  ]);
  const chainId = caip2(record.chain_id, "input.chain_id");
  const state = exactString(
    record.observation_state,
    OBSERVATION_STATES,
    "input.observation_state",
  );
  const finality = normalizeFinality(record.finality, "input.finality");
  const basis = normalizeBasis(record.basis, "input.basis");
  enforceEvidenceStateConsistency(state, finality, basis);
  return {
    chain_id: chainId,
    generation: normalizeGeneration(record.generation, "input.generation"),
    observation_state: state,
    transfer: normalizeTransfer(record.transfer, chainId, "input.transfer"),
    finality,
    basis,
  };
}

function evidenceContent(
  input: CreateEvmObservationEvidenceInput,
): EvmObservationEvidenceContent {
  const normalized = normalizeEvidenceInput(input);
  return {
    _format: EVM_OBSERVATION_EVIDENCE_FORMAT,
    chain_id: normalized.chain_id,
    generation: normalized.generation,
    observation_state: normalized.observation_state,
    transfer: normalized.transfer,
    finality: normalized.finality,
    basis: normalized.basis,
    privacy: EVM_EVIDENCE_PRIVACY_BOUNDARY,
    non_grants: EVM_EVIDENCE_NON_GRANTS,
  };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      fail("canonical JSON", "numbers must be safe integers");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  fail("canonical JSON", `unsupported ${typeof value} value`);
}

function domainBytes(domain: string, value: unknown): Uint8Array {
  return new TextEncoder().encode(`${domain}${canonicalJson(value)}`);
}

function sha256(bytes: Uint8Array): Sha256Digest {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function freezeDeep<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) {
      freezeDeep(child);
    }
    Object.freeze(value);
  }
  return value;
}

export function canonicalEvmObservationEvidenceBytes(
  content: EvmObservationEvidenceContent,
): Uint8Array {
  const record = exactRecord(content, "content", [
    "_format",
    "chain_id",
    "generation",
    "observation_state",
    "transfer",
    "finality",
    "basis",
    "privacy",
    "non_grants",
  ]);
  if (record._format !== EVM_OBSERVATION_EVIDENCE_FORMAT) {
    fail("content._format", `expected ${EVM_OBSERVATION_EVIDENCE_FORMAT}`);
  }
  privacyBoundary(record.privacy, "content.privacy");
  exactConstantArray(record.non_grants, EVM_EVIDENCE_NON_GRANTS, "content.non_grants");
  const normalized = evidenceContent({
    chain_id: record.chain_id as EvmCaip2ChainId,
    generation: record.generation as EvmEvidenceGeneration,
    observation_state: record.observation_state as EvmObservationState,
    transfer: record.transfer as EvmTransferClaim,
    finality: record.finality as EvmFinalityAxes,
    basis: record.basis as EvmEvidenceBasis,
  });
  return domainBytes(EVM_OBSERVATION_EVIDENCE_DIGEST_DOMAIN, normalized);
}

export function createEvmObservationEvidence(
  input: CreateEvmObservationEvidenceInput,
): EvmObservationEvidence {
  const content = evidenceContent(input);
  return freezeDeep({
    ...content,
    content_digest: sha256(
      domainBytes(EVM_OBSERVATION_EVIDENCE_DIGEST_DOMAIN, content),
    ),
  }) as EvmObservationEvidence;
}

export function parseEvmObservationEvidence(
  value: unknown,
): EvmObservationEvidence {
  const record = exactRecord(value, "evidence", [
    "_format",
    "chain_id",
    "generation",
    "observation_state",
    "transfer",
    "finality",
    "basis",
    "privacy",
    "non_grants",
    "content_digest",
  ]);
  if (record._format !== EVM_OBSERVATION_EVIDENCE_FORMAT) {
    fail("evidence._format", `expected ${EVM_OBSERVATION_EVIDENCE_FORMAT}`);
  }
  privacyBoundary(record.privacy, "evidence.privacy");
  exactConstantArray(record.non_grants, EVM_EVIDENCE_NON_GRANTS, "evidence.non_grants");
  const expectedDigest = digest(record.content_digest, "evidence.content_digest");
  const normalized = createEvmObservationEvidence({
    chain_id: record.chain_id as EvmCaip2ChainId,
    generation: record.generation as EvmEvidenceGeneration,
    observation_state: record.observation_state as EvmObservationState,
    transfer: record.transfer as EvmTransferClaim,
    finality: record.finality as EvmFinalityAxes,
    basis: record.basis as EvmEvidenceBasis,
  });
  if (normalized.content_digest !== expectedDigest) {
    fail("evidence.content_digest", "does not match canonical domain-separated content");
  }
  return normalized;
}

function categoricalAxisOrder(
  left: string,
  right: string,
  observed: ReadonlySet<string>,
): AxisOrder {
  if (left === right) return 0;
  const leftMissing = left === "unavailable" || left === "not_observed";
  const rightMissing = right === "unavailable" || right === "not_observed";
  if (leftMissing && rightMissing) return null;
  if (leftMissing && observed.has(right)) return -1;
  if (rightMissing && observed.has(left)) return 1;
  return null;
}

function confirmationAxisOrder(
  left: EvmFinalityAxes["confirmations"],
  right: EvmFinalityAxes["confirmations"],
): AxisOrder {
  if (left.status === right.status) {
    if (left.status !== "exact") return 0;
    const leftCount = BigInt(left.count!);
    const rightCount = BigInt(right.count!);
    return leftCount === rightCount ? 0 : leftCount > rightCount ? 1 : -1;
  }
  if (left.status === "exact") return 1;
  if (right.status === "exact") return -1;
  return null;
}

function settlementAxisOrder(
  left: EvmSettlementAssertion,
  right: EvmSettlementAssertion,
): AxisOrder {
  const base = categoricalAxisOrder(
    left,
    right,
    new Set([
      "unsettled",
      "provider_safe",
      "provider_finalized",
      "external_finalized",
      "conflicting",
    ]),
  );
  if (base !== null) return base;
  const providerRank: Partial<Record<EvmSettlementAssertion, number>> = {
    unsettled: 0,
    provider_safe: 1,
    provider_finalized: 2,
  };
  const leftRank = providerRank[left];
  const rightRank = providerRank[right];
  if (leftRank !== undefined && rightRank !== undefined) {
    return leftRank === rightRank ? 0 : leftRank > rightRank ? 1 : -1;
  }
  if (left === "external_finalized" && right === "unsettled") return 1;
  if (right === "external_finalized" && left === "unsettled") return -1;
  return null;
}

export function compareEvmFinality(
  left: EvmFinalityAxes,
  right: EvmFinalityAxes,
): EvmFinalityComparison {
  const leftNormalized = normalizeFinality(left, "left");
  const rightNormalized = normalizeFinality(right, "right");
  const axes: readonly AxisOrder[] = [
    categoricalAxisOrder(
      leftNormalized.canonicality,
      rightNormalized.canonicality,
      new Set(["canonical", "non_canonical", "conflicting"]),
    ),
    confirmationAxisOrder(
      leftNormalized.confirmations,
      rightNormalized.confirmations,
    ),
    settlementAxisOrder(
      leftNormalized.settlement,
      rightNormalized.settlement,
    ),
  ];
  if (axes.some((axis) => axis === null)) return "incomparable";
  const ordered = axes as readonly (-1 | 0 | 1)[];
  const hasLeft = ordered.includes(1);
  const hasRight = ordered.includes(-1);
  if (hasLeft && hasRight) return "incomparable";
  if (hasLeft) return "left_dominates";
  if (hasRight) return "right_dominates";
  return "equal";
}

function normalizeReceiptInput(
  input: CreateEvmEvidenceTransitionReceiptInput,
): CreateEvmEvidenceTransitionReceiptInput {
  const record = exactRecord(input, "input", [
    "from_digest",
    "to_digest",
    "relation",
    "preserved",
    "discarded",
    "assumptions",
    "counterexample",
    "stop_condition",
  ]);
  const relation = exactString(
    record.relation,
    TRANSITION_RELATIONS,
    "input.relation",
  );
  const fromDigest = nullableDigest(record.from_digest, "input.from_digest");
  if ((relation === "initial_observation") !== (fromDigest === null)) {
    fail(
      "input",
      "initial_observation requires null from_digest and every other relation requires a digest",
    );
  }
  const preserved = canonicalArray(
    record.preserved,
    EVM_SEMANTIC_FACETS,
    "input.preserved",
    1,
  );
  const discarded = canonicalArray(
    record.discarded,
    EVM_SEMANTIC_FACETS,
    "input.discarded",
    0,
  );
  if (preserved.some((facet) => discarded.includes(facet))) {
    fail("input", "preserved and discarded facets must be disjoint");
  }
  if (new Set([...preserved, ...discarded]).size !== EVM_SEMANTIC_FACETS.length) {
    fail(
      "input",
      "preserved and discarded must account for every semantic facet",
    );
  }
  return {
    from_digest: fromDigest,
    to_digest: digest(record.to_digest, "input.to_digest"),
    relation,
    preserved,
    discarded,
    assumptions: canonicalArray(
      record.assumptions,
      EVM_TRANSITION_ASSUMPTIONS,
      "input.assumptions",
      0,
    ),
    counterexample:
      record.counterexample === null
        ? null
        : exactString(
            record.counterexample,
            TRANSITION_COUNTEREXAMPLES,
            "input.counterexample",
          ),
    stop_condition: exactString(
      record.stop_condition,
      TRANSITION_STOP_CONDITIONS,
      "input.stop_condition",
    ),
  };
}

function receiptContent(
  input: CreateEvmEvidenceTransitionReceiptInput,
): EvmEvidenceTransitionReceiptContent {
  const normalized = normalizeReceiptInput(input);
  return {
    _format: EVM_EVIDENCE_TRANSITION_RECEIPT_FORMAT,
    from_digest: normalized.from_digest,
    to_digest: normalized.to_digest,
    relation: normalized.relation,
    preserved: normalized.preserved,
    discarded: normalized.discarded,
    assumptions: normalized.assumptions,
    counterexample: normalized.counterexample,
    stop_condition: normalized.stop_condition,
    effect_boundary: "semantic_only_no_state_change",
    privacy: EVM_EVIDENCE_PRIVACY_BOUNDARY,
    non_grants: EVM_EVIDENCE_NON_GRANTS,
  };
}

export function canonicalEvmEvidenceTransitionReceiptBytes(
  content: EvmEvidenceTransitionReceiptContent,
): Uint8Array {
  const record = exactRecord(content, "content", [
    "_format",
    "from_digest",
    "to_digest",
    "relation",
    "preserved",
    "discarded",
    "assumptions",
    "counterexample",
    "stop_condition",
    "effect_boundary",
    "privacy",
    "non_grants",
  ]);
  if (record._format !== EVM_EVIDENCE_TRANSITION_RECEIPT_FORMAT) {
    fail("content._format", `expected ${EVM_EVIDENCE_TRANSITION_RECEIPT_FORMAT}`);
  }
  if (record.effect_boundary !== "semantic_only_no_state_change") {
    fail("content.effect_boundary", "expected semantic_only_no_state_change");
  }
  privacyBoundary(record.privacy, "content.privacy");
  exactConstantArray(record.non_grants, EVM_EVIDENCE_NON_GRANTS, "content.non_grants");
  const normalized = receiptContent({
    from_digest: record.from_digest as Sha256Digest | null,
    to_digest: record.to_digest as Sha256Digest,
    relation: record.relation as EvmTransitionRelation,
    preserved: record.preserved as readonly EvmSemanticFacet[],
    discarded: record.discarded as readonly EvmSemanticFacet[],
    assumptions: record.assumptions as readonly EvmTransitionAssumption[],
    counterexample: record.counterexample as EvmTransitionCounterexample | null,
    stop_condition: record.stop_condition as EvmTransitionStopCondition,
  });
  return domainBytes(EVM_EVIDENCE_TRANSITION_DIGEST_DOMAIN, normalized);
}

export function createEvmEvidenceTransitionReceipt(
  input: CreateEvmEvidenceTransitionReceiptInput,
): EvmEvidenceTransitionReceipt {
  const content = receiptContent(input);
  return freezeDeep({
    ...content,
    content_digest: sha256(
      domainBytes(EVM_EVIDENCE_TRANSITION_DIGEST_DOMAIN, content),
    ),
  }) as EvmEvidenceTransitionReceipt;
}

export function parseEvmEvidenceTransitionReceipt(
  value: unknown,
): EvmEvidenceTransitionReceipt {
  const record = exactRecord(value, "receipt", [
    "_format",
    "from_digest",
    "to_digest",
    "relation",
    "preserved",
    "discarded",
    "assumptions",
    "counterexample",
    "stop_condition",
    "effect_boundary",
    "privacy",
    "non_grants",
    "content_digest",
  ]);
  if (record._format !== EVM_EVIDENCE_TRANSITION_RECEIPT_FORMAT) {
    fail("receipt._format", `expected ${EVM_EVIDENCE_TRANSITION_RECEIPT_FORMAT}`);
  }
  if (record.effect_boundary !== "semantic_only_no_state_change") {
    fail("receipt.effect_boundary", "expected semantic_only_no_state_change");
  }
  privacyBoundary(record.privacy, "receipt.privacy");
  exactConstantArray(record.non_grants, EVM_EVIDENCE_NON_GRANTS, "receipt.non_grants");
  const expectedDigest = digest(record.content_digest, "receipt.content_digest");
  const normalized = createEvmEvidenceTransitionReceipt({
    from_digest: record.from_digest as Sha256Digest | null,
    to_digest: record.to_digest as Sha256Digest,
    relation: record.relation as EvmTransitionRelation,
    preserved: record.preserved as readonly EvmSemanticFacet[],
    discarded: record.discarded as readonly EvmSemanticFacet[],
    assumptions: record.assumptions as readonly EvmTransitionAssumption[],
    counterexample: record.counterexample as EvmTransitionCounterexample | null,
    stop_condition: record.stop_condition as EvmTransitionStopCondition,
  });
  if (normalized.content_digest !== expectedDigest) {
    fail("receipt.content_digest", "does not match canonical domain-separated content");
  }
  return normalized;
}

function measurementReference(
  value: unknown,
  path: string,
): EvmMeasurementReference {
  if (typeof value !== "string" || !MEASUREMENT_REF.test(value)) {
    fail(path, "expected sha256:<64 lowercase hex>");
  }
  return value as EvmMeasurementReference;
}

export function projectEvmEvidenceMeasurement(input: {
  readonly evidence: EvmObservationEvidence;
  readonly procedure_ref: EvmMeasurementReference;
  readonly calibration_ref: EvmMeasurementReference | null;
  readonly uncertainty_ref: EvmMeasurementReference;
}): EvmMeasurementProjection {
  const record = exactRecord(input, "input", [
    "evidence",
    "procedure_ref",
    "calibration_ref",
    "uncertainty_ref",
  ]);
  const evidence = parseEvmObservationEvidence(record.evidence);
  const projection: EvmMeasurementProjection = {
    _format: EVM_MEASUREMENT_PROJECTION_FORMAT,
    evidence_digest: evidence.content_digest,
    measurand: {
      kind: "evm_transfer_atomic_quantity",
      chain_id: evidence.chain_id,
      atomic_unit: evidence.transfer.quantity.atomic_unit,
    },
    operationalization: {
      evidence_format: EVM_OBSERVATION_EVIDENCE_FORMAT,
      generation: evidence.generation,
      observation_state: evidence.observation_state,
      atomic_value: evidence.transfer.quantity.atomic_value,
    },
    procedure_ref: measurementReference(record.procedure_ref, "input.procedure_ref"),
    calibration_ref:
      record.calibration_ref === null
        ? null
        : measurementReference(record.calibration_ref, "input.calibration_ref"),
    uncertainty_ref: measurementReference(
      record.uncertainty_ref,
      "input.uncertainty_ref",
    ),
    host_contract: "not_registered",
    effect_boundary: "projection_only_no_action",
    privacy: EVM_EVIDENCE_PRIVACY_BOUNDARY,
    non_inheritance: ["action", "permission", "authority"],
  };
  return freezeDeep(projection) as EvmMeasurementProjection;
}
