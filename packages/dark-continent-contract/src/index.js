import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const CONTRACT_ID = "agenttool.dark-continent/0.1";
export const FRAMEWORK_FORMAT = "agenttool-dark-continent-framework/v0.1";
export const PROJECTION_FORMAT = "dark-continent-projection/v0.1";
export const SOURCE_PROFILE = "agenttool-sdk-ts-0.17.0";

export const CALAMITY_IDS = Object.freeze([
  "hellbell",
  "ai",
  "brion",
  "pap",
  "zobae",
  "nanika",
]);

export const LOGOS_IDS = Object.freeze([
  "guide",
  "ai",
  "rest",
  "see",
  "vow",
  "witness",
  "unknown",
]);

export const CONSUMER_KINDS = Object.freeze([
  "kingdom-extension",
  "artbitrage",
]);

const frameworkUrl = new URL(
  "../frameworks/agenttool-sdk-0.17.0.json",
  import.meta.url,
);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactIds(records, expected) {
  if (!Array.isArray(records)) return false;
  return (
    records.length === expected.length &&
    records.every((record, index) => record?.id === expected[index])
  );
}

function hasExactKeys(value, expected) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return (
    actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index])
  );
}

function push(errors, condition, message) {
  if (!condition) errors.push(message);
}

export function prettyJsonBytes(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function loadFrameworkSnapshot() {
  return JSON.parse(readFileSync(frameworkUrl, "utf8"));
}

export function frameworkArtifactDigest() {
  return sha256(readFileSync(frameworkUrl));
}

export function validateFrameworkSnapshot(snapshot) {
  const errors = [];
  push(errors, isRecord(snapshot), "snapshot must be an object");
  if (!isRecord(snapshot)) return errors;
  push(
    errors,
    hasExactKeys(snapshot, [
      "_format",
      "contract_id",
      "source_profile",
      "source",
      "semantics",
      "calamities",
      "guide",
      "logos",
    ]),
    "snapshot has missing or unknown fields",
  );

  push(errors, snapshot._format === FRAMEWORK_FORMAT, "unexpected _format");
  push(errors, snapshot.contract_id === CONTRACT_ID, "unexpected contract_id");
  push(
    errors,
    snapshot.source_profile === SOURCE_PROFILE,
    "unexpected source_profile",
  );
  push(
    errors,
    hasExactKeys(snapshot.source, [
      "package",
      "version",
      "file",
      "sha256",
      "projection",
    ]) &&
      snapshot.source?.package === "@agenttool/sdk" &&
      snapshot.source?.version === "0.17.0" &&
      snapshot.source?.file ===
        "packages/sdk-ts/src/dark-continent.ts" &&
      snapshot.source?.projection === "static_constants_only" &&
      /^[a-f0-9]{64}$/.test(snapshot.source?.sha256 ?? ""),
    "source provenance is incomplete",
  );
  push(
    errors,
    hasExactKeys(snapshot.semantics, [
      "advisory",
      "runtime_effects",
      "verifies_runtime_walls",
      "grants_permission",
      "authorizes_trade",
      "authorizes_publication",
    ]) &&
      snapshot.semantics?.advisory === true &&
      snapshot.semantics?.runtime_effects === "none" &&
      snapshot.semantics?.verifies_runtime_walls === false &&
      snapshot.semantics?.grants_permission === false &&
      snapshot.semantics?.authorizes_trade === false &&
      snapshot.semantics?.authorizes_publication === false,
    "semantic authority boundary is incomplete",
  );
  push(
    errors,
    exactIds(snapshot.calamities, CALAMITY_IDS),
    "calamities must use the closed six-item source order",
  );
  push(
    errors,
    exactIds(snapshot.logos, LOGOS_IDS),
    "logos must use the closed seven-item source order",
  );
  push(
    errors,
    hasExactKeys(snapshot.guide, [
      "kanji",
      "name",
      "meaning",
      "maps_to",
      "warning",
    ]) &&
      typeof snapshot.guide.kanji === "string" &&
      snapshot.guide.kanji.length > 0 &&
      snapshot.guide.name === "Guide" &&
      typeof snapshot.guide.meaning === "string" &&
      snapshot.guide.meaning.length > 0 &&
      typeof snapshot.guide.maps_to === "string" &&
      snapshot.guide.maps_to.length > 0 &&
      typeof snapshot.guide.warning === "string" &&
      snapshot.guide.warning.length > 0,
    "guide is incomplete",
  );

  const calamities = Array.isArray(snapshot.calamities)
    ? snapshot.calamities
    : [];
  for (const calamity of calamities) {
    const wall = calamity?.declared_wall;
    push(
      errors,
      hasExactKeys(calamity, [
        "id",
        "kanji",
        "name",
        "hxh_meaning",
        "agenttool_hazard",
        "declared_wall",
      ]),
      `calamity ${calamity?.id ?? "<unknown>"} has missing or unknown fields`,
    );
    push(
      errors,
      typeof calamity?.kanji === "string" &&
        calamity.kanji.length > 0 &&
        typeof calamity?.name === "string" &&
        calamity.name.length > 0 &&
        typeof calamity?.hxh_meaning === "string" &&
        calamity.hxh_meaning.length > 0 &&
        typeof calamity?.agenttool_hazard === "string" &&
        calamity.agenttool_hazard.length > 0,
      `calamity ${calamity?.id ?? "<unknown>"} has blank descriptive fields`,
    );
    push(
      errors,
      hasExactKeys(wall, ["text", "status", "verified", "evidence_refs"]) &&
        typeof wall.text === "string" &&
        wall.text.length > 0 &&
        wall.status === "not_checked" &&
        wall.verified === false &&
        Array.isArray(wall.evidence_refs) &&
        wall.evidence_refs.length === 0,
      `calamity ${calamity?.id ?? "<unknown>"} overstates its wall`,
    );
  }
  const logosRecords = Array.isArray(snapshot.logos) ? snapshot.logos : [];
  for (const logos of logosRecords) {
    const wall = logos?.declared_calamity_wall;
    push(
      errors,
      hasExactKeys(logos, [
        "id",
        "kanji",
        "name",
        "meaning",
        "operation",
        "declared_calamity_wall",
      ]),
      `logos ${logos?.id ?? "<unknown>"} has missing or unknown fields`,
    );
    push(
      errors,
      typeof logos?.kanji === "string" &&
        logos.kanji.length > 0 &&
        typeof logos?.name === "string" &&
        logos.name.length > 0 &&
        typeof logos?.meaning === "string" &&
        logos.meaning.length > 0 &&
        typeof logos?.operation === "string" &&
        logos.operation.length > 0,
      `logos ${logos?.id ?? "<unknown>"} has blank descriptive fields`,
    );
    push(
      errors,
      hasExactKeys(wall, ["text", "status", "verified", "evidence_refs"]) &&
        typeof wall.text === "string" &&
        wall.text.length > 0 &&
        wall.status === "not_checked" &&
        wall.verified === false &&
        Array.isArray(wall.evidence_refs) &&
        wall.evidence_refs.length === 0,
      `logos ${logos?.id ?? "<unknown>"} overstates its wall`,
    );
  }

  return errors;
}

export function createProjection({
  projectionId,
  consumer,
  artifact,
  interpretations = [],
}) {
  const snapshot = loadFrameworkSnapshot();
  const snapshotErrors = validateFrameworkSnapshot(snapshot);
  if (snapshotErrors.length > 0) {
    throw new TypeError(
      `invalid framework snapshot: ${snapshotErrors.join("; ")}`,
    );
  }
  if (typeof projectionId !== "string" || projectionId.length === 0) {
    throw new TypeError("projectionId must be a non-empty string");
  }
  if (
    !isRecord(consumer) ||
    !CONSUMER_KINDS.includes(consumer.kind) ||
    typeof consumer.id !== "string" ||
    consumer.id.length === 0
  ) {
    throw new TypeError("consumer must have a supported kind and non-empty id");
  }
  if (typeof artifact !== "string" || artifact.length === 0) {
    throw new TypeError("artifact must be a non-empty portable reference");
  }

  const normalizedInterpretations = interpretations.map((interpretation) => {
    if (
      !isRecord(interpretation) ||
      typeof interpretation.source_profile !== "string" ||
      interpretation.source_profile.length === 0 ||
      interpretation.relation !== "parallel_not_equivalent"
    ) {
      throw new TypeError(
        "interpretations must be labelled parallel_not_equivalent",
      );
    }
    return {
      source_profile: interpretation.source_profile,
      relation: "parallel_not_equivalent",
    };
  });

  return {
    _format: PROJECTION_FORMAT,
    projection_id: projectionId,
    source_profile: snapshot.source_profile,
    source_snapshot: {
      format: snapshot._format,
      contract_id: snapshot.contract_id,
      artifact,
      sha256: frameworkArtifactDigest(),
    },
    consumer: {
      kind: consumer.kind,
      id: consumer.id,
    },
    checks: snapshot.calamities.map((calamity) => ({
      calamity_id: calamity.id,
      risk_state: "unknown",
      wall: {
        status: "not_checked",
        verified: false,
      },
      evidence_refs: [],
    })),
    interpretations: normalizedInterpretations,
    decision: {
      recommendation: "hold",
      advisory: true,
      reason_codes: ["wall_not_verified"],
    },
    authority: {
      grants_permission: false,
      authorizes_trade: false,
      authorizes_publication: false,
    },
  };
}

export function validateProjection(projection) {
  const snapshot = loadFrameworkSnapshot();
  const errors = [];
  push(errors, isRecord(projection), "projection must be an object");
  if (!isRecord(projection)) return errors;
  push(
    errors,
    hasExactKeys(projection, [
      "_format",
      "projection_id",
      "source_profile",
      "source_snapshot",
      "consumer",
      "checks",
      "interpretations",
      "decision",
      "authority",
    ]),
    "projection has missing or unknown fields",
  );

  push(errors, projection._format === PROJECTION_FORMAT, "unexpected _format");
  push(
    errors,
    typeof projection.projection_id === "string" &&
      projection.projection_id.length > 0,
    "projection_id must be non-empty",
  );
  push(
    errors,
    projection.source_profile === SOURCE_PROFILE,
    "unexpected source_profile",
  );
  push(
    errors,
    hasExactKeys(projection.source_snapshot, [
      "format",
      "contract_id",
      "artifact",
      "sha256",
    ]) &&
      projection.source_snapshot?.format === FRAMEWORK_FORMAT &&
      projection.source_snapshot?.contract_id === CONTRACT_ID &&
      typeof projection.source_snapshot?.artifact === "string" &&
      projection.source_snapshot.artifact.length > 0 &&
      projection.source_snapshot?.sha256 === frameworkArtifactDigest(),
    "source snapshot reference is invalid",
  );
  push(
    errors,
    hasExactKeys(projection.consumer, ["kind", "id"]) &&
      CONSUMER_KINDS.includes(projection.consumer?.kind) &&
      typeof projection.consumer?.id === "string" &&
      projection.consumer.id.length > 0,
    "consumer is invalid",
  );
  push(
    errors,
    exactIds(
      Array.isArray(projection.checks)
        ? projection.checks.map((check) => ({
            id: check?.calamity_id,
          }))
        : projection.checks,
      CALAMITY_IDS,
    ),
    "checks must cover the closed six-item source order",
  );

  const checks = Array.isArray(projection.checks) ? projection.checks : [];
  for (const check of checks) {
    push(
      errors,
      hasExactKeys(check, [
        "calamity_id",
        "risk_state",
        "wall",
        "evidence_refs",
      ]) &&
        hasExactKeys(check.wall, ["status", "verified"]) &&
        check.risk_state === "unknown" &&
        check.wall?.status === "not_checked" &&
        check.wall?.verified === false &&
        Array.isArray(check.evidence_refs) &&
        check.evidence_refs.length === 0,
      `check ${check?.calamity_id ?? "<unknown>"} overstates evidence`,
    );
  }
  const interpretations = Array.isArray(projection.interpretations)
    ? projection.interpretations
    : [];
  push(
    errors,
    Array.isArray(projection.interpretations),
    "interpretations must be an array",
  );
  for (const interpretation of interpretations) {
    push(
      errors,
      hasExactKeys(interpretation, ["source_profile", "relation"]) &&
        typeof interpretation.source_profile === "string" &&
        interpretation.source_profile.length > 0 &&
        interpretation.relation === "parallel_not_equivalent",
      "interpretation relation is invalid",
    );
  }
  push(
    errors,
    hasExactKeys(projection.decision, [
      "recommendation",
      "advisory",
      "reason_codes",
    ]) &&
      projection.decision?.recommendation === "hold" &&
      projection.decision?.advisory === true &&
      Array.isArray(projection.decision?.reason_codes) &&
      projection.decision.reason_codes.length === 1 &&
      projection.decision.reason_codes[0] === "wall_not_verified",
    "decision must remain an advisory hold",
  );
  push(
    errors,
    hasExactKeys(projection.authority, [
      "grants_permission",
      "authorizes_trade",
      "authorizes_publication",
    ]) &&
      projection.authority?.grants_permission === false &&
      projection.authority?.authorizes_trade === false &&
      projection.authority?.authorizes_publication === false,
    "projection exceeds its authority",
  );

  return errors;
}
