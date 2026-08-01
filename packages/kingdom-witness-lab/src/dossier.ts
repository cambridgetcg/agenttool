import {
  HUMAN_REVIEW_STATUSES,
  WITNESS_DISCLOSURE,
  WITNESS_DOSSIER_SCHEMA,
  WITNESS_DOSSIER_STATEMENT,
  WITNESS_EXECUTION,
  WITNESS_INDEPENDENCE,
  WITNESS_KINDS,
  WITNESS_STANCES,
} from "./constants.js";
import { canonicalJson, deepFreeze, domainSeparatedId, snapshotJson } from "./canonical.js";
import { fail } from "./errors.js";
import type {
  CreateWitnessDossierInput,
  DossierRelationship,
  WitnessDescriptor,
  WitnessDossier,
} from "./types.js";
import {
  canonicalTime,
  enumeration,
  exactKeys,
  object,
  opaqueId,
  sha256,
  sourceRefs,
} from "./validation.js";

const CODE = "dossier_error" as const;

function parseWitnesses(value: unknown): WitnessDescriptor[] {
  if (!Array.isArray(value) || value.length > 64) {
    fail(CODE, "$.witnesses must be an array with at most 64 descriptors");
  }
  const output = value.map((entry, index) => {
    const path = `$.witnesses[${index}]`;
    const input = object(entry, path, CODE);
    exactKeys(
      input,
      [
        "witness_id",
        "kind",
        "source_ref",
        "observation_sha256",
        "stance",
        "independence",
        "execution",
        "disclosure",
      ],
      path,
      CODE,
    );
    const source = sourceRefs([input.source_ref], `${path}.source_ref`, CODE);
    return {
      witness_id: opaqueId(input.witness_id, `${path}.witness_id`, CODE),
      kind: enumeration(input.kind, WITNESS_KINDS, `${path}.kind`, CODE),
      source_ref: source[0]!,
      observation_sha256: sha256(input.observation_sha256, `${path}.observation_sha256`, CODE),
      stance: enumeration(input.stance, WITNESS_STANCES, `${path}.stance`, CODE),
      independence: enumeration(
        input.independence,
        WITNESS_INDEPENDENCE,
        `${path}.independence`,
        CODE,
      ),
      execution: enumeration(input.execution, WITNESS_EXECUTION, `${path}.execution`, CODE),
      disclosure: enumeration(input.disclosure, WITNESS_DISCLOSURE, `${path}.disclosure`, CODE),
    };
  });
  const ids = output.map((entry) => entry.witness_id);
  const sorted = [...ids].sort();
  if (new Set(ids).size !== ids.length || ids.some((id, index) => id !== sorted[index])) {
    fail(CODE, "$.witnesses must be unique and canonically sorted by witness_id");
  }
  return output;
}

function parseHumanReview(value: unknown): CreateWitnessDossierInput["human_review"] {
  const input = object(value, "$.human_review", CODE);
  exactKeys(input, ["status", "evidence_refs"], "$.human_review", CODE);
  const output: CreateWitnessDossierInput["human_review"] = {
    status: enumeration(input.status, HUMAN_REVIEW_STATUSES, "$.human_review.status", CODE),
    evidence_refs: sourceRefs(input.evidence_refs, "$.human_review.evidence_refs", CODE),
  };
  if (output.status === "not_requested" && output.evidence_refs.length !== 0) {
    fail(CODE, "human review not_requested must not carry review evidence");
  }
  if (output.status === "completed_reported" && output.evidence_refs.length === 0) {
    fail(CODE, "completed reported human review requires an opaque evidence reference");
  }
  return output;
}

function parseInput(value: unknown): CreateWitnessDossierInput {
  const root = object(snapshotJson(value), "$", CODE);
  exactKeys(
    root,
    ["passport_id", "question_sha256", "observed_at", "witnesses", "human_review", "evidence_refs"],
    "$",
    CODE,
  );
  return {
    passport_id: sha256(root.passport_id, "$.passport_id", CODE),
    question_sha256: sha256(root.question_sha256, "$.question_sha256", CODE),
    observed_at: canonicalTime(root.observed_at, "$.observed_at", CODE),
    witnesses: parseWitnesses(root.witnesses),
    human_review: parseHumanReview(root.human_review),
    evidence_refs: sourceRefs(root.evidence_refs, "$.evidence_refs", CODE),
  };
}

function relationship(witnesses: WitnessDescriptor[]): {
  relationship: DossierRelationship;
  support_count: number;
  contradiction_count: number;
  directional_source_count: number;
} {
  const supports = witnesses.filter((entry) => entry.stance === "supports");
  const contradictions = witnesses.filter((entry) => entry.stance === "contradicts");
  const directional = [...supports, ...contradictions];
  const directionalSourceCount = new Set(directional.map((entry) => entry.source_ref)).size;
  let relation: DossierRelationship;
  if (supports.length > 0 && contradictions.length > 0) {
    relation = "disagreement_observed";
  } else if (directional.length === 0) {
    relation = "no_directional_observation";
  } else {
    const independentSources = new Set(
      directional
        .filter((entry) => entry.independence === "independent")
        .map((entry) => entry.source_ref),
    );
    relation = independentSources.size >= 2
      ? "cross_source_agreement_observed"
      : "one_sided_observation";
  }
  return {
    relationship: relation,
    support_count: supports.length,
    contradiction_count: contradictions.length,
    directional_source_count: directionalSourceCount,
  };
}

export function createWitnessDossier(input: CreateWitnessDossierInput): WitnessDossier {
  const parsed = parseInput(input);
  const unsigned = {
    schema: WITNESS_DOSSIER_SCHEMA,
    ...parsed,
    observation: relationship(parsed.witnesses),
    conclusions: {
      external_facts: "not_resolved",
      truth: "not_determined",
      authority: "none",
      automatic_action: false,
    },
    statement: WITNESS_DOSSIER_STATEMENT,
  } as const;
  return deepFreeze({
    schema: unsigned.schema,
    dossier_id: domainSeparatedId(WITNESS_DOSSIER_SCHEMA, unsigned),
    passport_id: unsigned.passport_id,
    question_sha256: unsigned.question_sha256,
    observed_at: unsigned.observed_at,
    witnesses: unsigned.witnesses,
    human_review: unsigned.human_review,
    evidence_refs: unsigned.evidence_refs,
    observation: unsigned.observation,
    conclusions: unsigned.conclusions,
    statement: unsigned.statement,
  }) as WitnessDossier;
}

export function validateWitnessDossier(value: unknown): WitnessDossier {
  const root = object(snapshotJson(value), "$", CODE);
  exactKeys(
    root,
    [
      "schema",
      "dossier_id",
      "passport_id",
      "question_sha256",
      "observed_at",
      "witnesses",
      "human_review",
      "evidence_refs",
      "observation",
      "conclusions",
      "statement",
    ],
    "$",
    CODE,
  );
  if (root.schema !== WITNESS_DOSSIER_SCHEMA) fail(CODE, "$.schema is not supported");
  sha256(root.dossier_id, "$.dossier_id", CODE);
  const expected = createWitnessDossier({
    passport_id: root.passport_id as CreateWitnessDossierInput["passport_id"],
    question_sha256: root.question_sha256 as CreateWitnessDossierInput["question_sha256"],
    observed_at: root.observed_at as string,
    witnesses: root.witnesses as WitnessDescriptor[],
    human_review: root.human_review as CreateWitnessDossierInput["human_review"],
    evidence_refs: root.evidence_refs as string[],
  });
  if (canonicalJson(root) !== canonicalJson(expected)) {
    fail(CODE, "dossier_id or derived boundary fields do not bind the admitted dossier body");
  }
  return expected;
}
