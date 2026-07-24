import { createHash } from "node:crypto";

export const CASTLE_WHITEHACK_INTAKE_DOCUMENT =
  "agenttool-castle-whitehack-intake/v1";
export const CASTLE_WHITEHACK_INTAKE_VERSION = "0.1.0";
export const WHITEHACK_ADVISORY_DOCUMENT =
  "agenttool-whitehack-advisory/v0.1";

const WHITEHACK_REPOSITORY = "https://github.com/cambridgetcg/whitehack";
const MAX_FINDINGS = 200;
const MAX_ERRORS = 200;
const MAX_FILE_BYTES = 1024;
const TOKEN = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const SEMVER = /^[0-9]+\.[0-9]+\.[0-9]+$/u;
const GIT_REVISION = /^[0-9a-f]{40}$/u;
const RFC3339 =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/u;
const UNSAFE_TEXT =
  /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;

const CONFIDENCES = new Set([
  "high",
  "medium-high",
  "medium",
  "heuristic",
]);
const ADVISORY_STATUSES = new Set(["complete", "incomplete"]);
const SKIP_REASONS = [
  "hidden_path",
  "non_production_path",
  "non_regular_file",
  "unsupported_extension",
] as const;
const LIMIT_BOUNDS = Object.freeze({
  max_changed_paths: 2_000,
  max_path_bytes: 1_024,
  max_diff_bytes: 262_144,
  max_files: 200,
  max_file_bytes: 524_288,
  max_total_bytes: 8_388_608,
  max_total_findings: 5_000,
  max_reported_findings: 200,
});
const ADVISORY_BOUNDARIES = Object.freeze([
  "heuristic_findings_are_not_security_proof",
  "absence_of_findings_is_not_proof_of_honesty",
  "only_changed_supported_regular_non_test_files_are_observed",
  "source_snippets_messages_and_exception_text_are_not_serialized",
  "pinned_scanner_runs_with_the_callers_local_file_permissions",
  "no_dynamic_testing_target_interaction_or_submission",
  "a_finding_does_not_establish_target_authorization",
]);
const RETAINED_SIGNAL_FIELDS = Object.freeze([
  "check",
  "scanner_confidence",
  "doctrine",
  "principle",
  "occurrence_count",
]);
const REVIEW_QUESTION =
  "Which trust boundary or invariant should a reviewer inspect? "
  + "What authorized local evidence would support or reject the observation, "
  + "and which regression test records the intended behaviour?";
const UNKNOWN_ENTRIES = Object.freeze([
  [
    "advisory-provenance",
    "The projector validates structure and internal coherence but does not authenticate who produced the advisory or prove that the declared scanner revision executed.",
  ],
  [
    "authorization",
    "A Whitehack observation does not establish permission to test, remediate, disclose, publish, or act on a target.",
  ],
  [
    "castle-semantic-fit",
    "The projector does not decide whether an observation contains an insight, belongs at the gate, or should become a friction.",
  ],
  [
    "causation",
    "A finding in a changed file does not establish that the change introduced or caused the observed pattern.",
  ],
  [
    "consent",
    "Repository access, signatures, purpose text, or an advisory do not establish present consent for a later action.",
  ],
  [
    "coverage",
    "The advisory covers only its declared bounded changed-file scope; omitted or clean code is not established secure or honest.",
  ],
  [
    "exploitability",
    "A heuristic text match does not establish an exploitable vulnerability or reachable runtime behaviour.",
  ],
  [
    "fix-correctness",
    "Disappearance on a later scan does not prove that a remediation is correct, complete, or regression-tested.",
  ],
  [
    "freshness",
    "The advisory timestamp and revisions are retained declarations; the projector does not inspect Git or prove that the observation is current.",
  ],
  [
    "location-sensitivity",
    "A file label and line can reveal an undisclosed weakness or private repository structure; their sharing safety is unknown.",
  ],
  [
    "publication-safety",
    "This local projection does not decide whether any candidate is safe or authorized to enter durable or public Castle history.",
  ],
  [
    "room-selection",
    "No Castle room is selected; room placement requires a separate architect judgment over accepted and reviewed understanding.",
  ],
  [
    "severity",
    "Whitehack confidence calibrates a check match and is not impact, urgency, bounty value, or Castle truth confidence.",
  ],
  [
    "verification-outcome",
    "No counterexample, reproduction, regression test, or other independent trial is run by this projector.",
  ],
] as const);

type JsonRecord = Record<string, unknown>;

export type CastleWhitehackIntakeOptions = Readonly<{
  include_locations?: boolean;
}>;

export class CastleWhitehackIntakeError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "CastleWhitehackIntakeError";
    this.code = code;
  }
}

function fail(code: string): never {
  throw new CastleWhitehackIntakeError(code);
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function objectDescriptors(value: unknown, code: string): {
  object: JsonRecord;
  descriptors: Record<PropertyKey, PropertyDescriptor>;
} {
  if (!value || typeof value !== "object") fail(code);
  let isArray: boolean;
  try {
    isArray = Array.isArray(value);
  } catch {
    fail(code);
  }
  if (isArray) fail(code);
  let prototype: object | null;
  let descriptors: Record<PropertyKey, PropertyDescriptor>;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    fail(code);
  }
  if (prototype !== Object.prototype && prototype !== null) fail(code);
  if (Reflect.ownKeys(descriptors).some((key) => typeof key !== "string")) {
    fail(code);
  }
  return { object: value as JsonRecord, descriptors };
}

function snapshotExact(
  value: unknown,
  keys: readonly string[],
  code: string,
): JsonRecord {
  const { descriptors } = objectDescriptors(value, code);
  const actual = Object.keys(descriptors).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])
  ) fail(code);
  const result: JsonRecord = {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !("value" in descriptor)) fail(code);
    result[key] = descriptor.value;
  }
  return result;
}

function snapshotSubset(
  value: unknown,
  allowed: readonly string[],
  code: string,
): JsonRecord {
  const { descriptors } = objectDescriptors(value, code);
  const allowedSet = new Set(allowed);
  const result: JsonRecord = {};
  for (const key of Object.keys(descriptors).sort()) {
    if (!allowedSet.has(key)) fail(code);
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !("value" in descriptor)) fail(code);
    result[key] = descriptor.value;
  }
  return result;
}

function snapshotDenseArray(
  value: unknown,
  maximum: number,
  code: string,
): unknown[] {
  let isArray: boolean;
  try {
    isArray = Array.isArray(value);
  } catch {
    fail(code);
  }
  if (!isArray) fail(code);
  let descriptors: Record<PropertyKey, PropertyDescriptor>;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    fail(code);
  }
  if (Reflect.ownKeys(descriptors).some((key) => typeof key !== "string")) {
    fail(code);
  }
  const lengthDescriptor = descriptors.length;
  if (
    !lengthDescriptor
    || lengthDescriptor.enumerable
    || !("value" in lengthDescriptor)
    || !Number.isSafeInteger(lengthDescriptor.value)
    || lengthDescriptor.value < 0
    || lengthDescriptor.value > maximum
    || Reflect.ownKeys(descriptors).length !== lengthDescriptor.value + 1
  ) fail(code);
  const result: unknown[] = [];
  for (let index = 0; index < lengthDescriptor.value; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor?.enumerable || !("value" in descriptor)) fail(code);
    result.push(descriptor.value);
  }
  return result;
}

function requireString(
  value: unknown,
  code: string,
  options: {
    maximum?: number;
    pattern?: RegExp;
    safe?: boolean;
  } = {},
): string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > (options.maximum ?? 4096)
    || (options.safe !== false && UNSAFE_TEXT.test(value))
    || hasLoneSurrogate(value)
    || (options.pattern && !options.pattern.test(value))
  ) fail(code);
  return value;
}

function hasLoneSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function requireInteger(
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

function requireBoolean(value: unknown, code: string): boolean {
  if (typeof value !== "boolean") fail(code);
  return value;
}

function requirePath(value: unknown, code: string): string {
  const path = requireString(value, code, { maximum: MAX_FILE_BYTES });
  if (
    path.startsWith("/")
    || path.includes("\\")
    || path.split("/").some((part) => !part || part === "." || part === "..")
    || byteLength(path) > MAX_FILE_BYTES
  ) fail(code);
  return path;
}

function requireDateTime(value: unknown, code: string): string {
  const result = requireString(value, code, { maximum: 64 });
  const match = RFC3339.exec(result);
  if (!match) fail(code);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[7] === undefined ? 0 : Number(match[7]);
  const offsetMinute = match[8] === undefined ? 0 : Number(match[8]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    leap ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  if (
    year < 1
    || month < 1
    || month > 12
    || day < 1
    || day > daysInMonth[month - 1]!
    || hour > 23
    || minute > 59
    || second > 59
    || offsetHour > 23
    || offsetMinute > 59
  ) fail(code);
  return result;
}

function requireEnum(
  value: unknown,
  values: ReadonlySet<string>,
  code: string,
): string {
  if (typeof value !== "string" || !values.has(value)) fail(code);
  return value;
}

function parseCountMap(
  value: unknown,
  code: string,
  allowedKeys?: ReadonlySet<string>,
): Readonly<Record<string, number>> {
  const { descriptors } = objectDescriptors(value, code);
  const result: Record<string, number> = Object.create(null);
  for (const key of Object.keys(descriptors).sort()) {
    if (!TOKEN.test(key) || (allowedKeys && !allowedKeys.has(key))) fail(code);
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !("value" in descriptor)) fail(code);
    result[key] = requireInteger(
      descriptor.value,
      1,
      Number.MAX_SAFE_INTEGER,
      code,
    );
  }
  return Object.freeze(result);
}

function sumCounts(value: Readonly<Record<string, number>>): number {
  return Object.values(value).reduce((sum, count) => sum + count, 0);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareFindings(
  left: Readonly<Record<string, string | number>>,
  right: Readonly<Record<string, string | number>>,
): number {
  for (const key of ["file", "check", "confidence", "doctrine"] as const) {
    if (left[key] < right[key]) return -1;
    if (left[key] > right[key]) return 1;
  }
  return (left.line as number) - (right.line as number)
    || (left.principle as number) - (right.principle as number);
}

function normalizeFinding(
  value: unknown,
): Readonly<{
  file: string;
  line: number;
  check: string;
  confidence: string;
  doctrine: string;
  principle: number;
}> {
  const finding = snapshotExact(
    value,
    ["file", "line", "check", "confidence", "doctrine", "principle"],
    "advisory_finding_invalid",
  );
  return Object.freeze({
    file: requirePath(finding.file, "advisory_finding_invalid"),
    line: requireInteger(
      finding.line,
      1,
      Number.MAX_SAFE_INTEGER,
      "advisory_finding_invalid",
    ),
    check: requireString(finding.check, "advisory_finding_invalid", {
      maximum: 64,
      pattern: TOKEN,
    }),
    confidence: requireEnum(
      finding.confidence,
      CONFIDENCES,
      "advisory_finding_invalid",
    ),
    doctrine: requireString(finding.doctrine, "advisory_finding_invalid", {
      maximum: 64,
      pattern: TOKEN,
    }),
    principle: requireInteger(
      finding.principle,
      1,
      6,
      "advisory_finding_invalid",
    ),
  });
}

function normalizeLimits(value: unknown): Readonly<Record<string, number>> {
  const limits = snapshotExact(
    value,
    Object.keys(LIMIT_BOUNDS),
    "advisory_limits_invalid",
  );
  const result: Record<string, number> = {};
  for (const [key, ceiling] of Object.entries(LIMIT_BOUNDS)) {
    result[key] = requireInteger(
      limits[key],
      1,
      ceiling,
      "advisory_limits_invalid",
    );
  }
  return Object.freeze(result);
}

function normalizeSkipped(value: unknown): Readonly<Record<string, number>> {
  const skipped = snapshotSubset(
    value,
    SKIP_REASONS,
    "advisory_scope_invalid",
  );
  return Object.freeze(Object.fromEntries(
    SKIP_REASONS.map((key) => [
      key,
      skipped[key] === undefined
        ? 0
        : requireInteger(
          skipped[key],
          1,
          Number.MAX_SAFE_INTEGER,
          "advisory_scope_invalid",
        ),
    ]),
  ));
}

function normalizeErrors(value: unknown): readonly Readonly<{
  file: string;
  code: "scanner_file_incomplete";
}>[] {
  const errors = snapshotDenseArray(value, MAX_ERRORS, "advisory_errors_invalid")
    .map((entry) => {
      const error = snapshotExact(
        entry,
        ["file", "code"],
        "advisory_errors_invalid",
      );
      if (error.code !== "scanner_file_incomplete") {
        fail("advisory_errors_invalid");
      }
      return Object.freeze({
        file: requirePath(error.file, "advisory_errors_invalid"),
        code: "scanner_file_incomplete" as const,
      });
    })
    .sort((left, right) => compareText(left.file, right.file));
  return Object.freeze(errors);
}

function normalizeAdvisory(value: unknown) {
  const advisory = snapshotExact(
    value,
    [
      "document_type",
      "generated_at",
      "status",
      "scanner",
      "scope",
      "summary",
      "findings",
      "finding_details_truncated",
      "errors",
      "boundaries",
    ],
    "advisory_invalid",
  );
  if (advisory.document_type !== WHITEHACK_ADVISORY_DOCUMENT) {
    fail("advisory_document_type_invalid");
  }

  const scanner = snapshotExact(
    advisory.scanner,
    ["repository", "revision", "version"],
    "advisory_scanner_invalid",
  );
  if (scanner.repository !== WHITEHACK_REPOSITORY) {
    fail("advisory_scanner_invalid");
  }
  const normalizedScanner = Object.freeze({
    repository: WHITEHACK_REPOSITORY,
    revision: requireString(scanner.revision, "advisory_scanner_invalid", {
      maximum: 40,
      pattern: GIT_REVISION,
    }),
    version: requireString(scanner.version, "advisory_scanner_invalid", {
      maximum: 64,
      pattern: SEMVER,
    }),
  });

  const scope = snapshotExact(
    advisory.scope,
    [
      "mode",
      "base_revision",
      "head_revision",
      "changed_path_count",
      "changed_path_bytes",
      "candidate_count",
      "candidate_bytes",
      "skipped",
      "limits",
    ],
    "advisory_scope_invalid",
  );
  if (scope.mode !== "changed_supported_regular_files") {
    fail("advisory_scope_invalid");
  }
  const limits = normalizeLimits(scope.limits);
  const skipped = normalizeSkipped(scope.skipped);
  const normalizedScope = Object.freeze({
    mode: "changed_supported_regular_files" as const,
    base_revision: requireString(
      scope.base_revision,
      "advisory_scope_invalid",
      { maximum: 40, pattern: GIT_REVISION },
    ),
    head_revision: requireString(
      scope.head_revision,
      "advisory_scope_invalid",
      { maximum: 40, pattern: GIT_REVISION },
    ),
    changed_path_count: requireInteger(
      scope.changed_path_count,
      0,
      limits.max_changed_paths!,
      "advisory_scope_invalid",
    ),
    changed_path_bytes: requireInteger(
      scope.changed_path_bytes,
      0,
      limits.max_diff_bytes!,
      "advisory_scope_invalid",
    ),
    candidate_count: requireInteger(
      scope.candidate_count,
      0,
      limits.max_files!,
      "advisory_scope_invalid",
    ),
    candidate_bytes: requireInteger(
      scope.candidate_bytes,
      0,
      limits.max_total_bytes!,
      "advisory_scope_invalid",
    ),
    skipped,
    limits,
  });
  if (
    normalizedScope.candidate_count + sumCounts(normalizedScope.skipped)
    !== normalizedScope.changed_path_count
  ) fail("advisory_scope_mismatch");

  const summary = snapshotExact(
    advisory.summary,
    ["finding_count", "by_check", "by_confidence"],
    "advisory_summary_invalid",
  );
  const findingCount = requireInteger(
    summary.finding_count,
    0,
    limits.max_total_findings!,
    "advisory_summary_invalid",
  );
  const byCheck = parseCountMap(
    summary.by_check,
    "advisory_summary_invalid",
  );
  const byConfidence = parseCountMap(
    summary.by_confidence,
    "advisory_summary_invalid",
    CONFIDENCES,
  );
  if (
    sumCounts(byCheck) !== findingCount
    || sumCounts(byConfidence) !== findingCount
  ) fail("advisory_summary_mismatch");

  const findings = snapshotDenseArray(
    advisory.findings,
    Math.min(MAX_FINDINGS, limits.max_reported_findings!),
    "advisory_findings_invalid",
  )
    .map(normalizeFinding)
    .sort(compareFindings);
  const truncated = requireBoolean(
    advisory.finding_details_truncated,
    "advisory_truncation_invalid",
  );
  if (
    (!truncated && findings.length !== findingCount)
    || (truncated && (
      findingCount <= findings.length
      || findings.length !== limits.max_reported_findings
    ))
  ) fail("advisory_truncation_mismatch");

  const observedByCheck = new Map<string, number>();
  const observedByConfidence = new Map<string, number>();
  for (const finding of findings) {
    observedByCheck.set(
      finding.check,
      (observedByCheck.get(finding.check) ?? 0) + 1,
    );
    observedByConfidence.set(
      finding.confidence,
      (observedByConfidence.get(finding.confidence) ?? 0) + 1,
    );
  }
  for (const [key, count] of observedByCheck) {
    if ((byCheck[key] ?? 0) < count) fail("advisory_summary_mismatch");
  }
  for (const [key, count] of observedByConfidence) {
    if ((byConfidence[key] ?? 0) < count) fail("advisory_summary_mismatch");
  }

  const errors = normalizeErrors(advisory.errors);
  const status = requireEnum(
    advisory.status,
    ADVISORY_STATUSES,
    "advisory_status_invalid",
  );
  if (
    (status === "complete" && errors.length !== 0)
    || (status === "incomplete" && errors.length === 0)
    || errors.length > normalizedScope.candidate_count
  ) fail("advisory_status_mismatch");

  const boundaries = snapshotDenseArray(
    advisory.boundaries,
    ADVISORY_BOUNDARIES.length,
    "advisory_boundaries_invalid",
  ).map((boundary) => requireString(
    boundary,
    "advisory_boundaries_invalid",
    { maximum: 128 },
  ));
  if (
    boundaries.length !== ADVISORY_BOUNDARIES.length
    || new Set(boundaries).size !== ADVISORY_BOUNDARIES.length
    || ADVISORY_BOUNDARIES.some((boundary) => !boundaries.includes(boundary))
  ) fail("advisory_boundaries_invalid");

  return Object.freeze({
    document_type: WHITEHACK_ADVISORY_DOCUMENT,
    generated_at: requireDateTime(
      advisory.generated_at,
      "advisory_generated_at_invalid",
    ),
    status,
    scanner: normalizedScanner,
    scope: normalizedScope,
    summary: Object.freeze({
      finding_count: findingCount,
      by_check: byCheck,
      by_confidence: byConfidence,
    }),
    findings: Object.freeze(findings),
    finding_details_truncated: truncated,
    errors,
    boundaries: ADVISORY_BOUNDARIES,
  });
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) fail("canonical_value_invalid");
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value as JsonRecord)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(
        (value as JsonRecord)[key],
      )}`)
      .join(",")}}`;
  }
  fail("canonical_value_invalid");
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(canonicalJson(value), "utf8")
    .digest("hex")}`;
}

function freeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as JsonRecord)) freeze(child);
  return Object.freeze(value);
}

function assertOptions(value: CastleWhitehackIntakeOptions): boolean {
  const options = snapshotSubset(
    value,
    ["include_locations"],
    "intake_options_invalid",
  );
  if (
    options.include_locations !== undefined
    && typeof options.include_locations !== "boolean"
  ) fail("intake_options_invalid");
  return options.include_locations === true;
}

export function createCastleWhitehackIntake(
  advisoryInput: unknown,
  options: CastleWhitehackIntakeOptions = {},
) {
  const includeLocations = assertOptions(options);
  const advisory = normalizeAdvisory(advisoryInput);
  const advisoryDigest = digest(advisory);

  const groups = new Map<string, {
    file: string;
    line: number;
    signals: Map<string, {
      check: string;
      scanner_confidence: string;
      doctrine: string;
      principle: number;
      occurrence_count: number;
    }>;
  }>();
  for (const finding of advisory.findings) {
    const locationKey = canonicalJson([finding.file, finding.line]);
    let group = groups.get(locationKey);
    if (!group) {
      group = {
        file: finding.file,
        line: finding.line,
        signals: new Map(),
      };
      groups.set(locationKey, group);
    }
    const signalKey = canonicalJson([
      finding.check,
      finding.confidence,
      finding.doctrine,
      finding.principle,
    ]);
    const previous = group.signals.get(signalKey);
    group.signals.set(signalKey, {
      check: finding.check,
      scanner_confidence: finding.confidence,
      doctrine: finding.doctrine,
      principle: finding.principle,
      occurrence_count: (previous?.occurrence_count ?? 0) + 1,
    });
  }

  const candidates = [...groups.values()]
    .map((group) => {
      const signals = [...group.signals.values()].sort((left, right) =>
        compareText(left.check, right.check)
        || compareText(left.scanner_confidence, right.scanner_confidence)
        || compareText(left.doctrine, right.doctrine)
        || left.principle - right.principle
      );
      const locationReference = digest({
        advisory_sha256: advisoryDigest,
        file: group.file,
        line: group.line,
      });
      const candidateId = digest({
        advisory_sha256: advisoryDigest,
        location_reference: locationReference,
        signals,
      });
      if (!SHA256.test(locationReference) || !SHA256.test(candidateId)) {
        fail("candidate_digest_invalid");
      }
      return {
        id: candidateId,
        kind: "castle-gate-candidate",
        maturity: "observation",
        acceptance: "unaccepted",
        location: {
          disclosure: includeLocations ? "included" : "omitted",
          reference: locationReference,
          file: includeLocations ? group.file : null,
          line: includeLocations ? group.line : null,
          sensitivity: "unknown",
        },
        signals,
        change_relation: "not-evaluated",
        castle_confidence: "unset",
        verification: "not-run",
        suggested_destination: "gate",
        review_question: REVIEW_QUESTION,
      };
    })
    .sort((left, right) =>
      compareText(left.location.reference, right.location.reference)
    );

  const errorCounts: Record<string, number> = {};
  for (const error of advisory.errors) {
    errorCounts[error.code] = (errorCounts[error.code] ?? 0) + 1;
  }

  const unknowns = Object.fromEntries(UNKNOWN_ENTRIES);
  return freeze({
    document_type: CASTLE_WHITEHACK_INTAKE_DOCUMENT,
    projection_status: "complete",
    intake: {
      mode: "offer-only",
      destination: "castle-gate",
      audience: "local-private",
      accepted: false,
      writes_castle: false,
    },
    source: {
      document_type: WHITEHACK_ADVISORY_DOCUMENT,
      canonical_sha256: advisoryDigest,
      generated_at: advisory.generated_at,
      advisory_status: advisory.status,
      scanner: advisory.scanner,
      scope: {
        mode: advisory.scope.mode,
        base_revision: advisory.scope.base_revision,
        head_revision: advisory.scope.head_revision,
        changed_path_count: advisory.scope.changed_path_count,
        changed_path_bytes: advisory.scope.changed_path_bytes,
        candidate_file_count: advisory.scope.candidate_count,
        candidate_bytes: advisory.scope.candidate_bytes,
        skipped: advisory.scope.skipped,
        limits: advisory.scope.limits,
        finding_count: advisory.summary.finding_count,
        serialized_finding_count: advisory.findings.length,
        finding_details_truncated: advisory.finding_details_truncated,
        error_count: advisory.errors.length,
        errors_by_code: errorCounts,
      },
    },
    redaction: {
      location_disclosure: includeLocations ? "included" : "omitted",
      file_label_sensitivity: "unknown",
      source_text_retained: false,
      retained_signal_fields: RETAINED_SIGNAL_FIELDS,
      hashes_are_confidentiality_proof: false,
    },
    candidates,
    unknowns,
    boundaries: {
      cli_capabilities: {
        explicit_input_read: true,
        stdout: true,
        filesystem_write: false,
        castle_write: false,
        castle_loop_execution: false,
        process_spawn: false,
        network: false,
        target_testing: false,
        remediation: false,
        wallet: false,
        signing: false,
        rpc: false,
        broadcast: false,
        authorization: false,
      },
      transitions: {
        finding_to_gate: "offer-only",
        gate_to_stone: "requires-explicit-capture",
        finding_to_friction: "requires-explicit-judgment",
        friction_to_expedition: "requires-explicit-deepen",
        stone_to_tested: "requires-recorded-trial",
        tested_to_keep: "requires-surviving-trial",
        stone_to_room: "requires-architect-judgment",
      },
    },
  });
}
