import {
  CONFORMANCE_BOUNDARIES,
  OFFICIAL_SUITE_ID,
  OFFICIAL_SUITE_REVISION,
  OFFICIAL_SUITE_SEMANTIC_SHA256,
  OFFICIAL_VECTOR_MANIFEST_RAW_SHA256,
} from "./constants.js";
import {
  compareUtf8,
  deepFreeze,
  exactKeys,
  fail,
  identifier,
  label,
  object,
  sameJson,
  semanticSha256,
  token,
  unsigned,
} from "./internal.js";
import type {
  ConformanceCase,
  ConformanceCaseResult,
  ConformanceCounts,
  ConformanceFamilyResult,
  ConformanceObservation,
  ConformanceReport,
  ConformanceStatus,
  ConformanceSuite,
  ConformanceTrace,
  ConformanceTraceEntry,
} from "./types.js";

function observation(value: unknown, path: string): Readonly<ConformanceObservation> {
  const item = object(value, path);
  if (item.outcome === "VALUE") {
    exactKeys(item, ["outcome", "value"], path);
    return deepFreeze({ outcome: "VALUE", value: item.value } as ConformanceObservation);
  }
  if (item.outcome === "ERROR") {
    exactKeys(item, ["error_code", "outcome"], path);
    token(item.error_code, `${path}.error_code`);
    return deepFreeze({ outcome: "ERROR", error_code: item.error_code } as ConformanceObservation);
  }
  fail(`${path}.outcome must be VALUE or ERROR.`, `${path}.outcome`);
}

function caseValue(value: unknown, index: number): Readonly<ConformanceCase> {
  const path = `suite.cases[${String(index)}]`;
  const item = object(value, path);
  exactKeys(item, ["case_id", "description", "expected", "family", "input", "operation"], path);
  identifier(item.case_id, `${path}.case_id`);
  token(item.family, `${path}.family`);
  label(item.description, `${path}.description`);
  token(item.operation, `${path}.operation`);
  return deepFreeze({
    case_id: item.case_id,
    family: item.family,
    description: item.description,
    operation: item.operation,
    input: item.input,
    expected: observation(item.expected, `${path}.expected`),
  } as ConformanceCase);
}

export function validateConformanceSuite(value: unknown): Readonly<ConformanceSuite> {
  const item = object(value, "suite");
  exactKeys(item, [
    "cases",
    "protocol",
    "rights_baseline",
    "rights_conditional_on_payment",
    "schema",
    "suite_id",
    "suite_revision",
  ], "suite");
  if (item.schema !== "agenttool.economic-conformance-suite/1") {
    fail("Unsupported suite schema.", "suite.schema", "UNSUPPORTED_SCHEMA");
  }
  if (item.protocol !== "agenttool.economic-kernel/0.1") {
    fail("Unsupported economic protocol.", "suite.protocol", "UNSUPPORTED_SCHEMA");
  }
  if (item.rights_baseline !== "xenia.rights/0.1" || item.rights_conditional_on_payment !== false) {
    fail(
      "Suite must preserve the fixed non-purchasable rights baseline.",
      "suite.rights_baseline",
    );
  }
  identifier(item.suite_id, "suite.suite_id");
  unsigned(item.suite_revision, "suite.suite_revision");
  if (!Array.isArray(item.cases) || item.cases.length === 0 || item.cases.length > 512) {
    fail("Suite must contain 1..512 cases.", "suite.cases", "LIMIT_EXCEEDED");
  }
  const cases = item.cases.map((entry, index) => caseValue(entry, index));
  for (let index = 1; index < cases.length; index += 1) {
    if (compareUtf8(cases[index - 1]!.case_id, cases[index]!.case_id) >= 0) {
      fail("Suite case ids must be sorted and unique.", "suite.cases");
    }
  }
  return deepFreeze({ ...item, cases } as unknown as ConformanceSuite);
}

function traceEntry(value: unknown, index: number): Readonly<ConformanceTraceEntry> {
  const path = `trace.entries[${String(index)}]`;
  const item = object(value, path);
  exactKeys(item, ["case_id", "observed"], path);
  identifier(item.case_id, `${path}.case_id`);
  return deepFreeze({
    case_id: item.case_id,
    observed: observation(item.observed, `${path}.observed`),
  } as ConformanceTraceEntry);
}

export function validateConformanceTrace(value: unknown, suiteValue: unknown): Readonly<ConformanceTrace> {
  const suite = validateConformanceSuite(suiteValue);
  const item = object(value, "trace");
  exactKeys(item, ["entries", "producer_declared_ref", "schema", "suite_id", "suite_revision"], "trace");
  if (item.schema !== "agenttool.economic-conformance-trace/1") {
    fail("Unsupported trace schema.", "trace.schema", "UNSUPPORTED_SCHEMA");
  }
  if (item.suite_id !== suite.suite_id || item.suite_revision !== suite.suite_revision) {
    fail("Trace must pin the exact suite id and revision.", "trace.suite_id");
  }
  identifier(item.producer_declared_ref, "trace.producer_declared_ref");
  if (!Array.isArray(item.entries) || item.entries.length > suite.cases.length) {
    fail("Trace entries exceed the suite case count.", "trace.entries", "LIMIT_EXCEEDED");
  }
  const entries = item.entries.map((entry, index) => traceEntry(entry, index));
  const allowed = new Set(suite.cases.map((entry) => entry.case_id));
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    if (!allowed.has(entry.case_id)) fail("Trace contains an unknown case id.", `trace.entries[${String(index)}].case_id`);
    if (index > 0 && compareUtf8(entries[index - 1]!.case_id, entry.case_id) >= 0) {
      fail("Trace case ids must be sorted and unique.", "trace.entries");
    }
  }
  return deepFreeze({ ...item, entries } as unknown as ConformanceTrace);
}

function counts(results: readonly ConformanceCaseResult[]): ConformanceCounts {
  return {
    total: results.length,
    pass: results.filter((entry) => entry.status === "PASS").length,
    fail: results.filter((entry) => entry.status === "FAIL").length,
    inconclusive: results.filter((entry) => entry.status === "INCONCLUSIVE").length,
  };
}

function aggregateStatus(value: ConformanceCounts): ConformanceStatus {
  if (value.fail > 0) return "FAIL";
  if (value.inconclusive > 0) return "INCONCLUSIVE";
  return "PASS";
}

export function evaluateConformance(suiteValue: unknown, traceValue: unknown): Readonly<ConformanceReport> {
  const suite = validateConformanceSuite(suiteValue);
  const suiteDigest = semanticSha256(suite);
  if (
    suite.suite_id !== OFFICIAL_SUITE_ID
    || suite.suite_revision !== OFFICIAL_SUITE_REVISION
    || suiteDigest !== OFFICIAL_SUITE_SEMANTIC_SHA256
  ) {
    fail(
      "evaluateConformance accepts only the exact pinned official v0.1 suite semantics.",
      "suite",
      "UNPINNED_SUITE",
    );
  }
  const trace = validateConformanceTrace(traceValue, suite);
  const traceDigest = semanticSha256(trace);
  const observations = new Map(trace.entries.map((entry) => [entry.case_id, entry.observed]));
  const cases: ConformanceCaseResult[] = suite.cases.map((entry) => {
    const observed = observations.get(entry.case_id) ?? null;
    const status: ConformanceStatus = observed === null
      ? "INCONCLUSIVE"
      : sameJson(entry.expected, observed) ? "PASS" : "FAIL";
    const reasonCode = status === "PASS"
      ? "EXACT_MATCH"
      : status === "FAIL"
        ? "OBSERVATION_MISMATCH"
        : "OBSERVATION_MISSING";
    return {
      case_id: entry.case_id,
      family: entry.family,
      status,
      reason_code: reasonCode,
      expected_observation_semantic_sha256: semanticSha256(entry.expected),
      observed_observation_semantic_sha256: observed === null ? null : semanticSha256(observed),
    };
  });
  const grouped = new Map<string, ConformanceCaseResult[]>();
  for (const result of cases) grouped.set(result.family, [...(grouped.get(result.family) ?? []), result]);
  const families: ConformanceFamilyResult[] = [...grouped.entries()]
    .sort(([left], [right]) => compareUtf8(left, right))
    .map(([family, results]) => {
      const familyCounts = counts(results);
      return { family, status: aggregateStatus(familyCounts), ...familyCounts };
    });
  const totalCounts = counts(cases);
  return deepFreeze({
    schema: "agenttool.economic-conformance-report/1",
    suite_id: suite.suite_id,
    suite_revision: suite.suite_revision,
    suite_semantic_sha256: suiteDigest,
    official_vector_manifest_raw_sha256: OFFICIAL_VECTOR_MANIFEST_RAW_SHA256,
    trace_semantic_sha256: traceDigest,
    producer_declared_ref: trace.producer_declared_ref,
    status: aggregateStatus(totalCounts),
    scalar_score: null,
    counts: totalCounts,
    families,
    cases,
    boundaries: CONFORMANCE_BOUNDARIES,
  } satisfies ConformanceReport);
}
