import {
  ARTIFACT_SCHEMA,
  DEFAULT_LIMITS,
  REPORT_SCHEMA,
  SEARCH_SCHEMA,
  TOOL_NAME,
  TOOL_VERSION,
} from "./constants.js";
import { HfScoutError, invariant } from "./errors.js";
import { createHfReleaseReconciliation } from "./projection.js";
import { classifyHubReaderTransport } from "./public-hub-reader.js";
import type {
  HfArtifactSnapshot,
  HfBoundaryCode,
  HfDeclaredMetadata,
  HfDiagnostic,
  HfDiagnosticCode,
  HfFileCommitment,
  HfRepoKind,
  HfLocalVerificationReport,
  HfReleaseReconciliationReport,
  HfReleaseSourceDeclaration,
  HfScoutLimits,
  HfScoutReport,
  HfSearchHit,
  PublicHubRepoKind,
  HfSearchReport,
  HubReader,
  HubReaderTransport,
} from "./types.js";
import {
  asPlainObject,
  compareUnicode,
  effectiveLimits,
  normalizeFullSha,
  normalizeObservedAt,
  normalizeQuery,
  normalizeRepoId,
  normalizeSha1,
  normalizeSha256,
  optionalPlainObject,
  safeInteger,
  safeRelativeHubPath,
  safeRemoteString,
} from "./validation.js";

export interface InspectHfRepositoryInput {
  kind: HfRepoKind;
  id: string;
  revision?: string;
}

export interface ReconcileHfReleaseInput {
  kind: PublicHubRepoKind;
  id: string;
  release_revision: string;
  source_declaration?: HfReleaseSourceDeclaration;
  local_verification?: HfLocalVerificationReport;
}

export interface SearchHfRepositoriesInput {
  kind: HfRepoKind;
  query: string;
  limit?: number;
}

export interface HfScoutOptions {
  reader: HubReader;
  observed_at?: string;
  clock?: () => Date;
  limits?: Partial<HfScoutLimits>;
  signal?: AbortSignal;
}

export async function inspectHfRepository(
  input: InspectHfRepositoryInput,
  options: HfScoutOptions,
): Promise<HfScoutReport> {
  const id = normalizeRepoId(input.kind, input.id);
  const requestedRevision = input.revision === undefined
    ? null
    : requireFullRevision(input.revision);
  const observedAt = resolveObservedAt(options);
  const limits = effectiveLimits(DEFAULT_LIMITS, options.limits);
  validateReader(options.reader);
  const transport = classifyHubReaderTransport(options.reader);
  const raw = await readerCall(
    transport,
    () => options.reader.inspect({
      kind: input.kind,
      id,
      ...(requestedRevision ? { revision: requestedRevision } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    }),
  );
  const { snapshot, diagnostics } = normalizeSnapshot(
    input.kind,
    id,
    raw,
    limits,
    transport,
    requestedRevision,
  );
  return {
    schema: REPORT_SCHEMA,
    tool: { name: TOOL_NAME, version: TOOL_VERSION },
    operation: "inspect",
    observed_at: observedAt,
    status: diagnostics.length ? "partial" : "observed",
    transport: transport === "public_hub_api"
      ? {
          kind: "public_hub_api",
          requested_effect: "read_only",
          credentials: "omit_requested",
          retries: 0,
          response_body: "bounded",
        }
      : {
          kind: "injected",
          requested_effect: "read_only",
          credentials: "caller_owned",
          retries: "caller_owned",
          response_body: "caller_owned",
        },
    snapshot,
    diagnostics,
  };
}

export async function reconcileHfRelease(
  input: ReconcileHfReleaseInput,
  options: HfScoutOptions,
): Promise<HfReleaseReconciliationReport> {
  const kind = input.kind;
  invariant(
    kind === "model" || kind === "dataset" || kind === "space",
    "unsupported_reconciliation_kind",
    "release reconciliation supports model, dataset, or space repositories",
  );
  const id = normalizeRepoId(kind, input.id);
  const releaseRevision = requireFullRevision(input.release_revision);
  const observedAt = resolveObservedAt(options);
  const sharedOptions: HfScoutOptions = {
    ...options,
    observed_at: observedAt,
  };
  const releaseReport = await inspectHfRepository(
    { kind, id, revision: releaseRevision },
    sharedOptions,
  );
  const headReport = await inspectHfRepository({ kind, id }, sharedOptions);
  return createHfReleaseReconciliation({
    release_report: releaseReport,
    head_report: headReport,
    ...(input.source_declaration !== undefined
      ? { source_declaration: input.source_declaration }
      : {}),
    ...(input.local_verification !== undefined
      ? { local_verification: input.local_verification }
      : {}),
  });
}

export async function searchHfRepositories(
  input: SearchHfRepositoriesInput,
  options: HfScoutOptions,
): Promise<HfSearchReport> {
  const query = normalizeQuery(input.query);
  const observedAt = resolveObservedAt(options);
  const limits = effectiveLimits(DEFAULT_LIMITS, options.limits);
  const limit = input.limit ?? Math.min(10, limits.max_search_results);
  invariant(
    Number.isSafeInteger(limit) && limit > 0 && limit <= limits.max_search_results,
    "invalid_limit",
    "search limit is invalid",
  );
  validateReader(options.reader);
  const transport = classifyHubReaderTransport(options.reader);
  const raw = await readerCall(
    transport,
    () => options.reader.search({
      kind: input.kind,
      query,
      limit,
      ...(options.signal ? { signal: options.signal } : {}),
    }),
  );
  invariant(Array.isArray(raw), "invalid_hub_response", "Hub search response has an unsupported shape");

  const diagnostics: HfDiagnostic[] = [];
  let omitted = 0;
  let metadataTruncated = false;
  const hits: HfSearchHit[] = [];
  for (const entry of raw.slice(0, limit)) {
    try {
      const object = asPlainObject(entry);
      const remoteId = readRemoteId(object);
      if (!remoteId) {
        omitted += 1;
        continue;
      }
      const id = normalizeRepoId(input.kind, remoteId);
      const tags = normalizeTags(object.tags, limits.max_tags);
      const declared = declaredMetadata(object, tags.values, limits.max_tags);
      metadataTruncated ||= tags.truncated || tags.omitted || declared.relationsTruncated;
      hits.push({
        kind: input.kind,
        id,
        full_sha: normalizeFullSha(object.sha),
        license_declared: declared.metadata.license,
        task_declared: declared.metadata.task,
        library_declared: declared.metadata.library,
        gated_declared: declared.metadata.gated,
        private_observed: declared.metadata.private,
      });
    } catch {
      omitted += 1;
    }
  }
  if (raw.length > limit) {
    diagnostics.push(diagnostic("search_truncated", "Search results were truncated at the requested limit."));
  }
  if (omitted) {
    diagnostics.push(diagnostic("search_entries_omitted", "Unsupported search entries were omitted."));
  }
  if (metadataTruncated) {
    diagnostics.push(
      diagnostic("search_metadata_truncated", "Unsupported or oversized search metadata was omitted."),
    );
  }
  hits.sort((left, right) => compareUnicode(left.id, right.id));
  diagnostics.sort((left, right) => compareUnicode(left.code, right.code));
  return {
    schema: SEARCH_SCHEMA,
    tool: { name: TOOL_NAME, version: TOOL_VERSION },
    operation: "search",
    observed_at: observedAt,
    status: diagnostics.length ? "partial" : "observed",
    transport,
    query: { kind: input.kind, text: query, limit },
    hits,
    diagnostics,
  };
}

function normalizeSnapshot(
  kind: HfRepoKind,
  requestedId: string,
  raw: unknown,
  limits: HfScoutLimits,
  transport: HubReaderTransport,
  requestedRevision: string | null,
): { snapshot: HfArtifactSnapshot; diagnostics: HfDiagnostic[] } {
  const object = asPlainObject(raw);
  const remoteId = readRemoteId(object);
  invariant(
    requestedRevision === null || remoteId !== null,
    "hub_subject_unresolved",
    "Hub response did not identify the requested repository",
  );
  if (remoteId) {
    const normalizedRemote = normalizeRepoId(kind, remoteId);
    invariant(
      normalizedRemote === requestedId,
      "hub_subject_mismatch",
      "Hub response subject did not match the requested repository",
    );
  }

  const diagnostics: HfDiagnostic[] = [];
  const resolvedRevision = normalizeFullSha(object.sha);
  if (requestedRevision) {
    invariant(
      resolvedRevision === requestedRevision,
      "hub_revision_mismatch",
      "Hub response revision did not match the requested commit",
    );
  } else if (!resolvedRevision) {
    diagnostics.push(diagnostic("revision_unresolved", "No full commit SHA was observed for the current head."));
  }

  const tagsResult = normalizeTags(object.tags, limits.max_tags);
  if (tagsResult.truncated) diagnostics.push(diagnostic("tags_truncated", "Publisher tags were truncated."));
  if (tagsResult.omitted) diagnostics.push(diagnostic("tags_omitted", "Unsupported publisher tags were omitted."));
  const declaredResult = declaredMetadata(object, tagsResult.values, limits.max_tags);
  const declared = declaredResult.metadata;
  if (declaredResult.relationsTruncated) {
    diagnostics.push(
      diagnostic("declared_relations_truncated", "Publisher relationship metadata was truncated."),
    );
  }
  if (!declared.license) diagnostics.push(diagnostic("license_unknown", "No supported declared license value was observed."));

  const filesResult = normalizeFiles(object.siblings, limits.max_files);
  if (filesResult.state === "not_provided") {
    diagnostics.push(diagnostic("file_inventory_unavailable", "No repository file inventory was observed."));
  } else if (filesResult.state === "truncated") {
    diagnostics.push(diagnostic("file_inventory_truncated", "Repository file inventory was incomplete or truncated."));
  }
  if (filesResult.partialCommitments) {
    diagnostics.push(
      diagnostic("content_commitments_partial", "Some files lacked a supported provider content commitment."),
    );
  }

  const boundaryCodes = new Set<HfBoundaryCode>([
    "publisher_metadata_unverified",
    "scout_files_not_downloaded",
    "scout_model_code_not_executed",
  ]);
  if (transport === "injected") boundaryCodes.add("caller_owned_reader");
  if (!requestedRevision) boundaryCodes.add("mutable_head_observation");
  if (!resolvedRevision) boundaryCodes.add("revision_unresolved");
  if (!declared.license) boundaryCodes.add("license_unknown");
  if (filesResult.state !== "complete") boundaryCodes.add("file_inventory_incomplete");

  diagnostics.sort((left, right) => compareUnicode(left.code, right.code));
  const snapshot: HfArtifactSnapshot = {
    schema: ARTIFACT_SCHEMA,
    subject: {
      provider: "huggingface",
      kind,
      id: requestedId,
    },
    revision: {
      requested_full_sha: requestedRevision,
      resolved_full_sha: resolvedRevision,
      state: requestedRevision
        ? "exact_revision_match"
        : resolvedRevision
          ? "mutable_head_observation"
          : "unresolved",
    },
    observation: {
      transport,
      repository_association: transport === "public_hub_api"
        ? "provider_response"
        : "caller_owned",
      reference: requestedRevision ? "requested_exact_revision" : "current_head",
    },
    declared,
    file_inventory: filesResult.state,
    files: filesResult.files,
    provenance_grade: resolvedRevision
      ? requestedRevision
        ? transport === "public_hub_api"
          ? "provider_observed_exact_revision_metadata"
          : "caller_supplied_exact_revision_metadata"
        : transport === "public_hub_api"
          ? "provider_observed_mutable_head_metadata"
          : "caller_supplied_mutable_head_metadata"
      : "mutable_observation",
    boundary_codes: [...boundaryCodes].sort(),
  };
  return { snapshot, diagnostics };
}

function requireFullRevision(value: string): string {
  const revision = normalizeFullSha(value);
  invariant(
    revision,
    "invalid_revision",
    "revision must be a full lowercase commit SHA",
  );
  return revision;
}

function normalizeFiles(
  value: unknown,
  maxFiles: number,
): {
  files: HfFileCommitment[];
  state: "not_provided" | "complete" | "truncated";
  partialCommitments: boolean;
} {
  if (!Array.isArray(value)) {
    return { files: [], state: "not_provided", partialCommitments: false };
  }
  const files = new Map<string, HfFileCommitment>();
  let incomplete = value.length > maxFiles;
  let partialCommitments = false;
  for (const rawEntry of value.slice(0, maxFiles)) {
    let entry: Record<string, unknown>;
    try {
      entry = asPlainObject(rawEntry);
    } catch {
      incomplete = true;
      continue;
    }
    const path = safeRelativeHubPath(entry.rfilename ?? entry.path);
    if (!path || files.has(path)) {
      incomplete = true;
      continue;
    }
    const lfs = optionalPlainObject(entry.lfs);
    const oid = safeRemoteString(lfs?.oid, 80);
    const lfsSha = normalizeSha256(lfs?.sha256)
      ?? (oid?.startsWith("sha256:") ? normalizeSha256(oid.slice("sha256:".length)) : null);
    const sha256 = lfsSha ?? normalizeSha256(entry.sha256);
    const gitBlobSha1 = normalizeSha1(entry.blobId ?? entry.git_blob_sha1);
    const xetHash = normalizeSha256(entry.xetHash ?? entry.xet_hash);
    if (!sha256 && !gitBlobSha1 && !xetHash) partialCommitments = true;
    files.set(path, {
      path,
      size: safeInteger(entry.size) ?? safeInteger(lfs?.size),
      sha256,
      git_blob_sha1: gitBlobSha1,
      xet_hash: xetHash,
      basis: "provider_metadata",
      verified_locally: false,
    });
  }
  return {
    files: [...files.values()].sort((left, right) => compareUnicode(left.path, right.path)),
    state: incomplete ? "truncated" : "complete",
    partialCommitments,
  };
}

function normalizeTags(
  value: unknown,
  maxTags: number,
): { values: string[]; truncated: boolean; omitted: boolean } {
  if (!Array.isArray(value)) return { values: [], truncated: false, omitted: value !== undefined };
  let omitted = false;
  const tags = new Set<string>();
  for (const entry of value.slice(0, maxTags)) {
    const tag = safeRemoteString(entry, 256);
    if (!tag) {
      omitted = true;
      continue;
    }
    tags.add(tag);
  }
  return {
    values: [...tags].sort(compareUnicode),
    truncated: value.length > maxTags,
    omitted,
  };
}

function declaredMetadata(
  object: Record<string, unknown>,
  tags: string[],
  maxRelations: number,
): { metadata: HfDeclaredMetadata; relationsTruncated: boolean } {
  const card = optionalPlainObject(object.cardData);
  const license = safeRemoteString(card?.license, 128)
    ?? safeRemoteString(object.license, 128)
    ?? tagValue(tags, "license:");
  const task = safeRemoteString(object.pipeline_tag, 128);
  const library = safeRemoteString(object.library_name, 128);
  const gated = normalizeGated(object.gated);
  const privateValue = typeof object.private === "boolean" ? object.private : null;
  const baseModels = mergeStringClaims(card?.base_model, tags, "base_model:", maxRelations);
  const papers = mergeStringClaims(card?.arxiv, tags, "arxiv:", maxRelations);
  return {
    metadata: {
      basis: "publisher_assertion",
      license,
      task,
      library,
      gated,
      private: privateValue,
      tags,
      base_models: baseModels.values,
      papers: papers.values,
    },
    relationsTruncated: baseModels.truncated || papers.truncated,
  };
}

function mergeStringClaims(
  cardValue: unknown,
  tags: readonly string[],
  prefix: string,
  maxItems: number,
): { values: string[]; truncated: boolean } {
  const values = new Set<string>();
  let truncated = false;
  const add = (value: string) => {
    if (values.has(value)) return;
    if (values.size >= maxItems) {
      truncated = true;
      return;
    }
    values.add(value);
  };
  if (Array.isArray(cardValue)) {
    for (const entry of cardValue) {
      const value = safeRemoteString(entry, 256);
      if (value) add(value);
    }
  } else {
    const value = safeRemoteString(cardValue, 256);
    if (value) add(value);
  }
  for (const tag of tags) {
    if (tag.startsWith(prefix)) {
      const value = safeRemoteString(tag.slice(prefix.length), 256);
      if (value) add(value);
    }
  }
  return { values: [...values].sort(compareUnicode), truncated };
}

function normalizeGated(value: unknown): boolean | "auto" | "manual" | null {
  if (typeof value === "boolean") return value;
  if (value === "auto" || value === "manual") return value;
  return null;
}

function tagValue(tags: readonly string[], prefix: string): string | null {
  const match = tags.find((tag) => tag.startsWith(prefix));
  return match ? safeRemoteString(match.slice(prefix.length), 128) : null;
}

function readRemoteId(object: Record<string, unknown>): string | null {
  return safeRemoteString(object.id, 193)
    ?? safeRemoteString(object.modelId, 193)
    ?? safeRemoteString(object.datasetId, 193)
    ?? safeRemoteString(object.spaceId, 193);
}

function resolveObservedAt(options: HfScoutOptions): string {
  if (options.observed_at) return normalizeObservedAt(options.observed_at);
  const date = options.clock ? options.clock() : new Date();
  invariant(date instanceof Date && Number.isFinite(date.getTime()), "invalid_clock", "clock returned an invalid date");
  return normalizeObservedAt(date.toISOString());
}

function diagnostic(code: HfDiagnosticCode, message: string): HfDiagnostic {
  return { code, level: "warning", message };
}

function validateReader(reader: HubReader): void {
  invariant(
    reader && typeof reader.inspect === "function" && typeof reader.search === "function",
    "invalid_reader",
    "Hub reader is invalid",
  );
}

async function readerCall(
  transport: HubReaderTransport,
  operation: () => Promise<unknown>,
): Promise<unknown> {
  try {
    return await operation();
  } catch (error) {
    if (transport === "public_hub_api" && error instanceof HfScoutError) throw error;
    throw new HfScoutError("injected_reader_failed", "Injected Hub reader failed");
  }
}
