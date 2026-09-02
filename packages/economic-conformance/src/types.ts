export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type Sha256Digest = `sha256:${string}`;

export interface ValueObservation {
  outcome: "VALUE";
  value: JsonValue;
}

export interface ErrorObservation {
  outcome: "ERROR";
  error_code: string;
}

export type ConformanceObservation = ValueObservation | ErrorObservation;

export interface ConformanceCase {
  case_id: string;
  family: string;
  description: string;
  operation: string;
  input: JsonValue;
  expected: ConformanceObservation;
}

export interface ConformanceSuite {
  schema: "agenttool.economic-conformance-suite/1";
  protocol: "agenttool.economic-kernel/0.1";
  suite_id: string;
  suite_revision: string;
  rights_baseline: "xenia.rights/0.1";
  rights_conditional_on_payment: false;
  cases: readonly ConformanceCase[];
}

export interface ConformanceTraceEntry {
  case_id: string;
  observed: ConformanceObservation;
}

export interface ConformanceTrace {
  schema: "agenttool.economic-conformance-trace/1";
  suite_id: string;
  suite_revision: string;
  producer_declared_ref: string;
  entries: readonly ConformanceTraceEntry[];
}

export type ConformanceStatus = "PASS" | "FAIL" | "INCONCLUSIVE";
export type ConformanceCaseReason =
  | "EXACT_MATCH"
  | "OBSERVATION_MISMATCH"
  | "OBSERVATION_MISSING";

export interface ConformanceCaseResult {
  case_id: string;
  family: string;
  status: ConformanceStatus;
  reason_code: ConformanceCaseReason;
  expected_observation_semantic_sha256: Sha256Digest;
  observed_observation_semantic_sha256: Sha256Digest | null;
}

export interface ConformanceCounts {
  total: number;
  pass: number;
  fail: number;
  inconclusive: number;
}

export interface ConformanceFamilyResult extends ConformanceCounts {
  family: string;
  status: ConformanceStatus;
}

export interface ConformanceBoundaries {
  comparator_execution_only: true;
  offline_fixture_match_only: true;
  official_suite_pinned: true;
  external_finality_proven: false;
  host_durability_proven: false;
  adapter_truthfulness_proven: false;
  future_behavior_proven: false;
  producer_authenticated: false;
  xenia_certification: false;
  comparator_network_requests: 0;
  comparator_external_payments: 0;
  comparator_business_effects: 0;
}

export interface OfficialVectorManifest {
  schema: "agenttool.economic-conformance-vector-manifest/1";
  conformance_protocol: "agenttool.economic-conformance/0.1";
  vector_path: "economic-kernel-v0.1.json";
  vector_bytes: number;
  vector_raw_sha256: Sha256Digest;
  suite_semantic_sha256: Sha256Digest;
  suite_id: string;
  suite_revision: string;
  case_count: number;
}

export interface ConformanceReport {
  schema: "agenttool.economic-conformance-report/1";
  suite_id: string;
  suite_revision: string;
  suite_semantic_sha256: Sha256Digest;
  official_vector_manifest_raw_sha256: Sha256Digest;
  trace_semantic_sha256: Sha256Digest;
  producer_declared_ref: string;
  status: ConformanceStatus;
  scalar_score: null;
  counts: ConformanceCounts;
  families: readonly ConformanceFamilyResult[];
  cases: readonly ConformanceCaseResult[];
  boundaries: ConformanceBoundaries;
}
