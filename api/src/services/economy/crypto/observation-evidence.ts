/**
 * Pure API-side conformance adapter for the shared EVM evidence wire.
 *
 * The production image copies only `api/src`, so this module deliberately
 * imports neither `packages/alchemy` nor repository JSON assets. Focused
 * conformance tests compare its bytes with the package implementation and
 * shared vectors. This adapter writes no database state and grants no wallet
 * or lifecycle authority.
 *
 * Doctrine: docs/ALCHEMY-MATHEMATICAL-FRAMEWORK.md.
 */

import { createHash } from "node:crypto";

export const API_EVM_OBSERVATION_EVIDENCE_FORMAT =
  "agenttool.evm-observation-evidence/0.1" as const;
export const API_EVM_EVIDENCE_TRANSITION_RECEIPT_FORMAT =
  "agenttool.evm-evidence-transition-receipt/0.1" as const;

const OBSERVATION_DOMAIN = `${API_EVM_OBSERVATION_EVIDENCE_FORMAT}\0`;
const TRANSITION_DOMAIN = `${API_EVM_EVIDENCE_TRANSITION_RECEIPT_FORMAT}\0`;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const CAIP2 = /^eip155:[1-9][0-9]{0,31}$/u;
const ADDRESS = /^0x[0-9a-f]{40}$/u;
const HASH = /^0x[0-9a-f]{64}$/u;
const DECIMAL = /^(0|[1-9][0-9]{0,77})$/u;
const TIMESTAMP =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/u;
const MAX_UINT256 = (1n << 256n) - 1n;
const MAX_UINT64 = (1n << 64n) - 1n;

export const API_EVM_EVIDENCE_NON_GRANTS = [
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

export const API_EVM_EVIDENCE_PRIVACY = {
  classification: "private_linkable",
  digest_disclosure: "reveals_record_equality",
  direct_identifiers: "present",
  public_safe: false,
} as const;

type Digest = `sha256:${string}`;
type Address = `0x${string}`;
type Hash = `0x${string}`;
type Caip2 = `eip155:${string}`;
type ObservationState =
  | "unavailable"
  | "not_observed"
  | "absent"
  | "live"
  | "removed"
  | "conflicting";
type Canonicality =
  | "unavailable"
  | "not_observed"
  | "canonical"
  | "non_canonical"
  | "conflicting";
type ConfirmationStatus = "unavailable" | "not_observed" | "exact";
type Settlement =
  | "unavailable"
  | "not_observed"
  | "unsettled"
  | "provider_safe"
  | "provider_finalized"
  | "external_finalized"
  | "conflicting";
type ObservationChannel =
  | "none"
  | "signed_delivery"
  | "rpc_read"
  | "indexed_read"
  | "combined"
  | "caller_supplied";

export interface DepositObservationEvidenceInput {
  readonly chainId: Caip2;
  readonly blockNumber: bigint;
  readonly blockHash: string;
  readonly transactionHash: string;
  readonly logIndex: bigint | number;
  readonly contractAddress: string;
  readonly fromAddress: string | null;
  readonly toAddress: string;
  readonly atomicValue: string;
  readonly observationState: ObservationState;
  readonly finality: {
    readonly canonicality: Canonicality;
    readonly confirmations: {
      readonly status: ConfirmationStatus;
      readonly count: string | null;
    };
    readonly settlement: Settlement;
  };
  readonly basis: {
    readonly observationChannel: ObservationChannel;
    readonly observedAt: string | null;
    readonly sourceReceiptDigest: Digest | null;
  };
}

export interface ApiEvmObservationEvidence {
  readonly _format: typeof API_EVM_OBSERVATION_EVIDENCE_FORMAT;
  readonly chain_id: Caip2;
  readonly generation: {
    readonly block_number: string;
    readonly block_hash: Hash;
    readonly transaction_hash: Hash;
    readonly log_index: string;
  };
  readonly observation_state: ObservationState;
  readonly transfer: {
    readonly kind: "erc20_transfer";
    readonly contract_address: Address;
    readonly from_address: Address | null;
    readonly to_address: Address;
    readonly quantity: {
      readonly atomic_value: string;
      readonly atomic_unit: string;
    };
  };
  readonly finality: DepositObservationEvidenceInput["finality"];
  readonly basis: {
    readonly observation_channel: ObservationChannel;
    readonly observed_at: string | null;
    readonly source_receipt_digest: Digest | null;
  };
  readonly privacy: typeof API_EVM_EVIDENCE_PRIVACY;
  readonly non_grants: typeof API_EVM_EVIDENCE_NON_GRANTS;
  readonly content_digest: Digest;
}

const FACETS = [
  "chain_id",
  "block_generation",
  "transaction_identity",
  "transfer_parties",
  "atomic_quantity",
  "observation_state",
  "finality_axes",
  "basis",
] as const;
type Facet = (typeof FACETS)[number];
const ASSUMPTIONS = [
  "chain_mapping_accepted",
  "current_generation_selected",
  "logical_event_equivalent",
  "observation_channel_authentic",
  "policy_supplied",
] as const;
type Assumption = (typeof ASSUMPTIONS)[number];
type Relation =
  | "initial_observation"
  | "same_generation"
  | "replacement_generation"
  | "removed_generation"
  | "conflicting_evidence"
  | "no_observation";
type Counterexample =
  | "unavailable_evidence"
  | "stale_generation"
  | "conflicting_block_hash"
  | "logical_identity_mismatch"
  | "removed_current_generation";
type StopCondition =
  | "continue_observing"
  | "hold_unavailable"
  | "hold_conflict"
  | "reject_exact_mismatch"
  | "credit_current_generation_once"
  | "reverse_current_generation_once"
  | "no_effect";

export interface DepositEvidenceTransitionInput {
  readonly fromDigest: Digest | null;
  readonly toDigest: Digest;
  readonly relation: Relation;
  readonly preserved: readonly Facet[];
  readonly discarded: readonly Facet[];
  readonly assumptions: readonly Assumption[];
  readonly counterexample: Counterexample | null;
  readonly stopCondition: StopCondition;
}

export interface ApiEvmEvidenceTransitionReceipt {
  readonly _format: typeof API_EVM_EVIDENCE_TRANSITION_RECEIPT_FORMAT;
  readonly from_digest: Digest | null;
  readonly to_digest: Digest;
  readonly relation: Relation;
  readonly preserved: readonly Facet[];
  readonly discarded: readonly Facet[];
  readonly assumptions: readonly Assumption[];
  readonly counterexample: Counterexample | null;
  readonly stop_condition: StopCondition;
  readonly effect_boundary: "semantic_only_no_state_change";
  readonly privacy: typeof API_EVM_EVIDENCE_PRIVACY;
  readonly non_grants: typeof API_EVM_EVIDENCE_NON_GRANTS;
  readonly content_digest: Digest;
}

type RecordValue = Record<string, unknown>;

function fail(path: string, message: string): never {
  throw new TypeError(`${path}: ${message}`);
}

function exactRecord(
  value: unknown,
  path: string,
  expected: readonly string[],
): RecordValue {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(path, "expected an object");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail(path, "expected a plain object");
  }
  for (const [key, descriptor] of Object.entries(
    Object.getOwnPropertyDescriptors(value),
  )) {
    if (!("value" in descriptor)) {
      fail(`${path}.${key}`, "accessors are not accepted");
    }
  }
  const actual = Object.keys(value).sort();
  const keys = [...expected].sort();
  if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index])) {
    fail(path, `expected exactly keys ${keys.join(", ")}`);
  }
  return value as RecordValue;
}

function decimal(value: unknown, path: string, maximum = MAX_UINT256): string {
  if (typeof value !== "string" || !DECIMAL.test(value) || BigInt(value) > maximum) {
    fail(path, "expected a bounded canonical unsigned decimal string");
  }
  return value;
}

function bigintDecimal(value: unknown, path: string, maximum: bigint): string {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      fail(path, "expected a non-negative safe integer or bigint");
    }
    value = BigInt(value);
  }
  if (typeof value !== "bigint" || value < 0n || value > maximum) {
    fail(path, "expected a bounded non-negative bigint");
  }
  return value.toString(10);
}

function caip2(value: unknown): Caip2 {
  if (typeof value !== "string" || !CAIP2.test(value)) {
    fail("input.chainId", "expected exact canonical eip155 CAIP-2 identity");
  }
  return value as Caip2;
}

function address(value: unknown, path: string): Address {
  if (typeof value !== "string") fail(path, "expected an EVM address");
  const normalized = value.toLowerCase();
  if (!ADDRESS.test(normalized)) fail(path, "expected a 20-byte EVM address");
  return normalized as Address;
}

function hash(value: unknown, path: string): Hash {
  if (typeof value !== "string") fail(path, "expected an EVM hash");
  const normalized = value.toLowerCase();
  if (!HASH.test(normalized)) fail(path, "expected a 32-byte EVM hash");
  return normalized as Hash;
}

function digest(value: unknown, path: string): Digest {
  if (typeof value !== "string" || !SHA256.test(value)) {
    fail(path, "expected sha256:<64 lowercase hex>");
  }
  return value as Digest;
}

function timestamp(value: unknown, path: string): string {
  if (typeof value !== "string" || !TIMESTAMP.test(value)) {
    fail(path, "expected a canonical UTC timestamp");
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    fail(path, "expected a canonical millisecond UTC timestamp");
  }
  return value;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as RecordValue;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  fail("canonical JSON", `unsupported ${typeof value} value`);
}

function contentDigest(domain: string, value: unknown): Digest {
  return `sha256:${createHash("sha256").update(
    new TextEncoder().encode(`${domain}${canonicalJson(value)}`),
  ).digest("hex")}`;
}

function canonicalList<T extends string>(
  value: unknown,
  vocabulary: readonly T[],
  path: string,
  minimum: number,
): readonly T[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > vocabulary.length) {
    fail(path, "expected a bounded canonical array");
  }
  const result = value.map((entry, index) => {
    if (typeof entry !== "string" || !vocabulary.includes(entry as T)) {
      fail(`${path}[${index}]`, "unknown vocabulary entry");
    }
    return entry as T;
  });
  const positions = result.map((entry) => vocabulary.indexOf(entry));
  if (positions.some((position, index) => index > 0 && position <= positions[index - 1]!)) {
    fail(path, "entries must be unique and in canonical vocabulary order");
  }
  return result;
}

function freezeDeep<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as RecordValue)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

/**
 * Convert one already-parsed deposit observation into the shared wire.
 * This function neither reads evidence nor decides a wallet transition.
 */
export function adaptDepositObservationEvidence(
  input: DepositObservationEvidenceInput,
): ApiEvmObservationEvidence {
  const record = exactRecord(input, "input", [
    "chainId",
    "blockNumber",
    "blockHash",
    "transactionHash",
    "logIndex",
    "contractAddress",
    "fromAddress",
    "toAddress",
    "atomicValue",
    "observationState",
    "finality",
    "basis",
  ]);
  const chainId = caip2(record.chainId);
  const contractAddress = address(record.contractAddress, "input.contractAddress");
  const finality = exactRecord(record.finality, "input.finality", [
    "canonicality",
    "confirmations",
    "settlement",
  ]) as unknown as DepositObservationEvidenceInput["finality"];
  const confirmations = exactRecord(finality.confirmations, "input.finality.confirmations", [
    "status",
    "count",
  ]);
  const confirmationStatus = finality.confirmations.status;
  if (!["unavailable", "not_observed", "exact"].includes(confirmationStatus)) {
    fail("input.finality.confirmations.status", "unknown status");
  }
  const confirmationCount = confirmations.count === null
    ? null
    : decimal(confirmations.count, "input.finality.confirmations.count");
  if ((confirmationStatus === "exact") !== (confirmationCount !== null)) {
    fail("input.finality.confirmations", "exact status and count must agree");
  }
  if (![
    "unavailable", "not_observed", "canonical", "non_canonical", "conflicting",
  ].includes(finality.canonicality)) {
    fail("input.finality.canonicality", "unknown assertion");
  }
  if (![
    "unavailable", "not_observed", "unsettled", "provider_safe",
    "provider_finalized", "external_finalized", "conflicting",
  ].includes(finality.settlement)) {
    fail("input.finality.settlement", "unknown assertion");
  }
  const basis = exactRecord(record.basis, "input.basis", [
    "observationChannel",
    "observedAt",
    "sourceReceiptDigest",
  ]) as unknown as DepositObservationEvidenceInput["basis"];
  if (![
    "none", "signed_delivery", "rpc_read", "indexed_read", "combined", "caller_supplied",
  ].includes(basis.observationChannel)) {
    fail("input.basis.observationChannel", "unknown channel");
  }
  const observedAt = basis.observedAt === null
    ? null
    : timestamp(basis.observedAt, "input.basis.observedAt");
  const sourceReceiptDigest = basis.sourceReceiptDigest === null
    ? null
    : digest(basis.sourceReceiptDigest, "input.basis.sourceReceiptDigest");
  if (![
    "unavailable", "not_observed", "absent", "live", "removed", "conflicting",
  ].includes(record.observationState as string)) {
    fail("input.observationState", "unknown state");
  }
  const observationState = record.observationState as ObservationState;
  if (observationState === "unavailable") {
    if (
      basis.observationChannel === "none" || observedAt === null ||
      finality.canonicality !== "unavailable" || confirmationStatus !== "unavailable" ||
      finality.settlement !== "unavailable"
    ) fail("input", "unavailable state requires unavailable axes and attempted evidence");
  } else if (observationState === "not_observed") {
    if (
      basis.observationChannel !== "none" || observedAt !== null || sourceReceiptDigest !== null ||
      finality.canonicality !== "not_observed" || confirmationStatus !== "not_observed" ||
      finality.settlement !== "not_observed"
    ) fail("input", "not_observed state requires no source and not-observed axes");
  } else if (basis.observationChannel === "none" || observedAt === null) {
    fail("input.basis", "an observed assertion requires a channel and time");
  }

  const content = {
    _format: API_EVM_OBSERVATION_EVIDENCE_FORMAT,
    chain_id: chainId,
    generation: {
      block_number: bigintDecimal(record.blockNumber, "input.blockNumber", MAX_UINT256),
      block_hash: hash(record.blockHash, "input.blockHash"),
      transaction_hash: hash(record.transactionHash, "input.transactionHash"),
      log_index: bigintDecimal(record.logIndex, "input.logIndex", MAX_UINT64),
    },
    observation_state: observationState,
    transfer: {
      kind: "erc20_transfer" as const,
      contract_address: contractAddress,
      from_address: record.fromAddress === null
        ? null
        : address(record.fromAddress, "input.fromAddress"),
      to_address: address(record.toAddress, "input.toAddress"),
      quantity: {
        atomic_value: decimal(record.atomicValue, "input.atomicValue"),
        atomic_unit: `${chainId}/erc20:${contractAddress}/base-unit`,
      },
    },
    finality: {
      canonicality: finality.canonicality,
      confirmations: { status: confirmationStatus, count: confirmationCount },
      settlement: finality.settlement,
    },
    basis: {
      observation_channel: basis.observationChannel,
      observed_at: observedAt,
      source_receipt_digest: sourceReceiptDigest,
    },
    privacy: API_EVM_EVIDENCE_PRIVACY,
    non_grants: API_EVM_EVIDENCE_NON_GRANTS,
  };
  return freezeDeep({
    ...content,
    content_digest: contentDigest(OBSERVATION_DOMAIN, content),
  }) as ApiEvmObservationEvidence;
}

/** Build a receipt for semantic mapping only; no stop condition is executed. */
export function adaptDepositEvidenceTransition(
  input: DepositEvidenceTransitionInput,
): ApiEvmEvidenceTransitionReceipt {
  const record = exactRecord(input, "input", [
    "fromDigest",
    "toDigest",
    "relation",
    "preserved",
    "discarded",
    "assumptions",
    "counterexample",
    "stopCondition",
  ]);
  const relations: readonly Relation[] = [
    "initial_observation", "same_generation", "replacement_generation",
    "removed_generation", "conflicting_evidence", "no_observation",
  ];
  if (typeof record.relation !== "string" || !relations.includes(record.relation as Relation)) {
    fail("input.relation", "unknown relation");
  }
  const relation = record.relation as Relation;
  const fromDigest = record.fromDigest === null
    ? null
    : digest(record.fromDigest, "input.fromDigest");
  if ((relation === "initial_observation") !== (fromDigest === null)) {
    fail("input", "initial_observation is the only relation with no from digest");
  }
  const preserved = canonicalList(record.preserved, FACETS, "input.preserved", 1);
  const discarded = canonicalList(record.discarded, FACETS, "input.discarded", 0);
  if (preserved.some((facet) => discarded.includes(facet))) {
    fail("input", "preserved and discarded facets must be disjoint");
  }
  if (new Set([...preserved, ...discarded]).size !== FACETS.length) {
    fail("input", "preserved and discarded must account for every semantic facet");
  }
  const assumptions = canonicalList(record.assumptions, ASSUMPTIONS, "input.assumptions", 0);
  const counterexamples: readonly Counterexample[] = [
    "unavailable_evidence", "stale_generation", "conflicting_block_hash",
    "logical_identity_mismatch", "removed_current_generation",
  ];
  const counterexample = record.counterexample === null
    ? null
    : typeof record.counterexample === "string" &&
        counterexamples.includes(record.counterexample as Counterexample)
      ? record.counterexample as Counterexample
      : fail("input.counterexample", "unknown counterexample");
  const stopConditions: readonly StopCondition[] = [
    "continue_observing", "hold_unavailable", "hold_conflict",
    "reject_exact_mismatch", "credit_current_generation_once",
    "reverse_current_generation_once", "no_effect",
  ];
  if (
    typeof record.stopCondition !== "string" ||
    !stopConditions.includes(record.stopCondition as StopCondition)
  ) fail("input.stopCondition", "unknown stop condition");

  const content = {
    _format: API_EVM_EVIDENCE_TRANSITION_RECEIPT_FORMAT,
    from_digest: fromDigest,
    to_digest: digest(record.toDigest, "input.toDigest"),
    relation,
    preserved,
    discarded,
    assumptions,
    counterexample,
    stop_condition: record.stopCondition as StopCondition,
    effect_boundary: "semantic_only_no_state_change" as const,
    privacy: API_EVM_EVIDENCE_PRIVACY,
    non_grants: API_EVM_EVIDENCE_NON_GRANTS,
  };
  return freezeDeep({
    ...content,
    content_digest: contentDigest(TRANSITION_DOMAIN, content),
  }) as ApiEvmEvidenceTransitionReceipt;
}
