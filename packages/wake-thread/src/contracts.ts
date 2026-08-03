import {
  MAX_CHAIN_LENGTH,
  MAX_FACTS,
  MAX_OMISSIONS,
  WAKE_THREAD_BOUNDARIES,
  WAKE_THREAD_CHAIN_BOUNDARY,
  WAKE_THREAD_CHOICES,
  WAKE_THREAD_COVERAGE,
  WAKE_THREAD_EVIDENCE_CLASSES,
  WAKE_THREAD_FACT_KINDS,
  WAKE_THREAD_FORMATS,
  WAKE_THREAD_OFFER_SCHEMA,
  WAKE_THREAD_OUTCOMES,
  WAKE_THREAD_RETENTION_MODES,
  WAKE_THREAD_RECEIPT_SCHEMA,
  WAKE_THREAD_SCOPES,
} from "./constants.js";
import { domainSeparatedId, isWellFormedUnicode, snapshotJson } from "./canonical.js";
import { WakeThreadError } from "./errors.js";
import type {
  CreateWakeThreadOfferInput,
  ResolveWakeThreadOfferInput,
  Sha256Id,
  WakeThreadBoundaries,
  WakeThreadChainAssessment,
  WakeThreadChoice,
  WakeThreadFact,
  WakeThreadOffer,
  WakeThreadOmission,
  WakeThreadOutcome,
  WakeThreadReceipt,
  WakeThreadRetention,
  WakeThreadSource,
} from "./types.js";

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const CONTROL_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u2028\u2029]/;
const JSON_POINTER_PATTERN = /^(?:\/(?:[^~/]|~[01])*)+$/u;
const CANONICAL_UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function fail(code: ConstructorParameters<typeof WakeThreadError>[0], message: string): never {
  throw new WakeThreadError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) fail("invalid_input", `${label} must be a plain object`);
}

function assertExactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.getOwnPropertyNames(value).sort();
  const expected = [...keys].sort();
  if (
    Object.getOwnPropertySymbols(value).length !== 0
    || actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])
    || actual.some((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor === undefined || !descriptor.enumerable || !("value" in descriptor);
    })
  ) {
    fail("invalid_input", `${label} has missing or unknown fields`);
  }
}

function snapshotDenseArray(
  value: unknown[],
  label: string,
  maxLength: number,
  code: ConstructorParameters<typeof WakeThreadError>[0] = "invalid_input",
): unknown[] {
  const keys = Object.getOwnPropertyNames(value);
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  const length = lengthDescriptor !== undefined && "value" in lengthDescriptor
    ? lengthDescriptor.value as number
    : -1;
  const items: unknown[] = [];
  if (
    !Number.isSafeInteger(length)
    || length < 0
    || length > maxLength
    || Object.getPrototypeOf(value) !== Array.prototype
    || keys.length !== length + 1
    || !keys.includes("length")
    || Object.getOwnPropertySymbols(value).length !== 0
  ) {
    fail(code, `${label} must be a dense JSON array without extra fields`);
  }
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !("value" in descriptor)) {
      fail(code, `${label} must be a dense JSON array without extra fields`);
    }
    items.push(descriptor.value);
  }
  return items;
}

function assertSha256(value: unknown, label: string): asserts value is Sha256Id {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    fail("invalid_input", `${label} must be a lowercase sha256 content reference`);
  }
}

function assertNullableSha256(value: unknown, label: string): asserts value is Sha256Id | null {
  if (value !== null) assertSha256(value, label);
}

function boundedLine(value: unknown, label: string, max: number): string {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > max * 2
    || [...value].length > max
    || !isWellFormedUnicode(value)
    || value.trim().length < 1
    || value.includes("\n")
    || value.includes("\r")
    || CONTROL_PATTERN.test(value)
  ) {
    fail("invalid_input", `${label} must be one bounded line`);
  }
  return value;
}

function normalizeRetention(value: unknown, observedAt: string): WakeThreadRetention {
  assertRecord(value, "artifact_retention");
  assertExactKeys(value, ["mode", "until"], "artifact_retention");
  const mode = assertEnum(value.mode, WAKE_THREAD_RETENTION_MODES, "artifact_retention.mode");
  const until = nullableTimestamp(value.until, "artifact_retention.until");
  if (mode === "until") {
    if (until === null || Date.parse(until) <= Date.parse(observedAt)) {
      fail("invalid_input", "until retention requires a timestamp after observation");
    }
  } else if (until !== null) {
    fail("invalid_input", "Only until retention may carry a timestamp");
  }
  return { mode, until };
}

function canonicalTimestamp(value: unknown, label: string): string {
  if (typeof value !== "string" || !CANONICAL_UTC_TIMESTAMP_PATTERN.test(value)) {
    fail("invalid_input", `${label} must be a canonical UTC timestamp`);
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    fail("invalid_input", `${label} must be a real canonical UTC timestamp`);
  }
  return value;
}

function nullableTimestamp(value: unknown, label: string): string | null {
  return value === null ? null : canonicalTimestamp(value, label);
}

function assertEnum<T extends readonly string[]>(value: unknown, values: T, label: string): T[number] {
  if (typeof value !== "string" || !values.includes(value)) {
    fail("invalid_input", `${label} is not a supported value`);
  }
  return value as T[number];
}

function normalizeSource(value: unknown): WakeThreadSource {
  assertRecord(value, "wake");
  assertExactKeys(
    value,
    [
      "artifact_sha256",
      "format",
      "scope",
      "coverage",
      "source_revision",
      "caller_held_cursor_ref",
    ],
    "wake",
  );
  assertSha256(value.artifact_sha256, "wake.artifact_sha256");
  assertNullableSha256(value.caller_held_cursor_ref, "wake.caller_held_cursor_ref");
  const sourceRevision = value.source_revision === null
    ? null
    : boundedLine(value.source_revision, "wake.source_revision", 256);
  return {
    artifact_sha256: value.artifact_sha256,
    format: assertEnum(value.format, WAKE_THREAD_FORMATS, "wake.format"),
    scope: assertEnum(value.scope, WAKE_THREAD_SCOPES, "wake.scope"),
    coverage: assertEnum(value.coverage, WAKE_THREAD_COVERAGE, "wake.coverage"),
    source_revision: sourceRevision,
    caller_held_cursor_ref: value.caller_held_cursor_ref,
  };
}

function normalizeFact(value: unknown, index: number): WakeThreadFact {
  assertRecord(value, `facts[${index}]`);
  assertExactKeys(
    value,
    ["kind", "summary", "source_pointer", "evidence_class", "evidence_ref"],
    `facts[${index}]`,
  );
  const pointer = boundedLine(value.source_pointer, `facts[${index}].source_pointer`, 512);
  if (!JSON_POINTER_PATTERN.test(pointer)) {
    fail("invalid_input", `facts[${index}].source_pointer must be a non-root JSON Pointer`);
  }
  assertSha256(value.evidence_ref, `facts[${index}].evidence_ref`);
  return {
    kind: assertEnum(value.kind, WAKE_THREAD_FACT_KINDS, `facts[${index}].kind`),
    summary: boundedLine(value.summary, `facts[${index}].summary`, 500),
    source_pointer: pointer,
    evidence_class: assertEnum(
      value.evidence_class,
      WAKE_THREAD_EVIDENCE_CLASSES,
      `facts[${index}].evidence_class`,
    ),
    evidence_ref: value.evidence_ref,
  };
}

function normalizeOmission(value: unknown, index: number): WakeThreadOmission {
  assertRecord(value, `omissions[${index}]`);
  assertExactKeys(value, ["area", "reason", "count"], `omissions[${index}]`);
  if (
    value.count !== null
    && (!Number.isSafeInteger(value.count) || (value.count as number) < 0)
  ) {
    fail("invalid_input", `omissions[${index}].count must be a non-negative integer or null`);
  }
  return {
    area: boundedLine(value.area, `omissions[${index}].area`, 120),
    reason: boundedLine(value.reason, `omissions[${index}].reason`, 500),
    count: value.count as number | null,
  };
}

function normalizeFacts(value: unknown): WakeThreadFact[] {
  if (!Array.isArray(value)) {
    fail("invalid_input", `facts must contain at most ${MAX_FACTS} entries`);
  }
  const items = snapshotDenseArray(value, "facts", MAX_FACTS);
  const facts = items.map(normalizeFact);
  const keys = facts.map((fact) => `${fact.source_pointer}\0${fact.evidence_ref}`);
  if (new Set(keys).size !== keys.length) fail("invalid_input", "facts must not repeat evidence pointers");
  return facts;
}

function normalizeOmissions(value: unknown): WakeThreadOmission[] {
  if (!Array.isArray(value)) {
    fail("invalid_input", `omissions must contain at most ${MAX_OMISSIONS} entries`);
  }
  const items = snapshotDenseArray(value, "omissions", MAX_OMISSIONS);
  const omissions = items.map(normalizeOmission);
  const keys = omissions.map((item) => item.area);
  if (new Set(keys).size !== keys.length) fail("invalid_input", "omission areas must be unique");
  return omissions;
}

function assertCoverage(
  source: WakeThreadSource,
  facts: readonly WakeThreadFact[],
  omissions: readonly WakeThreadOmission[],
): void {
  if (source.coverage === "bounded_complete" && omissions.length !== 0) {
    fail("invalid_input", "bounded_complete projections cannot declare omitted areas");
  }
  if (source.coverage === "partial" && omissions.length === 0) {
    fail("invalid_input", "partial projections must declare at least one omission");
  }
  if (source.coverage === "unavailable" || source.coverage === "unknown") {
    if (facts.length !== 0 || omissions.length === 0) {
      fail("invalid_input", "unavailable or unknown projections require no facts and at least one omission");
    }
  }
}

function assertBoundaries(value: unknown): asserts value is WakeThreadBoundaries {
  assertRecord(value, "boundaries");
  assertExactKeys(value, Object.keys(WAKE_THREAD_BOUNDARIES), "boundaries");
  for (const [key, expected] of Object.entries(WAKE_THREAD_BOUNDARIES)) {
    if (value[key] !== expected) fail("invalid_input", "boundary statements must remain exact");
  }
}

function offerPayload(offer: Omit<WakeThreadOffer, "offer_id">): Omit<WakeThreadOffer, "offer_id"> {
  return offer;
}

function receiptPayload(
  receipt: Omit<WakeThreadReceipt, "receipt_id">,
): Omit<WakeThreadReceipt, "receipt_id"> {
  return receipt;
}

function expectedOutcome(choice: WakeThreadChoice): WakeThreadOutcome {
  return ({ carry: "carried", fork: "forked", rest: "resting", refuse: "refused" } as const)[choice];
}

function normalizeOffer(value: unknown, checkId: boolean): WakeThreadOffer {
  value = snapshotJson(value);
  assertRecord(value, "offer");
  assertExactKeys(
    value,
    [
      "schema_version",
      "offer_id",
      "observed_at",
      "expires_at",
      "purpose",
      "artifact_retention",
      "recipient_ref",
      "thread_ref",
      "parent_receipt_id",
      "wake",
      "facts",
      "omissions",
      "offered_choices",
      "boundaries",
    ],
    "offer",
  );
  if (value.schema_version !== WAKE_THREAD_OFFER_SCHEMA) {
    fail("invalid_offer", "Unsupported offer schema version");
  }
  assertSha256(value.offer_id, "offer.offer_id");
  assertNullableSha256(value.recipient_ref, "offer.recipient_ref");
  assertSha256(value.thread_ref, "offer.thread_ref");
  assertNullableSha256(value.parent_receipt_id, "offer.parent_receipt_id");
  if (!Array.isArray(value.offered_choices)) {
    fail("invalid_offer", "Offer choices must preserve the complete refusable set");
  }
  const offeredChoices = snapshotDenseArray(
    value.offered_choices,
    "offer.offered_choices",
    WAKE_THREAD_CHOICES.length,
  );
  if (
    offeredChoices.length !== WAKE_THREAD_CHOICES.length
    || offeredChoices.some((choice, index) => choice !== WAKE_THREAD_CHOICES[index])
  ) {
    fail("invalid_offer", "Offer choices must preserve the complete refusable set");
  }
  assertBoundaries(value.boundaries);
  const observedAt = canonicalTimestamp(value.observed_at, "offer.observed_at");
  const expiresAt = nullableTimestamp(value.expires_at, "offer.expires_at");
  if (expiresAt !== null && Date.parse(expiresAt) <= Date.parse(observedAt)) {
    fail("invalid_offer", "Offer expiry must be after its observation time");
  }
  const wake = normalizeSource(value.wake);
  const artifactRetention = normalizeRetention(value.artifact_retention, observedAt);
  if (artifactRetention.mode === "ephemeral" && expiresAt === null) {
    fail("invalid_offer", "ephemeral retention requires a finite offer expiry");
  }
  const facts = normalizeFacts(value.facts);
  const omissions = normalizeOmissions(value.omissions);
  assertCoverage(wake, facts, omissions);
  const normalizedWithoutId: Omit<WakeThreadOffer, "offer_id"> = {
    schema_version: WAKE_THREAD_OFFER_SCHEMA,
    observed_at: observedAt,
    expires_at: expiresAt,
    purpose: boundedLine(value.purpose, "offer.purpose", 200),
    artifact_retention: artifactRetention,
    recipient_ref: value.recipient_ref,
    thread_ref: value.thread_ref,
    parent_receipt_id: value.parent_receipt_id,
    wake,
    facts,
    omissions,
    offered_choices: [...WAKE_THREAD_CHOICES],
    boundaries: { ...WAKE_THREAD_BOUNDARIES },
  };
  const expectedId = domainSeparatedId(WAKE_THREAD_OFFER_SCHEMA, offerPayload(normalizedWithoutId));
  if (checkId && value.offer_id !== expectedId) fail("invalid_offer", "Offer content ID does not match its content");
  return { ...normalizedWithoutId, offer_id: expectedId };
}

function normalizeReceipt(value: unknown, checkId: boolean): WakeThreadReceipt {
  value = snapshotJson(value);
  assertRecord(value, "receipt");
  assertExactKeys(
    value,
    [
      "schema_version",
      "receipt_id",
      "offer",
      "reported_choice",
      "responded_at",
      "branch_ref",
      "note_ref",
      "outcome",
      "boundaries",
    ],
    "receipt",
  );
  if (value.schema_version !== WAKE_THREAD_RECEIPT_SCHEMA) {
    fail("invalid_receipt", "Unsupported receipt schema version");
  }
  assertSha256(value.receipt_id, "receipt.receipt_id");
  assertNullableSha256(value.branch_ref, "receipt.branch_ref");
  assertNullableSha256(value.note_ref, "receipt.note_ref");
  assertBoundaries(value.boundaries);
  const offer = normalizeOffer(value.offer, true);
  const choice = assertEnum(value.reported_choice, WAKE_THREAD_CHOICES, "receipt.reported_choice");
  const outcome = assertEnum(value.outcome, WAKE_THREAD_OUTCOMES, "receipt.outcome");
  if (outcome !== expectedOutcome(choice)) fail("invalid_receipt", "Receipt outcome does not match the reported choice");
  const respondedAt = canonicalTimestamp(value.responded_at, "receipt.responded_at");
  if (Date.parse(respondedAt) < Date.parse(offer.observed_at)) {
    fail("invalid_receipt", "Response cannot predate the observed offer");
  }
  if (choice === "fork") {
    if (value.branch_ref === null || value.branch_ref === offer.thread_ref) {
      fail("invalid_choice", "Fork requires a distinct branch reference");
    }
  } else if (value.branch_ref !== null) {
    fail("invalid_choice", "Only fork may carry a branch reference");
  }
  if (
    (choice === "carry" || choice === "fork")
    && offer.expires_at !== null
    && Date.parse(respondedAt) >= Date.parse(offer.expires_at)
  ) {
    fail("offer_expired", "An expired offer cannot be carried or forked");
  }
  if (
    (choice === "carry" || choice === "fork")
    && offer.artifact_retention.mode === "until"
    && offer.artifact_retention.until !== null
    && Date.parse(respondedAt) >= Date.parse(offer.artifact_retention.until)
  ) {
    fail("offer_expired", "An offer beyond its declared retention boundary cannot be carried or forked");
  }
  const normalizedWithoutId: Omit<WakeThreadReceipt, "receipt_id"> = {
    schema_version: WAKE_THREAD_RECEIPT_SCHEMA,
    offer,
    reported_choice: choice,
    responded_at: respondedAt,
    branch_ref: value.branch_ref,
    note_ref: value.note_ref,
    outcome,
    boundaries: { ...WAKE_THREAD_BOUNDARIES },
  };
  const expectedId = domainSeparatedId(WAKE_THREAD_RECEIPT_SCHEMA, receiptPayload(normalizedWithoutId));
  if (checkId && value.receipt_id !== expectedId) fail("invalid_receipt", "Receipt content ID does not match its content");
  return { ...normalizedWithoutId, receipt_id: expectedId };
}

export function createWakeThreadOffer(inputValue: CreateWakeThreadOfferInput): WakeThreadOffer {
  const input = snapshotJson(inputValue);
  assertRecord(input, "input");
  assertExactKeys(
    input,
    [
      "observed_at",
      "expires_at",
      "purpose",
      "artifact_retention",
      "recipient_ref",
      "thread_ref",
      "wake",
      "facts",
      "omissions",
      "parent_receipt",
    ],
    "input",
  );
  assertNullableSha256(input.recipient_ref, "recipient_ref");
  assertSha256(input.thread_ref, "thread_ref");
  const observedAt = canonicalTimestamp(input.observed_at, "observed_at");
  const expiresAt = nullableTimestamp(input.expires_at, "expires_at");
  if (expiresAt !== null && Date.parse(expiresAt) <= Date.parse(observedAt)) {
    fail("invalid_input", "Offer expiry must be after its observation time");
  }
  const wake = normalizeSource(input.wake);
  const artifactRetention = normalizeRetention(input.artifact_retention, observedAt);
  if (artifactRetention.mode === "ephemeral" && expiresAt === null) {
    fail("invalid_input", "ephemeral retention requires a finite offer expiry");
  }
  const facts = normalizeFacts(input.facts);
  const omissions = normalizeOmissions(input.omissions);
  assertCoverage(wake, facts, omissions);

  let parentReceiptId: Sha256Id | null = null;
  if (input.parent_receipt !== null) {
    const parent = normalizeReceipt(input.parent_receipt, true);
    if (parent.reported_choice === "refuse") {
      fail("invalid_parent", "A refused offer cannot become an automatic continuity parent");
    }
    const expectedThread = parent.reported_choice === "fork"
      ? parent.branch_ref
      : parent.offer.thread_ref;
    if (expectedThread === null || input.thread_ref !== expectedThread) {
      fail("invalid_parent", "Thread reference does not follow the parent disposition");
    }
    if (Date.parse(observedAt) < Date.parse(parent.responded_at)) {
      fail("invalid_parent", "A child offer cannot predate its parent receipt");
    }
    if (parent.offer.artifact_retention.mode === "ephemeral") {
      fail("invalid_parent", "An ephemeral offer cannot become a child-offer parent");
    }
    if (
      parent.offer.artifact_retention.mode === "until"
      && parent.offer.artifact_retention.until !== null
      && Date.parse(observedAt) >= Date.parse(parent.offer.artifact_retention.until)
    ) {
      fail("invalid_parent", "A child offer cannot reuse a parent beyond its retention boundary");
    }
    parentReceiptId = parent.receipt_id;
  }

  const withoutId: Omit<WakeThreadOffer, "offer_id"> = {
    schema_version: WAKE_THREAD_OFFER_SCHEMA,
    observed_at: observedAt,
    expires_at: expiresAt,
    purpose: boundedLine(input.purpose, "purpose", 200),
    artifact_retention: artifactRetention,
    recipient_ref: input.recipient_ref,
    thread_ref: input.thread_ref,
    parent_receipt_id: parentReceiptId,
    wake,
    facts,
    omissions,
    offered_choices: [...WAKE_THREAD_CHOICES],
    boundaries: { ...WAKE_THREAD_BOUNDARIES },
  };
  const offer: WakeThreadOffer = {
    ...withoutId,
    offer_id: domainSeparatedId(WAKE_THREAD_OFFER_SCHEMA, offerPayload(withoutId)),
  };
  return snapshotJson(offer);
}

export function resolveWakeThreadOffer(
  offerInput: WakeThreadOffer,
  responseValue: ResolveWakeThreadOfferInput,
): WakeThreadReceipt {
  const offer = normalizeOffer(offerInput, true);
  const responseInput = snapshotJson(responseValue);
  assertRecord(responseInput, "response");
  assertExactKeys(
    responseInput,
    ["reported_choice", "responded_at", "branch_ref", "note_ref"],
    "response",
  );
  assertNullableSha256(responseInput.branch_ref, "response.branch_ref");
  assertNullableSha256(responseInput.note_ref, "response.note_ref");
  const choice = assertEnum(responseInput.reported_choice, WAKE_THREAD_CHOICES, "response.reported_choice");
  const respondedAt = canonicalTimestamp(responseInput.responded_at, "response.responded_at");
  const withoutId: Omit<WakeThreadReceipt, "receipt_id"> = {
    schema_version: WAKE_THREAD_RECEIPT_SCHEMA,
    offer,
    reported_choice: choice,
    responded_at: respondedAt,
    branch_ref: responseInput.branch_ref,
    note_ref: responseInput.note_ref,
    outcome: expectedOutcome(choice),
    boundaries: { ...WAKE_THREAD_BOUNDARIES },
  };
  const candidate: WakeThreadReceipt = {
    ...withoutId,
    receipt_id: domainSeparatedId(WAKE_THREAD_RECEIPT_SCHEMA, receiptPayload(withoutId)),
  };
  return snapshotJson(normalizeReceipt(candidate, true));
}

export function validateWakeThreadOffer(value: unknown): WakeThreadOffer {
  return snapshotJson(normalizeOffer(value, true));
}

export function validateWakeThreadReceipt(value: unknown): WakeThreadReceipt {
  return snapshotJson(normalizeReceipt(value, true));
}

export function validateWakeThreadChain(values: readonly unknown[]): WakeThreadChainAssessment {
  const capturedValues = snapshotJson(values);
  if (!Array.isArray(capturedValues)) {
    fail("chain_invalid", `A chain must contain between 1 and ${MAX_CHAIN_LENGTH} receipts`);
  }
  const chainValues = snapshotDenseArray(
    capturedValues as unknown[],
    "chain",
    MAX_CHAIN_LENGTH,
    "chain_invalid",
  );
  if (chainValues.length < 1) {
    fail("chain_invalid", `A chain must contain between 1 and ${MAX_CHAIN_LENGTH} receipts`);
  }
  const receipts = chainValues.map((value) => normalizeReceipt(value, true));
  const ids = receipts.map((receipt) => receipt.receipt_id);
  if (new Set(ids).size !== ids.length) fail("chain_invalid", "A chain cannot repeat a receipt");
  if (receipts[0]!.offer.parent_receipt_id !== null) {
    fail("chain_invalid", "The first supplied receipt must begin the represented chain");
  }
  const threadRefs = new Set<Sha256Id>([receipts[0]!.offer.thread_ref]);
  for (let index = 0; index < receipts.length; index += 1) {
    const parent = receipts[index]!;
    if (parent.reported_choice === "fork") {
      if (parent.branch_ref === null || threadRefs.has(parent.branch_ref)) {
        fail("chain_invalid", "A fork cannot reuse an ancestor thread reference");
      }
      threadRefs.add(parent.branch_ref);
    }
    const current = receipts[index + 1];
    if (current === undefined) continue;
    if (parent.reported_choice === "refuse") {
      fail("chain_invalid", "A refused receipt cannot have a child in the same chain");
    }
    if (current.offer.parent_receipt_id !== parent.receipt_id) {
      fail("chain_invalid", "A child offer does not reference the previous receipt");
    }
    const expectedThread = parent.reported_choice === "fork"
      ? parent.branch_ref
      : parent.offer.thread_ref;
    if (expectedThread === null || current.offer.thread_ref !== expectedThread) {
      fail("chain_invalid", "A child offer does not follow the parent thread disposition");
    }
    if (Date.parse(current.offer.observed_at) < Date.parse(parent.responded_at)) {
      fail("chain_invalid", "A child offer predates its parent receipt");
    }
    if (parent.offer.artifact_retention.mode === "ephemeral") {
      fail("chain_invalid", "An ephemeral offer cannot become a child-offer parent");
    }
    if (
      parent.offer.artifact_retention.mode === "until"
      && parent.offer.artifact_retention.until !== null
      && Date.parse(current.offer.observed_at) >= Date.parse(parent.offer.artifact_retention.until)
    ) {
      fail("chain_invalid", "A child offer reuses a parent beyond its retention boundary");
    }
  }
  const head = receipts[receipts.length - 1]!;
  return {
    valid: true,
    length: receipts.length,
    root_offer_id: receipts[0]!.offer.offer_id,
    head_receipt_id: head.receipt_id,
    thread_refs: [...threadRefs],
    boundary: WAKE_THREAD_CHAIN_BOUNDARY,
  };
}
