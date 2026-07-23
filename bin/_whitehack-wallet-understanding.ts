/**
 * Pure Agent Wallet -> Whitehack context projection.
 *
 * This module verifies caller-presented public signed records and reduces them
 * to Whitehack's closed enum-only context. It has no filesystem, process,
 * network, key-store, signing, RPC, simulation, broadcast, or authorization
 * capability. Caller-supplied time and usage remain assertions.
 *
 * Doctrine: docs/WHITEHACK.md
 */
import {
  LIMITS,
  advanceContinuityHead,
  assertAmount,
  assertCaip19,
  assertTimestamp,
  chainFromAccount,
  continuityHeadFromDescriptor,
  timestampMs,
  validateSignerDescription,
  verifyContinuityEvent,
  verifySimulationReceipt,
  verifyTransactionIntent,
  verifyWalletCapability,
  verifyWalletDescriptor,
  type AssetAmount,
  type ContinuityEvent,
  type ContinuityHead,
  type SimulationReceipt,
  type TransactionIntent,
  type Verified,
  type WalletCapability,
  type WalletDescriptor,
} from "../packages/wallet/src/index.js";

export const WHITEHACK_WALLET_INPUT_TYPE =
  "agenttool-whitehack-wallet-input/v1" as const;
export const WHITEHACK_CONTEXT_PROFILE =
  "whitehack-agent-wallet-projection/v1" as const;
export const WHITEHACK_SOURCE_PROTOCOL = "agent-wallet/0.1" as const;

const MAX_FINDINGS = 10_000;
const MAX_CONTINUITY_EVENTS = 256;

type RecordState = "absent" | "unverified" | "verified" | "invalid";
type RelationState = "match" | "mismatch" | "unknown";
type BoundState = "within-bounds" | "outside-bounds" | "unknown";
type ApprovalState =
  | "not-required"
  | "requirement-satisfied"
  | "requirement-unsatisfied"
  | "unknown";

export type WhitehackWalletContext = Readonly<{
  profile: typeof WHITEHACK_CONTEXT_PROFILE;
  source_protocol: typeof WHITEHACK_SOURCE_PROTOCOL;
  records: Readonly<{
    descriptor: RecordState;
    capability: RecordState;
    intent: RecordState;
    simulation: RecordState;
    continuity: RecordState;
  }>;
  relations: Readonly<{
    "descriptor-capability": RelationState;
    "capability-intent": RelationState;
    delegate: RelationState;
    chain: RelationState;
    source: RelationState;
    "intent-simulation": RelationState;
    revocation: RelationState;
  }>;
  policy: Readonly<{
    calls: BoundState;
    spend: BoundState;
    fee: BoundState;
    expiry: BoundState;
    use: BoundState;
    approvals: ApprovalState;
  }>;
  simulation: Readonly<{
    execution: "passed" | "failed" | "stale" | "inconclusive" | "not-run";
    effects: RelationState;
    fee: BoundState;
  }>;
  custody: Readonly<{
    "descriptor-mode":
      | "self-custodied"
      | "delegated-signer"
      | "platform-custodied"
      | "watch-only"
      | "unknown";
    "signer-exportability": "non-exportable" | "exportable" | "unknown";
  }>;
}>;

type UsageAssertion = Readonly<{
  revocation_nonce: number;
  intent_count: number;
  spent: readonly Readonly<AssetAmount>[];
  authenticated_distinct_approval_count: number;
}>;

type ParsedInput = Readonly<{
  findings: readonly unknown[];
  descriptor: unknown | null;
  capability: unknown | null;
  intent: unknown | null;
  simulation: unknown | null;
  continuity_events: readonly unknown[];
  evaluated_at: string | null;
  usage: UsageAssertion | null;
  signer_description: unknown | null;
}>;

type VerifiedInput = Readonly<{
  descriptor: Verification<WalletDescriptor>;
  capability: Verification<WalletCapability>;
  intent: Verification<TransactionIntent>;
  simulation: Verification<SimulationReceipt>;
  continuity: Readonly<{
    state: RecordState;
    events: readonly Verified<ContinuityEvent>[];
    head: Readonly<ContinuityHead> | null;
  }>;
}>;

type Verification<T extends object> = Readonly<{
  state: "absent" | "verified" | "invalid";
  value: Verified<T> | null;
}>;

export type WhitehackUnderstandingFactory = (options: {
  findings: readonly unknown[];
  context: WhitehackWalletContext;
}) => unknown;

export class WhitehackWalletUnderstandingError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "WhitehackWalletUnderstandingError";
    this.code = code;
  }
}

function fail(code: string): never {
  throw new WhitehackWalletUnderstandingError(code);
}

function closedDataRecord(
  value: unknown,
  keys: readonly string[],
  code: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  let prototype: object | null;
  let descriptors: PropertyDescriptorMap;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    fail(code);
  }
  if (prototype !== Object.prototype && prototype !== null) fail(code);
  const ownKeys = Reflect.ownKeys(descriptors);
  if (ownKeys.some((key) => typeof key !== "string")) fail(code);
  const actual = [...ownKeys].sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])
  ) fail(code);

  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !("value" in descriptor)) fail(code);
    result[key] = descriptor.value;
  }
  return result;
}

function denseArray(value: unknown, maximum: number, code: string): readonly unknown[] {
  let isArray: boolean;
  let descriptors: PropertyDescriptorMap;
  try {
    isArray = Array.isArray(value);
    descriptors = isArray ? Object.getOwnPropertyDescriptors(value) : {};
  } catch {
    fail(code);
  }
  if (!isArray) fail(code);
  const lengthDescriptor = descriptors.length;
  if (
    !lengthDescriptor
    || lengthDescriptor.enumerable
    || !("value" in lengthDescriptor)
    || !Number.isSafeInteger(lengthDescriptor.value)
    || lengthDescriptor.value < 0
    || lengthDescriptor.value > maximum
  ) fail(code);
  const length = lengthDescriptor.value as number;
  const ownKeys = Reflect.ownKeys(descriptors);
  if (
    ownKeys.some((key) => typeof key !== "string")
    || ownKeys.length !== length + 1
  ) fail(code);

  const result: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor?.enumerable || !("value" in descriptor)) fail(code);
    result.push(descriptor.value);
  }
  return Object.freeze(result);
}

function parseUsage(value: unknown): UsageAssertion | null {
  if (value === null) return null;
  const item = closedDataRecord(value, [
    "authenticated_distinct_approval_count",
    "intent_count",
    "revocation_nonce",
    "spent",
  ], "invalid_host_assertions");
  for (const key of [
    "authenticated_distinct_approval_count",
    "intent_count",
    "revocation_nonce",
  ] as const) {
    if (!Number.isSafeInteger(item[key]) || (item[key] as number) < 0) {
      fail("invalid_host_assertions");
    }
  }
  if ((item.authenticated_distinct_approval_count as number) > 16) {
    fail("invalid_host_assertions");
  }

  const spentInput = denseArray(
    item.spent,
    LIMITS.max_spend_limits,
    "invalid_host_assertions",
  );
  const spent: Readonly<AssetAmount>[] = [];
  try {
    for (const value of spentInput) {
      const entry = closedDataRecord(
        value,
        ["amount_atomic", "asset_id"],
        "invalid_host_assertions",
      );
      assertCaip19(entry.asset_id, "usage.spent.asset_id");
      assertAmount(entry.amount_atomic, "usage.spent.amount_atomic");
      spent.push(Object.freeze({
        asset_id: entry.asset_id,
        amount_atomic: entry.amount_atomic,
      } as AssetAmount));
    }
  } catch {
    fail("invalid_host_assertions");
  }
  for (let index = 1; index < spent.length; index += 1) {
    if (spent[index - 1]!.asset_id >= spent[index]!.asset_id) {
      fail("invalid_host_assertions");
    }
  }
  return Object.freeze({
    revocation_nonce: item.revocation_nonce as number,
    intent_count: item.intent_count as number,
    spent: Object.freeze(spent),
    authenticated_distinct_approval_count:
      item.authenticated_distinct_approval_count as number,
  });
}

function parseInput(value: unknown): ParsedInput {
  const input = closedDataRecord(value, [
    "document_type",
    "findings",
    "host_assertions",
    "records",
  ], "invalid_input");
  if (input.document_type !== WHITEHACK_WALLET_INPUT_TYPE) fail("invalid_input");
  const records = closedDataRecord(input.records, [
    "capability",
    "continuity_events",
    "descriptor",
    "intent",
    "simulation",
  ], "invalid_input");
  const host = closedDataRecord(input.host_assertions, [
    "evaluated_at",
    "signer_description",
    "usage",
  ], "invalid_input");

  let evaluatedAt: string | null = null;
  if (host.evaluated_at !== null) {
    try {
      assertTimestamp(host.evaluated_at, "host_assertions.evaluated_at");
      evaluatedAt = host.evaluated_at;
    } catch {
      fail("invalid_host_assertions");
    }
  }

  const findings = denseArray(input.findings, MAX_FINDINGS, "invalid_findings")
    .map((finding) => Object.freeze(closedDataRecord(finding, [
      "check",
      "confidence",
      "doctrine",
      "file",
      "line",
      "principle",
    ], "invalid_findings")));

  return Object.freeze({
    findings: Object.freeze(findings),
    descriptor: records.descriptor,
    capability: records.capability,
    intent: records.intent,
    simulation: records.simulation,
    continuity_events: denseArray(
      records.continuity_events,
      MAX_CONTINUITY_EVENTS,
      "invalid_continuity_events",
    ),
    evaluated_at: evaluatedAt,
    usage: parseUsage(host.usage),
    signer_description: host.signer_description,
  });
}

function verifyOptional<T extends object>(
  value: unknown | null,
  verify: (input: unknown) => Verified<T>,
): Verification<T> {
  if (value === null) return Object.freeze({ state: "absent", value: null });
  try {
    return Object.freeze({ state: "verified", value: verify(value) });
  } catch {
    return Object.freeze({ state: "invalid", value: null });
  }
}

function verifyInput(input: ParsedInput): VerifiedInput {
  const descriptor = verifyOptional(input.descriptor, verifyWalletDescriptor);
  const capability = verifyOptional(input.capability, verifyWalletCapability);
  const intent = verifyOptional(input.intent, verifyTransactionIntent);
  const simulation = verifyOptional(input.simulation, verifySimulationReceipt);

  const continuityEvents: Verified<ContinuityEvent>[] = [];
  let continuityState: RecordState = input.continuity_events.length
    ? "verified"
    : "absent";
  for (const event of input.continuity_events) {
    try {
      continuityEvents.push(verifyContinuityEvent(event));
    } catch {
      continuityState = "invalid";
      break;
    }
  }

  let continuityHead: Readonly<ContinuityHead> | null = null;
  if (continuityState === "verified") {
    if (
      descriptor.state !== "verified"
      || !descriptor.value
      || input.evaluated_at === null
    ) {
      continuityState = "unverified";
    } else {
      try {
        continuityHead = continuityHeadFromDescriptor(descriptor.value);
        for (const event of continuityEvents) {
          continuityHead = advanceContinuityHead(
            continuityHead,
            event,
            input.evaluated_at,
          );
        }
      } catch {
        continuityState = "invalid";
        continuityHead = null;
      }
    }
  }

  return Object.freeze({
    descriptor,
    capability,
    intent,
    simulation,
    continuity: Object.freeze({
      state: continuityState,
      events: Object.freeze(continuityEvents),
      head: continuityHead,
    }),
  });
}

function sameKey(
  left: { key_id: string; public_key: string },
  right: { key_id: string; public_key: string },
): boolean {
  return left.key_id === right.key_id && left.public_key === right.public_key;
}

function relation(values: readonly (object | null)[], compare: () => boolean): RelationState {
  if (values.some((value) => value === null)) return "unknown";
  try {
    return compare() ? "match" : "mismatch";
  } catch {
    return "unknown";
  }
}

function aggregate(entries: readonly AssetAmount[]): Map<string, bigint> {
  const result = new Map<string, bigint>();
  for (const entry of entries) {
    result.set(
      entry.asset_id,
      (result.get(entry.asset_id) ?? 0n) + BigInt(entry.amount_atomic),
    );
  }
  return result;
}

function equalMaps(left: Map<string, bigint>, right: Map<string, bigint>): boolean {
  if (left.size !== right.size) return false;
  for (const [key, value] of left) {
    if (right.get(key) !== value) return false;
  }
  return true;
}

function simulationAmounts(simulation: SimulationReceipt): AssetAmount[] {
  return simulation.effects.flatMap((effect) => (
    effect.asset_id === null
      ? []
      : [{ asset_id: effect.asset_id, amount_atomic: effect.amount_atomic }]
  ));
}

function effectsMatch(
  intent: TransactionIntent,
  simulation: SimulationReceipt,
): boolean {
  const declared = aggregate(intent.declared_spends);
  const simulated = aggregate(simulationAmounts(simulation));
  if (!equalMaps(declared, simulated)) return false;
  const native = aggregate(
    intent.calls.flatMap((call) => (
      call.native_value === null ? [] : [call.native_value]
    )),
  );
  for (const [asset, amount] of native) {
    if ((declared.get(asset) ?? 0n) < amount) return false;
  }
  return true;
}

function findRule(
  capability: WalletCapability,
  item: { target_account: string; action: string; method: string | null },
) {
  return capability.call_rules.find((rule) => (
    rule.target_account === item.target_account
    && rule.actions.includes(item.action as (typeof rule.actions)[number])
    && (
      item.action === "transfer"
      || (item.method !== null && rule.methods.includes(item.method))
    )
  ));
}

function applicableRules(
  capability: WalletCapability | null,
  intent: TransactionIntent | null,
  simulation: SimulationReceipt | null,
) {
  if (!capability || !intent || !simulation) return null;
  const items = [...intent.calls, ...simulation.effects];
  return items.map((item) => findRule(capability, item));
}

function callsState(
  capability: WalletCapability | null,
  intent: TransactionIntent | null,
  simulation: SimulationReceipt | null,
): BoundState {
  const rules = applicableRules(capability, intent, simulation);
  if (!rules) return "unknown";
  return rules.some((rule) => rule === undefined)
    ? "outside-bounds"
    : "within-bounds";
}

function approvalState(
  capability: WalletCapability | null,
  intent: TransactionIntent | null,
  simulation: SimulationReceipt | null,
  usage: UsageAssertion | null,
): ApprovalState {
  const rules = applicableRules(capability, intent, simulation);
  if (!rules || rules.some((rule) => rule === undefined)) return "unknown";
  const requiresApproval = rules.some((rule) => rule!.requires_approval);
  if (!requiresApproval) return "not-required";
  if (!usage || !capability) return "unknown";
  return usage.authenticated_distinct_approval_count >= capability.approval_threshold
    ? "requirement-satisfied"
    : "requirement-unsatisfied";
}

function spendState(
  capability: WalletCapability | null,
  intent: TransactionIntent | null,
  simulation: SimulationReceipt | null,
  usage: UsageAssertion | null,
): BoundState {
  if (!capability || !intent || !simulation) return "unknown";
  if (!effectsMatch(intent, simulation)) return "outside-bounds";
  const simulated = aggregate(simulationAmounts(simulation));
  for (const [asset, amount] of simulated) {
    const limit = capability.spend_limits.find((entry) => entry.asset_id === asset);
    if (!limit || amount > BigInt(limit.max_per_intent)) return "outside-bounds";
  }
  if (!usage) return "unknown";
  const prior = aggregate(usage.spent);
  for (const [asset, amount] of simulated) {
    const limit = capability.spend_limits.find((entry) => entry.asset_id === asset);
    if (!limit || (prior.get(asset) ?? 0n) + amount > BigInt(limit.max_total)) {
      return "outside-bounds";
    }
  }
  return "within-bounds";
}

function policyFeeState(
  capability: WalletCapability | null,
  intent: TransactionIntent | null,
): BoundState {
  if (!capability || !intent) return "unknown";
  const limit = capability.fee_limits.find(
    (entry) => entry.asset_id === intent.max_fee.asset_id,
  );
  return limit && BigInt(intent.max_fee.amount_atomic) <= BigInt(limit.max_per_intent)
    ? "within-bounds"
    : "outside-bounds";
}

function simulationFeeState(
  intent: TransactionIntent | null,
  simulation: SimulationReceipt | null,
): BoundState {
  if (!intent || !simulation) return "unknown";
  return (
    intent.max_fee.asset_id === simulation.estimated_fee.asset_id
    && BigInt(simulation.estimated_fee.amount_atomic)
      <= BigInt(intent.max_fee.amount_atomic)
  ) ? "within-bounds" : "outside-bounds";
}

function expiryState(
  descriptor: WalletDescriptor | null,
  capability: WalletCapability | null,
  intent: TransactionIntent | null,
  evaluatedAt: string | null,
): BoundState {
  if (!descriptor || !capability || !intent) return "unknown";
  const chronologyValid =
    timestampMs(capability.issued_at) >= timestampMs(descriptor.created_at)
    && timestampMs(intent.issued_at) >= timestampMs(capability.issued_at)
    && timestampMs(intent.issued_at) >= timestampMs(capability.not_before)
    && timestampMs(intent.expires_at) <= timestampMs(capability.expires_at);
  if (!chronologyValid) return "outside-bounds";
  if (evaluatedAt === null) return "unknown";
  const now = timestampMs(evaluatedAt);
  return (
    now >= timestampMs(capability.not_before)
    && now < timestampMs(capability.expires_at)
    && now >= timestampMs(intent.issued_at)
    && now < timestampMs(intent.expires_at)
  ) ? "within-bounds" : "outside-bounds";
}

function useState(
  capability: WalletCapability | null,
  usage: UsageAssertion | null,
): BoundState {
  if (!capability || !usage) return "unknown";
  return usage.intent_count < capability.max_intents
    ? "within-bounds"
    : "outside-bounds";
}

function executionState(
  verification: Verification<SimulationReceipt>,
  intent: TransactionIntent | null,
  evaluatedAt: string | null,
): "passed" | "failed" | "stale" | "inconclusive" | "not-run" {
  if (verification.state === "absent") return "not-run";
  if (verification.state === "invalid" || !verification.value) return "inconclusive";
  if (!verification.value.success) return "failed";
  if (evaluatedAt === null) return "inconclusive";
  if (
    intent
    && timestampMs(verification.value.simulated_at) < timestampMs(intent.issued_at)
  ) return "stale";
  const now = timestampMs(evaluatedAt);
  return (
    now >= timestampMs(verification.value.simulated_at)
    && now < timestampMs(verification.value.valid_until)
  ) ? "passed" : "stale";
}

function descriptorMode(
  descriptor: WalletDescriptor | null,
): "self-custodied" | "delegated-signer" | "platform-custodied" | "watch-only" | "unknown" {
  if (!descriptor) return "unknown" as const;
  return ({
    self_custodied: "self-custodied",
    delegated_signer: "delegated-signer",
    platform_custodied: "platform-custodied",
    watch_only: "watch-only",
  } as const satisfies Record<
    WalletDescriptor["custody_mode"],
    "self-custodied" | "delegated-signer" | "platform-custodied" | "watch-only"
  >)[descriptor.custody_mode];
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

function buildContext(input: ParsedInput): WhitehackWalletContext {
  const verified = verifyInput(input);
  const descriptor = verified.descriptor.value;
  const capability = verified.capability.value;
  const intent = verified.intent.value;
  const simulation = verified.simulation.value;

  const descriptorCapability = relation(
    [descriptor, capability],
    () => (
      capability!.wallet_id === descriptor!.wallet_id
      && capability!.descriptor_id === descriptor!.record_id
      && sameKey(capability!.issuer, descriptor!.authority)
      && capability!.accounts.every((account) => (
        descriptor!.accounts.some(({ account_id }) => account_id === account)
      ))
    ),
  );
  const capabilityIntent = relation(
    [capability, intent],
    () => (
      intent!.wallet_id === capability!.wallet_id
      && intent!.descriptor_id === capability!.descriptor_id
      && intent!.grant_id === capability!.grant_id
      && intent!.capability_record_id === capability!.record_id
    ),
  );
  const delegate = relation(
    [capability, intent],
    () => sameKey(capability!.delegate, intent!.delegate),
  );
  const chain = relation(
    [descriptor, capability, intent, simulation],
    () => (
      intent!.chain_id === simulation!.chain_id
      && descriptor!.accounts.some(({ account_id }) => (
        chainFromAccount(account_id) === intent!.chain_id
      ))
      && capability!.accounts.some((account) => (
        chainFromAccount(account) === intent!.chain_id
      ))
    ),
  );
  const source = relation(
    [descriptor, capability, intent, simulation],
    () => (
      descriptor!.accounts.some(({ account_id }) => (
        account_id === intent!.source_account
      ))
      && capability!.accounts.includes(intent!.source_account)
      && simulation!.source_account === intent!.source_account
    ),
  );
  const intentSimulation = relation(
    [intent, simulation],
    () => (
      simulation!.intent_id === intent!.intent_id
      && simulation!.intent_record_id === intent!.record_id
      && simulation!.chain_id === intent!.chain_id
      && simulation!.source_account === intent!.source_account
    ),
  );
  const operationBound = [
    descriptorCapability,
    capabilityIntent,
    delegate,
    chain,
    source,
    intentSimulation,
  ].every((state) => state === "match");

  let revocation: RelationState = "unknown";
  if (capability && verified.continuity.head) {
    if (descriptorCapability === "match") {
      revocation = verified.continuity.head.revocation_nonce
        === capability.revocation_nonce ? "match" : "mismatch";
    }
  } else if (capability && input.usage) {
    revocation = input.usage.revocation_nonce === capability.revocation_nonce
      ? "match" : "mismatch";
  }

  let signerExportability: "non-exportable" | "unknown" = "unknown";
  if (input.signer_description !== null) {
    try {
      validateSignerDescription(input.signer_description);
      signerExportability = "non-exportable";
    } catch {
      signerExportability = "unknown";
    }
  }

  return deepFreeze({
    profile: WHITEHACK_CONTEXT_PROFILE,
    source_protocol: WHITEHACK_SOURCE_PROTOCOL,
    records: {
      descriptor: verified.descriptor.state,
      capability: verified.capability.state,
      intent: verified.intent.state,
      simulation: verified.simulation.state,
      continuity: verified.continuity.state,
    },
    relations: {
      "descriptor-capability": descriptorCapability,
      "capability-intent": capabilityIntent,
      delegate,
      chain,
      source,
      "intent-simulation": intentSimulation,
      revocation,
    },
    policy: {
      calls: operationBound
        ? callsState(capability, intent, simulation)
        : "unknown",
      spend: operationBound
        ? spendState(capability, intent, simulation, input.usage)
        : "unknown",
      fee: operationBound
        ? policyFeeState(capability, intent)
        : "unknown",
      expiry: operationBound
        ? expiryState(descriptor, capability, intent, input.evaluated_at)
        : "unknown",
      use: operationBound
        ? useState(capability, input.usage)
        : "unknown",
      approvals: operationBound
        ? approvalState(capability, intent, simulation, input.usage)
        : "unknown",
    },
    simulation: {
      execution: executionState(
        verified.simulation,
        intent,
        input.evaluated_at,
      ),
      effects: relation(
        [intent, simulation],
        () => effectsMatch(intent!, simulation!),
      ),
      fee: simulationFeeState(intent, simulation),
    },
    custody: {
      "descriptor-mode": descriptorMode(descriptor),
      "signer-exportability": signerExportability,
    },
  }) as WhitehackWalletContext;
}

export function projectAgentWalletContext(input: unknown): WhitehackWalletContext {
  return buildContext(parseInput(input));
}

export function createAgentWalletUnderstanding(
  input: unknown,
  createUnderstanding: WhitehackUnderstandingFactory,
): unknown {
  if (typeof createUnderstanding !== "function") fail("invalid_understanding_factory");
  const parsed = parseInput(input);
  const context = buildContext(parsed);
  try {
    return createUnderstanding({ findings: parsed.findings, context });
  } catch {
    fail("whitehack_understanding_failed");
  }
}
