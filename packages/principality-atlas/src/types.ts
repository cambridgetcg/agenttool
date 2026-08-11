import type {
  PRINCIPALITY_ATLAS_BOUNDARIES,
  PRINCIPALITY_ATLAS_CLAIM_POSTURES,
  PRINCIPALITY_ATLAS_CORRESPONDENCE_POSTURES,
  PRINCIPALITY_ATLAS_FORMAT,
} from "./constants.js";

export type Sha256Id = `sha256:${string}`;
export type AtlasClaimPosture =
  (typeof PRINCIPALITY_ATLAS_CLAIM_POSTURES)[number];
export type AtlasCorrespondencePosture =
  (typeof PRINCIPALITY_ATLAS_CORRESPONDENCE_POSTURES)[number];

export interface AtlasCell {
  readonly cell_ref: Sha256Id;
  readonly kind_ref: Sha256Id;
}

export interface AtlasIncidence {
  readonly cell_ref: Sha256Id;
  readonly role_ref: Sha256Id;
}

export interface AtlasRelation {
  readonly relation_ref: Sha256Id;
  readonly kind_ref: Sha256Id;
  readonly incidences: readonly AtlasIncidence[];
}

export interface AtlasClaimSubject {
  readonly kind: "cell" | "relation";
  readonly ref: Sha256Id;
}

export interface AtlasClaim {
  readonly claim_ref: Sha256Id;
  readonly subject: AtlasClaimSubject;
  readonly perspective_ref: Sha256Id;
  readonly posture: AtlasClaimPosture;
  readonly evidence_refs: readonly Sha256Id[];
  readonly supersedes_claim_ref: Sha256Id | null;
  readonly assertion: "caller_asserted";
  readonly verified_by_package: false;
}

export interface PrincipalityChart {
  readonly chart_ref: Sha256Id;
  readonly principality_ref: Sha256Id;
  readonly perspective_ref: Sha256Id;
  readonly cells: readonly AtlasCell[];
  readonly relations: readonly AtlasRelation[];
  readonly claims: readonly AtlasClaim[];
}

export interface AtlasCorrespondence {
  readonly correspondence_ref: Sha256Id;
  readonly from_cell_ref: Sha256Id;
  readonly to_cell_ref: Sha256Id;
  readonly posture: AtlasCorrespondencePosture;
  readonly perspective_ref: Sha256Id;
  readonly evidence_refs: readonly Sha256Id[];
  readonly assertion: "caller_asserted";
  readonly verified_by_package: false;
}

export interface ChartBridge {
  readonly bridge_ref: Sha256Id;
  readonly from_chart_ref: Sha256Id;
  readonly to_chart_ref: Sha256Id;
  readonly correspondences: readonly AtlasCorrespondence[];
  readonly unmapped_from_refs: readonly Sha256Id[];
  readonly unmapped_to_refs: readonly Sha256Id[];
  readonly coverage: "partial_not_complete";
}

export interface CreatePrincipalityAtlasInput {
  readonly scope_ref: Sha256Id;
  readonly charts: readonly PrincipalityChart[];
  readonly bridges: readonly ChartBridge[];
}

export interface PrincipalityAtlas {
  readonly _format: typeof PRINCIPALITY_ATLAS_FORMAT;
  readonly atlas_id: Sha256Id;
  readonly scope_ref: Sha256Id;
  readonly charts: readonly PrincipalityChart[];
  readonly bridges: readonly ChartBridge[];
  readonly coverage: "bounded_not_complete";
  readonly boundaries: typeof PRINCIPALITY_ATLAS_BOUNDARIES;
}
