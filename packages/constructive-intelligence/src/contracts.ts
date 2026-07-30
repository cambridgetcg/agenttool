import {
  ADOPTION_RECEIPT_TYPES,
  EVIDENCE_LEVELS,
  RECEIPT_ID_DOMAIN,
  RECEIPT_MODE,
  RECEIPT_PROTOCOL,
  TLS_QUEST_ID,
} from "./constants.js";
import { canonicalJson, domainSeparatedId, snapshotJson } from "./canonical.js";
import { fail } from "./errors.js";
import type {
  ConflictDisclosure,
  EvidencePin,
  EvidenceReceiptBody,
  EvidenceReceiptEnvelope,
  Sha256Id,
  StandardPin,
} from "./types.js";

type ObjectValue = Record<string, unknown>;

const BODY_KEYS = [
  "artifact_digest",
  "artifact_frozen_at",
  "authorization_and_safety_decision",
  "canonical_subject_roots",
  "conflict_disclosures",
  "created_at",
  "deliverable_key",
  "evidence_level_and_scope",
  "execution_environment_digest",
  "immutable_bounty_and_policy_revision_digest",
  "implementation_or_toolchain_root",
  "method_or_adapter_digest",
  "mode",
  "observed_at",
  "organization_or_control_root",
  "payee_and_role",
  "pin_id",
  "prior_deliverable_and_overlap_claim",
  "protocol",
  "quest_id",
  "result",
  "source_record_or_event_id",
  "source_revision",
  "source_system",
  "standards_reference_and_revision",
  "supersedes",
  "verifier_control_cluster",
] as const;

const FORBIDDEN_ECONOMIC_OR_JUDGMENT_PROPERTY =
  /(?:money|currency|wallet|escrow|payment|score|rank|winner|approval)/iu;

function object(value: unknown, path: string): ObjectValue {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("receipt_error", `${path} must be an object`);
  }
  return value as ObjectValue;
}

function exactKeys(value: ObjectValue, keys: readonly string[], path: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail("receipt_error", `${path} has an unknown or missing property`);
  }
}

function scanForbiddenProperties(value: unknown, path = "$"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanForbiddenProperties(item, `${path}[${index}]`));
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, member] of Object.entries(value as ObjectValue)) {
    if (FORBIDDEN_ECONOMIC_OR_JUDGMENT_PROPERTY.test(key)) {
      fail("receipt_error", `${path}.${key} is a forbidden economic or judgment property`);
    }
    scanForbiddenProperties(member, `${path}.${key}`);
  }
}

function text(value: unknown, path: string, maximum = 512): string {
  if (
    typeof value !== "string"
    || value.length === 0
    || Buffer.byteLength(value, "utf8") > maximum
  ) {
    fail("receipt_error", `${path} must be a nonempty string of at most ${maximum} bytes`);
  }
  return value;
}

function digest(value: unknown, path: string): Sha256Id {
  const candidate = text(value, path, 71);
  if (!/^sha256:[0-9a-f]{64}$/u.test(candidate)) {
    fail("receipt_error", `${path} must be a lowercase sha256: content ID`);
  }
  return candidate as Sha256Id;
}

function nullableDigest(value: unknown, path: string): Sha256Id | null {
  return value === null ? null : digest(value, path);
}

function timestamp(value: unknown, path: string): string {
  const candidate = text(value, path, 24);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(candidate)) {
    fail("receipt_error", `${path} must be an RFC 3339 UTC timestamp with milliseconds`);
  }
  const parsed = new Date(candidate);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== candidate) {
    fail("receipt_error", `${path} is not a valid UTC timestamp`);
  }
  return candidate;
}

function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    fail("receipt_error", `${path} is not an allowed value`);
  }
  return value as T;
}

function sortedUniqueStrings(
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
  validator: (item: unknown, itemPath: string) => string = text,
): string[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    fail("receipt_error", `${path} must contain ${minimum}..${maximum} items`);
  }
  const output = value.map((item, index) => validator(item, `${path}[${index}]`));
  if (output.some((item, index) => index > 0 && item <= (output[index - 1] as string))) {
    fail("receipt_error", `${path} must be strictly sorted and unique`);
  }
  return output;
}

export function computeDeliverableKey(input: Pick<
  EvidenceReceiptBody,
  | "standards_reference_and_revision"
  | "evidence_level_and_scope"
  | "immutable_bounty_and_policy_revision_digest"
  | "canonical_subject_roots"
>): Sha256Id {
  return domainSeparatedId("zerone.constructive-deliverable/v1", {
    exact_standard_pins: input.standards_reference_and_revision,
    scope_hash: input.evidence_level_and_scope.scope_digest,
    acceptance_policy_hash: input.immutable_bounty_and_policy_revision_digest,
    canonical_subject_roots: input.canonical_subject_roots,
  });
}

function validateStandards(value: unknown, pin: EvidencePin): StandardPin[] {
  if (!Array.isArray(value) || value.length !== pin.standards.length) {
    fail("receipt_error", "standards_reference_and_revision must match the quest standard set");
  }
  const output = value.map((item, index): StandardPin => {
    const standard = object(item, `$.standards_reference_and_revision[${index}]`);
    exactKeys(standard, ["artifact_digest", "canonical_id", "revision"], `$.standards_reference_and_revision[${index}]`);
    return {
      canonical_id: text(standard.canonical_id, `$.standards_reference_and_revision[${index}].canonical_id`),
      revision: text(standard.revision, `$.standards_reference_and_revision[${index}].revision`),
      artifact_digest: digest(
        standard.artifact_digest,
        `$.standards_reference_and_revision[${index}].artifact_digest`,
      ),
    };
  });
  for (let index = 0; index < output.length; index += 1) {
    const actual = output[index] as StandardPin;
    const expected = pin.standards[index];
    if (
      expected === undefined
      || actual.canonical_id !== expected.canonical_id
      || actual.revision !== expected.revision
    ) {
      fail("receipt_error", "standards_reference_and_revision differs from the pinned quest");
    }
  }
  return output;
}

export function validateReceiptBody(value: unknown, pin: EvidencePin): EvidenceReceiptBody {
  snapshotJson(value);
  scanForbiddenProperties(value);
  const body = object(value, "$");
  exactKeys(body, BODY_KEYS, "$");
  if (body.protocol !== RECEIPT_PROTOCOL) fail("receipt_error", `protocol must be ${RECEIPT_PROTOCOL}`);
  if (body.mode !== RECEIPT_MODE) fail("receipt_error", `mode must be ${RECEIPT_MODE}`);
  if (body.pin_id !== pin.pin_id) fail("receipt_error", "pin_id does not match the selected ledger");
  if (body.quest_id !== TLS_QUEST_ID || body.quest_id !== pin.quest_id) {
    fail("receipt_error", `quest_id must be ${TLS_QUEST_ID}`);
  }

  const roots = sortedUniqueStrings(body.canonical_subject_roots, "$.canonical_subject_roots", 1, 32);
  const overlap = object(body.prior_deliverable_and_overlap_claim, "$.prior_deliverable_and_overlap_claim");
  exactKeys(
    overlap,
    ["delta_digest", "overlap", "overlap_digest", "prior_deliverable_key"],
    "$.prior_deliverable_and_overlap_claim",
  );
  const overlapKind = enumValue(overlap.overlap, ["none", "partial", "complete"] as const, "$.prior_deliverable_and_overlap_claim.overlap");
  const priorKey = nullableDigest(overlap.prior_deliverable_key, "$.prior_deliverable_and_overlap_claim.prior_deliverable_key");
  const overlapDigest = nullableDigest(overlap.overlap_digest, "$.prior_deliverable_and_overlap_claim.overlap_digest");
  const deltaDigest = nullableDigest(overlap.delta_digest, "$.prior_deliverable_and_overlap_claim.delta_digest");
  if (
    (overlapKind === "none" && (priorKey !== null || overlapDigest !== null || deltaDigest !== null))
    || (overlapKind === "partial" && (priorKey === null || overlapDigest === null || deltaDigest === null))
    || (overlapKind === "complete" && (priorKey === null || overlapDigest === null || deltaDigest !== null))
  ) {
    fail("receipt_error", "prior deliverable, overlap, and delta fields are inconsistent");
  }

  const levelScope = object(body.evidence_level_and_scope, "$.evidence_level_and_scope");
  exactKeys(levelScope, ["level", "scope_digest"], "$.evidence_level_and_scope");
  const level = enumValue(levelScope.level, EVIDENCE_LEVELS, "$.evidence_level_and_scope.level");
  const scopeDigest = digest(levelScope.scope_digest, "$.evidence_level_and_scope.scope_digest");
  if (scopeDigest !== `sha256:${pin.quest_scope_hash}`) {
    fail("receipt_error", "scope_digest must bind the pinned quest scopeHash");
  }

  const role = object(body.payee_and_role, "$.payee_and_role");
  exactKeys(
    role,
    ["claimed_identifier", "economic_payee", "evidence_role", "verification"],
    "$.payee_and_role",
  );
  if (role.verification !== "unverified") {
    fail("receipt_error", "Contributor identity must remain explicitly unverified");
  }
  if (role.economic_payee === undefined || role.economic_payee !== null) {
    fail("receipt_error", "economic_payee must be present and null in shadow_unfunded mode");
  }
  const evidenceRole = enumValue(
    role.evidence_role,
    [
      "contributor",
      "independent_reproducer",
      "independent_adopter",
      "maintainer",
      "neutral_challenger",
      "repairer",
    ] as const,
    "$.payee_and_role.evidence_role",
  );

  if (!Array.isArray(body.conflict_disclosures) || body.conflict_disclosures.length > 32) {
    fail("receipt_error", "conflict_disclosures must contain at most 32 entries");
  }
  const conflicts = body.conflict_disclosures.map((item, index): ConflictDisclosure => {
    const conflict = object(item, `$.conflict_disclosures[${index}]`);
    exactKeys(conflict, ["kind", "statement_digest"], `$.conflict_disclosures[${index}]`);
    return {
      kind: enumValue(
        conflict.kind,
        ["authorship", "control", "employment", "funding", "other"] as const,
        `$.conflict_disclosures[${index}].kind`,
      ),
      statement_digest: digest(
        conflict.statement_digest,
        `$.conflict_disclosures[${index}].statement_digest`,
      ),
    };
  });
  const conflictJson = conflicts.map(canonicalJson);
  if (conflictJson.some((item, index) => index > 0 && item <= (conflictJson[index - 1] as string))) {
    fail("receipt_error", "conflict_disclosures must be canonically sorted and unique");
  }

  const safety = object(body.authorization_and_safety_decision, "$.authorization_and_safety_decision");
  exactKeys(
    safety,
    ["owned_or_explicitly_authorized", "private_triage", "publication", "safety_impact"],
    "$.authorization_and_safety_decision",
  );
  if (safety.owned_or_explicitly_authorized !== true) {
    fail("receipt_error", "Only owned or explicitly authorized work is admitted");
  }
  const safetyImpact = enumValue(
    safety.safety_impact,
    ["expected", "unexpected", "unknown"] as const,
    "$.authorization_and_safety_decision.safety_impact",
  );
  const publication = enumValue(
    safety.publication,
    ["public_safe", "private_triage"] as const,
    "$.authorization_and_safety_decision.publication",
  );
  let privateTriage = null;
  if (safety.private_triage !== null) {
    const triage = object(safety.private_triage, "$.authorization_and_safety_decision.private_triage");
    exactKeys(triage, ["reference_digest", "status", "visibility"], "$.authorization_and_safety_decision.private_triage");
    if (triage.visibility !== "private") fail("receipt_error", "Private triage visibility must be private");
    privateTriage = {
      visibility: "private" as const,
      status: enumValue(
        triage.status,
        ["pending", "coordinated_repair", "safe_to_disclose"] as const,
        "$.authorization_and_safety_decision.private_triage.status",
      ),
      reference_digest: digest(
        triage.reference_digest,
        "$.authorization_and_safety_decision.private_triage.reference_digest",
      ),
    };
  }
  if (
    (safetyImpact !== "expected" && (publication !== "private_triage" || privateTriage === null))
    || (safetyImpact === "expected" && (publication !== "public_safe" || privateTriage !== null))
  ) {
    fail("receipt_error", "Unexpected/unknown impact must use digest-only private triage; expected impact must be public-safe");
  }

  const result = object(body.result, "$.result");
  exactKeys(
    result,
    ["adoption_receipt_type", "case_digests", "checker_or_corpus_digest", "conclusion"],
    "$.result",
  );
  const conclusion = enumValue(
    result.conclusion,
    ["confirmed", "contradicted", "inconclusive", "adopted", "maintained"] as const,
    "$.result.conclusion",
  );
  const checker = nullableDigest(result.checker_or_corpus_digest, "$.result.checker_or_corpus_digest");
  const cases = sortedUniqueStrings(
    result.case_digests,
    "$.result.case_digests",
    0,
    256,
    digest,
  ) as Sha256Id[];
  const adoptionType = result.adoption_receipt_type === null
    ? null
    : enumValue(
      result.adoption_receipt_type,
      ADOPTION_RECEIPT_TYPES,
      "$.result.adoption_receipt_type",
    );
  if (level === "E3" && (checker === null || cases.length === 0)) {
    fail("receipt_error", "E3 receipts require a checker/corpus digest and case digests");
  }
  if (level === "E3" && evidenceRole !== "independent_reproducer") {
    fail("receipt_error", "E3 receipts require the independent_reproducer role");
  }
  if (
    level === "E4"
    && evidenceRole !== "neutral_challenger"
    && evidenceRole !== "repairer"
  ) {
    fail("receipt_error", "E4 receipts require a neutral_challenger or repairer role");
  }
  if (
    level === "E5"
    && (evidenceRole !== "independent_adopter" || conclusion !== "adopted" || adoptionType === null)
  ) {
    fail("receipt_error", "E5 requires an allowed independent adoption receipt");
  }
  if (level === "E6" && (evidenceRole !== "maintainer" || conclusion !== "maintained")) {
    fail("receipt_error", "E6 receipts require a maintainer receipt with conclusion maintained");
  }
  if (level !== "E5" && adoptionType !== null) {
    fail("receipt_error", "adoption_receipt_type is only allowed at E5");
  }
  if (level !== "E5" && conclusion === "adopted") {
    fail("receipt_error", "conclusion adopted is only allowed at E5");
  }
  if (level !== "E6" && conclusion === "maintained") {
    fail("receipt_error", "conclusion maintained is only allowed at E6");
  }

  const frozenAt = timestamp(body.artifact_frozen_at, "$.artifact_frozen_at");
  const observedAt = timestamp(body.observed_at, "$.observed_at");
  const createdAt = timestamp(body.created_at, "$.created_at");
  if (observedAt < frozenAt || createdAt < observedAt) {
    fail("receipt_error", "Timestamps must order artifact_frozen_at <= observed_at <= created_at");
  }
  if (level === "E3" && observedAt === frozenAt) {
    fail("receipt_error", "E3 assignment/evidence must be observed after artifact freeze");
  }
  const statusCheckedAt = pin.standards
    .map((standard) => standard.status_checked_at)
    .sort()
    .at(-1);
  const reviewAfter = pin.standards
    .map((standard) => standard.review_after)
    .sort()
    .at(0);
  if (
    statusCheckedAt === undefined
    || reviewAfter === undefined
    || [frozenAt, observedAt, createdAt].some((value) => {
      const date = value.slice(0, 10);
      return date < statusCheckedAt || date > reviewAfter;
    })
  ) {
    fail(
      "receipt_error",
      "Receipt freeze, observation, and creation must remain inside the reviewed standards window",
    );
  }

  const output: EvidenceReceiptBody = {
    protocol: RECEIPT_PROTOCOL,
    mode: RECEIPT_MODE,
    pin_id: digest(body.pin_id, "$.pin_id"),
    quest_id: text(body.quest_id, "$.quest_id"),
    deliverable_key: digest(body.deliverable_key, "$.deliverable_key"),
    immutable_bounty_and_policy_revision_digest: digest(
      body.immutable_bounty_and_policy_revision_digest,
      "$.immutable_bounty_and_policy_revision_digest",
    ),
    artifact_digest: digest(body.artifact_digest, "$.artifact_digest"),
    canonical_subject_roots: roots,
    prior_deliverable_and_overlap_claim: {
      prior_deliverable_key: priorKey,
      overlap: overlapKind,
      overlap_digest: overlapDigest,
      delta_digest: deltaDigest,
    },
    standards_reference_and_revision: validateStandards(body.standards_reference_and_revision, pin),
    evidence_level_and_scope: { level, scope_digest: scopeDigest },
    method_or_adapter_digest: digest(body.method_or_adapter_digest, "$.method_or_adapter_digest"),
    source_system: text(body.source_system, "$.source_system"),
    source_record_or_event_id: text(body.source_record_or_event_id, "$.source_record_or_event_id"),
    source_revision: text(body.source_revision, "$.source_revision"),
    payee_and_role: {
      claimed_identifier: text(role.claimed_identifier, "$.payee_and_role.claimed_identifier"),
      verification: "unverified",
      evidence_role: evidenceRole,
      economic_payee: null,
    },
    verifier_control_cluster: text(body.verifier_control_cluster, "$.verifier_control_cluster"),
    organization_or_control_root: text(body.organization_or_control_root, "$.organization_or_control_root"),
    implementation_or_toolchain_root: text(body.implementation_or_toolchain_root, "$.implementation_or_toolchain_root"),
    execution_environment_digest: digest(body.execution_environment_digest, "$.execution_environment_digest"),
    conflict_disclosures: conflicts,
    authorization_and_safety_decision: {
      owned_or_explicitly_authorized: true,
      safety_impact: safetyImpact,
      publication,
      private_triage: privateTriage,
    },
    result: {
      conclusion,
      checker_or_corpus_digest: checker,
      case_digests: cases,
      adoption_receipt_type: adoptionType,
    },
    artifact_frozen_at: frozenAt,
    observed_at: observedAt,
    created_at: createdAt,
    supersedes: nullableDigest(body.supersedes, "$.supersedes"),
  };
  if (computeDeliverableKey(output) !== output.deliverable_key) {
    fail("receipt_error", "deliverable_key does not match its canonical standards/scope/policy/subject roots");
  }
  return output;
}

export function createReceiptEnvelope(body: EvidenceReceiptBody): EvidenceReceiptEnvelope {
  return {
    evidence_id: domainSeparatedId(RECEIPT_ID_DOMAIN, body),
    receipt: body,
  };
}
