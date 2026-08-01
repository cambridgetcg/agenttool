import {
  DECLARED_LICENSES,
  LICENSE_SCOPES,
  RESEARCH_BOUNDARY_CODES,
  RESEARCH_CAPABILITIES,
  RESEARCH_KINDS,
  RESEARCH_PASSPORT_SCHEMA,
  RESEARCH_PASSPORT_STATEMENT,
  RESEARCH_PROVIDERS,
  RESEARCH_ROLES,
  RESEARCH_STAGES,
  RESEARCH_TARGETS,
} from "./constants.js";
import { canonicalJson, deepFreeze, domainSeparatedId, snapshotJson } from "./canonical.js";
import { fail } from "./errors.js";
import type {
  CreateResearchPassportInput,
  PublisherAssertions,
  ResearchPassport,
  ResearchProposal,
} from "./types.js";
import {
  artifactRef,
  canonicalTime,
  enumeration,
  exactKeys,
  object,
  opaqueId,
  sha256,
  sortedUnique,
  sourceRefs,
} from "./validation.js";

const CODE = "passport_error" as const;

export function parsePublisherAssertions(value: unknown, path: string): PublisherAssertions {
  const input = object(value, path, CODE);
  exactKeys(input, ["publisher", "declared_license", "license_scope", "capabilities"], path, CODE);
  return {
    publisher: opaqueId(input.publisher, `${path}.publisher`, CODE, 128),
    declared_license: input.declared_license === null
      ? null
      : enumeration(input.declared_license, DECLARED_LICENSES, `${path}.declared_license`, CODE),
    license_scope: enumeration(input.license_scope, LICENSE_SCOPES, `${path}.license_scope`, CODE),
    capabilities: sortedUnique(
      input.capabilities,
      `${path}.capabilities`,
      (entry, entryPath) => enumeration(entry, RESEARCH_CAPABILITIES, entryPath, CODE),
      RESEARCH_CAPABILITIES.length,
      CODE,
    ),
  };
}

export function parseResearchProposal(value: unknown, path: string): ResearchProposal {
  const input = object(value, path, CODE);
  exactKeys(input, ["roles", "targets", "stage", "boundary_codes"], path, CODE);
  return {
    roles: sortedUnique(
      input.roles,
      `${path}.roles`,
      (entry, entryPath) => enumeration(entry, RESEARCH_ROLES, entryPath, CODE),
      RESEARCH_ROLES.length,
      CODE,
    ),
    targets: sortedUnique(
      input.targets,
      `${path}.targets`,
      (entry, entryPath) => enumeration(entry, RESEARCH_TARGETS, entryPath, CODE),
      RESEARCH_TARGETS.length,
      CODE,
    ),
    stage: enumeration(input.stage, RESEARCH_STAGES, `${path}.stage`, CODE),
    boundary_codes: sortedUnique(
      input.boundary_codes,
      `${path}.boundary_codes`,
      (entry, entryPath) => enumeration(entry, RESEARCH_BOUNDARY_CODES, entryPath, CODE),
      RESEARCH_BOUNDARY_CODES.length,
      CODE,
    ),
  };
}

export function assertResearchAdmissionInvariants(
  publisherAssertions: PublisherAssertions,
  proposal: ResearchProposal,
  path = "$",
): void {
  const absentLicense = publisherAssertions.declared_license === null;
  if (absentLicense && publisherAssertions.license_scope !== "unknown") {
    fail(CODE, `${path} absent declared license must retain license_scope=unknown`);
  }
  if (absentLicense !== proposal.boundary_codes.includes("no_declared_license")) {
    fail(CODE, `${path} no_declared_license must exactly track an absent publisher declaration`);
  }
  if (!proposal.boundary_codes.includes("license_clearance_not_assessed")) {
    fail(CODE, `${path} must retain license_clearance_not_assessed`);
  }
}

function parseInput(value: unknown): CreateResearchPassportInput {
  const root = object(snapshotJson(value), "$", CODE);
  exactKeys(
    root,
    [
      "subject",
      "observed_at",
      "observation_basis",
      "publisher_assertions",
      "proposal",
      "evidence_refs",
    ],
    "$",
    CODE,
  );
  const output: CreateResearchPassportInput = {
    subject: artifactRef(root.subject, "$.subject", CODE, RESEARCH_PROVIDERS, RESEARCH_KINDS),
    observed_at: canonicalTime(root.observed_at, "$.observed_at", CODE),
    observation_basis: enumeration(
      root.observation_basis,
      ["caller_supplied", "provider_metadata"] as const,
      "$.observation_basis",
      CODE,
    ),
    publisher_assertions: parsePublisherAssertions(root.publisher_assertions, "$.publisher_assertions"),
    proposal: parseResearchProposal(root.proposal, "$.proposal"),
    evidence_refs: sourceRefs(root.evidence_refs, "$.evidence_refs", CODE),
  };
  assertResearchAdmissionInvariants(output.publisher_assertions, output.proposal);
  return output;
}

export function createResearchPassport(input: CreateResearchPassportInput): ResearchPassport {
  const parsed = parseInput(input);
  const unsigned = {
    schema: RESEARCH_PASSPORT_SCHEMA,
    ...parsed,
    conclusions: {
      authorship: "not_proven",
      legal_clearance: "not_assessed",
      safety: "not_assessed",
      truth: "not_determined",
      authority: "none",
      representation: "none",
      automatic_action: false,
    },
    statement: RESEARCH_PASSPORT_STATEMENT,
  } as const;
  return deepFreeze({
    schema: unsigned.schema,
    passport_id: domainSeparatedId(RESEARCH_PASSPORT_SCHEMA, unsigned),
    subject: unsigned.subject,
    observed_at: unsigned.observed_at,
    observation_basis: unsigned.observation_basis,
    publisher_assertions: unsigned.publisher_assertions,
    proposal: unsigned.proposal,
    evidence_refs: unsigned.evidence_refs,
    conclusions: unsigned.conclusions,
    statement: unsigned.statement,
  }) as ResearchPassport;
}

export function validateResearchPassport(value: unknown): ResearchPassport {
  const root = object(snapshotJson(value), "$", CODE);
  exactKeys(
    root,
    [
      "schema",
      "passport_id",
      "subject",
      "observed_at",
      "observation_basis",
      "publisher_assertions",
      "proposal",
      "evidence_refs",
      "conclusions",
      "statement",
    ],
    "$",
    CODE,
  );
  if (root.schema !== RESEARCH_PASSPORT_SCHEMA) fail(CODE, "$.schema is not supported");
  sha256(root.passport_id, "$.passport_id", CODE);
  const expected = createResearchPassport({
    subject: root.subject as CreateResearchPassportInput["subject"],
    observed_at: root.observed_at as string,
    observation_basis: root.observation_basis as CreateResearchPassportInput["observation_basis"],
    publisher_assertions: root.publisher_assertions as PublisherAssertions,
    proposal: root.proposal as ResearchProposal,
    evidence_refs: root.evidence_refs as string[],
  });
  if (canonicalJson(root) !== canonicalJson(expected)) {
    fail(CODE, "passport_id or fixed boundary fields do not bind the admitted passport body");
  }
  return expected;
}
