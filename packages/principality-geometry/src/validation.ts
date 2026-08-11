import {
  ARTIFACT_OBSERVATIONS,
  ATLAS_FORMAT,
  BRIDGE_DISPOSITIONS,
  GEOMETRY_LIMITS,
  INPUT_FORMAT,
  INVARIANT_STATES,
  NPM_PROVENANCE_STATES,
  PRINCIPALITY_KINDS,
} from "./constants.js";
import {
  canonicalJson,
  deepFreeze,
  domainSeparatedId,
  snapshotJson,
  utf16Order,
  type JsonValue,
} from "./canonical.js";
import { fail, type PrincipalityGeometryErrorCode } from "./errors.js";
import type {
  ArtifactInput,
  ArtifactReference,
  BridgeEvaluation,
  CreatePrincipalityGeometryInput,
  HuggingFaceArtifactInput,
  InvariantDefinition,
  ManifestationInput,
  ManifestationReference,
  NpmArtifactInput,
  PrincipalityInput,
  PrincipalityVertex,
  Sha256Id,
  TranslationBridge,
  TranslationInput,
} from "./types.js";

const SHA256_ID = /^sha256:[0-9a-f]{64}$/u;
const TOKEN = /^[a-z][a-z0-9._-]{0,63}$/u;
const PROTOCOL_ID =
  /^(?=.{1,128}$)[a-z][a-z0-9._:-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/u;
const HF_REPO_ID =
  /^(?=.{3,128}$)[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?\/[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/u;
const HF_REVISION = /^[0-9a-f]{40}$/u;
const NPM_NAME =
  /^(?:@[a-z0-9][a-z0-9._-]{0,63}\/[a-z0-9][a-z0-9._-]{0,127}|[a-z0-9][a-z0-9._-]{0,127})$/u;
const SEMVER =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
const SHA512_SRI = /^sha512-[A-Za-z0-9+/]{86}==$/u;

function sha512Sri(
  value: JsonValue | undefined,
  path: string,
  code: PrincipalityGeometryErrorCode,
): string {
  const candidate = text(value, path, code);
  if (!SHA512_SRI.test(candidate)) {
    fail(code, `${path} must be one exact canonical sha512 SRI value`);
  }
  const payload = candidate.slice("sha512-".length);
  const decoded = Buffer.from(payload, "base64");
  if (decoded.length !== 64 || decoded.toString("base64") !== payload) {
    fail(code, `${path} must use canonical base64 for exactly 64 bytes`);
  }
  return candidate;
}

export function record(
  value: JsonValue | undefined,
  path: string,
  code: PrincipalityGeometryErrorCode,
): Record<string, JsonValue> {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    fail(code, `${path} must be a plain object`);
  }
  return value;
}

export function exactKeys(
  value: Record<string, JsonValue>,
  expected: readonly string[],
  path: string,
  code: PrincipalityGeometryErrorCode,
): void {
  const actual = Object.keys(value).sort(utf16Order);
  const wanted = [...expected].sort(utf16Order);
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  ) {
    fail(code, `${path} must contain exactly: ${wanted.join(", ")}`);
  }
}

function text(
  value: JsonValue | undefined,
  path: string,
  code: PrincipalityGeometryErrorCode,
): string {
  if (typeof value !== "string") fail(code, `${path} must be a string`);
  return value;
}

function literal<T extends string>(
  value: JsonValue | undefined,
  allowed: readonly T[],
  path: string,
  code: PrincipalityGeometryErrorCode,
): T {
  const candidate = text(value, path, code);
  if (!(allowed as readonly string[]).includes(candidate)) {
    fail(code, `${path} must be one of: ${allowed.join(", ")}`);
  }
  return candidate as T;
}

function falseLiteral(
  value: JsonValue | undefined,
  path: string,
  code: PrincipalityGeometryErrorCode,
): false {
  if (value !== false) fail(code, `${path} must be false`);
  return false;
}

function token(
  value: JsonValue | undefined,
  path: string,
  code: PrincipalityGeometryErrorCode,
): string {
  const candidate = text(value, path, code);
  if (!TOKEN.test(candidate)) {
    fail(code, `${path} must be a lowercase 1-64 character protocol token`);
  }
  return candidate;
}

function protocolId(
  value: JsonValue | undefined,
  path: string,
  code: PrincipalityGeometryErrorCode,
): string {
  const candidate = text(value, path, code);
  if (!PROTOCOL_ID.test(candidate)) {
    fail(code, `${path} must be a lowercase 1-128 character protocol identifier`);
  }
  return candidate;
}

export function sha256(
  value: JsonValue | undefined,
  path: string,
  code: PrincipalityGeometryErrorCode,
): Sha256Id {
  const candidate = text(value, path, code);
  if (!SHA256_ID.test(candidate)) {
    fail(code, `${path} must be a lowercase sha256: content ID`);
  }
  return candidate as Sha256Id;
}

function array(
  value: JsonValue | undefined,
  path: string,
  max: number,
  code: PrincipalityGeometryErrorCode,
): JsonValue[] {
  if (!Array.isArray(value) || value.length > max) {
    fail(code, `${path} must be an array with at most ${String(max)} entries`);
  }
  return value;
}

function parseArtifact(
  value: JsonValue,
  path: string,
  code: PrincipalityGeometryErrorCode,
  withRef: boolean,
): ArtifactInput | ArtifactReference {
  const candidate = record(value, path, code);
  const kind = literal(candidate.kind, ["huggingface", "npm"], `${path}.kind`, code);
  if (kind === "huggingface") {
    const keys = [
      "kind",
      "repo_type",
      "repo_id",
      "revision",
      "snapshot_manifest_protocol",
      "snapshot_manifest_sha256",
      "observation",
    ];
    exactKeys(candidate, withRef ? [...keys, "artifact_ref"] : keys, path, code);
    const repoId = text(candidate.repo_id, `${path}.repo_id`, code);
    const revision = text(candidate.revision, `${path}.revision`, code);
    if (!HF_REPO_ID.test(repoId)) fail(code, `${path}.repo_id is invalid`);
    if (!HF_REVISION.test(revision)) {
      fail(code, `${path}.revision must be a full lowercase 40-hex commit`);
    }
    const body: HuggingFaceArtifactInput = {
      kind,
      repo_type: literal(
        candidate.repo_type,
        ["model", "dataset", "space"],
        `${path}.repo_type`,
        code,
      ),
      repo_id: repoId,
      revision,
      snapshot_manifest_protocol: protocolId(
        candidate.snapshot_manifest_protocol,
        `${path}.snapshot_manifest_protocol`,
        code,
      ),
      snapshot_manifest_sha256: sha256(
        candidate.snapshot_manifest_sha256,
        `${path}.snapshot_manifest_sha256`,
        code,
      ),
      observation: literal(
        candidate.observation,
        ARTIFACT_OBSERVATIONS,
        `${path}.observation`,
        code,
      ),
    };
    if (!withRef) return deepFreeze(body);
    return deepFreeze({
      ...body,
      artifact_ref: sha256(candidate.artifact_ref, `${path}.artifact_ref`, code),
    });
  }

  const keys = [
    "kind",
    "name",
    "version",
    "integrity",
    "version_metadata_protocol",
    "version_metadata_sha256",
    "provenance_attestation",
    "observation",
  ];
  exactKeys(candidate, withRef ? [...keys, "artifact_ref"] : keys, path, code);
  const name = text(candidate.name, `${path}.name`, code);
  const version = text(candidate.version, `${path}.version`, code);
  const integrity = sha512Sri(candidate.integrity, `${path}.integrity`, code);
  if (!NPM_NAME.test(name)) fail(code, `${path}.name is invalid`);
  if (!SEMVER.test(version)) fail(code, `${path}.version must be exact SemVer`);
  const body: NpmArtifactInput = {
    kind,
    name,
    version,
    integrity,
    version_metadata_protocol: protocolId(
      candidate.version_metadata_protocol,
      `${path}.version_metadata_protocol`,
      code,
    ),
    version_metadata_sha256: sha256(
      candidate.version_metadata_sha256,
      `${path}.version_metadata_sha256`,
      code,
    ),
    provenance_attestation: literal(
      candidate.provenance_attestation,
      NPM_PROVENANCE_STATES,
      `${path}.provenance_attestation`,
      code,
    ),
    observation: literal(
      candidate.observation,
      ARTIFACT_OBSERVATIONS,
      `${path}.observation`,
      code,
    ),
  };
  if (!withRef) return deepFreeze(body);
  return deepFreeze({
    ...body,
    artifact_ref: sha256(candidate.artifact_ref, `${path}.artifact_ref`, code),
  });
}

function parseManifestation(
  value: JsonValue,
  path: string,
  code: PrincipalityGeometryErrorCode,
  withRef: boolean,
): ManifestationInput | ManifestationReference {
  const candidate = record(value, path, code);
  const kind = literal(
    candidate.kind,
    ["protocol_digest", "external"],
    `${path}.kind`,
    code,
  );
  if (kind === "protocol_digest") {
    const keys = ["kind", "protocol", "content_ref"];
    exactKeys(candidate, withRef ? [...keys, "manifestation_ref"] : keys, path, code);
    const body: ManifestationInput = {
      kind,
      protocol: protocolId(candidate.protocol, `${path}.protocol`, code),
      content_ref: sha256(candidate.content_ref, `${path}.content_ref`, code),
    };
    if (!withRef) return deepFreeze(body);
    return deepFreeze({
      ...body,
      manifestation_ref: sha256(
        candidate.manifestation_ref,
        `${path}.manifestation_ref`,
        code,
      ),
    });
  }

  const keys = [
    "kind",
    "thread_ref",
    "artifact_ref",
    "disposition",
    "assertion",
    "verified_by_package",
    "state",
  ];
  exactKeys(candidate, withRef ? [...keys, "manifestation_ref"] : keys, path, code);
  const body: ManifestationInput = {
    kind,
    thread_ref: sha256(candidate.thread_ref, `${path}.thread_ref`, code),
    artifact_ref: sha256(candidate.artifact_ref, `${path}.artifact_ref`, code),
    disposition: literal(
      candidate.disposition,
      ["carry", "park", "release", "withdraw"],
      `${path}.disposition`,
      code,
    ),
    assertion: literal(
      candidate.assertion,
      ["caller_asserted"],
      `${path}.assertion`,
      code,
    ),
    verified_by_package: falseLiteral(
      candidate.verified_by_package,
      `${path}.verified_by_package`,
      code,
    ),
    state: literal(
      candidate.state,
      ["context_only", "review_required", "hold"],
      `${path}.state`,
      code,
    ),
  };
  if (!withRef) return deepFreeze(body);
  return deepFreeze({
    ...body,
    manifestation_ref: sha256(
      candidate.manifestation_ref,
      `${path}.manifestation_ref`,
      code,
    ),
  });
}

function parseInvariant(
  value: JsonValue,
  path: string,
  code: PrincipalityGeometryErrorCode,
): Readonly<InvariantDefinition> {
  const candidate = record(value, path, code);
  exactKeys(candidate, ["invariant_id", "definition_ref"], path, code);
  return deepFreeze({
    invariant_id: token(candidate.invariant_id, `${path}.invariant_id`, code),
    definition_ref: sha256(candidate.definition_ref, `${path}.definition_ref`, code),
  });
}

function parsePrincipality(
  value: JsonValue,
  path: string,
  code: PrincipalityGeometryErrorCode,
  withRef: boolean,
): PrincipalityInput | PrincipalityVertex {
  const candidate = record(value, path, code);
  const keys = [
    "principality_id",
    "kind",
    "definition_ref",
    "manifestations",
    "artifact_refs",
  ];
  exactKeys(candidate, withRef ? [...keys, "principality_ref"] : keys, path, code);
  const artifacts = array(
    candidate.artifact_refs,
    `${path}.artifact_refs`,
    GEOMETRY_LIMITS.artifacts_per_principality,
    code,
  )
    .map((entry, index) =>
      parseArtifact(entry, `${path}.artifact_refs[${index}]`, code, withRef),
    )
    .sort((a, b) => utf16Order(canonicalJson(a), canonicalJson(b)));
  if (new Set(artifacts.map((entry) => canonicalJson(entry))).size !== artifacts.length) {
    fail(code, `${path}.artifact_refs has a duplicate artifact`);
  }
  if (
    new Set(artifacts.map((entry) => artifactIdentityId(entry))).size !==
    artifacts.length
  ) {
    fail(code, `${path}.artifact_refs repeats one immutable artifact identity`);
  }
  const manifestations = array(
    candidate.manifestations,
    `${path}.manifestations`,
    GEOMETRY_LIMITS.manifestations_per_principality,
    code,
  )
    .map((entry, index) =>
      parseManifestation(entry, `${path}.manifestations[${index}]`, code, withRef),
    )
    .sort((a, b) => utf16Order(canonicalJson(a), canonicalJson(b)));
  if (
    new Set(manifestations.map((entry) => canonicalJson(entry))).size !==
    manifestations.length
  ) {
    fail(code, `${path}.manifestations has a duplicate`);
  }
  const external = manifestations.filter((entry) => entry.kind === "external");
  if (new Set(external.map((entry) => entry.thread_ref)).size !== external.length) {
    fail(code, `${path}.manifestations has a duplicate external thread_ref`);
  }
  if (new Set(external.map((entry) => entry.artifact_ref)).size !== external.length) {
    fail(code, `${path}.manifestations has a duplicate external artifact_ref`);
  }
  const body = {
    principality_id: token(
      candidate.principality_id,
      `${path}.principality_id`,
      code,
    ),
    kind: literal(candidate.kind, PRINCIPALITY_KINDS, `${path}.kind`, code),
    definition_ref: sha256(candidate.definition_ref, `${path}.definition_ref`, code),
    manifestations: deepFreeze(manifestations),
    artifact_refs: deepFreeze(artifacts),
  };
  if (!withRef) return deepFreeze(body as PrincipalityInput);
  return deepFreeze({
    ...body,
    principality_ref: sha256(
      candidate.principality_ref,
      `${path}.principality_ref`,
      code,
    ),
  } as PrincipalityVertex);
}

function parseEvaluation(
  value: JsonValue,
  path: string,
  code: PrincipalityGeometryErrorCode,
): Readonly<BridgeEvaluation> {
  const candidate = record(value, path, code);
  exactKeys(candidate, ["invariant_id", "state", "evidence_refs"], path, code);
  const state = literal(candidate.state, INVARIANT_STATES, `${path}.state`, code);
  const evidence = array(
    candidate.evidence_refs,
    `${path}.evidence_refs`,
    GEOMETRY_LIMITS.evidence_refs_per_evaluation,
    code,
  )
    .map((entry, index) => sha256(entry, `${path}.evidence_refs[${index}]`, code))
    .sort(utf16Order);
  if (new Set(evidence).size !== evidence.length) {
    fail(code, `${path}.evidence_refs has a duplicate`);
  }
  const invariantId = token(candidate.invariant_id, `${path}.invariant_id`, code);
  if (state === "preserved_reported" || state === "not_preserved_reported") {
    const [first, ...remaining] = evidence;
    if (!first) {
      fail(code, `${path}.evidence_refs is required for ${state}`);
    }
    return deepFreeze({
      invariant_id: invariantId,
      state,
      evidence_refs: deepFreeze(
        [first, ...remaining] as [Sha256Id, ...Sha256Id[]],
      ),
    });
  }
  if (evidence.length !== 0) {
    fail(code, `${path}.evidence_refs must be empty for ${state}`);
  }
  return deepFreeze({
    invariant_id: invariantId,
    state,
    evidence_refs: deepFreeze([] as []),
  });
}

function parseTranslation(
  value: JsonValue,
  path: string,
  code: PrincipalityGeometryErrorCode,
  withId: boolean,
): TranslationInput | TranslationBridge {
  const candidate = record(value, path, code);
  const keys = ["from", "to", "disposition", "evaluations"];
  exactKeys(
    candidate,
    withId ? ["bridge_id", "from_ref", "to_ref", ...keys] : keys,
    path,
    code,
  );
  const evaluations = array(
    candidate.evaluations,
    `${path}.evaluations`,
    GEOMETRY_LIMITS.invariants,
    code,
  )
    .map((entry, index) =>
      parseEvaluation(entry, `${path}.evaluations[${index}]`, code),
    )
    .sort((a, b) => utf16Order(a.invariant_id, b.invariant_id));
  if (new Set(evaluations.map((entry) => entry.invariant_id)).size !== evaluations.length) {
    fail(code, `${path}.evaluations has a duplicate invariant_id`);
  }
  const body: TranslationInput = {
    from: token(candidate.from, `${path}.from`, code),
    to: token(candidate.to, `${path}.to`, code),
    disposition: literal(
      candidate.disposition,
      BRIDGE_DISPOSITIONS,
      `${path}.disposition`,
      code,
    ),
    evaluations: deepFreeze(evaluations),
  };
  if (!withId) return deepFreeze(body);
  return deepFreeze({
    bridge_id: sha256(candidate.bridge_id, `${path}.bridge_id`, code),
    from_ref: sha256(candidate.from_ref, `${path}.from_ref`, code),
    to_ref: sha256(candidate.to_ref, `${path}.to_ref`, code),
    ...body,
  });
}

export interface ParsedInput {
  readonly _format: typeof INPUT_FORMAT;
  readonly scope_ref: Sha256Id;
  readonly invariants: readonly InvariantDefinition[];
  readonly principalities: readonly PrincipalityInput[];
  readonly translations: readonly TranslationInput[];
}

export function parseInput(value: unknown): Readonly<ParsedInput> {
  const snapshot = snapshotJson(value);
  canonicalJson(snapshot);
  const candidate = record(snapshot, "$", "input_error");
  exactKeys(
    candidate,
    ["_format", "scope_ref", "invariants", "principalities", "translations"],
    "$",
    "input_error",
  );
  const invariants = array(
    candidate.invariants,
    "$.invariants",
    GEOMETRY_LIMITS.invariants,
    "input_error",
  )
    .map((entry, index) => parseInvariant(entry, `$.invariants[${index}]`, "input_error"))
    .sort((a, b) => utf16Order(a.invariant_id, b.invariant_id));
  if (new Set(invariants.map((entry) => entry.invariant_id)).size !== invariants.length) {
    fail("input_error", "$.invariants has a duplicate invariant_id");
  }

  const principalities = array(
    candidate.principalities,
    "$.principalities",
    GEOMETRY_LIMITS.principalities,
    "input_error",
  )
    .map((entry, index) =>
      parsePrincipality(entry, `$.principalities[${index}]`, "input_error", false),
    )
    .sort((a, b) => utf16Order(a.principality_id, b.principality_id)) as PrincipalityInput[];
  const principalityIds = principalities.map((entry) => entry.principality_id);
  if (new Set(principalityIds).size !== principalityIds.length) {
    fail("input_error", "$.principalities has a duplicate principality_id");
  }
  const knownPrincipalityIds = new Set(principalityIds);

  const translations = array(
    candidate.translations,
    "$.translations",
    GEOMETRY_LIMITS.translations,
    "input_error",
  )
    .map((entry, index) =>
      parseTranslation(entry, `$.translations[${index}]`, "input_error", false),
    )
    .sort((a, b) => utf16Order(`${a.from}\0${a.to}`, `${b.from}\0${b.to}`)) as TranslationInput[];
  const pairs = new Set<string>();
  const invariantIds = invariants.map((entry) => entry.invariant_id);
  for (const [index, translation] of translations.entries()) {
    if (!knownPrincipalityIds.has(translation.from)) {
      fail("input_error", `$.translations[${index}].from is not a principality`);
    }
    if (!knownPrincipalityIds.has(translation.to)) {
      fail("input_error", `$.translations[${index}].to is not a principality`);
    }
    if (translation.from === translation.to) {
      fail("input_error", `$.translations[${index}] must not be a self-edge`);
    }
    const pair = `${translation.from}\0${translation.to}`;
    if (pairs.has(pair)) {
      fail("input_error", "$.translations has a duplicate directed pair");
    }
    pairs.add(pair);
    const actual = translation.evaluations.map((entry) => entry.invariant_id);
    if (
      actual.length !== invariantIds.length ||
      actual.some((entry, position) => entry !== invariantIds[position])
    ) {
      fail(
        "input_error",
        `$.translations[${index}].evaluations must cover every invariant exactly once`,
      );
    }
  }

  return deepFreeze({
    _format: literal(candidate._format, [INPUT_FORMAT], "$._format", "input_error"),
    scope_ref: sha256(candidate.scope_ref, "$.scope_ref", "input_error"),
    invariants: deepFreeze(invariants),
    principalities: deepFreeze(principalities),
    translations: deepFreeze(translations),
  });
}

export function reconstructInputFromAtlas(value: unknown): Readonly<ParsedInput> {
  const snapshot = snapshotJson(value);
  canonicalJson(snapshot);
  const candidate = record(snapshot, "$", "atlas_error");
  exactKeys(
    candidate,
    [
      "_format",
      "atlas_id",
      "scope_ref",
      "invariants",
      "principalities",
      "bridges",
      "geometry",
      "boundaries",
      "claim_boundary",
    ],
    "$",
    "atlas_error",
  );
  literal(candidate._format, [ATLAS_FORMAT], "$._format", "atlas_error");
  sha256(candidate.atlas_id, "$.atlas_id", "atlas_error");
  const invariants = array(
    candidate.invariants,
    "$.invariants",
    GEOMETRY_LIMITS.invariants,
    "atlas_error",
  ).map((entry, index) => parseInvariant(entry, `$.invariants[${index}]`, "atlas_error"));
  const principalities = array(
    candidate.principalities,
    "$.principalities",
    GEOMETRY_LIMITS.principalities,
    "atlas_error",
  ).map((entry, index) => {
    const parsed = parsePrincipality(
      entry,
      `$.principalities[${index}]`,
      "atlas_error",
      true,
    ) as PrincipalityVertex;
    const artifacts = parsed.artifact_refs.map(({ artifact_ref: _ref, ...body }) => body);
    const manifestations = parsed.manifestations.map(
      ({ manifestation_ref: _ref, ...body }) => body,
    );
    return {
      principality_id: parsed.principality_id,
      kind: parsed.kind,
      definition_ref: parsed.definition_ref,
      manifestations,
      artifact_refs: artifacts,
    } satisfies PrincipalityInput;
  });
  const translations = array(
    candidate.bridges,
    "$.bridges",
    GEOMETRY_LIMITS.translations,
    "atlas_error",
  ).map((entry, index) => {
    const parsed = parseTranslation(
      entry,
      `$.bridges[${index}]`,
      "atlas_error",
      true,
    ) as TranslationBridge;
    const {
      bridge_id: _bridgeId,
      from_ref: _fromRef,
      to_ref: _toRef,
      ...body
    } = parsed;
    return body;
  });
  return parseInput({
    _format: INPUT_FORMAT,
    scope_ref: sha256(candidate.scope_ref, "$.scope_ref", "atlas_error"),
    invariants,
    principalities,
    translations,
  } satisfies CreatePrincipalityGeometryInput);
}

export function artifactReference(input: ArtifactInput): ArtifactReference {
  return deepFreeze({
    ...input,
    artifact_ref: artifactIdentityId(input),
  } as ArtifactReference);
}

function artifactIdentityId(input: ArtifactInput | ArtifactReference): Sha256Id {
  const body =
    input.kind === "huggingface"
      ? {
          kind: input.kind,
          repo_type: input.repo_type,
          repo_id: input.repo_id,
          revision: input.revision,
          snapshot_manifest_protocol: input.snapshot_manifest_protocol,
          snapshot_manifest_sha256: input.snapshot_manifest_sha256,
        }
      : {
          kind: input.kind,
          name: input.name,
          version: input.version,
          integrity: input.integrity,
          version_metadata_protocol: input.version_metadata_protocol,
          version_metadata_sha256: input.version_metadata_sha256,
        };
  return domainSeparatedId("agenttool.principality-artifact/0.1", body);
}

export function manifestationReference(
  input: ManifestationInput,
): ManifestationReference {
  return deepFreeze({
    ...input,
    manifestation_ref: domainSeparatedId(
      "agenttool.principality-manifestation/0.1",
      input,
    ),
  } as ManifestationReference);
}
