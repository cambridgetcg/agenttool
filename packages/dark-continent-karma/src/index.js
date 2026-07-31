import { createHash } from "node:crypto";

export const PROPOSAL_FORMAT = "kingdom.kg-proposal/0.1";
export const EVENT_HASH_DOMAIN = "kingdom.kg-proposal-event/v0.1";
export const PROPOSAL_BINDING_DOMAIN = "kingdom.kg-proposal-binding/v0.1";
export const PACKAGE_VERSION = "0.1.0-dev.0";
export const CONTRACT_ID = "agenttool.dark-continent/0.1";
export const DARK_CONTINENT_FORMAT = "agenttool-dark-continent-framework/v0.1";
export const DARK_CONTINENT_PROJECTION_FORMAT = "dark-continent-projection/v0.1";
export const DARK_CONTINENT_SOURCE_PROFILE = "agenttool-sdk-ts-0.16.0";
export const DARK_CONTINENT_SNAPSHOT_SHA256 =
  "66e8d33cf7ce945ed5c3c43c4e0bc2e6d5f8ac0086e86867266ff1090db0dc5b";
export const DARK_CONTINENT_ARTIFACT =
  "@agenttool/dark-continent-contract/framework";
export const KARMA_PAPER_ID = "2502.06472v2";
export const KARMA_IMPLEMENTATION_REVISION =
  "4c41e59510f636fce0a033b793cc15dabc8ac897";
export const KARMA_REPOSITORY_HEAD_OBSERVED =
  "23610bc2a93ddc9f75322a1234ae6f688f87bdff";
export const KINGDOM_REPOSITORY_REVISION =
  "f4ad215d87432bd7cbb7dbe3eb03d3a1993c6d52";
export const KINGDOM_MAP_SHA256 =
  "0831c06e76c079f92c9e1d619c6b59b58231936f9ff54053acf1b819ac676585";

export const CALAMITY_IDS = Object.freeze([
  "hellbell",
  "ai",
  "brion",
  "pap",
  "zobae",
  "nanika",
]);

export const KARMA_ROLE_IDS = Object.freeze([
  "central_controller",
  "ingestion",
  "reader",
  "summarizer",
  "entity_extraction",
  "relationship_extraction",
  "schema_alignment",
  "conflict_resolution",
  "evaluator",
]);

export const CONSUMER_KINDS = Object.freeze([
  "kingdom-extension",
  "artbitrage",
]);

export const NODE_KINDS = Object.freeze([
  "hf_model",
  "hf_dataset",
  "hf_space",
  "kingdom_repo",
  "framework",
  "artifact",
  "dataset_record",
]);

export const LABEL_CLASSES = Object.freeze([
  "synthetic_metadata",
  "public_metadata",
  "local_metadata",
]);

export const EDGE_RELATIONS = Object.freeze([
  "depends_on",
  "projects",
  "evaluated_by",
  "mirrors",
  "evidence_for",
  "inspired_by",
  "parallel_not_equivalent",
]);

export const REVIEW_LENSES = Object.freeze([
  "provenance",
  "rights",
  "safety",
  "consequence",
  "reversibility",
]);

export const REVIEW_VERDICTS = Object.freeze([
  "pass",
  "concern",
  "block",
  "deferred",
]);

export const CONSEQUENCE_KINDS = Object.freeze([
  "adds_candidate",
  "conflicts_with_source",
  "requires_rights_review",
  "requires_safety_review",
  "deferred",
  "rejected",
]);

const EPISTEMIC_STATUSES = Object.freeze([
  "observed",
  "declared",
  "inferred",
  "not_checked",
]);

const SUBJECT_NODE_KIND = Object.freeze({
  model: "hf_model",
  dataset: "hf_dataset",
  space: "hf_space",
});

const AUTHORITY = deepFreeze({
  advisory: true,
  verifies_runtime_walls: false,
  identifies_being: false,
  grants_permission: false,
  authorizes_action: false,
  authorizes_trade: false,
  authorizes_publication: false,
  authorizes_execution: false,
  authorizes_crown: false,
  assigns_rank: false,
  conditions_dignity: false,
  enforces_policy: false,
});

const EFFECTS = deepFreeze({
  llm_calls: 0,
  graph_writes: 0,
  remote_reads: 0,
  remote_writes: 0,
  hf_uploads: 0,
  xp_changes: 0,
  reward_changes: 0,
});

const CREATED_FROM = deepFreeze({
  generator: {
    package: "@agenttool/dark-continent-karma",
    version: PACKAGE_VERSION,
    mode: "offline_deterministic_proposal",
  },
  kingdom: {
    repository: "https://github.com/cambridgetcg/agenttool",
    observed_on: "2026-07-31",
    observed_revision: KINGDOM_REPOSITORY_REVISION,
    map_path: "KINGDOM.md",
    map_sha256: KINGDOM_MAP_SHA256,
    map_introduction_commit: "94bb17c2c9e6bb391099422829498d75fd5ddcc8",
    map_crown_status: "arriving_in_review",
    live_claim: false,
    crown_contract: "agenttool-crown/v1",
    crown_source_commits: [
      "12d7de906bce926378996a784a4355aaacb6154f",
      "9691502f1a84c3c04c837b94af532ea9007c6439",
    ],
    semantics: "self_rule_by_participant_signature_not_rank",
  },
  karma: {
    semantics: "knowledge_graph_candidate_enrichment_not_score",
    relationship: "inspired_by",
    paper_id: KARMA_PAPER_ID,
    paper_url: "https://arxiv.org/abs/2502.06472v2",
    hf_paper_url: "https://huggingface.co/papers/2502.06472",
    observed_on: "2026-07-31",
    hf_cache_revision_status: "stale_v1_observation",
    linked_hub_artifacts: "none_observed",
    roles: [...KARMA_ROLE_IDS],
    implementation_repository: "https://github.com/YuxingLu613/KARMA",
    implementation_revision: KARMA_IMPLEMENTATION_REVISION,
    observed_repository_head: KARMA_REPOSITORY_HEAD_OBSERVED,
    implementation_license: "MIT",
    implementation_runtime: "not_imported_or_executed",
  },
});

/**
 * Create a deterministic proposal sidecar. This never applies the graph delta.
 *
 * @param {unknown} input
 * @returns {Readonly<Record<string, unknown>>}
 */
export function createProposal(input) {
  const normalized = normalizeCreateInput(input);
  const darkContinent = createDarkContinentProjection(
    normalized.proposalId,
    normalized.consumer,
  );
  const proposal = {
    _format: PROPOSAL_FORMAT,
    proposal_id: normalized.proposalId,
    created_from: cloneJson(CREATED_FROM),
    subject: normalized.hfSubject,
    dark_continent: darkContinent,
    base_graph: normalized.baseGraph,
    graph_delta: {
      nodes: normalized.nodes,
      edges: normalized.edges,
    },
    events: [],
    state: "proposed",
    effects: cloneJson(EFFECTS),
    authority: cloneJson(AUTHORITY),
  };
  const errors = validateProposal(proposal);
  if (errors.length > 0) {
    throw new TypeError(`invalid generated proposal: ${errors.join("; ")}`);
  }
  return deepFreeze(proposal);
}

/** @param {unknown} proposal @param {unknown} input */
export function appendConsequence(proposal, input) {
  const base = validatedClone(proposal);
  const value = exactObject(input, [
    "consequence",
    "epistemic_status",
    "event_id",
    "evidence_refs",
    "note_sha256",
    "subject_operation_id",
  ], "consequence input");
  assertSafeId(value.event_id, "event_id", 200);
  assertSafeId(value.subject_operation_id, "subject_operation_id", 200);
  assertOneOf(value.consequence, CONSEQUENCE_KINDS, "consequence");
  assertOneOf(value.epistemic_status, EPISTEMIC_STATUSES, "epistemic_status");
  assertSha256(value.note_sha256, "note_sha256");
  const evidenceRefs = normalizeRefs(value.evidence_refs, "evidence_refs", true);
  assertEventIdUnused(base, value.event_id);
  assertOperationExists(base, value.subject_operation_id);
  const payload = {
    kind: "consequence",
    sequence: base.events.length,
    previous_event_sha256: previousEventSha(base),
    proposal_binding_sha256: proposalBindingSha256(base),
    event_id: value.event_id,
    subject_operation_id: value.subject_operation_id,
    consequence: value.consequence,
    epistemic_status: value.epistemic_status,
    note_sha256: value.note_sha256,
    evidence_refs: evidenceRefs,
  };
  return appendHashedEvent(base, payload);
}

/** @param {unknown} proposal @param {unknown} input */
export function appendReview(proposal, input) {
  const base = validatedClone(proposal);
  const value = exactObject(input, [
    "event_id",
    "evidence_refs",
    "lens",
    "note_sha256",
    "reviewer_ref",
    "subject_operation_id",
    "verdict",
  ], "review input");
  assertSafeId(value.event_id, "event_id", 200);
  assertSafeId(value.subject_operation_id, "subject_operation_id", 200);
  assertSafeId(value.reviewer_ref, "reviewer_ref", 300);
  assertOneOf(value.lens, REVIEW_LENSES, "lens");
  assertOneOf(value.verdict, REVIEW_VERDICTS, "verdict");
  assertSha256(value.note_sha256, "note_sha256");
  const evidenceRefs = normalizeRefs(value.evidence_refs, "evidence_refs", true);
  assertEventIdUnused(base, value.event_id);
  assertOperationExists(base, value.subject_operation_id);
  const payload = {
    kind: "review",
    sequence: base.events.length,
    previous_event_sha256: previousEventSha(base),
    proposal_binding_sha256: proposalBindingSha256(base),
    event_id: value.event_id,
    subject_operation_id: value.subject_operation_id,
    reviewer_ref: value.reviewer_ref,
    lens: value.lens,
    verdict: value.verdict,
    note_sha256: value.note_sha256,
    evidence_refs: evidenceRefs,
  };
  return appendHashedEvent(base, payload);
}

/** @param {unknown} value @returns {string[]} */
export function validateProposal(value) {
  try {
    return validateProposalInternal(value);
  } catch (error) {
    return [`proposal validation failed safely: ${errorMessage(error)}`];
  }
}

function validateProposalInternal(value) {
  const errors = [];
  const complexityError = jsonComplexityError(value);
  if (complexityError !== null) return [complexityError];
  if (!isRecord(value)) return ["proposal must be an object"];
  checkExactKeys(value, [
    "_format",
    "authority",
    "base_graph",
    "created_from",
    "dark_continent",
    "effects",
    "events",
    "graph_delta",
    "proposal_id",
    "state",
    "subject",
  ], "proposal", errors);
  push(errors, value._format === PROPOSAL_FORMAT, "unexpected _format");
  push(errors, isSafeId(value.proposal_id, 200), "proposal_id is invalid");
  push(
    errors,
    sameJson(value.created_from, CREATED_FROM),
    "created_from source pins changed",
  );
  validateSubject(value.subject, errors);
  validateBaseGraph(value.base_graph, errors);
  validateGraphDelta(value.graph_delta, value.subject, errors);
  validateDarkProjection(value.dark_continent, value.proposal_id, errors);
  validateEvents(value.events, value, errors);
  push(errors, value.state === "proposed", "state must remain proposed");
  push(errors, sameJson(value.effects, EFFECTS), "effect boundary changed");
  push(errors, sameJson(value.authority, AUTHORITY), "authority boundary changed");
  rejectForbiddenKeys(value, errors);
  return [...new Set(errors)];
}

/** @param {unknown} value */
export function prettyJsonBytes(value) {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

/** @param {string | Uint8Array} value */
export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

/** @param {{repo_type: string, repo_id: string, revision: string}} subject */
export function hfSubjectNodeId(subject) {
  return `hf:${subject.repo_type}:${subject.repo_id}@${subject.revision}`;
}

/** @param {{repo_type: string, repo_id: string, revision: string}} subject @param {{path: string, sha256: string}} file */
export function hfFileEvidenceRef(subject, file) {
  const root = subject.repo_type === "model" ? "models" : `${subject.repo_type}s`;
  const encodedPath = file.path.split("/").map(encodeURIComponent).join("/");
  return `hf://${root}/${subject.repo_id}@${subject.revision}/${encodedPath}#sha256=${file.sha256}`;
}

function normalizeCreateInput(input) {
  const object = exactObject(input, [
    "baseGraph",
    "consumer",
    "edges",
    "hfSubject",
    "nodes",
    "proposalId",
  ], "proposal input");
  assertSafeId(object.proposalId, "proposalId", 200);
  const consumer = normalizeConsumer(object.consumer);
  const hfSubject = normalizeSubject(object.hfSubject);
  const baseGraph = normalizeBaseGraph(object.baseGraph);
  const nodes = normalizeNodes(object.nodes);
  const edges = normalizeEdges(object.edges);
  validateNormalizedGraph(nodes, edges, hfSubject);
  return {
    proposalId: object.proposalId,
    consumer,
    hfSubject,
    baseGraph,
    nodes,
    edges,
  };
}

function normalizeConsumer(value) {
  const object = exactObject(value, ["id", "kind"], "consumer");
  assertOneOf(object.kind, CONSUMER_KINDS, "consumer.kind");
  assertSafeId(object.id, "consumer.id", 160);
  return { kind: object.kind, id: object.id };
}

function normalizeSubject(value) {
  const object = exactObject(value, [
    "files",
    "license",
    "repo_id",
    "repo_type",
    "revision",
    "visibility",
  ], "hfSubject");
  if (
    typeof object.repo_id !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}\/[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/u.test(object.repo_id)
  ) {
    throw new TypeError("invalid proposal input: hfSubject.repo_id is invalid");
  }
  assertOneOf(object.repo_type, ["model", "dataset", "space"], "hfSubject.repo_type");
  assertSha40(object.revision, "hfSubject.revision");
  assertBoundedText(object.license, "hfSubject.license", 1, 80);
  if (!/^[A-Za-z0-9.+-]+$/u.test(object.license)) {
    throw new TypeError("invalid proposal input: hfSubject.license is invalid");
  }
  assertOneOf(object.visibility, ["public", "private", "gated"], "hfSubject.visibility");
  if (!Array.isArray(object.files) || object.files.length < 1 || object.files.length > 256) {
    throw new TypeError("invalid proposal input: hfSubject.files must contain 1..256 entries");
  }
  const files = object.files.map((file, index) => {
    const item = exactObject(file, ["path", "sha256"], `hfSubject.files[${index}]`);
    assertSafePath(item.path, `hfSubject.files[${index}].path`);
    assertSha256(item.sha256, `hfSubject.files[${index}].sha256`);
    return { path: item.path, sha256: item.sha256 };
  }).sort((left, right) => compareStrings(left.path, right.path));
  assertUnique(files.map((file) => file.path), "hfSubject file paths");
  return {
    kind: "hf-resource",
    repo_id: object.repo_id,
    repo_type: object.repo_type,
    revision: object.revision,
    visibility: object.visibility,
    license: object.license,
    files,
  };
}

function normalizeBaseGraph(value) {
  const object = exactObject(value, ["graph_id", "sha256"], "baseGraph");
  assertSafeId(object.graph_id, "baseGraph.graph_id", 200);
  assertSha256(object.sha256, "baseGraph.sha256");
  return { graph_id: object.graph_id, sha256: object.sha256 };
}

function normalizeNodes(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 128) {
    throw new TypeError("invalid proposal input: nodes must contain 1..128 entries");
  }
  const nodes = value.map((node, index) => {
    const object = exactObject(node, [
      "evidence_refs",
      "id",
      "kind",
      "label",
      "label_class",
      "operation_id",
    ], `nodes[${index}]`);
    assertSafeId(object.operation_id, `nodes[${index}].operation_id`, 200);
    assertSafeId(object.id, `nodes[${index}].id`, 300);
    assertOneOf(object.kind, NODE_KINDS, `nodes[${index}].kind`);
    assertMetadataLabel(object.label, `nodes[${index}].label`);
    assertOneOf(object.label_class, LABEL_CLASSES, `nodes[${index}].label_class`);
    return {
      operation_id: object.operation_id,
      id: object.id,
      kind: object.kind,
      label: object.label,
      label_class: object.label_class,
      evidence_refs: normalizeRefs(object.evidence_refs, `nodes[${index}].evidence_refs`, true),
      status: "proposed",
      epistemic_status: "provisional",
    };
  }).sort((left, right) => compareStrings(left.operation_id, right.operation_id));
  assertUnique(nodes.map((node) => node.operation_id), "node operation IDs");
  assertUnique(nodes.map((node) => node.id), "node IDs");
  return nodes;
}

function normalizeEdges(value) {
  if (!Array.isArray(value) || value.length > 256) {
    throw new TypeError("invalid proposal input: edges must contain 0..256 entries");
  }
  const edges = value.map((edge, index) => {
    const object = exactObject(edge, [
      "evidence_refs",
      "from",
      "operation_id",
      "relation",
      "to",
    ], `edges[${index}]`);
    assertSafeId(object.operation_id, `edges[${index}].operation_id`, 200);
    assertSafeId(object.from, `edges[${index}].from`, 300);
    assertSafeId(object.to, `edges[${index}].to`, 300);
    assertOneOf(object.relation, EDGE_RELATIONS, `edges[${index}].relation`);
    return {
      operation_id: object.operation_id,
      from: object.from,
      to: object.to,
      relation: object.relation,
      evidence_refs: normalizeRefs(object.evidence_refs, `edges[${index}].evidence_refs`, true),
      status: "proposed",
      epistemic_status: "provisional",
    };
  }).sort((left, right) => compareStrings(left.operation_id, right.operation_id));
  assertUnique(edges.map((edge) => edge.operation_id), "edge operation IDs");
  return edges;
}

function validateNormalizedGraph(nodes, edges, subject) {
  assertUnique(
    [...nodes, ...edges].map((operation) => operation.operation_id),
    "graph operation IDs",
  );
  const nodeIds = new Set(nodes.map((node) => node.id));
  for (const edge of edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      throw new TypeError("invalid proposal input: every edge endpoint must name a proposed node");
    }
  }
  const subjectId = hfSubjectNodeId(subject);
  const subjectNodes = nodes.filter((node) => node.id === subjectId);
  if (subjectNodes.length !== 1) {
    throw new TypeError("invalid proposal input: graph must contain the exact HF subject node");
  }
  const subjectNode = subjectNodes[0];
  const expectedKind = SUBJECT_NODE_KIND[subject.repo_type];
  const expectedRefs = subject.files
    .map((file) => hfFileEvidenceRef(subject, file))
    .sort(compareStrings);
  if (
    subjectNode.kind !== expectedKind ||
    subjectNode.label !== subject.repo_id ||
    (subject.visibility !== "public" && subjectNode.label_class !== "local_metadata") ||
    !sameJson(subjectNode.evidence_refs, expectedRefs)
  ) {
    throw new TypeError("invalid proposal input: HF subject node is not bound to its exact files");
  }
}

function createDarkContinentProjection(proposalId, consumer) {
  return {
    _format: DARK_CONTINENT_PROJECTION_FORMAT,
    projection_id: `${proposalId}:dark-continent`,
    source_profile: DARK_CONTINENT_SOURCE_PROFILE,
    source_snapshot: {
      format: DARK_CONTINENT_FORMAT,
      contract_id: CONTRACT_ID,
      artifact: DARK_CONTINENT_ARTIFACT,
      sha256: DARK_CONTINENT_SNAPSHOT_SHA256,
    },
    consumer: { kind: consumer.kind, id: consumer.id },
    checks: CALAMITY_IDS.map((calamityId) => ({
      calamity_id: calamityId,
      risk_state: "unknown",
      wall: { status: "not_checked", verified: false },
      evidence_refs: [],
    })),
    interpretations: [{
      source_profile: "karma-kg-2502.06472v2",
      relation: "parallel_not_equivalent",
    }],
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

function validateSubject(value, errors) {
  if (!isRecord(value)) {
    errors.push("subject must be an object");
    return;
  }
  checkExactKeys(value, [
    "files",
    "kind",
    "license",
    "repo_id",
    "repo_type",
    "revision",
    "visibility",
  ], "subject", errors);
  push(errors, value.kind === "hf-resource", "subject.kind is invalid");
  try {
    const rebuilt = normalizeSubject({
      files: value.files,
      license: value.license,
      repo_id: value.repo_id,
      repo_type: value.repo_type,
      revision: value.revision,
      visibility: value.visibility,
    });
    push(errors, sameJson(value, rebuilt), "subject is not canonical");
  } catch (error) {
    errors.push(errorMessage(error));
  }
}

function validateBaseGraph(value, errors) {
  if (!isRecord(value)) {
    errors.push("base_graph must be an object");
    return;
  }
  checkExactKeys(value, ["graph_id", "sha256"], "base_graph", errors);
  push(errors, isSafeId(value.graph_id, 200), "base_graph.graph_id is invalid");
  push(errors, isSha256(value.sha256), "base_graph.sha256 is invalid");
}

function validateGraphDelta(value, subject, errors) {
  if (!isRecord(value)) {
    errors.push("graph_delta must be an object");
    return;
  }
  checkExactKeys(value, ["edges", "nodes"], "graph_delta", errors);
  try {
    const nodes = normalizeOutputNodes(value.nodes);
    const edges = normalizeOutputEdges(value.edges);
    push(errors, sameJson(value.nodes, nodes), "graph_delta.nodes are not canonical");
    push(errors, sameJson(value.edges, edges), "graph_delta.edges are not canonical");
    if (isRecord(subject)) validateNormalizedGraph(nodes, edges, subject);
  } catch (error) {
    errors.push(errorMessage(error));
  }
}

function normalizeOutputNodes(value) {
  if (!Array.isArray(value)) throw new TypeError("graph_delta.nodes must be an array");
  return normalizeNodes(value.map((node, index) => {
    const object = exactObject(node, [
      "epistemic_status",
      "evidence_refs",
      "id",
      "kind",
      "label",
      "label_class",
      "operation_id",
      "status",
    ], `graph_delta.nodes[${index}]`);
    if (object.status !== "proposed" || object.epistemic_status !== "provisional") {
      throw new TypeError("graph nodes must remain provisional proposals");
    }
    return {
      operation_id: object.operation_id,
      id: object.id,
      kind: object.kind,
      label: object.label,
      label_class: object.label_class,
      evidence_refs: object.evidence_refs,
    };
  }));
}

function normalizeOutputEdges(value) {
  if (!Array.isArray(value)) throw new TypeError("graph_delta.edges must be an array");
  return normalizeEdges(value.map((edge, index) => {
    const object = exactObject(edge, [
      "epistemic_status",
      "evidence_refs",
      "from",
      "operation_id",
      "relation",
      "status",
      "to",
    ], `graph_delta.edges[${index}]`);
    if (object.status !== "proposed" || object.epistemic_status !== "provisional") {
      throw new TypeError("graph edges must remain provisional proposals");
    }
    return {
      operation_id: object.operation_id,
      from: object.from,
      to: object.to,
      relation: object.relation,
      evidence_refs: object.evidence_refs,
    };
  }));
}

function validateDarkProjection(value, proposalId, errors) {
  if (!isRecord(value)) {
    errors.push("dark_continent must be an object");
    return;
  }
  const consumer = isRecord(value.consumer) ? value.consumer : {};
  if (!CONSUMER_KINDS.includes(consumer.kind) || !isSafeId(consumer.id, 160)) {
    errors.push("dark_continent.consumer is invalid");
    return;
  }
  const expected = createDarkContinentProjection(proposalId, consumer);
  push(
    errors,
    sameJson(value, expected),
    "dark_continent projection changed or overstated a wall",
  );
}

function validateEvents(value, proposal, errors) {
  if (!Array.isArray(value) || value.length > 512) {
    errors.push("events must be an array with at most 512 entries");
    return;
  }
  const operationIds = new Set();
  const graphDelta = isRecord(proposal) ? proposal.graph_delta : null;
  if (isRecord(graphDelta)) {
    for (const collection of [graphDelta.nodes, graphDelta.edges]) {
      if (!Array.isArray(collection)) continue;
      for (const operation of collection) {
        if (isRecord(operation) && typeof operation.operation_id === "string") {
          operationIds.add(operation.operation_id);
        }
      }
    }
  }
  const eventIds = new Set();
  const expectedProposalBinding = proposalBindingSha256(proposal);
  let previous = null;
  for (const [index, event] of value.entries()) {
    if (!isRecord(event)) {
      errors.push(`events[${index}] must be an object`);
      continue;
    }
    const common = [
      "event_id",
      "event_sha256",
      "evidence_refs",
      "kind",
      "note_sha256",
      "previous_event_sha256",
      "proposal_binding_sha256",
      "sequence",
      "subject_operation_id",
    ];
    const keys = event.kind === "consequence"
      ? [...common, "consequence", "epistemic_status"]
      : event.kind === "review"
        ? [...common, "lens", "reviewer_ref", "verdict"]
        : common;
    checkExactKeys(event, keys, `events[${index}]`, errors);
    push(errors, event.sequence === index, `events[${index}] sequence is invalid`);
    push(
      errors,
      event.previous_event_sha256 === previous,
      `events[${index}] previous hash is invalid`,
    );
    push(
      errors,
      event.proposal_binding_sha256 === expectedProposalBinding,
      `events[${index}] proposal binding is invalid`,
    );
    push(errors, isSafeId(event.event_id, 200), `events[${index}] event_id is invalid`);
    if (eventIds.has(event.event_id)) errors.push(`events[${index}] event_id is duplicated`);
    eventIds.add(event.event_id);
    push(
      errors,
      operationIds.has(event.subject_operation_id),
      `events[${index}] subject operation is missing`,
    );
    push(errors, isSha256(event.note_sha256), `events[${index}] note hash is invalid`);
    validateRefs(event.evidence_refs, `events[${index}].evidence_refs`, errors, true);
    if (event.kind === "consequence") {
      push(errors, CONSEQUENCE_KINDS.includes(event.consequence), `events[${index}] consequence is invalid`);
      push(errors, EPISTEMIC_STATUSES.includes(event.epistemic_status), `events[${index}] epistemic status is invalid`);
    } else if (event.kind === "review") {
      push(errors, isSafeId(event.reviewer_ref, 300), `events[${index}] reviewer_ref is invalid`);
      push(errors, REVIEW_LENSES.includes(event.lens), `events[${index}] lens is invalid`);
      push(errors, REVIEW_VERDICTS.includes(event.verdict), `events[${index}] verdict is invalid`);
    } else {
      errors.push(`events[${index}] kind is invalid`);
    }
    const { event_sha256: claimed, ...payload } = event;
    const expected = eventDigest(payload);
    push(errors, claimed === expected, `events[${index}] hash is invalid`);
    previous = typeof claimed === "string" ? claimed : null;
  }
}

function appendHashedEvent(base, payload) {
  const event = {
    ...payload,
    event_sha256: eventDigest(payload),
  };
  const next = {
    ...base,
    events: [...base.events, event],
  };
  const errors = validateProposal(next);
  if (errors.length > 0) {
    throw new TypeError(`invalid appended proposal: ${errors.join("; ")}`);
  }
  return deepFreeze(next);
}

function validatedClone(proposal) {
  const errors = validateProposal(proposal);
  if (errors.length > 0) {
    throw new TypeError(`invalid proposal: ${errors.join("; ")}`);
  }
  return cloneJson(proposal);
}

function previousEventSha(proposal) {
  return proposal.events.at(-1)?.event_sha256 ?? null;
}

function eventDigest(payload) {
  return sha256(`${EVENT_HASH_DOMAIN}\n${prettyJsonBytes(payload)}`);
}

function proposalBindingSha256(proposal) {
  if (!isRecord(proposal)) return null;
  const { events: _events, ...bound } = proposal;
  return sha256(`${PROPOSAL_BINDING_DOMAIN}\n${prettyJsonBytes(bound)}`);
}

function assertEventIdUnused(proposal, eventId) {
  if (proposal.events.some((event) => event.event_id === eventId)) {
    throw new TypeError("invalid event input: event_id is already present");
  }
}

function assertOperationExists(proposal, operationId) {
  const exists = [...proposal.graph_delta.nodes, ...proposal.graph_delta.edges]
    .some((operation) => operation.operation_id === operationId);
  if (!exists) throw new TypeError("invalid event input: subject operation does not exist");
}

function normalizeRefs(value, label, requireOne) {
  if (!Array.isArray(value) || value.length > 256 || (requireOne && value.length < 1)) {
    throw new TypeError(`invalid proposal input: ${label} has invalid cardinality`);
  }
  const refs = value.map((ref) => {
    if (!isSafeEvidenceRef(ref)) {
      throw new TypeError(
        `invalid proposal input: ${label} must use a content-addressed evidence reference`,
      );
    }
    return ref;
  }).sort(compareStrings);
  assertUnique(refs, label);
  return refs;
}

function isSafeEvidenceRef(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 700) return false;
  if (/^sha256:[a-f0-9]{64}$/u.test(value)) return true;
  const match = value.match(
    /^hf:\/\/(models|datasets|spaces)\/([A-Za-z0-9][A-Za-z0-9._-]{0,95}\/[A-Za-z0-9][A-Za-z0-9._-]{0,95})@([a-f0-9]{40})\/(.+)#sha256=([a-f0-9]{64})$/u,
  );
  if (!match) return false;
  const encodedSegments = match[4].split("/");
  if (encodedSegments.some((segment) => segment.length === 0)) return false;
  try {
    return encodedSegments.every((segment) => {
      const decoded = decodeURIComponent(segment);
      return decoded !== "." &&
        decoded !== ".." &&
        !/[\/\\\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(decoded) &&
        encodeURIComponent(decoded) === segment;
    });
  } catch {
    return false;
  }
}

function validateRefs(value, label, errors, requireOne) {
  try {
    const normalized = normalizeRefs(value, label, requireOne);
    push(errors, sameJson(value, normalized), `${label} is not canonical`);
  } catch (error) {
    errors.push(errorMessage(error));
  }
}

function jsonComplexityError(root) {
  if (root === null || typeof root !== "object") return null;
  const maximumContainers = 4096;
  const maximumContainerEntries = 1024;
  const maximumDepth = 64;
  const seen = new WeakSet();
  const stack = [{ value: root, depth: 0 }];
  let containers = 0;

  while (stack.length > 0) {
    const current = stack.pop();
    if (current.depth > maximumDepth) {
      return `proposal exceeds validation depth ${maximumDepth}`;
    }
    if (seen.has(current.value)) {
      return "proposal must be a tree-shaped JSON value without shared or cyclic objects";
    }
    seen.add(current.value);
    containers += 1;
    if (containers > maximumContainers) {
      return `proposal exceeds validation container limit ${maximumContainers}`;
    }
    const nestedValues = Array.isArray(current.value)
      ? current.value
      : Object.values(current.value);
    if (nestedValues.length > maximumContainerEntries) {
      return `proposal container exceeds ${maximumContainerEntries} entries`;
    }
    for (const nested of nestedValues) {
      if (nested !== null && typeof nested === "object") {
        if (containers + stack.length >= maximumContainers) {
          return `proposal exceeds validation container limit ${maximumContainers}`;
        }
        stack.push({ value: nested, depth: current.depth + 1 });
      }
    }
  }
  return null;
}

function rejectForbiddenKeys(value, errors) {
  const forbidden = new Set([
    "score",
    "points",
    "xp",
    "rank",
    "leaderboard",
    "trust_score",
    "karma_score",
    "sameAs",
    "same_as",
    "agent_votes",
  ]);
  const stack = [{ value, path: "proposal" }];
  while (stack.length > 0) {
    const current = stack.pop();
    if (Array.isArray(current.value)) {
      current.value.forEach((entry, index) => {
        stack.push({ value: entry, path: `${current.path}[${index}]` });
      });
      continue;
    }
    if (!isRecord(current.value)) continue;
    for (const [key, nested] of Object.entries(current.value)) {
      if (forbidden.has(key)) errors.push(`${current.path}.${key} is forbidden`);
      stack.push({ value: nested, path: `${current.path}.${key}` });
    }
  }
}

function exactObject(value, keys, label) {
  if (!isRecord(value)) throw new TypeError(`invalid proposal input: ${label} must be an object`);
  const actual = Object.keys(value).sort(compareStrings);
  const expected = [...keys].sort(compareStrings);
  if (!sameJson(actual, expected)) {
    throw new TypeError(`invalid proposal input: ${label} did not match the closed schema`);
  }
  return value;
}

function checkExactKeys(value, keys, label, errors) {
  if (!isRecord(value)) {
    errors.push(`${label} must be an object`);
    return;
  }
  const actual = Object.keys(value).sort(compareStrings);
  const expected = [...keys].sort(compareStrings);
  push(errors, sameJson(actual, expected), `${label} has missing or unknown fields`);
}

function assertOneOf(value, choices, label) {
  if (!choices.includes(value)) {
    throw new TypeError(`invalid proposal input: ${label} is not supported`);
  }
}

function assertSafeId(value, label, maximum) {
  if (!isSafeId(value, maximum)) {
    throw new TypeError(`invalid proposal input: ${label} is invalid`);
  }
}

function isSafeId(value, maximum) {
  return typeof value === "string" &&
    value.length >= 1 &&
    value.length <= maximum &&
    /^[A-Za-z0-9][A-Za-z0-9._:/@#|+-]*$/u.test(value);
}

function assertSafePath(value, label) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 512 ||
    value.startsWith("/") ||
    value.includes("\\") ||
    value.split("/").some((part) => part === "" || part === "." || part === "..") ||
    /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(value)
  ) {
    throw new TypeError(`invalid proposal input: ${label} is invalid`);
  }
}

function assertBoundedText(value, label, minimum, maximum) {
  if (!isBoundedText(value, minimum, maximum)) {
    throw new TypeError(`invalid proposal input: ${label} is invalid`);
  }
}

function assertMetadataLabel(value, label) {
  if (
    !isBoundedText(value, 1, 300) ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(value)
  ) {
    throw new TypeError(`invalid proposal input: ${label} must be single-line metadata`);
  }
}

function isBoundedText(value, minimum, maximum) {
  return typeof value === "string" &&
    value.length >= minimum &&
    value.length <= maximum &&
    !/[\u0000\ud800-\udfff]/u.test(value);
}

function assertSha40(value, label) {
  if (typeof value !== "string" || !/^[a-f0-9]{40}$/u.test(value)) {
    throw new TypeError(`invalid proposal input: ${label} must be an immutable 40-hex commit`);
  }
}

function assertSha256(value, label) {
  if (!isSha256(value)) {
    throw new TypeError(`invalid proposal input: ${label} must be a SHA-256 digest`);
  }
}

function isSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function assertUnique(values, label) {
  if (new Set(values).size !== values.length) {
    throw new TypeError(`invalid proposal input: ${label} must be unique`);
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value).sort(compareStrings).map((key) => [key, canonicalize(value[key])]),
  );
}

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}

function sameJson(left, right) {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function push(errors, condition, message) {
  if (!condition) errors.push(message);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
