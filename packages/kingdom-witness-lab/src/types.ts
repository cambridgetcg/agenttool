import type {
  API_DIALECTS,
  DECLARED_LICENSES,
  DOSSIER_RELATIONSHIPS,
  HUMAN_REVIEW_STATUSES,
  INPUT_DISCLOSURES,
  LICENSE_SCOPES,
  RESEARCH_BOUNDARY_CODES,
  RESEARCH_CAPABILITIES,
  RESEARCH_KINDS,
  RESEARCH_PROVIDERS,
  RESEARCH_ROLES,
  RESEARCH_STAGES,
  RESEARCH_TARGETS,
  RETENTION_BASES,
  ROUTE_EQUIVALENCE,
  ROUTE_FEATURE_NOTES,
  ROUTE_FEATURE_STATUSES,
  ROUTE_FEATURES,
  ROUTE_PROVIDERS,
  SAMPLING_MODES,
  THINKING_MODES,
  TRAINING_USES,
  TRIAL_STATUSES,
  WITNESS_DISCLOSURE,
  WITNESS_EXECUTION,
  WITNESS_INDEPENDENCE,
  WITNESS_KINDS,
  WITNESS_STANCES,
} from "./constants.js";
import type {
  DEEPSEEK_ATLAS_SCHEMA,
  EXECUTION_ROUTE_BINDING_SCHEMA,
  RESEARCH_PASSPORT_SCHEMA,
  RESEARCH_PASSPORT_STATEMENT,
  EXECUTION_ROUTE_BINDING_STATEMENT,
  SPECULATIVE_TRIAL_SCHEMA,
  SPECULATIVE_TRIAL_STATEMENT,
  WITNESS_DOSSIER_SCHEMA,
  WITNESS_DOSSIER_STATEMENT,
} from "./constants.js";

type Entry<T extends readonly string[]> = T[number];

export type Sha256Id = `sha256:${string}`;
export type ResearchProvider = Entry<typeof RESEARCH_PROVIDERS>;
export type ResearchKind = Entry<typeof RESEARCH_KINDS>;
export type DeclaredLicense = Entry<typeof DECLARED_LICENSES> | null;
export type LicenseScope = Entry<typeof LICENSE_SCOPES>;
export type ResearchCapability = Entry<typeof RESEARCH_CAPABILITIES>;
export type ResearchRole = Entry<typeof RESEARCH_ROLES>;
export type ResearchTarget = Entry<typeof RESEARCH_TARGETS>;
export type ResearchStage = Entry<typeof RESEARCH_STAGES>;
export type ResearchBoundaryCode = Entry<typeof RESEARCH_BOUNDARY_CODES>;

export interface ResearchArtifactRef {
  provider: ResearchProvider;
  kind: ResearchKind;
  id: string;
  revision: string;
}

export interface PublisherAssertions {
  publisher: string;
  declared_license: DeclaredLicense;
  license_scope: LicenseScope;
  capabilities: ResearchCapability[];
}

export interface ResearchProposal {
  roles: ResearchRole[];
  targets: ResearchTarget[];
  stage: ResearchStage;
  boundary_codes: ResearchBoundaryCode[];
}

export interface CreateResearchPassportInput {
  subject: ResearchArtifactRef;
  observed_at: string;
  observation_basis: "caller_supplied" | "provider_metadata";
  publisher_assertions: PublisherAssertions;
  proposal: ResearchProposal;
  evidence_refs: string[];
}

export interface ResearchPassport extends CreateResearchPassportInput {
  schema: typeof RESEARCH_PASSPORT_SCHEMA;
  passport_id: Sha256Id;
  conclusions: {
    authorship: "not_proven";
    legal_clearance: "not_assessed";
    safety: "not_assessed";
    truth: "not_determined";
    authority: "none";
    representation: "none";
    automatic_action: false;
  };
  statement: typeof RESEARCH_PASSPORT_STATEMENT;
}

export type RouteProvider = Entry<typeof ROUTE_PROVIDERS>;
export type ApiDialect = Entry<typeof API_DIALECTS>;
export type RouteEquivalence = Entry<typeof ROUTE_EQUIVALENCE>;
export type RouteFeature = Entry<typeof ROUTE_FEATURES>;
export type RouteFeatureStatus = Entry<typeof ROUTE_FEATURE_STATUSES>;
export type RouteFeatureNote = Entry<typeof ROUTE_FEATURE_NOTES> | null;
export type RetentionBasis = Entry<typeof RETENTION_BASES>;
export type InputDisclosure = Entry<typeof INPUT_DISCLOSURES>;
export type TrainingUse = Entry<typeof TRAINING_USES>;

export interface RouteFeatureObservation {
  feature: RouteFeature;
  status: RouteFeatureStatus;
  note_code: RouteFeatureNote;
}

export interface CreateExecutionRouteBindingInput {
  artifact: ResearchArtifactRef;
  route: {
    provider: RouteProvider;
    route_id: string;
    effective_version: string | null;
    observed_at: string;
    api_dialect: ApiDialect;
    equivalence: RouteEquivalence;
    equivalence_evidence_refs: string[];
  };
  features: RouteFeatureObservation[];
  disclosure: {
    retention_basis: RetentionBasis;
    input_disclosure: InputDisclosure;
    training_use: TrainingUse;
    evidence_refs: string[];
  };
  evidence_refs: string[];
}

export interface ExecutionRouteBinding extends CreateExecutionRouteBindingInput {
  schema: typeof EXECUTION_ROUTE_BINDING_SCHEMA;
  binding_id: Sha256Id;
  boundaries: {
    artifact_route_equivalence: RouteEquivalence;
    credentials: "not_received";
    dispatch: "not_performed";
    authority: "none";
    automatic_action: false;
  };
  statement: typeof EXECUTION_ROUTE_BINDING_STATEMENT;
}

export type WitnessKind = Entry<typeof WITNESS_KINDS>;
export type WitnessStance = Entry<typeof WITNESS_STANCES>;
export type WitnessIndependence = Entry<typeof WITNESS_INDEPENDENCE>;
export type WitnessExecution = Entry<typeof WITNESS_EXECUTION>;
export type WitnessDisclosure = Entry<typeof WITNESS_DISCLOSURE>;
export type HumanReviewStatus = Entry<typeof HUMAN_REVIEW_STATUSES>;
export type DossierRelationship = Entry<typeof DOSSIER_RELATIONSHIPS>;

export interface WitnessDescriptor {
  witness_id: string;
  kind: WitnessKind;
  source_ref: string;
  observation_sha256: Sha256Id;
  stance: WitnessStance;
  independence: WitnessIndependence;
  execution: WitnessExecution;
  disclosure: WitnessDisclosure;
}

export interface CreateWitnessDossierInput {
  passport_id: Sha256Id;
  question_sha256: Sha256Id;
  observed_at: string;
  witnesses: WitnessDescriptor[];
  human_review: {
    status: HumanReviewStatus;
    evidence_refs: string[];
  };
  evidence_refs: string[];
}

export interface WitnessDossier extends CreateWitnessDossierInput {
  schema: typeof WITNESS_DOSSIER_SCHEMA;
  dossier_id: Sha256Id;
  observation: {
    relationship: DossierRelationship;
    support_count: number;
    contradiction_count: number;
    directional_source_count: number;
  };
  conclusions: {
    external_facts: "not_resolved";
    truth: "not_determined";
    authority: "none";
    automatic_action: false;
  };
  statement: typeof WITNESS_DOSSIER_STATEMENT;
}

export type TrialStatus = Entry<typeof TRIAL_STATUSES>;
export type ThinkingMode = Entry<typeof THINKING_MODES>;
export type SamplingMode = Entry<typeof SAMPLING_MODES>;

export interface CreateSpeculativeTrialInput {
  trial_id: string;
  observed_at: string;
  target_artifact: ResearchArtifactRef;
  draft_artifact: ResearchArtifactRef;
  engine: {
    id: string;
    revision: string;
    config_sha256: Sha256Id;
  };
  workload: {
    prompt_set_sha256: Sha256Id;
    matched_settings_reported: boolean;
    thinking_mode: ThinkingMode;
    sampling_mode: SamplingMode;
    concurrency: number;
    request_count: number;
  };
  status: TrialStatus;
  metrics: {
    acceptance_length_micros: number | null;
    throughput_milli_tokens_per_second: number | null;
    latency_micros: number | null;
  };
  evidence_refs: string[];
}

export interface SpeculativeTrialDescriptor extends CreateSpeculativeTrialInput {
  schema: typeof SPECULATIVE_TRIAL_SCHEMA;
  descriptor_id: Sha256Id;
  conclusions: {
    matched_settings: "caller_reported_only";
    performance: "caller_reported_only";
    equivalence: "not_determined";
    authority: "none";
    automatic_retry: false;
  };
  statement: typeof SPECULATIVE_TRIAL_STATEMENT;
}

export interface DeepSeekResearchEntry {
  key: string;
  subject: ResearchArtifactRef;
  publisher_assertions: PublisherAssertions;
  provider_observation: {
    public_access: "public_ungated_observed" | "public_observed";
    basis: "github_repository" | "huggingface_metadata";
  };
  proposal: ResearchProposal;
  official_sources: string[];
}

export interface DeepSeekResearchAtlas {
  schema: typeof DEEPSEEK_ATLAS_SCHEMA;
  atlas_id: Sha256Id;
  observed_on: string;
  entries: DeepSeekResearchEntry[];
  boundary: {
    artifact_content: "not_downloaded";
    code: "not_executed";
    public_metadata: "read_only_observed";
    inference_or_write_api: "not_called";
    credentials: "not_read";
    terms: "not_accepted";
    legal_clearance: "not_assessed";
    truth: "not_determined";
    authority: "none";
  };
}
