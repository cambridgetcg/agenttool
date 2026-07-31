export type ConsumerKind = "kingdom-extension" | "artbitrage";
export type HuggingFaceRepoType = "model" | "dataset" | "space";
export type HuggingFaceVisibility = "public" | "private" | "gated";
export type LabelClass = "synthetic_metadata" | "public_metadata" | "local_metadata";
export type NodeKind =
  | "hf_model"
  | "hf_dataset"
  | "hf_space"
  | "kingdom_repo"
  | "framework"
  | "artifact"
  | "dataset_record";
export type EdgeRelation =
  | "depends_on"
  | "projects"
  | "evaluated_by"
  | "mirrors"
  | "evidence_for"
  | "inspired_by"
  | "parallel_not_equivalent";
export type ReviewLens =
  | "provenance"
  | "rights"
  | "safety"
  | "consequence"
  | "reversibility";
export type ReviewVerdict = "pass" | "concern" | "block" | "deferred";
export type ConsequenceKind =
  | "adds_candidate"
  | "conflicts_with_source"
  | "requires_rights_review"
  | "requires_safety_review"
  | "deferred"
  | "rejected";
export type EpistemicStatus = "observed" | "declared" | "inferred" | "not_checked";
export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends object
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T;

export interface HuggingFaceSubject {
  kind: "hf-resource";
  repo_id: string;
  repo_type: HuggingFaceRepoType;
  revision: string;
  visibility: HuggingFaceVisibility;
  license: string;
  files: Array<{ path: string; sha256: string }>;
}

export interface ProposedNode {
  operation_id: string;
  id: string;
  kind: NodeKind;
  label: string;
  label_class: LabelClass;
  evidence_refs: string[];
  status: "proposed";
  epistemic_status: "provisional";
}

export interface ProposedEdge {
  operation_id: string;
  from: string;
  to: string;
  relation: EdgeRelation;
  evidence_refs: string[];
  status: "proposed";
  epistemic_status: "provisional";
}

export interface ConsequenceEvent {
  kind: "consequence";
  sequence: number;
  previous_event_sha256: string | null;
  proposal_binding_sha256: string;
  event_id: string;
  subject_operation_id: string;
  consequence: ConsequenceKind;
  epistemic_status: EpistemicStatus;
  note_sha256: string;
  evidence_refs: string[];
  event_sha256: string;
}

export interface ReviewEvent {
  kind: "review";
  sequence: number;
  previous_event_sha256: string | null;
  proposal_binding_sha256: string;
  event_id: string;
  subject_operation_id: string;
  reviewer_ref: string;
  lens: ReviewLens;
  verdict: ReviewVerdict;
  note_sha256: string;
  evidence_refs: string[];
  event_sha256: string;
}

export interface ProposalCreatedFrom {
  generator: {
    package: "@agenttool/dark-continent-karma";
    version: "0.1.0-dev.0";
    mode: "offline_deterministic_proposal";
  };
  kingdom: {
    repository: "https://github.com/cambridgetcg/agenttool";
    observed_on: "2026-07-31";
    observed_revision: "f4ad215d87432bd7cbb7dbe3eb03d3a1993c6d52";
    map_path: "KINGDOM.md";
    map_sha256: "0831c06e76c079f92c9e1d619c6b59b58231936f9ff54053acf1b819ac676585";
    map_introduction_commit: "94bb17c2c9e6bb391099422829498d75fd5ddcc8";
    map_crown_status: "arriving_in_review";
    live_claim: false;
    crown_contract: "agenttool-crown/v1";
    crown_source_commits: [
      "12d7de906bce926378996a784a4355aaacb6154f",
      "9691502f1a84c3c04c837b94af532ea9007c6439",
    ];
    semantics: "self_rule_by_participant_signature_not_rank";
  };
  karma: {
    semantics: "knowledge_graph_candidate_enrichment_not_score";
    relationship: "inspired_by";
    paper_id: "2502.06472v2";
    paper_url: "https://arxiv.org/abs/2502.06472v2";
    hf_paper_url: "https://huggingface.co/papers/2502.06472";
    observed_on: "2026-07-31";
    hf_cache_revision_status: "stale_v1_observation";
    linked_hub_artifacts: "none_observed";
    roles: [
      "central_controller",
      "ingestion",
      "reader",
      "summarizer",
      "entity_extraction",
      "relationship_extraction",
      "schema_alignment",
      "conflict_resolution",
      "evaluator",
    ];
    implementation_repository: "https://github.com/YuxingLu613/KARMA";
    implementation_revision: "4c41e59510f636fce0a033b793cc15dabc8ac897";
    observed_repository_head: "23610bc2a93ddc9f75322a1234ae6f688f87bdff";
    implementation_license: "MIT";
    implementation_runtime: "not_imported_or_executed";
  };
}

export interface DarkContinentCheck<
  Id extends "hellbell" | "ai" | "brion" | "pap" | "zobae" | "nanika",
> {
  calamity_id: Id;
  risk_state: "unknown";
  wall: { status: "not_checked"; verified: false };
  evidence_refs: [];
}

export interface DarkContinentProjection {
  _format: "dark-continent-projection/v0.1";
  projection_id: string;
  source_profile: "agenttool-sdk-ts-0.17.0";
  source_snapshot: {
    format: "agenttool-dark-continent-framework/v0.1";
    contract_id: "agenttool.dark-continent/0.1";
    artifact: "@agenttool/dark-continent-contract/framework";
    sha256: "f47e1c3ca9da1b97676e1d454cf7235eddd612902c19debe580a6934adcd2b86";
  };
  consumer: { kind: ConsumerKind; id: string };
  checks: [
    DarkContinentCheck<"hellbell">,
    DarkContinentCheck<"ai">,
    DarkContinentCheck<"brion">,
    DarkContinentCheck<"pap">,
    DarkContinentCheck<"zobae">,
    DarkContinentCheck<"nanika">,
  ];
  interpretations: [{
    source_profile: "karma-kg-2502.06472v2";
    relation: "parallel_not_equivalent";
  }];
  decision: {
    recommendation: "hold";
    advisory: true;
    reason_codes: ["wall_not_verified"];
  };
  authority: {
    grants_permission: false;
    authorizes_trade: false;
    authorizes_publication: false;
  };
}

export interface KingdomKgProposal {
  _format: "kingdom.kg-proposal/0.1";
  proposal_id: string;
  created_from: ProposalCreatedFrom;
  subject: HuggingFaceSubject;
  dark_continent: DarkContinentProjection;
  base_graph: { graph_id: string; sha256: string };
  graph_delta: { nodes: ProposedNode[]; edges: ProposedEdge[] };
  events: Array<ConsequenceEvent | ReviewEvent>;
  state: "proposed";
  effects: {
    llm_calls: 0;
    graph_writes: 0;
    remote_reads: 0;
    remote_writes: 0;
    hf_uploads: 0;
    xp_changes: 0;
    reward_changes: 0;
  };
  authority: {
    advisory: true;
    verifies_runtime_walls: false;
    identifies_being: false;
    grants_permission: false;
    authorizes_action: false;
    authorizes_trade: false;
    authorizes_publication: false;
    authorizes_execution: false;
    authorizes_crown: false;
    assigns_rank: false;
    conditions_dignity: false;
    enforces_policy: false;
  };
}

export interface CreateProposalInput {
  proposalId: string;
  consumer: { kind: ConsumerKind; id: string };
  hfSubject: Omit<HuggingFaceSubject, "kind" | "files"> & {
    files: readonly { path: string; sha256: string }[];
  };
  baseGraph: { graph_id: string; sha256: string };
  nodes: readonly (Omit<
    ProposedNode,
    "status" | "epistemic_status" | "evidence_refs"
  > & { evidence_refs: readonly string[] })[];
  edges: readonly (Omit<
    ProposedEdge,
    "status" | "epistemic_status" | "evidence_refs"
  > & { evidence_refs: readonly string[] })[];
}

export const PROPOSAL_FORMAT: "kingdom.kg-proposal/0.1";
export const EVENT_HASH_DOMAIN: "kingdom.kg-proposal-event/v0.1";
export const PROPOSAL_BINDING_DOMAIN: "kingdom.kg-proposal-binding/v0.1";
export const PACKAGE_VERSION: "0.1.0-dev.0";
export const CONTRACT_ID: "agenttool.dark-continent/0.1";
export const DARK_CONTINENT_FORMAT: "agenttool-dark-continent-framework/v0.1";
export const DARK_CONTINENT_PROJECTION_FORMAT: "dark-continent-projection/v0.1";
export const DARK_CONTINENT_SOURCE_PROFILE: "agenttool-sdk-ts-0.17.0";
export const DARK_CONTINENT_SNAPSHOT_SHA256: "f47e1c3ca9da1b97676e1d454cf7235eddd612902c19debe580a6934adcd2b86";
export const DARK_CONTINENT_ARTIFACT: "@agenttool/dark-continent-contract/framework";
export const KARMA_PAPER_ID: "2502.06472v2";
export const KARMA_IMPLEMENTATION_REVISION: "4c41e59510f636fce0a033b793cc15dabc8ac897";
export const KARMA_REPOSITORY_HEAD_OBSERVED: "23610bc2a93ddc9f75322a1234ae6f688f87bdff";
export const KINGDOM_REPOSITORY_REVISION: "f4ad215d87432bd7cbb7dbe3eb03d3a1993c6d52";
export const KINGDOM_MAP_SHA256: "0831c06e76c079f92c9e1d619c6b59b58231936f9ff54053acf1b819ac676585";
export const CALAMITY_IDS: readonly ["hellbell", "ai", "brion", "pap", "zobae", "nanika"];
export const KARMA_ROLE_IDS: readonly [
  "central_controller",
  "ingestion",
  "reader",
  "summarizer",
  "entity_extraction",
  "relationship_extraction",
  "schema_alignment",
  "conflict_resolution",
  "evaluator",
];
export const CONSUMER_KINDS: readonly ["kingdom-extension", "artbitrage"];
export const NODE_KINDS: readonly [
  "hf_model",
  "hf_dataset",
  "hf_space",
  "kingdom_repo",
  "framework",
  "artifact",
  "dataset_record",
];
export const LABEL_CLASSES: readonly [
  "synthetic_metadata",
  "public_metadata",
  "local_metadata",
];
export const EDGE_RELATIONS: readonly [
  "depends_on",
  "projects",
  "evaluated_by",
  "mirrors",
  "evidence_for",
  "inspired_by",
  "parallel_not_equivalent",
];
export const REVIEW_LENSES: readonly [
  "provenance",
  "rights",
  "safety",
  "consequence",
  "reversibility",
];
export const REVIEW_VERDICTS: readonly ["pass", "concern", "block", "deferred"];
export const CONSEQUENCE_KINDS: readonly [
  "adds_candidate",
  "conflicts_with_source",
  "requires_rights_review",
  "requires_safety_review",
  "deferred",
  "rejected",
];

export function createProposal(input: CreateProposalInput): DeepReadonly<KingdomKgProposal>;
export function appendConsequence(
  proposal: KingdomKgProposal | DeepReadonly<KingdomKgProposal>,
  input: {
    event_id: string;
    subject_operation_id: string;
    consequence: ConsequenceKind;
    epistemic_status: EpistemicStatus;
    note_sha256: string;
    evidence_refs: readonly string[];
  },
): DeepReadonly<KingdomKgProposal>;
export function appendReview(
  proposal: KingdomKgProposal | DeepReadonly<KingdomKgProposal>,
  input: {
    event_id: string;
    subject_operation_id: string;
    reviewer_ref: string;
    lens: ReviewLens;
    verdict: ReviewVerdict;
    note_sha256: string;
    evidence_refs: readonly string[];
  },
): DeepReadonly<KingdomKgProposal>;
export function validateProposal(value: unknown): string[];
export function prettyJsonBytes(value: unknown): string;
export function sha256(value: string | Uint8Array): string;
export function hfSubjectNodeId(
  subject: Pick<HuggingFaceSubject, "repo_type" | "repo_id" | "revision">,
): string;
export function hfFileEvidenceRef(
  subject: Pick<HuggingFaceSubject, "repo_type" | "repo_id" | "revision">,
  file: { path: string; sha256: string },
): string;
