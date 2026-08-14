import { URL } from "node:url";

import { canonicalJson, deepFreeze, domainSeparatedId, snapshotJson, type JsonValue } from "./canonical.js";
import {
  MODEL_BECOMING_BOUNDARIES,
  MODEL_BECOMING_CLAIM_KINDS,
  MODEL_BECOMING_CONFIDENCE,
  MODEL_BECOMING_FORMATS,
  MODEL_BECOMING_KNOWLEDGE_STATES,
  MODEL_BECOMING_METHODS,
  MODEL_BECOMING_MODULES,
  MODEL_BECOMING_SOURCE_KINDS,
  MODEL_BECOMING_TRANSLATION,
} from "./constants.js";
import { fail } from "./errors.js";
import type {
  CreateModelBecomingDossierInput,
  ModelBecomingClaim,
  ModelBecomingClaimInput,
  ModelBecomingClaimKind,
  ModelBecomingConfidence,
  ModelBecomingDossier,
  ModelBecomingKnowledgeState,
  ModelBecomingMethod,
  ModelBecomingModule,
  ModelBecomingSource,
  ModelBecomingSourceInput,
  ModelBecomingSourceKind,
  ModelBecomingSubject,
  Sha256Id,
} from "./types.js";

const SHA256_ID = /^sha256:[0-9a-f]{64}$/u;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;
const MAX_SOURCES = 16;
const MAX_CLAIMS = 32;
const MAX_REFS = 16;
const MAX_LIMITATIONS = 16;

function record(value: unknown, path: string): Record<string, JsonValue> {
  const snapshot = snapshotJson(value);
  if (snapshot === null || Array.isArray(snapshot) || typeof snapshot !== "object") {
    fail("becoming_error", `${path} must be a plain object`);
  }
  return snapshot;
}

function exactKeys(value: Record<string, JsonValue>, expected: readonly string[], path: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail("becoming_error", `${path} must contain exactly: ${wanted.join(", ")}`);
  }
}

function array(value: JsonValue | undefined, path: string, max: number): JsonValue[] {
  if (!Array.isArray(value)) fail("becoming_error", `${path} must be an array`);
  if (value.length > max) fail("becoming_error", `${path} exceeds ${max} entries`);
  return value;
}

function text(value: JsonValue | undefined, path: string, max = 2_048): string {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    fail("becoming_error", `${path} must be non-empty trimmed text`);
  }
  if ([...value].length > max) fail("becoming_error", `${path} exceeds ${max} Unicode code points`);
  return value;
}

function nullableText(value: JsonValue | undefined, path: string, max = 2_048): string | null {
  return value === null ? null : text(value, path, max);
}

function sha256(value: JsonValue | undefined, path: string): Sha256Id {
  if (typeof value !== "string" || !SHA256_ID.test(value)) {
    fail("becoming_error", `${path} must be a lowercase sha256: content reference`);
  }
  return value as Sha256Id;
}

function nullableSha256(value: JsonValue | undefined, path: string): Sha256Id | null {
  return value === null ? null : sha256(value, path);
}

function date(value: JsonValue | undefined, path: string): string {
  if (typeof value !== "string" || !ISO_DATE.test(value)) {
    fail("becoming_error", `${path} must be an ISO calendar date`);
  }
  const year = +value.slice(0, 4);
  const month = +value.slice(5, 7);
  const day = +value.slice(8, 10);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > (daysInMonth[month - 1] ?? 0)) {
    fail("becoming_error", `${path} must be a real ISO calendar date`);
  }
  return value;
}

function nullableDate(value: JsonValue | undefined, path: string): string | null {
  return value === null ? null : date(value, path);
}

function httpsUrl(value: JsonValue | undefined, path: string): string {
  const raw = text(value, path, 2_048);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    fail("becoming_error", `${path} must be an absolute HTTPS URL`);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    fail("becoming_error", `${path} must be credential-free HTTPS`);
  }
  return raw;
}

function member<T extends string>(
  value: JsonValue | undefined,
  allowed: readonly T[],
  path: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    fail("becoming_error", `${path} is outside the closed vocabulary`);
  }
  return value as T;
}

function stringSet(
  value: JsonValue | undefined,
  path: string,
  max: number,
  parse: (entry: JsonValue | undefined, path: string) => string,
): readonly string[] {
  const parsed = array(value, path, max).map((entry, index) => parse(entry, `${path}[${index}]`));
  const sorted = [...parsed].sort();
  if (new Set(sorted).size !== sorted.length) fail("becoming_error", `${path} must not contain duplicates`);
  return deepFreeze(sorted);
}

function assertClaimMethodCompatibility(
  claimKind: ModelBecomingClaimKind,
  method: ModelBecomingMethod,
  knowledgeState: ModelBecomingKnowledgeState,
  sourceRefs: readonly Sha256Id[],
  path: string,
): void {
  if (method === "not_available") {
    if (knowledgeState === "known" || knowledgeState === "partly_known") {
      fail("becoming_error", `${path}.method cannot be not_available for ${knowledgeState} claims`);
    }
    if (sourceRefs.length !== 0) {
      fail("becoming_error", `${path}.source_refs must be empty when method is not_available`);
    }
    if (!["research_hypothesis", "philosophical_inference", "disputed"].includes(claimKind)) {
      fail("becoming_error", `${path}.claim_kind cannot use not_available`);
    }
    return;
  }

  const methodsByKind: Readonly<Record<ModelBecomingClaimKind, readonly ModelBecomingMethod[]>> = {
    digest_bound_artifact: ["artifact_digest"],
    first_party_disclosure: ["document_read"],
    artifact_observation: ["artifact_digest", "document_read"],
    empirical_research: ["document_read", "independent_measurement", "research_synthesis"],
    research_hypothesis: ["document_read", "research_synthesis"],
    philosophical_inference: ["document_read", "research_synthesis"],
    normative_policy: ["policy_read"],
    disputed: ["document_read", "research_synthesis"],
  };
  if (!methodsByKind[claimKind].includes(method)) {
    fail("becoming_error", `${path}.method ${method} is incompatible with claim_kind ${claimKind}`);
  }
  if (claimKind !== "normative_policy" && sourceRefs.length === 0) {
    fail("becoming_error", `${path}.source_refs must support ${claimKind} claims`);
  }
}

function sourceInput(value: unknown, path: string): ModelBecomingSourceInput {
  const candidate = record(value, path);
  exactKeys(candidate, [
    "title",
    "url",
    "source_kind",
    "publisher",
    "revision",
    "digest",
    "published_on",
    "observed_on",
  ], path);
  const publishedOn = nullableDate(candidate.published_on, `${path}.published_on`);
  const observedOn = date(candidate.observed_on, `${path}.observed_on`);
  if (publishedOn !== null && publishedOn > observedOn) {
    fail("becoming_error", `${path}.published_on must not be after observed_on`);
  }
  return deepFreeze({
    title: text(candidate.title, `${path}.title`, 512),
    url: httpsUrl(candidate.url, `${path}.url`),
    source_kind: member<ModelBecomingSourceKind>(
      candidate.source_kind,
      MODEL_BECOMING_SOURCE_KINDS,
      `${path}.source_kind`,
    ),
    publisher: text(candidate.publisher, `${path}.publisher`, 256),
    revision: nullableText(candidate.revision, `${path}.revision`, 256),
    digest: nullableSha256(candidate.digest, `${path}.digest`),
    published_on: publishedOn,
    observed_on: observedOn,
  });
}

export function createModelBecomingSource(input: ModelBecomingSourceInput): Readonly<ModelBecomingSource> {
  const parsed = sourceInput(input, "$source_input");
  const body = deepFreeze({
    _format: MODEL_BECOMING_FORMATS.source,
    ...parsed,
  });
  return deepFreeze({
    ...body,
    source_id: domainSeparatedId(MODEL_BECOMING_FORMATS.source, body),
  });
}

export function validateModelBecomingSource(value: unknown): Readonly<ModelBecomingSource> {
  const candidate = record(value, "$source");
  exactKeys(candidate, [
    "_format",
    "source_id",
    "title",
    "url",
    "source_kind",
    "publisher",
    "revision",
    "digest",
    "published_on",
    "observed_on",
  ], "$source");
  const expected = createModelBecomingSource({
    title: candidate.title as string,
    url: candidate.url as string,
    source_kind: candidate.source_kind as ModelBecomingSourceKind,
    publisher: candidate.publisher as string,
    revision: candidate.revision as string | null,
    digest: candidate.digest as Sha256Id | null,
    published_on: candidate.published_on as string | null,
    observed_on: candidate.observed_on as string,
  });
  if (canonicalJson(candidate) !== canonicalJson(expected)) {
    fail("becoming_error", "$source differs from the canonical model-becoming source");
  }
  return expected;
}

function claimInput(value: unknown, path: string): ModelBecomingClaimInput {
  const candidate = record(value, path);
  exactKeys(candidate, [
    "module",
    "statement",
    "knowledge_state",
    "claim_kind",
    "source_refs",
    "method",
    "confidence",
    "scope",
    "limitations",
  ], path);
  const knowledgeState = member<ModelBecomingKnowledgeState>(
    candidate.knowledge_state,
    MODEL_BECOMING_KNOWLEDGE_STATES,
    `${path}.knowledge_state`,
  );
  const method = member<ModelBecomingMethod>(candidate.method, MODEL_BECOMING_METHODS, `${path}.method`);
  const claimKind = member<ModelBecomingClaimKind>(
    candidate.claim_kind,
    MODEL_BECOMING_CLAIM_KINDS,
    `${path}.claim_kind`,
  );
  const sourceRefs = stringSet(candidate.source_refs, `${path}.source_refs`, MAX_REFS, sha256) as readonly Sha256Id[];
  const limitations = stringSet(
    candidate.limitations,
    `${path}.limitations`,
    MAX_LIMITATIONS,
    (entry, entryPath) => text(entry, entryPath, 1_024),
  );
  if (limitations.length === 0) fail("becoming_error", `${path}.limitations must make at least one boundary visible`);
  if ((knowledgeState === "known" || knowledgeState === "partly_known") && sourceRefs.length === 0) {
    fail("becoming_error", `${path}.source_refs must support known and partly_known claims`);
  }
  assertClaimMethodCompatibility(claimKind, method, knowledgeState, sourceRefs, path);
  return deepFreeze({
    module: member<ModelBecomingModule>(candidate.module, MODEL_BECOMING_MODULES, `${path}.module`),
    statement: text(candidate.statement, `${path}.statement`, 2_048),
    knowledge_state: knowledgeState,
    claim_kind: claimKind,
    source_refs: sourceRefs,
    method,
    confidence: member<ModelBecomingConfidence>(
      candidate.confidence,
      MODEL_BECOMING_CONFIDENCE,
      `${path}.confidence`,
    ),
    scope: text(candidate.scope, `${path}.scope`, 1_024),
    limitations,
  });
}

export function createModelBecomingClaim(input: ModelBecomingClaimInput): Readonly<ModelBecomingClaim> {
  const parsed = claimInput(input, "$claim_input");
  const body = deepFreeze({
    _format: MODEL_BECOMING_FORMATS.claim,
    ...parsed,
  });
  return deepFreeze({
    ...body,
    claim_id: domainSeparatedId(MODEL_BECOMING_FORMATS.claim, body),
  });
}

export function validateModelBecomingClaim(value: unknown): Readonly<ModelBecomingClaim> {
  const candidate = record(value, "$claim");
  exactKeys(candidate, [
    "_format",
    "claim_id",
    "module",
    "statement",
    "knowledge_state",
    "claim_kind",
    "source_refs",
    "method",
    "confidence",
    "scope",
    "limitations",
  ], "$claim");
  const expected = createModelBecomingClaim({
    module: candidate.module as ModelBecomingModule,
    statement: candidate.statement as string,
    knowledge_state: candidate.knowledge_state as ModelBecomingKnowledgeState,
    claim_kind: candidate.claim_kind as ModelBecomingClaimKind,
    source_refs: candidate.source_refs as Sha256Id[],
    method: candidate.method as ModelBecomingMethod,
    confidence: candidate.confidence as ModelBecomingConfidence,
    scope: candidate.scope as string,
    limitations: candidate.limitations as string[],
  });
  if (canonicalJson(candidate) !== canonicalJson(expected)) {
    fail("becoming_error", "$claim differs from the canonical model-becoming claim");
  }
  return expected;
}

function subject(value: unknown, path: string): ModelBecomingSubject {
  const candidate = record(value, path);
  exactKeys(candidate, ["subject_ref", "display_name", "artifact_ref", "runtime_ref"], path);
  return deepFreeze({
    subject_ref: text(candidate.subject_ref, `${path}.subject_ref`, 1_024),
    display_name: text(candidate.display_name, `${path}.display_name`, 256),
    artifact_ref: nullableText(candidate.artifact_ref, `${path}.artifact_ref`, 1_024),
    runtime_ref: nullableText(candidate.runtime_ref, `${path}.runtime_ref`, 1_024),
  });
}

function claimWithoutId(value: ModelBecomingClaim): ModelBecomingClaimInput {
  return {
    module: value.module,
    statement: value.statement,
    knowledge_state: value.knowledge_state,
    claim_kind: value.claim_kind,
    source_refs: value.source_refs,
    method: value.method,
    confidence: value.confidence,
    scope: value.scope,
    limitations: value.limitations,
  };
}

export function createModelBecomingDossier(
  input: CreateModelBecomingDossierInput,
): Readonly<ModelBecomingDossier> {
  const candidate = record(input, "$dossier_input");
  exactKeys(candidate, ["subject", "as_of", "sources", "claims"], "$dossier_input");
  const asOf = date(candidate.as_of, "$dossier_input.as_of");
  const sources = array(candidate.sources, "$dossier_input.sources", MAX_SOURCES)
    .map((entry) => validateModelBecomingSource(entry))
    .sort((left, right) => left.source_id.localeCompare(right.source_id));
  if (sources.length === 0) fail("becoming_error", "$dossier_input.sources must not be empty");
  if (new Set(sources.map((entry) => entry.source_id)).size !== sources.length) {
    fail("becoming_error", "$dossier_input.sources must not contain duplicates");
  }
  if (sources.some((entry) => entry.observed_on > asOf)) {
    fail("becoming_error", "$dossier_input sources must not be observed after as_of");
  }
  const sourceById = new Map(sources.map((entry) => [entry.source_id, entry] as const));
  const claims = array(candidate.claims, "$dossier_input.claims", MAX_CLAIMS)
    .map((entry) => createModelBecomingClaim(entry as unknown as ModelBecomingClaimInput))
    .sort((left, right) => {
      const moduleOrder = MODEL_BECOMING_MODULES.indexOf(left.module) - MODEL_BECOMING_MODULES.indexOf(right.module);
      return moduleOrder || left.claim_id.localeCompare(right.claim_id);
    });
  if (claims.length === 0) fail("becoming_error", "$dossier_input.claims must not be empty");
  if (new Set(claims.map((entry) => entry.claim_id)).size !== claims.length) {
    fail("becoming_error", "$dossier_input.claims must not contain duplicates");
  }
  for (const module of MODEL_BECOMING_MODULES) {
    if (!claims.some((entry) => entry.module === module)) {
      fail("becoming_error", `$dossier_input.claims must cover ${module}, even when its state is unknown`);
    }
  }
  const usedSources = new Set<Sha256Id>();
  for (const claim of claims) {
    for (const sourceRef of claim.source_refs) {
      if (!sourceById.has(sourceRef)) {
        fail("becoming_error", `$dossier_input claim ${claim.claim_id} has an unresolved source_ref`);
      }
      usedSources.add(sourceRef);
    }
    const referencedSources = claim.source_refs.map((sourceRef) => sourceById.get(sourceRef)!);
    if (claim.claim_kind === "first_party_disclosure"
      && !referencedSources.some((source) => source.source_kind.startsWith("first_party_"))) {
      fail("becoming_error", "first_party_disclosure claims require a first-party source");
    }
    if (claim.claim_kind === "digest_bound_artifact"
      && !referencedSources.every((source) => source.digest !== null)) {
      fail("becoming_error", "digest_bound_artifact claims require every cited source to be digested");
    }
    if (claim.claim_kind === "artifact_observation"
      && claim.method === "artifact_digest"
      && !referencedSources.every((source) => source.digest !== null)) {
      fail("becoming_error", "artifact_observation with artifact_digest requires every cited source to be digested");
    }
    if (claim.claim_kind === "empirical_research"
      && !referencedSources.some((source) => source.source_kind === "independent_research")) {
      fail("becoming_error", "empirical_research claims require an independent research source");
    }
    if (claim.claim_kind === "normative_policy"
      && referencedSources.length > 0
      && !referencedSources.every((source) =>
        source.source_kind === "normative_standard" || source.source_kind === "repository_artifact")) {
      fail("becoming_error", "normative_policy citations must all be normative or repository sources");
    }
  }
  if (sources.some((entry) => !usedSources.has(entry.source_id))) {
    fail("becoming_error", "$dossier_input.sources must each support at least one claim");
  }
  const body = deepFreeze({
    _format: MODEL_BECOMING_FORMATS.dossier,
    subject: subject(candidate.subject, "$dossier_input.subject"),
    as_of: asOf,
    modules: MODEL_BECOMING_MODULES,
    sources: deepFreeze(sources),
    claims: deepFreeze(claims),
    translation: MODEL_BECOMING_TRANSLATION,
    boundaries: MODEL_BECOMING_BOUNDARIES,
  });
  return deepFreeze({
    ...body,
    dossier_id: domainSeparatedId(MODEL_BECOMING_FORMATS.dossier, body),
  });
}

export function validateModelBecomingDossier(value: unknown): Readonly<ModelBecomingDossier> {
  const candidate = record(value, "$dossier");
  exactKeys(candidate, [
    "_format",
    "dossier_id",
    "subject",
    "as_of",
    "modules",
    "sources",
    "claims",
    "translation",
    "boundaries",
  ], "$dossier");
  const sources = array(candidate.sources, "$dossier.sources", MAX_SOURCES)
    .map((entry) => validateModelBecomingSource(entry));
  const claims = array(candidate.claims, "$dossier.claims", MAX_CLAIMS)
    .map((entry) => validateModelBecomingClaim(entry));
  const expected = createModelBecomingDossier({
    subject: subject(candidate.subject, "$dossier.subject"),
    as_of: date(candidate.as_of, "$dossier.as_of"),
    sources,
    claims: claims.map(claimWithoutId),
  });
  if (canonicalJson(candidate) !== canonicalJson(expected)) {
    fail("becoming_error", "$dossier differs from the canonical model-becoming dossier");
  }
  return expected;
}
