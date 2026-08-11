import type {
  ARTIFACT_OBSERVATIONS,
  ATLAS_FORMAT,
  BRIDGE_DISPOSITIONS,
  INPUT_FORMAT,
  INVARIANT_STATES,
  LENS_ROUTE_STATES,
  NPM_PROVENANCE_STATES,
  PRINCIPALITY_BOUNDARIES,
  PRINCIPALITY_KINDS,
} from "./constants.js";

export type Sha256Id = `sha256:${string}`;
export type PrincipalityKind = (typeof PRINCIPALITY_KINDS)[number];
export type BridgeDisposition = (typeof BRIDGE_DISPOSITIONS)[number];
export type InvariantState = (typeof INVARIANT_STATES)[number];
export type LensRouteState = (typeof LENS_ROUTE_STATES)[number];
export type ArtifactObservation = (typeof ARTIFACT_OBSERVATIONS)[number];
export type NpmProvenanceState = (typeof NPM_PROVENANCE_STATES)[number];

export interface HuggingFaceArtifactInput {
  readonly kind: "huggingface";
  readonly repo_type: "model" | "dataset" | "space";
  readonly repo_id: string;
  readonly revision: string;
  readonly snapshot_manifest_protocol: string;
  readonly snapshot_manifest_sha256: Sha256Id;
  readonly observation: ArtifactObservation;
}

export interface NpmArtifactInput {
  readonly kind: "npm";
  readonly name: string;
  readonly version: string;
  readonly integrity: string;
  readonly version_metadata_protocol: string;
  readonly version_metadata_sha256: Sha256Id;
  readonly provenance_attestation: NpmProvenanceState;
  readonly observation: ArtifactObservation;
}

export type ArtifactInput = HuggingFaceArtifactInput | NpmArtifactInput;

export type ArtifactReference =
  | (HuggingFaceArtifactInput & { readonly artifact_ref: Sha256Id })
  | (NpmArtifactInput & { readonly artifact_ref: Sha256Id });

/** A bounded digest seam for Browser, Witness, WAKE, or another protocol. */
export interface ProtocolManifestationInput {
  readonly kind: "protocol_digest";
  readonly protocol: string;
  readonly content_ref: Sha256Id;
}

/**
 * The exact seven-field AFTERGLOW `external` thread projection. Geometry does
 * not import, validate, select, carry, or resume an AFTERGLOW capsule.
 */
export interface AfterglowExternalManifestationInput {
  readonly kind: "external";
  readonly thread_ref: Sha256Id;
  readonly artifact_ref: Sha256Id;
  readonly disposition: "carry" | "park" | "release" | "withdraw";
  readonly assertion: "caller_asserted";
  readonly verified_by_package: false;
  readonly state: "context_only" | "review_required" | "hold";
}

export type ManifestationInput =
  | ProtocolManifestationInput
  | AfterglowExternalManifestationInput;

export type ManifestationReference = ManifestationInput & {
  readonly manifestation_ref: Sha256Id;
};

export interface InvariantDefinition {
  readonly invariant_id: string;
  readonly definition_ref: Sha256Id;
}

export interface PrincipalityInput {
  readonly principality_id: string;
  readonly kind: PrincipalityKind;
  readonly definition_ref: Sha256Id;
  readonly manifestations: readonly ManifestationInput[];
  readonly artifact_refs: readonly ArtifactInput[];
}

export interface PrincipalityVertex {
  readonly principality_id: string;
  readonly principality_ref: Sha256Id;
  readonly kind: PrincipalityKind;
  readonly definition_ref: Sha256Id;
  readonly manifestations: readonly ManifestationReference[];
  readonly artifact_refs: readonly ArtifactReference[];
}

export interface BridgeEvaluation {
  readonly invariant_id: string;
  readonly state: InvariantState;
  readonly evidence_refs: readonly Sha256Id[];
}

export interface TranslationInput {
  readonly from: string;
  readonly to: string;
  readonly disposition: BridgeDisposition;
  readonly evaluations: readonly BridgeEvaluation[];
}

export interface TranslationBridge extends TranslationInput {
  readonly bridge_id: Sha256Id;
  readonly from_ref: Sha256Id;
  readonly to_ref: Sha256Id;
}

export interface CreatePrincipalityGeometryInput {
  readonly _format: typeof INPUT_FORMAT;
  readonly scope_ref: Sha256Id;
  readonly invariants: readonly InvariantDefinition[];
  readonly principalities: readonly PrincipalityInput[];
  readonly translations: readonly TranslationInput[];
}

export interface LensInvariantRelation {
  readonly invariant_id: string;
  readonly forward_state: InvariantState;
  readonly reverse_state: InvariantState;
}

export interface ReciprocalLens {
  readonly lens_id: Sha256Id;
  readonly vertices: readonly [string, string];
  readonly vertex_refs: readonly [Sha256Id, Sha256Id];
  readonly bridge_ids: readonly [Sha256Id, Sha256Id];
  readonly dispositions: readonly [BridgeDisposition, BridgeDisposition];
  readonly route_state: LensRouteState;
  readonly invariant_relations: readonly LensInvariantRelation[];
  readonly mutually_preserved: readonly string[];
  readonly mutually_not_preserved: readonly string[];
  readonly directional_asymmetry: readonly string[];
  readonly refused: readonly string[];
  readonly unknown: readonly string[];
}

export interface InvariantSurface {
  readonly surface_id: Sha256Id;
  readonly vertices: readonly [string, string, string];
  readonly vertex_refs: readonly [Sha256Id, Sha256Id, Sha256Id];
  readonly lens_ids: readonly [Sha256Id, Sha256Id, Sha256Id];
  readonly invariant_ids: readonly string[];
}

export interface InvariantGeometryComponent {
  readonly component_id: Sha256Id;
  readonly invariant_id: string;
  readonly vertices: readonly string[];
  readonly vertex_refs: readonly Sha256Id[];
  readonly lens_ids: readonly Sha256Id[];
}

export interface InvariantOpenEntry {
  readonly bridge_id: Sha256Id;
  readonly invariant_id: string;
  readonly evidence_refs: readonly Sha256Id[];
}

export interface DirectionalAsymmetryEntry {
  readonly lens_id: Sha256Id;
  readonly invariant_id: string;
}

export interface PrincipalityOpenConditions {
  readonly one_way_bridge_ids: readonly Sha256Id[];
  readonly non_available_bridge_ids: readonly Sha256Id[];
  readonly not_preserved: readonly InvariantOpenEntry[];
  readonly refused: readonly InvariantOpenEntry[];
  readonly unknown: readonly InvariantOpenEntry[];
  readonly directional_asymmetry: readonly DirectionalAsymmetryEntry[];
  readonly unrelated_vertex_pairs: readonly (readonly [string, string])[];
  readonly declared_isolated_vertices: readonly string[];
}

export interface PrincipalityTopology {
  readonly reciprocal_lenses: readonly ReciprocalLens[];
  readonly invariant_surfaces: readonly InvariantSurface[];
  readonly invariant_components: readonly InvariantGeometryComponent[];
  /** An open-condition ledger, not a simplicial boundary operator. */
  readonly open_conditions: PrincipalityOpenConditions;
}

export interface PrincipalityAtlas {
  readonly _format: typeof ATLAS_FORMAT;
  readonly atlas_id: Sha256Id;
  readonly scope_ref: Sha256Id;
  readonly invariants: readonly InvariantDefinition[];
  readonly principalities: readonly PrincipalityVertex[];
  readonly bridges: readonly TranslationBridge[];
  readonly geometry: PrincipalityTopology;
  readonly boundaries: typeof PRINCIPALITY_BOUNDARIES;
  readonly claim_boundary: string;
}
