import type {
  LIVING_SUBSTRATE_BOUNDARIES,
  LIVING_SUBSTRATE_CONDITIONS,
  LIVING_SUBSTRATE_FACET_KINDS,
  LIVING_SUBSTRATE_FORMATS,
  LIVING_SUBSTRATE_RELATIONS,
  REGENERATION_ACTION_KINDS,
  REGENERATION_CHOICE,
  REGENERATION_REVERSIBILITY,
} from "./constants.js";

export type Sha256Id = `sha256:${string}`;
export type LivingSubstrateFacetKind =
  (typeof LIVING_SUBSTRATE_FACET_KINDS)[number];
export type LivingSubstrateCondition =
  (typeof LIVING_SUBSTRATE_CONDITIONS)[number];
export type LivingSubstrateRelationKind =
  (typeof LIVING_SUBSTRATE_RELATIONS)[number];
export type RegenerationActionKind = (typeof REGENERATION_ACTION_KINDS)[number];
export type RegenerationReversibility =
  (typeof REGENERATION_REVERSIBILITY)[number];

export interface LivingSubstrateFacet {
  readonly facet_id: Sha256Id;
  readonly kind: LivingSubstrateFacetKind;
  readonly condition: LivingSubstrateCondition;
  readonly evidence_refs: readonly Sha256Id[];
  readonly assertion: "caller_asserted";
  readonly verified_by_package: false;
}

export interface LivingSubstrateRelation {
  readonly from_ref: Sha256Id;
  readonly relation: LivingSubstrateRelationKind;
  readonly to_ref: Sha256Id;
  readonly evidence_refs: readonly Sha256Id[];
  readonly assertion: "caller_asserted";
  readonly verified_by_package: false;
}

export interface CreateLivingSubstrateMapInput {
  readonly scope_ref: Sha256Id;
  readonly facets: readonly LivingSubstrateFacet[];
  readonly relations: readonly LivingSubstrateRelation[];
}

export interface LivingSubstrateMap {
  readonly _format: (typeof LIVING_SUBSTRATE_FORMATS)["map"];
  readonly map_id: Sha256Id;
  readonly scope_ref: Sha256Id;
  readonly facets: readonly LivingSubstrateFacet[];
  readonly relations: readonly LivingSubstrateRelation[];
  readonly coverage: "bounded_not_complete";
  readonly boundaries: typeof LIVING_SUBSTRATE_BOUNDARIES;
}

export interface RegenerationAction {
  readonly action_ref: Sha256Id;
  readonly kind: RegenerationActionKind;
  readonly target_refs: readonly Sha256Id[];
  readonly basis_refs: readonly Sha256Id[];
  readonly reversibility: RegenerationReversibility;
  readonly state: "proposed_unaccepted";
  readonly authority: "separate_authority_required";
  readonly assertion: "caller_asserted";
  readonly verified_by_package: false;
}

export interface CreateRegenerationProposalInput {
  readonly actions: readonly RegenerationAction[];
}

export interface RegenerationProposal {
  readonly _format: (typeof LIVING_SUBSTRATE_FORMATS)["proposal"];
  readonly proposal_id: Sha256Id;
  readonly substrate_map_id: Sha256Id;
  readonly scope_ref: Sha256Id;
  readonly actions: readonly RegenerationAction[];
  readonly choice: typeof REGENERATION_CHOICE;
  readonly boundaries: typeof LIVING_SUBSTRATE_BOUNDARIES;
}
