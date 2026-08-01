import {
  canonicalJson,
  compareUnicode,
  deepFreeze,
  domainSeparatedId,
} from "./canonical.js";
import {
  CLAIM_KINDS,
  DEEPSEEK_FORMATS,
  LICENSE_SCOPES,
  SOURCE_BOUNDARIES,
} from "./constants.js";
import { fail } from "./errors.js";
import type {
  CreateDeepSeekSourceBindingInput,
  DeepSeekClaimInput,
  DeepSeekLicenseInput,
  DeepSeekSourceBinding,
} from "./types.js";
import {
  evidencePin,
  exactKeys,
  id,
  literal,
  record,
  sameEvidenceSubject,
  sha256,
  text,
} from "./validation.js";

export function createDeepSeekSourceBinding(
  input: CreateDeepSeekSourceBindingInput,
): Readonly<DeepSeekSourceBinding> {
  const candidate = record(input, "$input", "invalid_source");
  exactKeys(candidate, ["subject", "license", "claims"], "$input", "invalid_source");

  const subject = record(candidate.subject, "$input.subject", "invalid_source");
  exactKeys(subject, ["label", "evidence"], "$input.subject", "invalid_source");
  const evidence = evidencePin(subject.evidence, "$input.subject.evidence", "invalid_source");
  const license = normalizeLicense(candidate.license, evidence, "$input.license");
  const claims = normalizeClaims(candidate.claims);

  const body = deepFreeze({
    _format: DEEPSEEK_FORMATS.source_binding,
    publisher: "deepseek-ai" as const,
    subject: {
      label: text(subject.label, "$input.subject.label", "invalid_source", 200),
      evidence,
      evidence_ref: evidence.sha256,
    },
    license: {
      ...license,
      basis: "caller_reported" as const,
    },
    claims: claims.map((claim) => ({
      ...claim,
      basis: "caller_asserted_from_primary_source" as const,
      verification: "not_performed" as const,
    })),
    status: "metadata_bound" as const,
    boundaries: SOURCE_BOUNDARIES,
  });

  return deepFreeze({
    ...body,
    binding_id: domainSeparatedId("agenttool.deepseek-source-binding/0.1", body),
  });
}

export function validateDeepSeekSourceBinding(
  value: unknown,
): Readonly<DeepSeekSourceBinding> {
  const source = record(value, "$source", "invalid_source");
  exactKeys(
    source,
    ["_format", "binding_id", "publisher", "subject", "license", "claims", "status", "boundaries"],
    "$source",
    "invalid_source",
  );
  if (
    source._format !== DEEPSEEK_FORMATS.source_binding ||
    source.publisher !== "deepseek-ai" ||
    source.status !== "metadata_bound" ||
    canonicalJson(source.boundaries) !== canonicalJson(SOURCE_BOUNDARIES)
  ) {
    fail("invalid_source", "$source fixed protocol fields are invalid");
  }
  const subject = record(source.subject, "$source.subject", "invalid_source");
  exactKeys(subject, ["label", "evidence", "evidence_ref"], "$source.subject", "invalid_source");
  const evidence = evidencePin(subject.evidence, "$source.subject.evidence", "invalid_source");
  if (sha256(subject.evidence_ref, "$source.subject.evidence_ref", "invalid_source") !== evidence.sha256) {
    fail("invalid_source", "$source.subject.evidence_ref must bind the source bytes");
  }
  const license = record(source.license, "$source.license", "invalid_source");
  exactKeys(
    license,
    ["scope", "declared_expression", "evidence", "review_status", "basis"],
    "$source.license",
    "invalid_source",
  );
  if (license.basis !== "caller_reported") {
    fail("invalid_source", "$source.license.basis is invalid");
  }
  if (!Array.isArray(source.claims)) fail("invalid_source", "$source.claims must be an array");
  const claims = source.claims.map((entry, index) => {
    const claim = record(entry, `$source.claims[${index}]`, "invalid_source");
    exactKeys(
      claim,
      ["claim_id", "claim_kind", "summary", "source_anchor", "basis", "verification"],
      `$source.claims[${index}]`,
      "invalid_source",
    );
    if (
      claim.basis !== "caller_asserted_from_primary_source" ||
      claim.verification !== "not_performed"
    ) {
      fail("invalid_source", `$source.claims[${index}] overstates its basis`);
    }
    return {
      claim_id: claim.claim_id,
      claim_kind: claim.claim_kind,
      summary: claim.summary,
      source_anchor: claim.source_anchor,
    };
  });
  const rebuilt = createDeepSeekSourceBinding({
    subject: { label: subject.label as string, evidence },
    license: {
      scope: license.scope as DeepSeekLicenseInput["scope"],
      declared_expression: license.declared_expression as string | null,
      evidence: license.evidence as DeepSeekLicenseInput["evidence"],
      review_status: license.review_status as DeepSeekLicenseInput["review_status"],
    },
    claims: claims as DeepSeekClaimInput[],
  });
  if (
    sha256(source.binding_id, "$source.binding_id", "invalid_source") !== rebuilt.binding_id ||
    canonicalJson(source) !== canonicalJson(rebuilt)
  ) {
    fail("invalid_source", "$source binding digest or canonical fields are invalid");
  }
  return rebuilt;
}

function normalizeLicense(
  value: unknown,
  sourceEvidence: ReturnType<typeof evidencePin>,
  path: string,
): DeepSeekLicenseInput {
  const license = record(value, path, "invalid_source");
  exactKeys(
    license,
    ["scope", "declared_expression", "evidence", "review_status"],
    path,
    "invalid_source",
  );
  const declaredExpression = license.declared_expression === null
    ? null
    : text(license.declared_expression, `${path}.declared_expression`, "invalid_source", 120);
  const licenseEvidence = license.evidence === null
    ? null
    : evidencePin(license.evidence, `${path}.evidence`, "invalid_source");
  if ((declaredExpression === null) !== (licenseEvidence === null)) {
    fail("invalid_source", `${path} requires both a declared expression and exact evidence, or neither`);
  }
  if (licenseEvidence && !sameEvidenceSubject(sourceEvidence, licenseEvidence)) {
    fail("invalid_source", `${path}.evidence must share the subject origin, repository, and revision`);
  }
  return {
    scope: literal(license.scope, LICENSE_SCOPES, `${path}.scope`, "invalid_source"),
    declared_expression: declaredExpression,
    evidence: licenseEvidence,
    review_status: literal(
      license.review_status,
      ["not_reviewed", "caller_reviewed"] as const,
      `${path}.review_status`,
      "invalid_source",
    ),
  };
}

function normalizeClaims(value: unknown): DeepSeekClaimInput[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 64) {
    fail("invalid_source", "$input.claims must contain 1 through 64 claims");
  }
  const claims = value.map((entry, index) => {
    const claim = record(entry, `$input.claims[${index}]`, "invalid_source");
    exactKeys(
      claim,
      ["claim_id", "claim_kind", "summary", "source_anchor"],
      `$input.claims[${index}]`,
      "invalid_source",
    );
    return {
      claim_id: id(claim.claim_id, `$input.claims[${index}].claim_id`, "invalid_source"),
      claim_kind: literal(
        claim.claim_kind,
        CLAIM_KINDS,
        `$input.claims[${index}].claim_kind`,
        "invalid_source",
      ),
      summary: text(claim.summary, `$input.claims[${index}].summary`, "invalid_source", 280),
      source_anchor: text(
        claim.source_anchor,
        `$input.claims[${index}].source_anchor`,
        "invalid_source",
        160,
      ),
    };
  });
  const sorted = [...claims].sort((left, right) => compareUnicode(left.claim_id, right.claim_id));
  if (
    claims.some((claim, index) => claim.claim_id !== sorted[index]!.claim_id) ||
    new Set(claims.map((claim) => claim.claim_id)).size !== claims.length
  ) {
    fail("invalid_source", "$input.claims must be sorted by unique claim_id");
  }
  return claims;
}
