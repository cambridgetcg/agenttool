/**
 * Pure validation and receipt construction for the Whitehack evidence bridge.
 *
 * This module has no filesystem, process, network, environment, clock, Castle,
 * or storage-provider dependency. Callers supply all time and cryptographic
 * results explicitly.
 *
 * Doctrine: docs/WHITEHACK.md
 */
import {
  canonicalJson,
  canonicalJsonBytes,
  parseCanonicalJson,
} from "../packages/data-protocol/src/canonical.js";
import type { SignedGrant } from "../packages/data-protocol/src/types.js";

export const WHITEHACK_EVIDENCE_CAPSULE_DOCUMENT =
  "whitehack-evidence-capsule/v1" as const;
export const WHITEHACK_EVIDENCE_CAPSULE_DISCLOSURE =
  "whitehack-public-minimal/v1" as const;
export const WHITEHACK_EVIDENCE_CAPSULE_MEDIA_TYPE =
  "application/vnd.whitehack.evidence-capsule.v1+json" as const;
export const WHITEHACK_EVIDENCE_FRAME_SCHEMA =
  "agenttool-whitehack-evidence-frame/v1" as const;
export const WHITEHACK_EVIDENCE_CAPSULE_SCANNER_VERSION = "0.9.0" as const;
export const WHITEHACK_EVIDENCE_CAPSULE_CHECK_COUNT = 47 as const;
export const WHITEHACK_EVIDENCE_STORAGE_INPUT_DOCUMENT =
  "agenttool-whitehack-evidence-storage-input/v1" as const;
export const WHITEHACK_EVIDENCE_STORAGE_RECEIPT_DOCUMENT =
  "agenttool-whitehack-evidence-storage-receipt/v1" as const;
export const WHITEHACK_EVIDENCE_STORAGE_VERSION = "0.1.0" as const;

const WHITEHACK_EVIDENCE_FRAME_MAGIC = new TextEncoder().encode(
  "agenttool-whitehack-evidence-frame/v1\0",
);
export const WHITEHACK_EVIDENCE_FRAME_BYTES = 64 * 1024;
export const WHITEHACK_EVIDENCE_FRAME_HEADER_BYTES =
  WHITEHACK_EVIDENCE_FRAME_MAGIC.byteLength + 4;
export const MAX_WHITEHACK_EVIDENCE_CAPSULE_BYTES = 60 * 1024;
export const MAX_WHITEHACK_EVIDENCE_MANIFEST_BYTES = 8 * 1024;
export const WHITEHACK_EVIDENCE_ENCRYPTED_FRAME_BYTES =
  WHITEHACK_EVIDENCE_FRAME_BYTES + 12 + 16;
export const MAX_WHITEHACK_EVIDENCE_FINDINGS = 10_000;
export const MAX_WHITEHACK_EVIDENCE_SIGNAL_GROUPS = 77;
export const DEFAULT_WHITEHACK_EVIDENCE_GRANT_TTL_SECONDS =
  30 * 24 * 60 * 60;
export const MAX_WHITEHACK_EVIDENCE_GRANT_TTL_SECONDS =
  10 * 365 * 24 * 60 * 60;
export const DEFAULT_WHITEHACK_EVIDENCE_STORE_TIMEOUT_MS = 5_000;

const CID_RE = /^b[a-z2-7]{58}$/u;
const BASE64URL_32_RE = /^[A-Za-z0-9_-]{43}$/u;
const BASE64URL_64_RE = /^[A-Za-z0-9_-]{86}$/u;
const KEY_ID_RE = /^sha256:[A-Za-z0-9_-]{43}$/u;
const UUID_URN_RE =
  /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const RFC3339_MILLISECONDS_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const FORBIDDEN_TEXT_RE =
  /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;

const CONFIDENCES = Object.freeze([
  "high",
  "heuristic",
  "medium",
  "medium-high",
] as const);

export type WhitehackEvidenceConfidence = (typeof CONFIDENCES)[number];
export type WhitehackEvidenceDoctrine =
  | "substrate-honesty"
  | "transparency"
  | "trust-protocol";

export type WhitehackEvidenceCapsule = Readonly<{
  document_type: typeof WHITEHACK_EVIDENCE_CAPSULE_DOCUMENT;
  complete: true;
  disclosure: Readonly<{
    profile: typeof WHITEHACK_EVIDENCE_CAPSULE_DISCLOSURE;
    scan_metadata_retained: readonly ["scanner"];
    finding_group_fields: readonly [
      "check",
      "confidence",
      "doctrine",
      "principle",
      "count",
    ];
    target_retained: false;
    locations_retained: false;
    source_text_retained: false;
    scope_retained: false;
    caller_text_retained: false;
  }>;
  scanner: Readonly<{
    name: "whitehack";
    version: typeof WHITEHACK_EVIDENCE_CAPSULE_SCANNER_VERSION;
    check_count: typeof WHITEHACK_EVIDENCE_CAPSULE_CHECK_COUNT;
  }>;
  finding_groups: readonly Readonly<{
    check: string;
    confidence: WhitehackEvidenceConfidence;
    doctrine: WhitehackEvidenceDoctrine;
    principle: number;
    count: number;
  }>[];
  epistemic: Readonly<{
    basis: "scanner-output-claim";
    finding_semantics: "review-prompt-not-vulnerability-verdict";
    empty_semantics: "no-bundled-match-not-security-proof";
    provenance: "unverified";
    coverage: "bounded-heuristic";
    content_address: "canonical-bytes-identity-not-authenticity";
    complete_semantics: "capsule-transformation-complete";
  }>;
  boundaries: Readonly<{
    capability_subject: "evidence-capsule-transform";
    direct_capabilities: Readonly<{
      filesystem: false;
      process: false;
      network: false;
      storage: false;
      wallet: false;
      clock: false;
      key_store_access: false;
      signing: false;
      encryption: false;
      authorization: false;
    }>;
    input_inspection: Readonly<{
      ordinary_accessors_invoked: false;
      caller_proxy_traps_may_run: true;
      sandboxed: false;
    }>;
    publication_authority: "external";
    storage_receipt_included: false;
  }>;
}>;

export type WhitehackEvidenceStorageInput = Readonly<{
  document_type: typeof WHITEHACK_EVIDENCE_STORAGE_INPUT_DOCUMENT;
  capsule: WhitehackEvidenceCapsule;
  recipient: Readonly<{
    id: string;
    x25519_public_key: string;
  }>;
  grant: Readonly<{
    /** Null selects the documented finite 30-day default. */
    expires_at: string | null;
  }>;
}>;

export type WhitehackEvidenceStorageReceipt = Readonly<{
  document_type: typeof WHITEHACK_EVIDENCE_STORAGE_RECEIPT_DOCUMENT;
  manifest_cid: string;
  signed_grant: SignedGrant;
  handling: Readonly<{
    sensitivity: "sensitive-recipient-bound-read-grant";
    contains_recipient_metadata: true;
    contains_publisher_metadata: true;
    safe_for_publication: false;
  }>;
  counts: Readonly<{
    ciphertext_blocks: number;
    ciphertext_blocks_verified: number;
    encrypted_bytes_verified: number;
    remote_objects_acknowledged: number;
    minimum_write_acknowledgements: number;
    maximum_write_acknowledgements: number;
    failed_writes: number;
  }>;
  verification: Readonly<{
    verified_at: string;
    manifest_and_ciphertext_cids: true;
    decrypted_read_back_exact_bytes: true;
    capsule_schema_revalidated: true;
    fixed_size_frame_validated: true;
  }>;
  boundaries: Readonly<{
    status: "observed-and-verified-at-time-only";
    durability_claim: false;
    permanence_claim: false;
    retention_claim: false;
    deletion_claim: false;
    publication_claim: false;
    target_authorization_claim: false;
    automatic_scan: false;
    castle_write: false;
    retry: false;
    delete_operation: false;
  }>;
}>;

export class WhitehackEvidenceStorageError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "WhitehackEvidenceStorageError";
    this.code = code;
  }
}

function fail(code: string): never {
  throw new WhitehackEvidenceStorageError(code);
}

function isObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function object(
  value: unknown,
  keys: readonly string[],
  code: string,
): Record<string, unknown> {
  if (!isObject(value)) fail(code);
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.length
    || ownKeys.some((key) => typeof key !== "string" || !keys.includes(key))
  ) fail(code);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined
      || !("value" in descriptor)
      || descriptor.enumerable !== true
    ) fail(code);
  }
  return value;
}

function field(object: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (descriptor === undefined || !("value" in descriptor)) {
    fail("input_shape_invalid");
  }
  return descriptor.value;
}

function denseArray(
  value: unknown,
  maximum: number,
  code: string,
): readonly unknown[] {
  let isArray = false;
  try {
    isArray = Array.isArray(value);
  } catch {
    fail(code);
  }
  if (!isArray) fail(code);
  let descriptors: PropertyDescriptorMap;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    fail(code);
  }
  const ownKeys = Reflect.ownKeys(descriptors);
  if (
    ownKeys.some((key) =>
      typeof key !== "string"
      || (
        key !== "length"
        && !/^(?:0|[1-9]\d*)$/u.test(key)
      )
    )
  ) fail(code);
  const lengthDescriptor = descriptors.length;
  if (
    lengthDescriptor === undefined
    || lengthDescriptor.enumerable
    || !("value" in lengthDescriptor)
    || !Number.isSafeInteger(lengthDescriptor.value)
    || lengthDescriptor.value < 0
    || lengthDescriptor.value > maximum
  ) fail(code);
  const length = lengthDescriptor.value as number;
  if (ownKeys.length !== length + 1) fail(code);
  const snapshot: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (
      descriptor === undefined
      || !descriptor.enumerable
      || !("value" in descriptor)
    ) fail(code);
    snapshot.push(descriptor.value);
  }
  return snapshot;
}

function integer(
  value: unknown,
  minimum: number,
  maximum: number,
  code: string,
): number {
  if (
    !Number.isSafeInteger(value)
    || (value as number) < minimum
    || (value as number) > maximum
  ) fail(code);
  return value as number;
}

function literal<T extends string | boolean>(
  value: unknown,
  expected: T,
  code: string,
): T {
  if (value !== expected) fail(code);
  return expected;
}

function token(
  value: unknown,
  expression: RegExp,
  code: string,
): string {
  if (typeof value !== "string" || !expression.test(value)) fail(code);
  return value;
}

function principalId(value: unknown, code: string): string {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > 512
    || value !== value.trim()
    || FORBIDDEN_TEXT_RE.test(value)
    || hasUnpairedUtf16Surrogate(value)
  ) fail(code);
  return value;
}

function hasUnpairedUtf16Surrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (
        index + 1 >= value.length
        || next < 0xdc00
        || next > 0xdfff
      ) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function timestamp(value: unknown, code: string): string {
  if (
    typeof value !== "string"
    || !RFC3339_MILLISECONDS_RE.test(value)
    || Number.isNaN(Date.parse(value))
    || new Date(value).toISOString() !== value
  ) fail(code);
  return value;
}

function wholeSecondTimestamp(value: unknown, code: string): string {
  const normalized = timestamp(value, code);
  if (!normalized.endsWith(".000Z")) fail(code);
  return normalized;
}

type CheckProfile = Readonly<{
  confidence: WhitehackEvidenceConfidence;
  doctrine: WhitehackEvidenceDoctrine;
  principle: number;
}>;

/*
 * This is the public check metadata from Whitehack 0.9.0's CHECK_MANIFEST.
 * It intentionally excludes titles, languages, source, and all caller text.
 * The local copy is temporary protocol validation, not a runtime import across
 * repositories; the compatibility test fixes the canonical bytes produced by
 * Whitehack itself.
 */
const CHECK_PROFILE = new Map<string, CheckProfile>([
  ["silent-failure", { confidence: "medium-high", doctrine: "substrate-honesty", principle: 2 }],
  ["cache-as-live", { confidence: "heuristic", doctrine: "substrate-honesty", principle: 4 }],
  ["decision-without-why", { confidence: "heuristic", doctrine: "transparency", principle: 3 }],
  ["stale-oracle", { confidence: "medium-high", doctrine: "substrate-honesty", principle: 4 }],
  ["unchecked-transfer", { confidence: "medium-high", doctrine: "substrate-honesty", principle: 2 }],
  ["spot-price-as-fair", { confidence: "heuristic", doctrine: "substrate-honesty", principle: 1 }],
  ["silent-revert", { confidence: "heuristic", doctrine: "transparency", principle: 3 }],
  ["float-money", { confidence: "medium-high", doctrine: "substrate-honesty", principle: 1 }],
  ["hardcoded-secret", { confidence: "high", doctrine: "substrate-honesty", principle: 2 }],
  ["exposed-config", { confidence: "high", doctrine: "substrate-honesty", principle: 2 }],
  ["unsafe-eval", { confidence: "medium-high", doctrine: "substrate-honesty", principle: 2 }],
  ["performed-ignorance", { confidence: "medium-high", doctrine: "substrate-honesty", principle: 1 }],
  ["trust-by-authority", { confidence: "heuristic", doctrine: "trust-protocol", principle: 3 }],
  ["api-status-lie", { confidence: "high", doctrine: "substrate-honesty", principle: 2 }],
  ["api-missing-versioning", { confidence: "heuristic", doctrine: "substrate-honesty", principle: 1 }],
  ["api-error-without-shape", { confidence: "heuristic", doctrine: "substrate-honesty", principle: 3 }],
  ["api-missing-rate-limit", { confidence: "heuristic", doctrine: "substrate-honesty", principle: 4 }],
  ["api-bare-fetch", { confidence: "medium-high", doctrine: "substrate-honesty", principle: 2 }],
  ["wifi-protocol-flaws", { confidence: "medium-high", doctrine: "substrate-honesty", principle: 2 }],
  ["bluetooth-protocol-flaws", { confidence: "medium-high", doctrine: "substrate-honesty", principle: 2 }],
  ["bluetooth-protocol", { confidence: "high", doctrine: "substrate-honesty", principle: 2 }],
  ["insecure-protocol", { confidence: "medium-high", doctrine: "substrate-honesty", principle: 2 }],
  ["disabled-cert-verification", { confidence: "high", doctrine: "substrate-honesty", principle: 2 }],
  ["weak-crypto", { confidence: "medium-high", doctrine: "substrate-honesty", principle: 2 }],
  ["cors-wildcard", { confidence: "medium-high", doctrine: "substrate-honesty", principle: 2 }],
  ["cookie-insecure", { confidence: "medium-high", doctrine: "substrate-honesty", principle: 2 }],
  ["sql-injection", { confidence: "high", doctrine: "substrate-honesty", principle: 2 }],
  ["protocol-surface", { confidence: "medium-high", doctrine: "substrate-honesty", principle: 2 }],
  ["dns-plaintext", { confidence: "heuristic", doctrine: "substrate-honesty", principle: 4 }],
  ["password-auth", { confidence: "high", doctrine: "substrate-honesty", principle: 2 }],
  ["bluetooth-paired-stranger", { confidence: "heuristic", doctrine: "substrate-honesty", principle: 3 }],
  ["wpa2-krack", { confidence: "medium-high", doctrine: "substrate-honesty", principle: 2 }],
  ["weak-wifi-encryption", { confidence: "high", doctrine: "substrate-honesty", principle: 1 }],
  ["wifi-deauth-accept", { confidence: "medium-high", doctrine: "substrate-honesty", principle: 2 }],
  ["wifi-evil-twin", { confidence: "medium-high", doctrine: "substrate-honesty", principle: 5 }],
  ["wifi-pmk-exposure", { confidence: "high", doctrine: "substrate-honesty", principle: 1 }],
  ["wifi-krack-vulnerable", { confidence: "medium-high", doctrine: "substrate-honesty", principle: 4 }],
  ["wifi-protocol", { confidence: "high", doctrine: "substrate-honesty", principle: 2 }],
  ["static-aead-nonce", { confidence: "heuristic", doctrine: "substrate-honesty", principle: 1 }],
  ["signature-fail-open", { confidence: "medium-high", doctrine: "substrate-honesty", principle: 2 }],
  ["webhook-reencoded-body", { confidence: "heuristic", doctrine: "substrate-honesty", principle: 1 }],
  ["signed-webhook-without-replay-guard", { confidence: "heuristic", doctrine: "substrate-honesty", principle: 4 }],
  ["wallet-key-egress", { confidence: "medium-high", doctrine: "substrate-honesty", principle: 2 }],
  ["wallet-direct-request-signing", { confidence: "heuristic", doctrine: "substrate-honesty", principle: 3 }],
  ["wallet-capability-unbounded", { confidence: "heuristic", doctrine: "substrate-honesty", principle: 3 }],
  ["wallet-broadcast-auto-retry", { confidence: "heuristic", doctrine: "substrate-honesty", principle: 2 }],
  ["unlimited-token-approval", { confidence: "heuristic", doctrine: "substrate-honesty", principle: 3 }],
]);

if (CHECK_PROFILE.size !== WHITEHACK_EVIDENCE_CAPSULE_CHECK_COUNT) {
  throw new Error("whitehack_check_profile_internal_mismatch");
}

const EXPECTED_EPISTEMIC = Object.freeze({
  basis: "scanner-output-claim",
  finding_semantics: "review-prompt-not-vulnerability-verdict",
  empty_semantics: "no-bundled-match-not-security-proof",
  provenance: "unverified",
  coverage: "bounded-heuristic",
  content_address: "canonical-bytes-identity-not-authenticity",
  complete_semantics: "capsule-transformation-complete",
} as const);

const EXPECTED_DIRECT_CAPABILITIES = Object.freeze({
  filesystem: false,
  process: false,
  network: false,
  storage: false,
  wallet: false,
  clock: false,
  key_store_access: false,
  signing: false,
  encryption: false,
  authorization: false,
} as const);

const EXPECTED_INPUT_INSPECTION = Object.freeze({
  ordinary_accessors_invoked: false,
  caller_proxy_traps_may_run: true,
  sandboxed: false,
} as const);

function exactStringArray(
  value: unknown,
  expected: readonly string[],
  code: string,
): string[] {
  const values = denseArray(value, expected.length, code);
  if (
    values.length !== expected.length
    || values.some((entry, index) => entry !== expected[index])
  ) fail(code);
  return [...expected];
}

function fixedRecord<T extends Readonly<Record<string, string | boolean>>>(
  value: unknown,
  expected: T,
  code: string,
): T {
  const input = object(value, Object.keys(expected), code);
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (field(input, key) !== expectedValue) fail(code);
  }
  return { ...expected };
}

type FindingGroup = WhitehackEvidenceCapsule["finding_groups"][number];

function compareFindingGroups(left: FindingGroup, right: FindingGroup): number {
  for (const key of ["check", "confidence", "doctrine"] as const) {
    if (left[key] < right[key]) return -1;
    if (left[key] > right[key]) return 1;
  }
  return left.principle - right.principle;
}

function normalizeFindingGroup(value: unknown): FindingGroup {
  const input = object(
    value,
    ["check", "confidence", "doctrine", "principle", "count"],
    "capsule_finding_group_invalid",
  );
  const checkValue = field(input, "check");
  if (typeof checkValue !== "string") fail("capsule_finding_group_invalid");
  const profile = CHECK_PROFILE.get(checkValue);
  if (profile === undefined) fail("capsule_finding_group_invalid");
  const confidenceValue = field(input, "confidence");
  if (
    typeof confidenceValue !== "string"
    || !CONFIDENCES.includes(confidenceValue as WhitehackEvidenceConfidence)
    || (
      confidenceValue !== profile.confidence
      && confidenceValue !== "heuristic"
    )
  ) fail("capsule_finding_group_invalid");
  if (
    field(input, "doctrine") !== profile.doctrine
    || field(input, "principle") !== profile.principle
  ) fail("capsule_finding_group_invalid");
  return {
    check: checkValue,
    confidence: confidenceValue as WhitehackEvidenceConfidence,
    doctrine: profile.doctrine,
    principle: profile.principle,
    count: integer(
      field(input, "count"),
      1,
      MAX_WHITEHACK_EVIDENCE_FINDINGS,
      "capsule_finding_group_invalid",
    ),
  };
}

export function normalizeWhitehackEvidenceCapsule(
  value: unknown,
): WhitehackEvidenceCapsule {
  const root = object(
    value,
    [
      "document_type",
      "complete",
      "disclosure",
      "scanner",
      "finding_groups",
      "epistemic",
      "boundaries",
    ],
    "capsule_shape_invalid",
  );
  literal(
    field(root, "document_type"),
    WHITEHACK_EVIDENCE_CAPSULE_DOCUMENT,
    "capsule_document_type_invalid",
  );
  literal(field(root, "complete"), true, "capsule_complete_invalid");

  const disclosure = object(
    field(root, "disclosure"),
    [
      "profile",
      "scan_metadata_retained",
      "finding_group_fields",
      "target_retained",
      "locations_retained",
      "source_text_retained",
      "scope_retained",
      "caller_text_retained",
    ],
    "capsule_disclosure_invalid",
  );
  literal(
    field(disclosure, "profile"),
    WHITEHACK_EVIDENCE_CAPSULE_DISCLOSURE,
    "capsule_disclosure_invalid",
  );
  const scanMetadataRetained = exactStringArray(
    field(disclosure, "scan_metadata_retained"),
    ["scanner"],
    "capsule_disclosure_invalid",
  ) as ["scanner"];
  const findingGroupFields = exactStringArray(
    field(disclosure, "finding_group_fields"),
    ["check", "confidence", "doctrine", "principle", "count"],
    "capsule_disclosure_invalid",
  ) as ["check", "confidence", "doctrine", "principle", "count"];
  for (const key of [
    "target_retained",
    "locations_retained",
    "source_text_retained",
    "scope_retained",
    "caller_text_retained",
  ]) {
    literal(field(disclosure, key), false, "capsule_disclosure_invalid");
  }

  const scanner = object(
    field(root, "scanner"),
    ["name", "version", "check_count"],
    "capsule_scanner_invalid",
  );
  literal(field(scanner, "name"), "whitehack", "capsule_scanner_invalid");
  literal(
    field(scanner, "version"),
    WHITEHACK_EVIDENCE_CAPSULE_SCANNER_VERSION,
    "capsule_scanner_invalid",
  );
  if (
    field(scanner, "check_count")
      !== WHITEHACK_EVIDENCE_CAPSULE_CHECK_COUNT
  ) fail("capsule_scanner_invalid");

  const groupValues = denseArray(
    field(root, "finding_groups"),
    MAX_WHITEHACK_EVIDENCE_SIGNAL_GROUPS,
    "capsule_finding_groups_invalid",
  );
  const groups = groupValues.map(normalizeFindingGroup);
  let total = 0;
  for (let index = 0; index < groups.length; index += 1) {
    total += groups[index]!.count;
    if (
      !Number.isSafeInteger(total)
      || total > MAX_WHITEHACK_EVIDENCE_FINDINGS
    ) fail("capsule_finding_count_limit_exceeded");
    if (
      index > 0
      && compareFindingGroups(groups[index - 1]!, groups[index]!) >= 0
    ) fail("capsule_finding_groups_not_canonical");
  }

  const epistemic = fixedRecord(
    field(root, "epistemic"),
    EXPECTED_EPISTEMIC,
    "capsule_epistemic_invalid",
  );
  const boundariesInput = object(
    field(root, "boundaries"),
    [
      "capability_subject",
      "direct_capabilities",
      "input_inspection",
      "publication_authority",
      "storage_receipt_included",
    ],
    "capsule_boundaries_invalid",
  );
  literal(
    field(boundariesInput, "capability_subject"),
    "evidence-capsule-transform",
    "capsule_boundaries_invalid",
  );
  const directCapabilities = fixedRecord(
    field(boundariesInput, "direct_capabilities"),
    EXPECTED_DIRECT_CAPABILITIES,
    "capsule_boundaries_invalid",
  );
  const inputInspection = fixedRecord(
    field(boundariesInput, "input_inspection"),
    EXPECTED_INPUT_INSPECTION,
    "capsule_boundaries_invalid",
  );
  literal(
    field(boundariesInput, "publication_authority"),
    "external",
    "capsule_boundaries_invalid",
  );
  literal(
    field(boundariesInput, "storage_receipt_included"),
    false,
    "capsule_boundaries_invalid",
  );

  const capsule: WhitehackEvidenceCapsule = {
    document_type: WHITEHACK_EVIDENCE_CAPSULE_DOCUMENT,
    complete: true,
    disclosure: {
      profile: WHITEHACK_EVIDENCE_CAPSULE_DISCLOSURE,
      scan_metadata_retained: scanMetadataRetained,
      finding_group_fields: findingGroupFields,
      target_retained: false,
      locations_retained: false,
      source_text_retained: false,
      scope_retained: false,
      caller_text_retained: false,
    },
    scanner: {
      name: "whitehack",
      version: WHITEHACK_EVIDENCE_CAPSULE_SCANNER_VERSION,
      check_count: WHITEHACK_EVIDENCE_CAPSULE_CHECK_COUNT,
    },
    finding_groups: groups,
    epistemic,
    boundaries: {
      capability_subject: "evidence-capsule-transform",
      direct_capabilities: directCapabilities,
      input_inspection: inputInspection,
      publication_authority: "external",
      storage_receipt_included: false,
    },
  };
  const bytes = canonicalJsonBytes(capsule);
  if (bytes.byteLength > MAX_WHITEHACK_EVIDENCE_CAPSULE_BYTES) {
    fail("capsule_byte_limit_exceeded");
  }
  return deepFreeze(capsule);
}

export function normalizeWhitehackEvidenceStorageInput(
  value: unknown,
): WhitehackEvidenceStorageInput {
  const root = object(
    value,
    ["document_type", "capsule", "recipient", "grant"],
    "input_shape_invalid",
  );
  literal(
    field(root, "document_type"),
    WHITEHACK_EVIDENCE_STORAGE_INPUT_DOCUMENT,
    "input_document_type_invalid",
  );
  const recipient = object(
    field(root, "recipient"),
    ["id", "x25519_public_key"],
    "recipient_invalid",
  );
  const recipientId = principalId(field(recipient, "id"), "recipient_invalid");
  const recipientPublicKey = token(
    field(recipient, "x25519_public_key"),
    BASE64URL_32_RE,
    "recipient_invalid",
  );
  const grant = object(
    field(root, "grant"),
    ["expires_at"],
    "grant_policy_invalid",
  );
  const expiresAtValue = field(grant, "expires_at");
  const expiresAt = expiresAtValue === null
    ? null
    : wholeSecondTimestamp(expiresAtValue, "grant_expiry_invalid");
  return deepFreeze({
    document_type: WHITEHACK_EVIDENCE_STORAGE_INPUT_DOCUMENT,
    capsule: normalizeWhitehackEvidenceCapsule(field(root, "capsule")),
    recipient: {
      id: recipientId,
      x25519_public_key: recipientPublicKey,
    },
    grant: { expires_at: expiresAt },
  });
}

export function resolveWhitehackEvidenceGrantWindow(
  input: WhitehackEvidenceStorageInput,
  now: Date,
): Readonly<{ issued_at: number; expires_at: number }> {
  if (
    !(now instanceof Date)
    || Number.isNaN(now.getTime())
  ) fail("clock_invalid");
  const issuedAt = Math.floor(now.getTime() / 1_000);
  const expiresAt = input.grant.expires_at === null
    ? issuedAt + DEFAULT_WHITEHACK_EVIDENCE_GRANT_TTL_SECONDS
    : Date.parse(
      wholeSecondTimestamp(
        input.grant.expires_at,
        "grant_expiry_invalid",
      ),
    ) / 1_000;
  const lifetime = expiresAt - issuedAt;
  if (
    !Number.isSafeInteger(expiresAt)
    || lifetime < 1
    || lifetime > MAX_WHITEHACK_EVIDENCE_GRANT_TTL_SECONDS
  ) fail("grant_expiry_out_of_bounds");
  return Object.freeze({ issued_at: issuedAt, expires_at: expiresAt });
}

export function canonicalCapsuleBytes(
  capsule: WhitehackEvidenceCapsule,
): Uint8Array {
  return canonicalJsonBytes(capsule);
}

export function equalBytes(
  left: Uint8Array,
  right: Uint8Array,
): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= left[index]! ^ right[index]!;
  }
  return difference === 0;
}

/**
 * Hide the small capsule domain and exact finding distribution from storage
 * providers by encrypting one constant-size authenticated plaintext frame.
 */
export function frameWhitehackEvidenceCapsule(
  capsule: WhitehackEvidenceCapsule,
): Uint8Array {
  const canonical = canonicalCapsuleBytes(
    normalizeWhitehackEvidenceCapsule(capsule),
  );
  if (canonical.byteLength > MAX_WHITEHACK_EVIDENCE_CAPSULE_BYTES) {
    fail("capsule_byte_limit_exceeded");
  }
  const framed = new Uint8Array(WHITEHACK_EVIDENCE_FRAME_BYTES);
  framed.set(WHITEHACK_EVIDENCE_FRAME_MAGIC, 0);
  new DataView(framed.buffer).setUint32(
    WHITEHACK_EVIDENCE_FRAME_MAGIC.byteLength,
    canonical.byteLength,
    false,
  );
  framed.set(canonical, WHITEHACK_EVIDENCE_FRAME_HEADER_BYTES);
  return framed;
}

export function unframeWhitehackEvidenceCapsule(
  framed: Uint8Array,
): Readonly<{
  capsule: WhitehackEvidenceCapsule;
  canonical_bytes: Uint8Array;
}> {
  if (
    !(framed instanceof Uint8Array)
    || framed.byteLength !== WHITEHACK_EVIDENCE_FRAME_BYTES
  ) fail("evidence_frame_invalid");
  if (
    !equalBytes(
      framed.subarray(0, WHITEHACK_EVIDENCE_FRAME_MAGIC.byteLength),
      WHITEHACK_EVIDENCE_FRAME_MAGIC,
    )
  ) fail("evidence_frame_invalid");
  const capsuleLength = new DataView(
    framed.buffer,
    framed.byteOffset,
    framed.byteLength,
  ).getUint32(WHITEHACK_EVIDENCE_FRAME_MAGIC.byteLength, false);
  if (
    capsuleLength < 1
    || capsuleLength > MAX_WHITEHACK_EVIDENCE_CAPSULE_BYTES
    || WHITEHACK_EVIDENCE_FRAME_HEADER_BYTES + capsuleLength
      > framed.byteLength
  ) fail("evidence_frame_invalid");
  const paddingStart = WHITEHACK_EVIDENCE_FRAME_HEADER_BYTES + capsuleLength;
  for (let index = paddingStart; index < framed.byteLength; index += 1) {
    if (framed[index] !== 0) fail("evidence_frame_invalid");
  }
  const canonicalBytes = framed.slice(
    WHITEHACK_EVIDENCE_FRAME_HEADER_BYTES,
    paddingStart,
  );
  let reencoded: Uint8Array | undefined;
  try {
    const parsed = parseCanonicalJson(canonicalBytes);
    const capsule = normalizeWhitehackEvidenceCapsule(parsed);
    reencoded = canonicalCapsuleBytes(capsule);
    if (!equalBytes(canonicalBytes, reencoded)) {
      fail("evidence_capsule_not_canonical");
    }
    return Object.freeze({ capsule, canonical_bytes: canonicalBytes });
  } catch {
    canonicalBytes.fill(0);
    fail("evidence_capsule_not_canonical");
  } finally {
    reencoded?.fill(0);
  }
  fail("evidence_capsule_not_canonical");
}

function normalizeSignedGrant(value: unknown): SignedGrant {
  const root = object(
    value,
    [
      "adds_version",
      "kind",
      "grant_id",
      "manifest_cid",
      "issuer",
      "audience",
      "audience_x25519_public_key",
      "audience_x25519_key_id",
      "rights",
      "issued_at",
      "expires_at",
      "key_wrap",
      "signature",
    ],
    "receipt_grant_invalid",
  );
  literal(field(root, "adds_version"), "0.1", "receipt_grant_invalid");
  literal(field(root, "kind"), "grant", "receipt_grant_invalid");
  const grantId = token(field(root, "grant_id"), UUID_URN_RE, "receipt_grant_invalid");
  const manifestCid = token(field(root, "manifest_cid"), CID_RE, "receipt_grant_invalid");
  const issuerInput = object(
    field(root, "issuer"),
    ["id", "ed25519_public_key"],
    "receipt_grant_invalid",
  );
  const issuer = {
    id: principalId(field(issuerInput, "id"), "receipt_grant_invalid"),
    ed25519_public_key: token(
      field(issuerInput, "ed25519_public_key"),
      BASE64URL_32_RE,
      "receipt_grant_invalid",
    ),
  };
  const audience = principalId(field(root, "audience"), "receipt_grant_invalid");
  const audiencePublicKey = token(
    field(root, "audience_x25519_public_key"),
    BASE64URL_32_RE,
    "receipt_grant_invalid",
  );
  const audienceKeyId = token(
    field(root, "audience_x25519_key_id"),
    KEY_ID_RE,
    "receipt_grant_invalid",
  );
  const rights = denseArray(field(root, "rights"), 1, "receipt_grant_invalid");
  if (rights.length !== 1 || rights[0] !== "read") fail("receipt_grant_invalid");
  const issuedAt = integer(
    field(root, "issued_at"),
    0,
    Number.MAX_SAFE_INTEGER,
    "receipt_grant_invalid",
  );
  const expiresAt = integer(
    field(root, "expires_at"),
    issuedAt + 1,
    Number.MAX_SAFE_INTEGER,
    "receipt_grant_invalid",
  );
  if (expiresAt - issuedAt > MAX_WHITEHACK_EVIDENCE_GRANT_TTL_SECONDS) {
    fail("receipt_grant_invalid");
  }
  const wrapInput = object(
    field(root, "key_wrap"),
    ["algorithm", "ephemeral_public_key", "nonce", "ciphertext"],
    "receipt_grant_invalid",
  );
  const keyWrap = {
    algorithm: literal(
      field(wrapInput, "algorithm"),
      "X25519-HKDF-SHA256-AES-256-GCM",
      "receipt_grant_invalid",
    ),
    ephemeral_public_key: token(
      field(wrapInput, "ephemeral_public_key"),
      BASE64URL_32_RE,
      "receipt_grant_invalid",
    ),
    nonce: token(
      field(wrapInput, "nonce"),
      /^[A-Za-z0-9_-]{16}$/u,
      "receipt_grant_invalid",
    ),
    ciphertext: token(
      field(wrapInput, "ciphertext"),
      /^[A-Za-z0-9_-]{64}$/u,
      "receipt_grant_invalid",
    ),
  };
  const signatureInput = object(
    field(root, "signature"),
    ["algorithm", "public_key", "value"],
    "receipt_grant_invalid",
  );
  const signature = {
    algorithm: literal(
      field(signatureInput, "algorithm"),
      "Ed25519",
      "receipt_grant_invalid",
    ),
    public_key: token(
      field(signatureInput, "public_key"),
      BASE64URL_32_RE,
      "receipt_grant_invalid",
    ),
    value: token(
      field(signatureInput, "value"),
      BASE64URL_64_RE,
      "receipt_grant_invalid",
    ),
  };
  if (signature.public_key !== issuer.ed25519_public_key) {
    fail("receipt_grant_invalid");
  }
  return {
    adds_version: "0.1",
    kind: "grant",
    grant_id: grantId,
    manifest_cid: manifestCid,
    issuer,
    audience,
    audience_x25519_public_key: audiencePublicKey,
    audience_x25519_key_id: audienceKeyId,
    rights: ["read"],
    issued_at: issuedAt,
    expires_at: expiresAt,
    key_wrap: keyWrap,
    signature,
  };
}

export function createWhitehackEvidenceStorageReceipt(input: {
  manifest_cid: string;
  signed_grant: SignedGrant;
  counts: WhitehackEvidenceStorageReceipt["counts"];
  verified_at: string;
}): WhitehackEvidenceStorageReceipt {
  const manifestCid = token(
    input.manifest_cid,
    CID_RE,
    "receipt_manifest_cid_invalid",
  );
  const grant = normalizeSignedGrant(input.signed_grant);
  if (grant.manifest_cid !== manifestCid) fail("receipt_grant_manifest_mismatch");
  const countsInput = object(
    input.counts,
    [
      "ciphertext_blocks",
      "ciphertext_blocks_verified",
      "encrypted_bytes_verified",
      "remote_objects_acknowledged",
      "minimum_write_acknowledgements",
      "maximum_write_acknowledgements",
      "failed_writes",
    ],
    "receipt_counts_invalid",
  );
  const counts = {
    ciphertext_blocks: integer(
      field(countsInput, "ciphertext_blocks"),
      1,
      1_024,
      "receipt_counts_invalid",
    ),
    ciphertext_blocks_verified: integer(
      field(countsInput, "ciphertext_blocks_verified"),
      1,
      1_024,
      "receipt_counts_invalid",
    ),
    encrypted_bytes_verified: integer(
      field(countsInput, "encrypted_bytes_verified"),
      1,
      MAX_WHITEHACK_EVIDENCE_CAPSULE_BYTES + 64 * 1_024,
      "receipt_counts_invalid",
    ),
    remote_objects_acknowledged: integer(
      field(countsInput, "remote_objects_acknowledged"),
      1,
      1_025,
      "receipt_counts_invalid",
    ),
    minimum_write_acknowledgements: integer(
      field(countsInput, "minimum_write_acknowledgements"),
      1,
      32,
      "receipt_counts_invalid",
    ),
    maximum_write_acknowledgements: integer(
      field(countsInput, "maximum_write_acknowledgements"),
      1,
      32,
      "receipt_counts_invalid",
    ),
    failed_writes: integer(
      field(countsInput, "failed_writes"),
      0,
      32 * 1_025,
      "receipt_counts_invalid",
    ),
  };
  if (
    counts.ciphertext_blocks !== 1
    || counts.ciphertext_blocks_verified !== 1
    || counts.encrypted_bytes_verified
      !== WHITEHACK_EVIDENCE_ENCRYPTED_FRAME_BYTES
    || counts.remote_objects_acknowledged !== 2
    || counts.minimum_write_acknowledgements !== 1
    || counts.maximum_write_acknowledgements !== 1
    || counts.failed_writes !== 0
  ) fail("receipt_counts_inconsistent");

  return deepFreeze({
    document_type: WHITEHACK_EVIDENCE_STORAGE_RECEIPT_DOCUMENT,
    manifest_cid: manifestCid,
    signed_grant: grant,
    handling: {
      sensitivity: "sensitive-recipient-bound-read-grant",
      contains_recipient_metadata: true,
      contains_publisher_metadata: true,
      safe_for_publication: false,
    },
    counts,
    verification: {
      verified_at: timestamp(input.verified_at, "receipt_verified_at_invalid"),
      manifest_and_ciphertext_cids: true,
      decrypted_read_back_exact_bytes: true,
      capsule_schema_revalidated: true,
      fixed_size_frame_validated: true,
    },
    boundaries: {
      status: "observed-and-verified-at-time-only",
      durability_claim: false,
      permanence_claim: false,
      retention_claim: false,
      deletion_claim: false,
      publication_claim: false,
      target_authorization_claim: false,
      automatic_scan: false,
      castle_write: false,
      retry: false,
      delete_operation: false,
    },
  });
}

export function normalizeWhitehackEvidenceStorageReceipt(
  value: unknown,
): WhitehackEvidenceStorageReceipt {
  const root = object(
    value,
    [
      "document_type",
      "manifest_cid",
      "signed_grant",
      "handling",
      "counts",
      "verification",
      "boundaries",
    ],
    "receipt_shape_invalid",
  );
  literal(
    field(root, "document_type"),
    WHITEHACK_EVIDENCE_STORAGE_RECEIPT_DOCUMENT,
    "receipt_document_type_invalid",
  );
  fixedRecord(
    field(root, "handling"),
    {
      sensitivity: "sensitive-recipient-bound-read-grant",
      contains_recipient_metadata: true,
      contains_publisher_metadata: true,
      safe_for_publication: false,
    },
    "receipt_handling_invalid",
  );
  const verification = object(
    field(root, "verification"),
    [
      "verified_at",
      "manifest_and_ciphertext_cids",
      "decrypted_read_back_exact_bytes",
      "capsule_schema_revalidated",
      "fixed_size_frame_validated",
    ],
    "receipt_verification_invalid",
  );
  for (const key of [
    "manifest_and_ciphertext_cids",
    "decrypted_read_back_exact_bytes",
    "capsule_schema_revalidated",
    "fixed_size_frame_validated",
  ]) {
    literal(field(verification, key), true, "receipt_verification_invalid");
  }
  const boundaries = object(
    field(root, "boundaries"),
    [
      "status",
      "durability_claim",
      "permanence_claim",
      "retention_claim",
      "deletion_claim",
      "publication_claim",
      "target_authorization_claim",
      "automatic_scan",
      "castle_write",
      "retry",
      "delete_operation",
    ],
    "receipt_boundaries_invalid",
  );
  literal(
    field(boundaries, "status"),
    "observed-and-verified-at-time-only",
    "receipt_boundaries_invalid",
  );
  for (const key of [
    "durability_claim",
    "permanence_claim",
    "retention_claim",
    "deletion_claim",
    "publication_claim",
    "target_authorization_claim",
    "automatic_scan",
    "castle_write",
    "retry",
    "delete_operation",
  ]) {
    literal(field(boundaries, key), false, "receipt_boundaries_invalid");
  }
  return createWhitehackEvidenceStorageReceipt({
    manifest_cid: field(root, "manifest_cid") as string,
    signed_grant: field(root, "signed_grant") as SignedGrant,
    counts: field(root, "counts") as WhitehackEvidenceStorageReceipt["counts"],
    verified_at: timestamp(
      field(verification, "verified_at"),
      "receipt_verified_at_invalid",
    ),
  });
}

export function canonicalWhitehackEvidenceStorageReceipt(
  receipt: WhitehackEvidenceStorageReceipt,
): string {
  return canonicalJson(receipt);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}
