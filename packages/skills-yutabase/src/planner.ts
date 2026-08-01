import { createHash } from "node:crypto";

import {
  INPUT_PROTOCOL,
  INPUT_SCHEMA_ID,
  INSPECTION_KIND,
  INSPECTION_SCHEMA_ID,
  INSPECTION_SCHEMA_VERSION,
  INSPECTOR_NAME,
  INSPECTOR_REVISION_PROVENANCE,
  MAX_FILES,
  MAX_ISSUES,
  MAX_SKILLS,
  PLAN_PROFILE,
  PROJECTION_POLICY_URN,
  REPORT_DIGEST_SEMANTICS,
  SELECTION_DIGEST_DOMAIN,
  SKILL_CONTENT_DIGEST_SEMANTICS,
  YUTABASE_BOOK,
} from "./constants.js";
import {
  inspectionEvidenceUrn,
  projectionUuid,
  selectionEvidenceUrn,
  skillEvidenceUrn,
} from "./identifiers.js";
import type {
  CachedClaim,
  ComputedClaim,
  MinimizedSkillSnapshot,
  SkillsYutabaseInput,
  SkillsYutabasePlan,
  SkillsYutabasePlanOptions,
  YutabaseAddress,
  YutabaseCardFieldMap,
  YutabaseCardMutation,
  YutabaseDeck,
  YutabaseRelationMutation,
} from "./types.js";

const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const RFC3339_MILLISECONDS =
  /^(?!0000)[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const REVISION_HEX = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const REDACTED_SKILL_ALIAS = /^<redacted-([1-9][0-9]*)>$/;
const SEMVER =
  /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export class SkillsYutabasePlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkillsYutabasePlanError";
  }
}

function compareSkillSnapshots(
  left: MinimizedSkillSnapshot,
  right: MinimizedSkillSnapshot,
): number {
  if (left.name_kind !== right.name_kind) {
    return left.name_kind < right.name_kind ? -1 : 1;
  }
  if (left.name !== right.name) return left.name < right.name ? -1 : 1;
  if (left.content_digest === right.content_digest) return 0;
  return left.content_digest < right.content_digest ? -1 : 1;
}

/** Digest of the exact minimized selection, not of skill bytes or a report. */
export function skillsSelectionDigest(
  skills: readonly MinimizedSkillSnapshot[],
): string {
  const canonical = [...skills].sort(compareSkillSnapshots).map((skill) => ({
    name_kind: skill.name_kind,
    name: skill.name,
    content_digest: skill.content_digest,
    file_count: skill.file_count,
    script_count: skill.script_count,
    resource_count: skill.resource_count,
  }));
  return "sha256:" + createHash("sha256")
    .update(SELECTION_DIGEST_DOMAIN)
    .update("\u0000")
    .update(JSON.stringify(canonical), "utf8")
    .digest("hex");
}

function fail(path: string, expectation: string): never {
  throw new SkillsYutabasePlanError(path + ": " + expectation);
}

function asClosedObject(
  value: unknown,
  path: string,
  allowedKeys: readonly string[],
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(path, "expected an object");
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) fail(`${path}.${key}`, "unexpected field");
  }
  return record;
}

function assertString(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string") fail(path, "expected a string");
}

function assertExact(value: unknown, expected: string, path: string): void {
  if (value !== expected) fail(path, `expected ${expected}`);
}

function assertCanonicalUuid(value: unknown, path: string): asserts value is string {
  assertString(value, path);
  if (!CANONICAL_UUID.test(value)) fail(path, "expected a canonical lowercase UUID");
}

function assertTimestamp(value: unknown, path: string): asserts value is string {
  assertString(value, path);
  if (!RFC3339_MILLISECONDS.test(value)) {
    fail(path, "expected exact UTC RFC3339 milliseconds");
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    fail(path, "expected a real UTC instant");
  }
}

function assertDigest(value: unknown, path: string): asserts value is string {
  assertString(value, path);
  if (!SHA256.test(value)) fail(path, "expected sha256:<64 lowercase hex>");
}

function assertCount(
  value: unknown,
  path: string,
  maximum: number,
  minimum = 0,
): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    fail(path, `expected an integer from ${minimum} to ${maximum}`);
  }
}

function checkedSum(values: readonly number[], path: string): number {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(total) || total > MAX_FILES) {
    fail(path, `expected total no greater than ${MAX_FILES}`);
  }
  return total;
}

/**
 * Checks only the closed minimized snapshot consumed by this planner. It does
 * not receive the original report, validate that report's schema, recompute a
 * digest, authenticate a publisher, or interpret a skill.
 */
export function assertSkillsYutabaseInput(input: SkillsYutabaseInput): void {
  const record = asClosedObject(input, "input", [
    "$schema",
    "protocol",
    "project_id",
    "recorded_at",
    "source",
    "selection_summary",
    "skills",
    "authority",
  ]);
  assertExact(record.$schema, INPUT_SCHEMA_ID, "input.$schema");
  assertExact(record.protocol, INPUT_PROTOCOL, "input.protocol");
  assertCanonicalUuid(record.project_id, "input.project_id");
  assertTimestamp(record.recorded_at, "input.recorded_at");

  const source = asClosedObject(record.source, "input.source", [
    "kind",
    "report_schema",
    "report_schema_version",
    "report_digest",
    "report_digest_semantics",
    "report_valid",
    "inspector_name",
    "inspector_version",
    "inspector_revision",
    "mode",
  ]);
  assertExact(source.kind, INSPECTION_KIND, "input.source.kind");
  assertExact(source.report_schema, INSPECTION_SCHEMA_ID, "input.source.report_schema");
  assertExact(
    source.report_schema_version,
    INSPECTION_SCHEMA_VERSION,
    "input.source.report_schema_version",
  );
  assertDigest(source.report_digest, "input.source.report_digest");
  assertExact(
    source.report_digest_semantics,
    REPORT_DIGEST_SEMANTICS,
    "input.source.report_digest_semantics",
  );
  if (source.report_valid !== true) fail("input.source.report_valid", "expected true");
  assertExact(source.inspector_name, INSPECTOR_NAME, "input.source.inspector_name");
  assertString(source.inspector_version, "input.source.inspector_version");
  if (!SEMVER.test(source.inspector_version)) {
    fail("input.source.inspector_version", "expected a canonical semantic version");
  }
  assertString(source.inspector_revision, "input.source.inspector_revision");
  if (!REVISION_HEX.test(source.inspector_revision)) {
    fail("input.source.inspector_revision", "expected a 40 or 64 lowercase hex revision");
  }
  assertExact(source.mode, "read-only", "input.source.mode");

  const summary = asClosedObject(record.selection_summary, "input.selection_summary", [
    "skills",
    "files",
    "scripts",
    "resources",
    "errors",
    "warnings",
    "redactions",
  ]);
  assertCount(summary.skills, "input.selection_summary.skills", MAX_SKILLS, 1);
  assertCount(summary.files, "input.selection_summary.files", MAX_FILES, 1);
  assertCount(summary.scripts, "input.selection_summary.scripts", MAX_FILES);
  assertCount(summary.resources, "input.selection_summary.resources", MAX_FILES);
  if (summary.errors !== 0) fail("input.selection_summary.errors", "expected zero");
  assertCount(summary.warnings, "input.selection_summary.warnings", MAX_ISSUES);
  assertCount(summary.redactions, "input.selection_summary.redactions", MAX_ISSUES);

  if (!Array.isArray(record.skills) || record.skills.length < 1 || record.skills.length > MAX_SKILLS) {
    fail("input.skills", `expected 1–${MAX_SKILLS} skill snapshots`);
  }
  if (record.skills.length !== summary.skills) {
    fail("input.skills", "length must equal input.selection_summary.skills");
  }

  const names = new Set<string>();
  const redactedAliasOrdinals: number[] = [];
  const skills: MinimizedSkillSnapshot[] = [];
  for (const [index, value] of record.skills.entries()) {
    const path = `input.skills[${index}]`;
    const skill = asClosedObject(value, path, [
      "name_kind",
      "name",
      "content_digest",
      "file_count",
      "script_count",
      "resource_count",
    ]);
    assertString(skill.name_kind, `${path}.name_kind`);
    if (skill.name_kind !== "reported" && skill.name_kind !== "redacted_alias") {
      fail(`${path}.name_kind`, "expected reported or redacted_alias");
    }
    assertString(skill.name, `${path}.name`);
    if (skill.name_kind === "reported") {
      if (skill.name.length > 64 || !SKILL_NAME.test(skill.name)) {
        fail(`${path}.name`, "expected a portable lowercase hyphenated reported skill name");
      }
    } else {
      const match = REDACTED_SKILL_ALIAS.exec(skill.name);
      const ordinal = match === null ? 0 : Number(match[1]);
      if (!Number.isSafeInteger(ordinal) || ordinal < 1 || ordinal > MAX_ISSUES) {
        fail(
          `${path}.name`,
          `expected an exact upstream <redacted-N> alias with N from 1 to ${MAX_ISSUES}`,
        );
      }
      redactedAliasOrdinals.push(ordinal);
    }
    if (names.has(skill.name)) fail(`${path}.name`, "skill names must be unique");
    names.add(skill.name);
    assertDigest(skill.content_digest, `${path}.content_digest`);
    assertCount(skill.file_count, `${path}.file_count`, MAX_FILES, 1);
    assertCount(skill.script_count, `${path}.script_count`, skill.file_count as number);
    assertCount(skill.resource_count, `${path}.resource_count`, skill.file_count as number);
    if (
      (skill.file_count as number) !==
      1 + (skill.script_count as number) + (skill.resource_count as number)
    ) {
      fail(
        `${path}.file_count`,
        "must equal 1 + script_count + resource_count for an @agenttool/skills snapshot",
      );
    }
    skills.push(skill as unknown as MinimizedSkillSnapshot);
  }

  if (redactedAliasOrdinals.some((ordinal) => ordinal > (summary.redactions as number))) {
    fail(
      "input.selection_summary.redactions",
      "must cover every selected redacted skill alias ordinal",
    );
  }

  if (checkedSum(skills.map((skill) => skill.file_count), "input.selection_summary.files") !== summary.files) {
    fail("input.selection_summary.files", "must equal the selected skill file-count total");
  }
  if (checkedSum(skills.map((skill) => skill.script_count), "input.selection_summary.scripts") !== summary.scripts) {
    fail("input.selection_summary.scripts", "must equal the selected skill script-count total");
  }
  if (checkedSum(skills.map((skill) => skill.resource_count), "input.selection_summary.resources") !== summary.resources) {
    fail("input.selection_summary.resources", "must equal the selected skill resource-count total");
  }

  const authority = asClosedObject(record.authority, "input.authority", [
    "automatic_action",
    "grants",
  ]);
  if (authority.automatic_action !== "never" || !Array.isArray(authority.grants) || authority.grants.length !== 0) {
    fail("input.authority", "expected { automatic_action: \"never\", grants: [] }");
  }
}

function address<D extends YutabaseDeck>(deck: D, id: string): YutabaseAddress<D> {
  return { book: YUTABASE_BOOK, deck, id, ref: [YUTABASE_BOOK, deck, id].join("/") };
}

function cachedClaim(at: string, by: string, ...src: string[]): CachedClaim {
  return { at, by, how: "cached", src };
}

function computedClaim(at: string, by: string, ...src: string[]): ComputedClaim {
  return { at, by, how: "computed", src: [...src, PROJECTION_POLICY_URN] };
}

function card<D extends YutabaseDeck>(
  deck: D,
  id: string,
  fields: YutabaseCardFieldMap[D],
  claim: CachedClaim,
): YutabaseCardMutation {
  return { op: "card.upsert", address: address(deck, id), fields, claim } as YutabaseCardMutation;
}

export function planSkillsInspection(
  input: SkillsYutabaseInput,
  options: SkillsYutabasePlanOptions,
): SkillsYutabasePlan {
  assertSkillsYutabaseInput(input);
  assertString(options?.claimant, "options.claimant");
  if (options.claimant.trim().length === 0 || options.claimant.includes("\u0000")) {
    fail("options.claimant", "expected a non-empty string without NUL");
  }

  const reportUrn = inspectionEvidenceUrn(input.source.report_digest);
  const selectionDigest = skillsSelectionDigest(input.skills);
  const selectionUrn = selectionEvidenceUrn(input.source.report_digest, selectionDigest);
  const inspectionAddress = address(
    "inspections",
    projectionUuid(
      "inspection",
      input.project_id,
      input.source.report_digest,
      selectionDigest,
      input.source.inspector_revision,
    ),
  );
  const cards: YutabaseCardMutation[] = [
    card(
      "inspections",
      inspectionAddress.id,
      {
        project_id: input.project_id,
        source_kind: input.source.kind,
        report_schema: input.source.report_schema,
        report_schema_version: input.source.report_schema_version,
        report_digest: input.source.report_digest,
        report_digest_semantics: input.source.report_digest_semantics,
        source_report_validity: "caller_supplied_valid",
        selection_digest: selectionDigest,
        inspector_name: input.source.inspector_name,
        inspector_version: input.source.inspector_version,
        inspector_revision: input.source.inspector_revision,
        inspector_revision_provenance: INSPECTOR_REVISION_PROVENANCE,
        inspector_mode: input.source.mode,
        selected_skill_count: input.selection_summary.skills,
        selected_file_count: input.selection_summary.files,
        selected_script_count: input.selection_summary.scripts,
        selected_resource_count: input.selection_summary.resources,
        error_count: 0,
        warning_count: input.selection_summary.warnings,
        redaction_count: input.selection_summary.redactions,
      },
      cachedClaim(input.recorded_at, options.claimant, reportUrn, selectionUrn),
    ),
  ];
  const relations: YutabaseRelationMutation[] = [];

  const skills = [...input.skills].sort(compareSkillSnapshots);
  for (const skill of skills) {
    const skillUrn = skillEvidenceUrn(
      input.source.report_digest,
      skill.name_kind,
      skill.name,
      skill.content_digest,
    );
    const skillAddress = address(
      "skill_snapshots",
      projectionUuid(
        "skill_snapshot",
        input.project_id,
        input.source.report_digest,
        skill.name_kind,
        skill.name,
        skill.content_digest,
      ),
    );
    cards.push(
      card(
        "skill_snapshots",
        skillAddress.id,
        {
          project_id: input.project_id,
          source_report_digest: input.source.report_digest,
          name_kind: skill.name_kind,
          name: skill.name,
          content_digest: skill.content_digest,
          content_digest_semantics: SKILL_CONTENT_DIGEST_SEMANTICS,
          file_count: skill.file_count,
          script_count: skill.script_count,
          resource_count: skill.resource_count,
          interpretation: "not_performed",
        },
        cachedClaim(input.recorded_at, options.claimant, reportUrn, selectionUrn, skillUrn),
      ),
    );
    relations.push({
      op: "thread.ensure",
      id: projectionUuid(
        "relation",
        "lists_skill_snapshot",
        inspectionAddress.ref,
        skillAddress.ref,
      ),
      word: "lists_skill_snapshot",
      from: inspectionAddress,
      to: skillAddress,
      claim: computedClaim(input.recorded_at, options.claimant, reportUrn, selectionUrn, skillUrn),
    });
  }

  return {
    profile: PLAN_PROFILE,
    source_scope: "project_private",
    source_report_digest: input.source.report_digest,
    selection_digest: selectionDigest,
    cards,
    relations,
    limitations: {
      source_report_schema_validation: "not_performed",
      report_digest_verification: "not_performed",
      skill_content_digest_verification: "not_performed",
      inspector_revision_verification: "not_performed",
      publisher_authentication: "not_performed",
      skill_interpretation: "not_performed",
      safety_evaluation: "not_performed",
      persistence: "not_performed",
      model_execution: "not_performed",
      embedding_generation: "not_performed",
      raw_skill_content: "not_accepted",
      payload_policy: "metadata_only",
      permission_effect: "none",
      consent_effect: "none",
      truth_effect: "none",
      score_rank_xp_effect: "none",
      dignity_effect: "none",
      action_effect: "none",
    },
  };
}
