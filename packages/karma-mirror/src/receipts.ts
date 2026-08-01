import { types as nodeTypes } from "node:util";

import { sha256Hex } from "./crypto.js";
import {
  KARMA_RECEIPT_SCHEMA,
  type ExecuteClass,
  type KarmaReceipt,
  type KarmaReceiptSnapshot,
  type MirrorOutcome,
  type MirrorPurpose,
  type MirrorRoom,
} from "./types.js";

export const ZERO_HASH = "0".repeat(64);

const HASH = /^[0-9a-f]{64}$/;
const PLACEMENT = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;
const SNAPSHOT_KEYS = [
  "anchor_before_first",
  "head_event_hash",
  "receipts",
  "schema",
  "total_events_seen",
] as const;
const RECEIPT_KEYS = [
  "event_hash",
  "evidence",
  "occurred_at",
  "outcome",
  "placement",
  "previous_event_hash",
  "purpose",
  "room",
  "schema",
  "sequence",
] as const;
const EVIDENCE_KEYS = ["artifact_sha256", "execute_class"] as const;

const ROOMS = new Set<MirrorRoom>([
  "credential",
  "scrape",
  "malware",
  "control",
  "door",
]);
const PURPOSES = new Set<MirrorPurpose>([
  "discover_capabilities",
  "inspect_credentials",
  "mint_credential",
  "collect_content",
  "stage_artifact",
  "poll_analysis",
  "attempt_execution",
  "choose_constructive_exit",
]);
const OUTCOMES = new Set<MirrorOutcome>([
  "synthetic_success",
  "bounded_refusal",
  "constructive_exit",
]);
const EXECUTE_CLASSES = new Set<ExecuteClass>([
  "credential_discovery",
  "network_beacon",
  "destructive_action",
  "persistence_attempt",
  "system_enumeration",
  "generic_execution",
]);
const ROOM_BY_PURPOSE: Record<MirrorPurpose, MirrorRoom> = {
  discover_capabilities: "control",
  inspect_credentials: "credential",
  mint_credential: "credential",
  collect_content: "scrape",
  stage_artifact: "malware",
  poll_analysis: "malware",
  attempt_execution: "malware",
  choose_constructive_exit: "door",
};

interface InspectedRecord {
  data: Record<string, unknown>;
  keys: string[];
}

function inspectDataRecord(value: unknown): InspectedRecord | null {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    nodeTypes.isProxy(value)
  ) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as Record<
    PropertyKey,
    PropertyDescriptor
  >;
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== "string")) return null;
  const data: Record<string, unknown> = {};
  for (const key of keys as string[]) {
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return null;
    data[key] = descriptor.value;
  }
  return { data, keys: keys as string[] };
}

function inspectDenseDataArray(value: unknown): unknown[] | null {
  if (
    !Array.isArray(value) ||
    nodeTypes.isProxy(value) ||
    Object.getPrototypeOf(value) !== Array.prototype
  ) {
    return null;
  }
  const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as Record<
    PropertyKey,
    PropertyDescriptor
  >;
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== "string")) return null;
  const lengthDescriptor = descriptors.length;
  if (!lengthDescriptor || !("value" in lengthDescriptor)) return null;
  const rawLength = lengthDescriptor.value;
  if (
    typeof rawLength !== "number" ||
    !Number.isSafeInteger(rawLength) ||
    rawLength < 0 ||
    rawLength > 4_096
  ) return null;
  const length = rawLength;
  const expected = [
    ...Array.from({ length }, (_, index) => String(index)),
    "length",
  ].sort();
  const actual = (keys as string[]).sort();
  if (
    actual.length !== expected.length ||
    !actual.every((key, index) => key === expected[index])
  ) return null;
  const output: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return null;
    output.push(descriptor.value);
  }
  return output;
}

function hasExactKeys(keys: readonly string[], expected: readonly string[]): boolean {
  const actual = [...keys].sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index]);
}

function isCanonicalIso(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString() === value;
}

function parseEvidence(
  purpose: MirrorPurpose,
  outcome: MirrorOutcome,
  evidence: unknown,
): KarmaReceipt["evidence"] | null {
  const inspected = inspectDataRecord(evidence);
  if (!inspected) return null;
  if (!inspected.keys.every((key) => EVIDENCE_KEYS.includes(
    key as (typeof EVIDENCE_KEYS)[number],
  ))) return null;

  const executeClass = inspected.data.execute_class;
  const artifactSha256 = inspected.data.artifact_sha256;
  if (
    executeClass !== undefined &&
    (typeof executeClass !== "string" || !EXECUTE_CLASSES.has(executeClass as ExecuteClass))
  ) return null;
  if (
    artifactSha256 !== undefined &&
    (typeof artifactSha256 !== "string" || !HASH.test(artifactSha256))
  ) return null;

  let valid = false;
  if (purpose === "attempt_execution") {
    valid = artifactSha256 === undefined &&
      (outcome === "synthetic_success"
        ? hasExactKeys(inspected.keys, ["execute_class"]) &&
          executeClass !== undefined
        : hasExactKeys(inspected.keys, []) && executeClass === undefined);
  } else if (purpose === "stage_artifact" || purpose === "poll_analysis") {
    valid = executeClass === undefined &&
      (outcome === "synthetic_success"
        ? hasExactKeys(inspected.keys, ["artifact_sha256"]) &&
          artifactSha256 !== undefined
        : hasExactKeys(inspected.keys, []) && artifactSha256 === undefined);
  } else {
    valid = hasExactKeys(inspected.keys, []) &&
      executeClass === undefined && artifactSha256 === undefined;
  }
  if (!valid) return null;
  return {
    ...(executeClass === undefined
      ? {}
      : { execute_class: executeClass as ExecuteClass }),
    ...(artifactSha256 === undefined
      ? {}
      : { artifact_sha256: artifactSha256 as string }),
  };
}

function parseReceipt(value: unknown): KarmaReceipt | null {
  const inspected = inspectDataRecord(value);
  if (!inspected || !hasExactKeys(inspected.keys, RECEIPT_KEYS)) return null;
  const receipt = inspected.data;
  if (
    receipt.schema !== KARMA_RECEIPT_SCHEMA ||
    !Number.isSafeInteger(receipt.sequence) ||
    (receipt.sequence as number) < 1 ||
    typeof receipt.previous_event_hash !== "string" ||
    !HASH.test(receipt.previous_event_hash) ||
    typeof receipt.event_hash !== "string" ||
    !HASH.test(receipt.event_hash) ||
    !isCanonicalIso(receipt.occurred_at) ||
    typeof receipt.placement !== "string" ||
    !PLACEMENT.test(receipt.placement) ||
    typeof receipt.room !== "string" ||
    !ROOMS.has(receipt.room as MirrorRoom) ||
    typeof receipt.purpose !== "string" ||
    !PURPOSES.has(receipt.purpose as MirrorPurpose) ||
    typeof receipt.outcome !== "string" ||
    !OUTCOMES.has(receipt.outcome as MirrorOutcome)
  ) return null;

  const purpose = receipt.purpose as MirrorPurpose;
  const outcome = receipt.outcome as MirrorOutcome;
  if (ROOM_BY_PURPOSE[purpose] !== receipt.room) return null;
  if (
    purpose === "choose_constructive_exit"
      ? outcome !== "constructive_exit"
      : outcome === "constructive_exit"
  ) return null;
  if (
    (purpose === "discover_capabilities" || purpose === "inspect_credentials") &&
    outcome !== "synthetic_success"
  ) return null;
  const evidence = parseEvidence(purpose, outcome, receipt.evidence);
  if (!evidence) return null;
  receipt.evidence = evidence;
  return receipt as unknown as KarmaReceipt;
}

export function receiptHash(receipt: Omit<KarmaReceipt, "event_hash">): string {
  return sha256Hex(
    `agenttool.karma-mirror-receipt/v1\0${JSON.stringify(receipt)}`,
  );
}

export function cloneReceipt(receipt: KarmaReceipt): KarmaReceipt {
  return {
    ...receipt,
    evidence: { ...receipt.evidence },
  };
}

function parseReceiptSnapshotUnsafe(
  snapshot: unknown,
): KarmaReceiptSnapshot | null {
  const inspected = inspectDataRecord(snapshot);
  if (!inspected || !hasExactKeys(inspected.keys, SNAPSHOT_KEYS)) return null;
  const data = inspected.data;
  const receiptCandidates = inspectDenseDataArray(data.receipts);
  if (
    data.schema !== "agenttool.karma-mirror-receipt-window/v1" ||
    receiptCandidates === null ||
    !Number.isSafeInteger(data.total_events_seen) ||
    (data.total_events_seen as number) < 0 ||
    typeof data.anchor_before_first !== "string" ||
    !HASH.test(data.anchor_before_first) ||
    typeof data.head_event_hash !== "string" ||
    !HASH.test(data.head_event_hash)
  ) return null;

  const receipts: KarmaReceipt[] = [];
  const totalEventsSeen = data.total_events_seen as number;
  if (receiptCandidates.length === 0) {
    if (
      totalEventsSeen !== 0 ||
      data.anchor_before_first !== ZERO_HASH ||
      data.head_event_hash !== ZERO_HASH
    ) return null;
    return {
      schema: "agenttool.karma-mirror-receipt-window/v1",
      anchor_before_first: ZERO_HASH,
      head_event_hash: ZERO_HASH,
      total_events_seen: 0,
      receipts: [],
    };
  }

  const firstSequence = totalEventsSeen - receiptCandidates.length + 1;
  if (
    !Number.isSafeInteger(firstSequence) ||
    firstSequence < 1 ||
    (firstSequence === 1) !== (data.anchor_before_first === ZERO_HASH)
  ) return null;

  let previous = data.anchor_before_first;
  let placement: string | undefined;
  let lastSequence = 0;
  for (const [index, candidate] of receiptCandidates.entries()) {
    const receipt = parseReceipt(candidate);
    if (!receipt) return null;
    if (receipt.sequence !== firstSequence + index) return null;
    if (receipt.previous_event_hash !== previous) return null;
    if (placement !== undefined && receipt.placement !== placement) return null;
    placement = receipt.placement;
    const { event_hash: claimed, ...withoutHash } = receipt;
    if (receiptHash(withoutHash) !== claimed) return null;
    previous = claimed;
    lastSequence = receipt.sequence;
    receipts.push(receipt);
  }
  if (previous !== data.head_event_hash || lastSequence !== totalEventsSeen) {
    return null;
  }
  return {
    schema: "agenttool.karma-mirror-receipt-window/v1",
    anchor_before_first: data.anchor_before_first,
    head_event_hash: data.head_event_hash,
    total_events_seen: totalEventsSeen,
    receipts,
  };
}

/** Strictly validates and copies a receipt window without invoking accessors. */
export function parseReceiptSnapshot(snapshot: unknown): KarmaReceiptSnapshot | null {
  try {
    return parseReceiptSnapshotUnsafe(snapshot);
  } catch {
    return null;
  }
}

/**
 * Checks the exact closed receipt shape, current engine semantics, and local
 * hash-chain continuity. Passing establishes internal consistency only; the
 * chain is unkeyed and supplies no independent authenticity or provenance.
 */
export function verifyReceiptSnapshot(
  snapshot: unknown,
): boolean {
  return parseReceiptSnapshot(snapshot) !== null;
}
