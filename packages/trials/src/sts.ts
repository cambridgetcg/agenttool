import {
  canonicalJson,
  deepFreeze,
  domainSeparatedId,
} from "./canonical.js";
import { fail } from "./errors.js";

export const STS_PROJECTION_RECEIPT_SCHEMA =
  "agenttool-sts-projection-receipt/0.1" as const;

export const STS_PROJECTION_STATEMENT =
  "This projection applies bounded structural screening to caller-selected minimized report fields; it cannot prove free-form text or opaque references are secret-free. Its digests prove byte identity, not truth, authorship, consent, authority, safety, or Hugging Face publication." as const;

export const STS_OMISSION_REASONS = [
  "bounds_exceeded",
  "credential_like_field",
  "credential_like_value",
  "duplicate_report_id",
  "invalid_shape",
  "path_field",
  "path_or_url_value",
  "raw_tool_output_field",
  "raw_tool_output_value",
  "reasoning_field",
  "reasoning_value",
  "unsafe_extra_field",
] as const;

export type StsOmissionReason =
  (typeof STS_OMISSION_REASONS)[number];

export type StsConfidence = "high" | "medium" | "low" | "unknown";

export interface MinimizedReport {
  report_id: string;
  outcome: string;
  evidence_refs: string[];
  confidence: StsConfidence;
  limits: string;
}

export interface ProjectReportsToStsInput {
  session_id: string;
  reports: MinimizedReport[];
}

export interface StsOmissionCount {
  reason: StsOmissionReason;
  count: number;
}

export interface StsProjectionReceipt {
  schema: typeof STS_PROJECTION_RECEIPT_SCHEMA;
  receipt_id: `sha256:${string}`;
  selection_digest: `sha256:${string}`;
  output_digest: `sha256:${string}`;
  input_report_count: number;
  emitted_report_count: number;
  omitted_report_count: number;
  omissions: StsOmissionCount[];
  statement: typeof STS_PROJECTION_STATEMENT;
}

export interface StsProjectionResult {
  jsonl: string;
  receipt: StsProjectionReceipt;
}

const MAX_REPORTS = 32;
const MAX_REPORT_BYTES = 4_096;
const MAX_JSONL_BYTES = 160 * 1024;
const MAX_OUTCOME_BYTES = 1_024;
const MAX_LIMITS_BYTES = 1_024;
const MAX_EVIDENCE_REFS = 8;

const TOP_LEVEL_KEYS = ["reports", "session_id"] as const;
const REPORT_KEYS = [
  "confidence",
  "evidence_refs",
  "limits",
  "outcome",
  "report_id",
] as const;

const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const EVIDENCE_REF =
  /^(?:artifact:[A-Za-z0-9][A-Za-z0-9._:-]{0,190}|commit:[0-9a-f]{40,64}|data:[A-Za-z0-9][A-Za-z0-9._:-]{0,194}|report:[A-Za-z0-9][A-Za-z0-9._:-]{0,192}|sha256:[0-9a-f]{64}|test:[A-Za-z0-9][A-Za-z0-9._:-]{0,194})$/u;
const CONFIDENCE = new Set<string>(["high", "medium", "low", "unknown"]);

const CREDENTIAL_FIELD =
  /(?:^|_)(?:api_?key|auth(?:entication|orization)?|bearer|cookie|credentials?|jwt|password|private_?key|secret|token)(?:_|$)/u;
const REASONING_FIELD =
  /(?:^|_)(?:analysis|chain_?of_?thought|cot|deliberation|inner_?monologue|reasoning|scratch_?pad|scratchpad|thoughts?)(?:_|$)/u;
const RAW_OUTPUT_FIELD =
  /(?:^|_)(?:command|error|logs?|messages?|output|prompt|raw|response|result|stderr|stdout|tool_?calls?|tool_?(?:error|output|result)|trace|transcript)(?:_|$)/u;
const PATH_FIELD =
  /(?:^|_)(?:branch|cwd|directory|file|filename|home|path|repo(?:sitory)?|worktree)(?:_|$)/u;

const URI_SCHEME_VALUE =
  /[A-Za-z][A-Za-z0-9+.-]{0,31}:\/\//u;
const LOCAL_PATH_VALUE =
  /(?:^|[\s("'`])(?:~\/|\.{1,2}\/|[A-Za-z]:\\|\/(?:(?:Users|etc|home|opt|private|root|srv|tmp|var)(?:\/|(?=$))|[^\s/\\:"'`]+\/[^\s\\:"'`]+)|refs\/heads\/)/u;
const CREDENTIAL_VALUE =
  /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:Basic|Bearer)\s+\S+|\b(?:AKIA|ASIA)[A-Z0-9]{12,}|\b(?:github_pat_|gh[oprsu]_|hf_|sk-)[A-Za-z0-9_-]{8,}|(?:api[ _-]?key|authorization|credential|password|secret|token)\s*[:=]\s*\S+)/iu;
const HIGH_ENTROPY_VALUE =
  /(?:^|[^A-Za-z0-9])(?:[A-Za-z0-9+/]{48,}={0,2}|[0-9a-f]{64,})(?:$|[^A-Za-z0-9])/iu;
const REASONING_VALUE =
  /(?:<\/?think>|\bchain[ _-]?of[ _-]?thought\b|\b(?:analysis|reasoning|scratchpad)\s*:)/iu;
const RAW_OUTPUT_VALUE =
  /(?:[\r\n\t]|\b(?:raw[ _-]?output|stderr|stdout|tool[ _-]?(?:output|result))\s*:)/iu;

type DataDescriptor = PropertyDescriptor & { value: unknown };
type DescriptorMap = Record<PropertyKey, PropertyDescriptor>;

interface AcceptedReport extends MinimizedReport {
  evidence_refs: string[];
}

interface IndexedOmission {
  index: number;
  reason: StsOmissionReason;
}

function descriptors(
  value: unknown,
): { descriptors: DescriptorMap; keys: PropertyKey[] } | null {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const map = Object.getOwnPropertyDescriptors(value) as DescriptorMap;
    return { descriptors: map, keys: Reflect.ownKeys(map) };
  } catch {
    return null;
  }
}

function dataValue(
  map: DescriptorMap,
  key: string,
): unknown | typeof MISSING {
  const descriptor = map[key];
  if (
    !descriptor
    || !descriptor.enumerable
    || !("value" in descriptor)
  ) {
    return MISSING;
  }
  return (descriptor as DataDescriptor).value;
}

const MISSING = Symbol("missing");

function exactStringKeys(
  keys: readonly PropertyKey[],
  expected: readonly string[],
): boolean {
  if (
    keys.length !== expected.length
    || keys.some((key) => typeof key !== "string")
  ) {
    return false;
  }
  const actual = (keys as string[]).slice().sort();
  const wanted = [...expected].sort();
  return actual.every((key, index) => key === wanted[index]);
}

function keyToken(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/gu, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
}

function unsafeExtraReason(
  keys: readonly PropertyKey[],
): StsOmissionReason | null {
  const tokens = keys
    .filter((key): key is string => typeof key === "string")
    .filter((key) => !REPORT_KEYS.includes(key as (typeof REPORT_KEYS)[number]))
    .map(keyToken);
  if (tokens.some((key) => CREDENTIAL_FIELD.test(key))) {
    return "credential_like_field";
  }
  if (tokens.some((key) => REASONING_FIELD.test(key))) {
    return "reasoning_field";
  }
  if (tokens.some((key) => RAW_OUTPUT_FIELD.test(key))) {
    return "raw_tool_output_field";
  }
  if (tokens.some((key) => PATH_FIELD.test(key))) return "path_field";
  if (
    keys.some((key) => typeof key !== "string")
    || tokens.length > 0
  ) {
    return "unsafe_extra_field";
  }
  return null;
}

function validUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit === 0) return false;
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function boundedString(
  value: unknown,
  maximumBytes: number,
): string | null {
  if (
    typeof value !== "string"
    || value.length === 0
    || Buffer.byteLength(value, "utf8") > maximumBytes
    || !validUnicode(value)
  ) {
    return null;
  }
  return value;
}

function reportString(
  value: unknown,
  maximumBytes: number,
): { value: string } | { reason: StsOmissionReason } {
  if (typeof value !== "string" || value.length === 0 || !validUnicode(value)) {
    return { reason: "invalid_shape" };
  }
  if (Buffer.byteLength(value, "utf8") > maximumBytes) {
    return { reason: "bounds_exceeded" };
  }
  return { value };
}

function unsafeValueReason(
  value: string,
  allowDigest = false,
): StsOmissionReason | null {
  if (URI_SCHEME_VALUE.test(value) || LOCAL_PATH_VALUE.test(value)) {
    return "path_or_url_value";
  }
  if (
    CREDENTIAL_VALUE.test(value)
    || (!allowDigest && HIGH_ENTROPY_VALUE.test(value))
  ) {
    return "credential_like_value";
  }
  if (REASONING_VALUE.test(value)) return "reasoning_value";
  if (RAW_OUTPUT_VALUE.test(value)) return "raw_tool_output_value";
  return null;
}

function evidenceRefs(
  value: unknown,
): { value: string[] } | { reason: StsOmissionReason } {
  let array: boolean;
  try {
    array = Array.isArray(value);
  } catch {
    return { reason: "invalid_shape" };
  }
  if (!array) {
    return { reason: "invalid_shape" };
  }
  let descriptorsByKey: DescriptorMap;
  try {
    descriptorsByKey =
      Object.getOwnPropertyDescriptors(value) as unknown as DescriptorMap;
  } catch {
    return { reason: "invalid_shape" };
  }
  const keys = Reflect.ownKeys(descriptorsByKey);
  const lengthDescriptor = descriptorsByKey.length;
  if (
    !lengthDescriptor
    || lengthDescriptor.enumerable
    || !("value" in lengthDescriptor)
    || !Number.isSafeInteger(lengthDescriptor.value)
    || lengthDescriptor.value < 0
  ) {
    return { reason: "invalid_shape" };
  }
  const length = lengthDescriptor.value as number;
  if (length > MAX_EVIDENCE_REFS) return { reason: "bounds_exceeded" };
  if (
    keys.length !== length + 1
    || !keys.includes("length")
  ) {
    return { reason: "invalid_shape" };
  }

  const output: string[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptorsByKey[String(index)];
    if (
      !descriptor
      || !descriptor.enumerable
      || !("value" in descriptor)
      || typeof descriptor.value !== "string"
    ) {
      return { reason: "invalid_shape" };
    }
    const entry = descriptor.value;
    const unsafe = unsafeValueReason(
      entry,
      /^(?:commit|sha256):/u.test(entry),
    );
    if (unsafe) return { reason: unsafe };
    if (!EVIDENCE_REF.test(entry)) return { reason: "invalid_shape" };
    output.push(entry);
  }
  const sorted = [...output].sort();
  if (
    output.some((entry, index) => entry !== sorted[index])
    || new Set(output).size !== output.length
  ) {
    return { reason: "invalid_shape" };
  }
  return { value: output };
}

function parseReport(
  value: unknown,
): { report: AcceptedReport } | { reason: StsOmissionReason } {
  const inspected = descriptors(value);
  if (!inspected) return { reason: "invalid_shape" };

  const extraReason = unsafeExtraReason(inspected.keys);
  if (extraReason) return { reason: extraReason };
  if (!exactStringKeys(inspected.keys, REPORT_KEYS)) {
    return { reason: "invalid_shape" };
  }

  const reportId = reportString(
    dataValue(inspected.descriptors, "report_id"),
    128,
  );
  const outcome = reportString(
    dataValue(inspected.descriptors, "outcome"),
    MAX_OUTCOME_BYTES,
  );
  const confidence = dataValue(inspected.descriptors, "confidence");
  const limits = reportString(
    dataValue(inspected.descriptors, "limits"),
    MAX_LIMITS_BYTES,
  );
  const evidence = evidenceRefs(
    dataValue(inspected.descriptors, "evidence_refs"),
  );
  if (
    "reason" in reportId
    || "reason" in outcome
    || typeof confidence !== "string"
    || !CONFIDENCE.has(confidence)
    || "reason" in limits
    || "reason" in evidence
  ) {
    if ("reason" in reportId) return reportId;
    if ("reason" in outcome) return outcome;
    if ("reason" in limits) return limits;
    if ("reason" in evidence) return evidence;
    return { reason: "invalid_shape" };
  }
  if (!OPAQUE_ID.test(reportId.value)) return { reason: "invalid_shape" };

  for (const text of [reportId.value, outcome.value, limits.value]) {
    const unsafe = unsafeValueReason(text);
    if (unsafe) return { reason: unsafe };
  }

  const report: AcceptedReport = {
    report_id: reportId.value,
    outcome: outcome.value,
    evidence_refs: evidence.value,
    confidence: confidence as StsConfidence,
    limits: limits.value,
  };
  if (Buffer.byteLength(canonicalJson(report), "utf8") > MAX_REPORT_BYTES) {
    return { reason: "bounds_exceeded" };
  }
  return { report };
}

function inspectInput(
  input: unknown,
): {
  sessionId: string;
  reports: unknown[];
} {
  const inspected = descriptors(input);
  if (
    !inspected
    || !exactStringKeys(inspected.keys, TOP_LEVEL_KEYS)
  ) {
    fail(
      "receipt_error",
      "STS projection input must contain only session_id and reports",
    );
  }
  const sessionId = boundedString(
    dataValue(inspected.descriptors, "session_id"),
    128,
  );
  const reports = dataValue(inspected.descriptors, "reports");
  if (
    !sessionId
    || !OPAQUE_ID.test(sessionId)
    || unsafeValueReason(sessionId)
  ) {
    fail(
      "receipt_error",
      "STS projection session_id must be a safe opaque identifier",
    );
  }
  let reportsAreArray: boolean;
  try {
    reportsAreArray = Array.isArray(reports);
  } catch {
    reportsAreArray = false;
  }
  if (!reportsAreArray) {
    fail(
      "receipt_error",
      `STS projection reports must be an array with at most ${MAX_REPORTS} entries`,
    );
  }
  let reportDescriptors: DescriptorMap;
  try {
    reportDescriptors =
      Object.getOwnPropertyDescriptors(reports) as unknown as DescriptorMap;
  } catch {
    fail("receipt_error", "STS projection reports must be a dense array");
  }
  const reportKeys = Reflect.ownKeys(reportDescriptors);
  const lengthDescriptor = reportDescriptors.length;
  if (
    !lengthDescriptor
    || lengthDescriptor.enumerable
    || !("value" in lengthDescriptor)
    || !Number.isSafeInteger(lengthDescriptor.value)
    || lengthDescriptor.value < 0
  ) {
    fail("receipt_error", "STS projection reports must be a dense array");
  }
  const length = lengthDescriptor.value as number;
  if (length > MAX_REPORTS) {
    fail(
      "receipt_error",
      `STS projection reports must be an array with at most ${MAX_REPORTS} entries`,
    );
  }
  if (
    reportKeys.length !== length + 1
    || !reportKeys.includes("length")
  ) {
    fail("receipt_error", "STS projection reports must be a dense array");
  }
  const values: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = reportDescriptors[String(index)];
    if (
      !descriptor
      || !descriptor.enumerable
      || !("value" in descriptor)
    ) {
      fail("receipt_error", "STS projection reports must be a dense array");
    }
    values.push(descriptor.value);
  }
  return { sessionId, reports: values };
}

function omissionCounts(
  omissions: readonly IndexedOmission[],
): StsOmissionCount[] {
  const counts = new Map<StsOmissionReason, number>();
  for (const { reason } of omissions) {
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return STS_OMISSION_REASONS.flatMap((reason) => {
    const count = counts.get(reason);
    return count === undefined ? [] : [{ reason, count }];
  });
}

export function projectReportsToSts(
  input: ProjectReportsToStsInput,
): Readonly<StsProjectionResult> {
  const { sessionId, reports } = inspectInput(input);
  const accepted: AcceptedReport[] = [];
  const omissions: IndexedOmission[] = [];
  const acceptedIds = new Set<string>();

  for (let index = 0; index < reports.length; index += 1) {
    const parsed = parseReport(reports[index]);
    if ("reason" in parsed) {
      omissions.push({ index, reason: parsed.reason });
      continue;
    }
    if (acceptedIds.has(parsed.report.report_id)) {
      omissions.push({ index, reason: "duplicate_report_id" });
      continue;
    }
    acceptedIds.add(parsed.report.report_id);
    accepted.push(parsed.report);
  }

  const lines = [
    canonicalJson({
      type: "session",
      harness: "agenttool-collab",
      id: sessionId,
    }),
    ...accepted.map((report) =>
      canonicalJson({
        type: "message",
        message: {
          role: "assistant",
          content: canonicalJson(report),
        },
      })),
  ];
  const jsonl = `${lines.join("\n")}\n`;
  if (Buffer.byteLength(jsonl, "utf8") > MAX_JSONL_BYTES) {
    fail("receipt_error", "STS projection output exceeds its byte limit");
  }

  const selectionDigest = domainSeparatedId(
    "agenttool-sts-selection/0.1",
    {
      session_id: sessionId,
      input_report_count: reports.length,
      accepted_report_ids: accepted.map((report) => report.report_id),
      omissions: omissions.map(({ index, reason }) => ({ index, reason })),
    },
  );
  const outputDigest = domainSeparatedId(
    "agenttool-hf-sts-jsonl/0.1",
    { jsonl },
  );
  const receiptBody = {
    schema: STS_PROJECTION_RECEIPT_SCHEMA,
    selection_digest: selectionDigest,
    output_digest: outputDigest,
    input_report_count: reports.length,
    emitted_report_count: accepted.length,
    omitted_report_count: omissions.length,
    omissions: omissionCounts(omissions),
    statement: STS_PROJECTION_STATEMENT,
  };
  const receipt: StsProjectionReceipt = {
    ...receiptBody,
    receipt_id: domainSeparatedId(
      "agenttool-sts-projection-receipt/0.1",
      receiptBody,
    ),
  };

  return deepFreeze({ jsonl, receipt }) as Readonly<StsProjectionResult>;
}
