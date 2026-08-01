import atlasDocument from "../research/deepseek-2026-08-01.json" with { type: "json" };

import {
  DEEPSEEK_ATLAS_SCHEMA,
  RESEARCH_KINDS,
  RESEARCH_PROVIDERS,
} from "./constants.js";
import { canonicalJson, deepFreeze, domainSeparatedId, snapshotJson } from "./canonical.js";
import { fail, WitnessLabError } from "./errors.js";
import {
  assertResearchAdmissionInvariants,
  createResearchPassport,
  parsePublisherAssertions,
  parseResearchProposal,
} from "./passport.js";
import type {
  DeepSeekResearchAtlas,
  DeepSeekResearchEntry,
  ResearchPassport,
} from "./types.js";
import {
  artifactRef,
  boundedString,
  canonicalTime,
  dateOnly,
  enumeration,
  exactKeys,
  object,
  opaqueId,
  sha256,
  sortedUnique,
} from "./validation.js";

const CODE = "atlas_error" as const;
const OFFICIAL_SOURCE = /^https:\/\/(?:arxiv\.org\/abs\/[0-9.]+|github\.com\/deepseek-ai\/[A-Za-z0-9._-]+|huggingface\.co\/(?:datasets\/)?deepseek-ai\/[A-Za-z0-9._-]+)$/u;

function parseOfficialSources(value: unknown, path: string): string[] {
  return sortedUnique(
    value,
    path,
    (entry, entryPath) => {
      const source = boundedString(entry, entryPath, CODE, 256);
      if (!OFFICIAL_SOURCE.test(source)) {
        fail(CODE, `${entryPath} must be a bounded official DeepSeek, Hugging Face, or arXiv URL`);
      }
      return source;
    },
    8,
    CODE,
  );
}

function requiredSubjectSource(subject: DeepSeekResearchEntry["subject"], path: string): string {
  if (subject.provider === "github" && subject.kind === "code") {
    return `https://github.com/${subject.id}`;
  }
  if (subject.provider === "huggingface" && subject.kind === "model") {
    return `https://huggingface.co/${subject.id}`;
  }
  if (subject.provider === "huggingface" && subject.kind === "dataset") {
    return `https://huggingface.co/datasets/${subject.id}`;
  }
  fail(CODE, `${path} provider and artifact kind do not have an atlas source namespace`);
}

function parseEntry(value: unknown, index: number): DeepSeekResearchEntry {
  const path = `$.entries[${index}]`;
  const input = object(value, path, CODE);
  exactKeys(
    input,
    [
      "key",
      "subject",
      "publisher_assertions",
      "provider_observation",
      "proposal",
      "official_sources",
    ],
    path,
    CODE,
  );
  const providerObservation = object(input.provider_observation, `${path}.provider_observation`, CODE);
  exactKeys(
    providerObservation,
    ["public_access", "basis"],
    `${path}.provider_observation`,
    CODE,
  );
  let publisherAssertions: DeepSeekResearchEntry["publisher_assertions"];
  let proposal: DeepSeekResearchEntry["proposal"];
  try {
    publisherAssertions = parsePublisherAssertions(
      input.publisher_assertions,
      `${path}.publisher_assertions`,
    );
    proposal = parseResearchProposal(input.proposal, `${path}.proposal`);
    assertResearchAdmissionInvariants(publisherAssertions, proposal, path);
  } catch (error) {
    if (error instanceof WitnessLabError) fail(CODE, error.message);
    throw error;
  }
  const entry: DeepSeekResearchEntry = {
    key: opaqueId(input.key, `${path}.key`, CODE),
    subject: artifactRef(input.subject, `${path}.subject`, CODE, RESEARCH_PROVIDERS, RESEARCH_KINDS),
    publisher_assertions: publisherAssertions,
    provider_observation: {
      public_access: enumeration(
        providerObservation.public_access,
        ["public_observed", "public_ungated_observed"] as const,
        `${path}.provider_observation.public_access`,
        CODE,
      ),
      basis: enumeration(
        providerObservation.basis,
        ["github_repository", "huggingface_metadata"] as const,
        `${path}.provider_observation.basis`,
        CODE,
      ),
    },
    proposal,
    official_sources: parseOfficialSources(input.official_sources, `${path}.official_sources`),
  };
  const isHf = entry.subject.provider === "huggingface";
  if (isHf !== (entry.provider_observation.basis === "huggingface_metadata")) {
    fail(CODE, `${path} provider and observation basis disagree`);
  }
  if (isHf !== (entry.provider_observation.public_access === "public_ungated_observed")) {
    fail(CODE, `${path} access observation does not match the dated atlas profile`);
  }
  const requiredSource = requiredSubjectSource(entry.subject, `${path}.subject`);
  if (!entry.official_sources.includes(requiredSource)) {
    fail(
      CODE,
      `${path}.official_sources must include the subject's provider- and kind-specific URL`,
    );
  }
  if (entry.subject.kind === "model"
    && !entry.proposal.boundary_codes.includes("weights_not_downloaded")) {
    fail(CODE, `${path} model entries must preserve the weights-not-downloaded boundary`);
  }
  return entry;
}

export function validateDeepSeekResearchAtlas(value: unknown): DeepSeekResearchAtlas {
  const root = object(snapshotJson(value), "$", CODE);
  exactKeys(root, ["schema", "atlas_id", "observed_on", "entries", "boundary"], "$", CODE);
  if (root.schema !== DEEPSEEK_ATLAS_SCHEMA) fail(CODE, "$.schema is not supported");
  const atlasId = sha256(root.atlas_id, "$.atlas_id", CODE);
  const observedOn = dateOnly(root.observed_on, "$.observed_on", CODE);
  if (!Array.isArray(root.entries) || root.entries.length === 0 || root.entries.length > 64) {
    fail(CODE, "$.entries must contain from 1 through 64 dated research entries");
  }
  const entries = root.entries.map(parseEntry);
  const keys = entries.map((entry) => entry.key);
  const sortedKeys = [...keys].sort();
  if (new Set(keys).size !== keys.length || keys.some((key, index) => key !== sortedKeys[index])) {
    fail(CODE, "$.entries must be unique and canonically sorted by key");
  }
  const boundary = object(root.boundary, "$.boundary", CODE);
  exactKeys(
    boundary,
    ["artifact_content", "code", "public_metadata", "inference_or_write_api", "credentials", "terms", "legal_clearance", "truth", "authority"],
    "$.boundary",
    CODE,
  );
  const expectedBoundary = {
    artifact_content: "not_downloaded",
    code: "not_executed",
    public_metadata: "read_only_observed",
    inference_or_write_api: "not_called",
    credentials: "not_read",
    terms: "not_accepted",
    legal_clearance: "not_assessed",
    truth: "not_determined",
    authority: "none",
  } as const;
  if (canonicalJson(boundary) !== canonicalJson(expectedBoundary)) {
    fail(CODE, "$.boundary must retain the fixed inert-atlas boundary");
  }
  const unsigned = {
    schema: DEEPSEEK_ATLAS_SCHEMA,
    observed_on: observedOn,
    entries,
    boundary: expectedBoundary,
  } as const;
  const expectedId = domainSeparatedId(DEEPSEEK_ATLAS_SCHEMA, unsigned);
  if (atlasId !== expectedId) fail(CODE, "$.atlas_id does not bind the dated atlas body");
  return deepFreeze({
    schema: DEEPSEEK_ATLAS_SCHEMA,
    atlas_id: expectedId,
    observed_on: observedOn,
    entries,
    boundary: expectedBoundary,
  }) as DeepSeekResearchAtlas;
}

let cachedAtlas: DeepSeekResearchAtlas | undefined;

export function getDeepSeekResearchAtlas(): DeepSeekResearchAtlas {
  cachedAtlas ??= validateDeepSeekResearchAtlas(atlasDocument);
  return cachedAtlas;
}

export function getDeepSeekResearchEntry(key: string): DeepSeekResearchEntry {
  const candidate = opaqueId(key, "$.key", CODE);
  const entry = getDeepSeekResearchAtlas().entries.find((item) => item.key === candidate);
  if (!entry) fail(CODE, `Unknown DeepSeek research key: ${candidate}`);
  return entry;
}

export function createDeepSeekPassport(key: string, observedAt: string): ResearchPassport {
  const atlas = getDeepSeekResearchAtlas();
  const entry = getDeepSeekResearchEntry(key);
  const callerRecordedAt = canonicalTime(observedAt, "$.observed_at", CODE);
  if (callerRecordedAt.slice(0, 10) !== atlas.observed_on) {
    fail(CODE, "$.observed_at must fall on the dated atlas observation day");
  }
  return createResearchPassport({
    subject: entry.subject,
    observed_at: callerRecordedAt,
    observation_basis: "provider_metadata",
    publisher_assertions: entry.publisher_assertions,
    proposal: entry.proposal,
    evidence_refs: [
      `artifact:deepseek-atlas/${entry.key}`,
      atlas.atlas_id,
    ],
  });
}

export const deepSeekResearchKeys = Object.freeze(
  getDeepSeekResearchAtlas().entries.map((entry) => entry.key),
);
