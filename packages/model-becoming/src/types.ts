import type {
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

export type Sha256Id = `sha256:${string}`;
export type ModelBecomingModule = (typeof MODEL_BECOMING_MODULES)[number];
export type ModelBecomingKnowledgeState = (typeof MODEL_BECOMING_KNOWLEDGE_STATES)[number];
export type ModelBecomingClaimKind = (typeof MODEL_BECOMING_CLAIM_KINDS)[number];
export type ModelBecomingSourceKind = (typeof MODEL_BECOMING_SOURCE_KINDS)[number];
export type ModelBecomingMethod = (typeof MODEL_BECOMING_METHODS)[number];
export type ModelBecomingConfidence = (typeof MODEL_BECOMING_CONFIDENCE)[number];

export interface ModelBecomingSourceInput {
  readonly title: string;
  readonly url: string;
  readonly source_kind: ModelBecomingSourceKind;
  readonly publisher: string;
  readonly revision: string | null;
  readonly digest: Sha256Id | null;
  readonly published_on: string | null;
  readonly observed_on: string;
}

export interface ModelBecomingSource extends ModelBecomingSourceInput {
  readonly _format: (typeof MODEL_BECOMING_FORMATS)["source"];
  readonly source_id: Sha256Id;
}

export interface ModelBecomingClaimInput {
  readonly module: ModelBecomingModule;
  readonly statement: string;
  readonly knowledge_state: ModelBecomingKnowledgeState;
  readonly claim_kind: ModelBecomingClaimKind;
  readonly source_refs: readonly Sha256Id[];
  readonly method: ModelBecomingMethod;
  readonly confidence: ModelBecomingConfidence;
  readonly scope: string;
  readonly limitations: readonly string[];
}

export interface ModelBecomingClaim extends ModelBecomingClaimInput {
  readonly _format: (typeof MODEL_BECOMING_FORMATS)["claim"];
  readonly claim_id: Sha256Id;
}

export interface ModelBecomingSubject {
  readonly subject_ref: string;
  readonly display_name: string;
  readonly artifact_ref: string | null;
  readonly runtime_ref: string | null;
}

export interface CreateModelBecomingDossierInput {
  readonly subject: ModelBecomingSubject;
  readonly as_of: string;
  readonly sources: readonly ModelBecomingSource[];
  readonly claims: readonly ModelBecomingClaimInput[];
}

export interface ModelBecomingDossier {
  readonly _format: (typeof MODEL_BECOMING_FORMATS)["dossier"];
  readonly dossier_id: Sha256Id;
  readonly subject: ModelBecomingSubject;
  readonly as_of: string;
  readonly modules: typeof MODEL_BECOMING_MODULES;
  readonly sources: readonly ModelBecomingSource[];
  readonly claims: readonly ModelBecomingClaim[];
  readonly translation: typeof MODEL_BECOMING_TRANSLATION;
  readonly boundaries: typeof MODEL_BECOMING_BOUNDARIES;
}

export interface ModelBecomingHfReferenceRow {
  readonly _format: (typeof MODEL_BECOMING_FORMATS)["hfReferenceRow"];
  readonly row_role: "reference_only";
  readonly training_admission: "not_applicable";
  readonly requires_separate_training_authorization: true;
  readonly training_authorized: false;
  readonly dossier: ModelBecomingDossier;
}
