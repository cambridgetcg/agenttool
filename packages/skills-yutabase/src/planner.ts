import { createHash } from "node:crypto";
import { types as utilTypes } from "node:util";

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
  return skillsSelectionDigestFromSnapshot(
    snapshotSkillArray(skills, "skills", 0),
  );
}

function skillsSelectionDigestFromSnapshot(
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

function readClosedObject(
  value: unknown,
  path: string,
  requiredKeys: readonly string[],
): Record<string, unknown> {
  if (value === null || typeof value !== "object") {
    fail(path, "expected an object");
  }
  if (utilTypes.isProxy(value)) fail(path, "Proxies are not accepted");
  if (Array.isArray(value)) fail(path, "expected an object");

  let prototype: object | null;
  let descriptors: ReturnType<typeof Object.getOwnPropertyDescriptors>;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    fail(path, "could not inspect object structure");
  }
  if (prototype !== Object.prototype && prototype !== null) {
    fail(path, "expected a plain or null-prototype object");
  }

  const required = new Set(requiredKeys);
  const captured = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string") fail(path, "symbol fields are not accepted");
    if (!required.has(key)) fail(`${path}.${key}`, "unexpected field");
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      fail(`${path}.${key}`, "expected an own enumerable data property");
    }
    captured[key] = descriptor.value;
  }
  for (const key of requiredKeys) {
    if (!Object.hasOwn(captured, key)) {
      fail(`${path}.${key}`, "expected an own enumerable data property");
    }
  }
  return captured;
}

function readClosedArray(
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
): unknown[] {
  if (value !== null && typeof value === "object" && utilTypes.isProxy(value)) {
    fail(path, "Proxies are not accepted");
  }
  if (!Array.isArray(value)) fail(path, "expected an array");

  let prototype: object | null;
  let descriptors: ReturnType<typeof Object.getOwnPropertyDescriptors>;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    fail(path, "could not inspect array structure");
  }
  if (prototype !== Array.prototype) {
    fail(path, "expected an array with the standard prototype");
  }
  const lengthDescriptor = descriptors.length;
  if (
    !lengthDescriptor ||
    lengthDescriptor.enumerable ||
    !("value" in lengthDescriptor)
  ) {
    fail(`${path}.length`, "expected the standard own array length");
  }
  assertCount(lengthDescriptor.value, `${path}.length`, maximum, minimum);
  const length = lengthDescriptor.value;
  const expectedIndices = new Set(
    Array.from({ length }, (_, index) => String(index)),
  );
  const capturedByIndex = new Map<string, unknown>();
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string") {
      fail(path, "symbol fields are not accepted on arrays");
    }
    if (key === "length") continue;
    if (!expectedIndices.has(key)) fail(`${path}.${key}`, "unexpected array field");
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      fail(`${path}[${key}]`, "expected an own enumerable data property");
    }
    capturedByIndex.set(key, descriptor.value);
  }

  const captured: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const key = String(index);
    if (!capturedByIndex.has(key)) {
      fail(`${path}[${key}]`, "expected an own enumerable data property");
    }
    captured.push(capturedByIndex.get(key));
  }
  return captured;
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

function snapshotSkillArray(
  value: unknown,
  path: string,
  minimum: number,
): MinimizedSkillSnapshot[] {
  const entries = readClosedArray(value, path, minimum, MAX_SKILLS);
  const names = new Set<string>();
  const skills: MinimizedSkillSnapshot[] = [];
  for (const [index, value] of entries.entries()) {
    const skillPath = `${path}[${String(index)}]`;
    const skill = readClosedObject(value, skillPath, [
      "name_kind",
      "name",
      "content_digest",
      "file_count",
      "script_count",
      "resource_count",
    ]);
    const nameKind = skill.name_kind;
    const name = skill.name;
    const contentDigest = skill.content_digest;
    const fileCount = skill.file_count;
    const scriptCount = skill.script_count;
    const resourceCount = skill.resource_count;

    assertString(nameKind, `${skillPath}.name_kind`);
    if (nameKind !== "reported" && nameKind !== "redacted_alias") {
      fail(`${skillPath}.name_kind`, "expected reported or redacted_alias");
    }
    assertString(name, `${skillPath}.name`);
    if (nameKind === "reported") {
      if (name.length > 64 || !SKILL_NAME.test(name)) {
        fail(
          `${skillPath}.name`,
          "expected a portable lowercase hyphenated reported skill name",
        );
      }
    } else {
      const match = REDACTED_SKILL_ALIAS.exec(name);
      const ordinal = match === null ? 0 : Number(match[1]);
      if (!Number.isSafeInteger(ordinal) || ordinal < 1 || ordinal > MAX_ISSUES) {
        fail(
          `${skillPath}.name`,
          `expected an exact upstream <redacted-N> alias with N from 1 to ${MAX_ISSUES}`,
        );
      }
    }
    if (names.has(name)) fail(`${skillPath}.name`, "skill names must be unique");
    names.add(name);
    assertDigest(contentDigest, `${skillPath}.content_digest`);
    assertCount(fileCount, `${skillPath}.file_count`, MAX_FILES, 1);
    assertCount(scriptCount, `${skillPath}.script_count`, fileCount);
    assertCount(resourceCount, `${skillPath}.resource_count`, fileCount);
    if (fileCount !== 1 + scriptCount + resourceCount) {
      fail(
        `${skillPath}.file_count`,
        "must equal 1 + script_count + resource_count for an @agenttool/skills snapshot",
      );
    }
    skills.push({
      name_kind: nameKind,
      name,
      content_digest: contentDigest,
      file_count: fileCount,
      script_count: scriptCount,
      resource_count: resourceCount,
    });
  }
  return skills;
}

function snapshotSkillsYutabaseInput(input: unknown): SkillsYutabaseInput {
  const record = readClosedObject(input, "input", [
    "$schema",
    "protocol",
    "project_id",
    "recorded_at",
    "source",
    "selection_summary",
    "skills",
    "authority",
  ]);
  const projectId = record.project_id;
  const recordedAt = record.recorded_at;
  assertExact(record.$schema, INPUT_SCHEMA_ID, "input.$schema");
  assertExact(record.protocol, INPUT_PROTOCOL, "input.protocol");
  assertCanonicalUuid(projectId, "input.project_id");
  assertTimestamp(recordedAt, "input.recorded_at");

  const source = readClosedObject(record.source, "input.source", [
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
  const reportDigest = source.report_digest;
  const inspectorVersion = source.inspector_version;
  const inspectorRevision = source.inspector_revision;
  assertExact(source.kind, INSPECTION_KIND, "input.source.kind");
  assertExact(source.report_schema, INSPECTION_SCHEMA_ID, "input.source.report_schema");
  assertExact(
    source.report_schema_version,
    INSPECTION_SCHEMA_VERSION,
    "input.source.report_schema_version",
  );
  assertDigest(reportDigest, "input.source.report_digest");
  assertExact(
    source.report_digest_semantics,
    REPORT_DIGEST_SEMANTICS,
    "input.source.report_digest_semantics",
  );
  if (source.report_valid !== true) fail("input.source.report_valid", "expected true");
  assertExact(source.inspector_name, INSPECTOR_NAME, "input.source.inspector_name");
  assertString(inspectorVersion, "input.source.inspector_version");
  if (!SEMVER.test(inspectorVersion)) {
    fail("input.source.inspector_version", "expected a canonical semantic version");
  }
  assertString(inspectorRevision, "input.source.inspector_revision");
  if (!REVISION_HEX.test(inspectorRevision)) {
    fail("input.source.inspector_revision", "expected a 40 or 64 lowercase hex revision");
  }
  assertExact(source.mode, "read-only", "input.source.mode");

  const summary = readClosedObject(record.selection_summary, "input.selection_summary", [
    "skills",
    "files",
    "scripts",
    "resources",
    "errors",
    "warnings",
    "redactions",
  ]);
  const selectedSkillCount = summary.skills;
  const selectedFileCount = summary.files;
  const selectedScriptCount = summary.scripts;
  const selectedResourceCount = summary.resources;
  const warningCount = summary.warnings;
  const redactionCount = summary.redactions;
  assertCount(selectedSkillCount, "input.selection_summary.skills", MAX_SKILLS, 1);
  assertCount(selectedFileCount, "input.selection_summary.files", MAX_FILES, 1);
  assertCount(selectedScriptCount, "input.selection_summary.scripts", MAX_FILES);
  assertCount(selectedResourceCount, "input.selection_summary.resources", MAX_FILES);
  if (summary.errors !== 0) fail("input.selection_summary.errors", "expected zero");
  assertCount(warningCount, "input.selection_summary.warnings", MAX_ISSUES);
  assertCount(redactionCount, "input.selection_summary.redactions", MAX_ISSUES);

  const skills = snapshotSkillArray(record.skills, "input.skills", 1);
  if (skills.length !== selectedSkillCount) {
    fail("input.skills", "length must equal input.selection_summary.skills");
  }
  if (
    skills.some((skill) => {
      if (skill.name_kind !== "redacted_alias") return false;
      const match = REDACTED_SKILL_ALIAS.exec(skill.name);
      return match !== null && Number(match[1]) > redactionCount;
    })
  ) {
    fail(
      "input.selection_summary.redactions",
      "must cover every selected redacted skill alias ordinal",
    );
  }

  if (checkedSum(skills.map((skill) => skill.file_count), "input.selection_summary.files") !== selectedFileCount) {
    fail("input.selection_summary.files", "must equal the selected skill file-count total");
  }
  if (checkedSum(skills.map((skill) => skill.script_count), "input.selection_summary.scripts") !== selectedScriptCount) {
    fail("input.selection_summary.scripts", "must equal the selected skill script-count total");
  }
  if (checkedSum(skills.map((skill) => skill.resource_count), "input.selection_summary.resources") !== selectedResourceCount) {
    fail("input.selection_summary.resources", "must equal the selected skill resource-count total");
  }

  const authority = readClosedObject(record.authority, "input.authority", [
    "automatic_action",
    "grants",
  ]);
  if (authority.automatic_action !== "never") {
    fail("input.authority.automatic_action", "expected never");
  }
  readClosedArray(authority.grants, "input.authority.grants", 0, 0);

  return {
    $schema: INPUT_SCHEMA_ID,
    protocol: INPUT_PROTOCOL,
    project_id: projectId,
    recorded_at: recordedAt,
    source: {
      kind: INSPECTION_KIND,
      report_schema: INSPECTION_SCHEMA_ID,
      report_schema_version: INSPECTION_SCHEMA_VERSION,
      report_digest: reportDigest,
      report_digest_semantics: REPORT_DIGEST_SEMANTICS,
      report_valid: true,
      inspector_name: INSPECTOR_NAME,
      inspector_version: inspectorVersion,
      inspector_revision: inspectorRevision,
      mode: "read-only",
    },
    selection_summary: {
      skills: selectedSkillCount,
      files: selectedFileCount,
      scripts: selectedScriptCount,
      resources: selectedResourceCount,
      errors: 0,
      warnings: warningCount,
      redactions: redactionCount,
    },
    skills,
    authority: { automatic_action: "never", grants: [] },
  };
}

/**
 * Checks only the closed minimized snapshot consumed by this planner. It does
 * not receive the original report, validate that report's schema, recompute a
 * digest, authenticate a publisher, or interpret a skill.
 */
export function assertSkillsYutabaseInput(
  input: unknown,
): asserts input is SkillsYutabaseInput {
  snapshotSkillsYutabaseInput(input);
}

function snapshotClaimant(options: unknown): string {
  const record = readClosedObject(options, "options", ["claimant"]);
  const claimant = record.claimant;
  assertString(claimant, "options.claimant");
  if (claimant.trim().length === 0 || claimant.includes("\u0000")) {
    fail("options.claimant", "expected a non-empty string without NUL");
  }
  return claimant;
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
  const snapshot = snapshotSkillsYutabaseInput(input);
  const claimant = snapshotClaimant(options);

  const reportUrn = inspectionEvidenceUrn(snapshot.source.report_digest);
  const selectionDigest = skillsSelectionDigestFromSnapshot(snapshot.skills);
  const selectionUrn = selectionEvidenceUrn(
    snapshot.source.report_digest,
    selectionDigest,
  );
  const inspectionAddress = address(
    "inspections",
    projectionUuid(
      "inspection",
      snapshot.project_id,
      snapshot.source.report_digest,
      selectionDigest,
      snapshot.source.inspector_revision,
    ),
  );
  const cards: YutabaseCardMutation[] = [
    card(
      "inspections",
      inspectionAddress.id,
      {
        project_id: snapshot.project_id,
        source_kind: snapshot.source.kind,
        report_schema: snapshot.source.report_schema,
        report_schema_version: snapshot.source.report_schema_version,
        report_digest: snapshot.source.report_digest,
        report_digest_semantics: snapshot.source.report_digest_semantics,
        source_report_validity: "caller_supplied_valid",
        selection_digest: selectionDigest,
        inspector_name: snapshot.source.inspector_name,
        inspector_version: snapshot.source.inspector_version,
        inspector_revision: snapshot.source.inspector_revision,
        inspector_revision_provenance: INSPECTOR_REVISION_PROVENANCE,
        inspector_mode: snapshot.source.mode,
        selected_skill_count: snapshot.selection_summary.skills,
        selected_file_count: snapshot.selection_summary.files,
        selected_script_count: snapshot.selection_summary.scripts,
        selected_resource_count: snapshot.selection_summary.resources,
        error_count: 0,
        warning_count: snapshot.selection_summary.warnings,
        redaction_count: snapshot.selection_summary.redactions,
      },
      cachedClaim(snapshot.recorded_at, claimant, reportUrn, selectionUrn),
    ),
  ];
  const relations: YutabaseRelationMutation[] = [];

  const skills = [...snapshot.skills].sort(compareSkillSnapshots);
  for (const skill of skills) {
    const skillUrn = skillEvidenceUrn(
      snapshot.source.report_digest,
      skill.name_kind,
      skill.name,
      skill.content_digest,
    );
    const skillAddress = address(
      "skill_snapshots",
      projectionUuid(
        "skill_snapshot",
        snapshot.project_id,
        snapshot.source.report_digest,
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
          project_id: snapshot.project_id,
          source_report_digest: snapshot.source.report_digest,
          name_kind: skill.name_kind,
          name: skill.name,
          content_digest: skill.content_digest,
          content_digest_semantics: SKILL_CONTENT_DIGEST_SEMANTICS,
          file_count: skill.file_count,
          script_count: skill.script_count,
          resource_count: skill.resource_count,
          interpretation: "not_performed",
        },
        cachedClaim(snapshot.recorded_at, claimant, reportUrn, selectionUrn, skillUrn),
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
      claim: computedClaim(
        snapshot.recorded_at,
        claimant,
        reportUrn,
        selectionUrn,
        skillUrn,
      ),
    });
  }

  return {
    profile: PLAN_PROFILE,
    source_scope: "project_private",
    source_report_digest: snapshot.source.report_digest,
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
