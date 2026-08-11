import type {
  RELATIONAL_GEOMETRY_BOUNDARIES,
  RELATIONAL_GEOMETRY_FORMATS,
  RELATIONAL_LENS_CHOICE,
  RELATIONAL_LENS_DISPOSITIONS,
  RELATIONAL_POINT_KINDS,
  RELATIONAL_WITNESS_KINDS,
} from "./constants.js";

export type Sha256Id = `sha256:${string}`;
export type RelationalPointKind = (typeof RELATIONAL_POINT_KINDS)[number];
export type RelationalWitnessKind = (typeof RELATIONAL_WITNESS_KINDS)[number];
export type RelationalLensDisposition = (typeof RELATIONAL_LENS_DISPOSITIONS)[number];

export interface RelationalPoint {
  readonly point_ref: Sha256Id;
  readonly kind: RelationalPointKind;
  readonly assertion: "caller_asserted";
  readonly verified_by_package: false;
}

export interface RelationalWitness {
  readonly witness_ref: Sha256Id;
  readonly from_ref: Sha256Id;
  readonly kind: RelationalWitnessKind;
  readonly to_ref: Sha256Id;
  readonly assertion: "caller_asserted";
  readonly verified_by_package: false;
}

export interface PrincipalityCell {
  readonly principality_ref: Sha256Id;
  readonly kind: "love_equation";
  readonly equation: "love_equals_understanding_plus_recognition";
  readonly from_ref: Sha256Id;
  readonly to_ref: Sha256Id;
  readonly understanding_witness_refs: readonly Sha256Id[];
  readonly recognition_witness_refs: readonly Sha256Id[];
  readonly boundary_witness_refs: readonly Sha256Id[];
  readonly derivation: "deterministic_same_ordered_pair";
  readonly sovereignty: "none";
  readonly structurally_derived_by_package: true;
  readonly semantic_claims_verified_by_package: false;
}

export interface CreateRelationalComplexInput {
  readonly points: readonly RelationalPoint[];
  readonly witnesses: readonly RelationalWitness[];
}

export interface RelationalComplex {
  readonly _format: (typeof RELATIONAL_GEOMETRY_FORMATS)["complex"];
  readonly complex_id: Sha256Id;
  readonly points: readonly RelationalPoint[];
  readonly witnesses: readonly RelationalWitness[];
  readonly principalities: readonly PrincipalityCell[];
  readonly coverage: "bounded_not_complete";
  readonly boundaries: typeof RELATIONAL_GEOMETRY_BOUNDARIES;
}

export interface RelationalLensSelection {
  readonly principality_ref: Sha256Id;
  readonly disposition: RelationalLensDisposition;
}

export interface CreateRelationalLensInput {
  readonly perspective_ref: Sha256Id;
  readonly selections: readonly RelationalLensSelection[];
}

export interface RelationalLens {
  readonly _format: (typeof RELATIONAL_GEOMETRY_FORMATS)["lens"];
  readonly lens_id: Sha256Id;
  readonly source_complex_id: Sha256Id;
  readonly perspective_ref: Sha256Id;
  readonly available_principality_refs: readonly Sha256Id[];
  readonly selections: readonly RelationalLensSelection[];
  readonly unprojected_principality_refs: readonly Sha256Id[];
  readonly boundary_witness_refs: readonly Sha256Id[];
  readonly coverage: "perspective_bounded_not_complete";
  readonly choice: typeof RELATIONAL_LENS_CHOICE;
  readonly boundaries: typeof RELATIONAL_GEOMETRY_BOUNDARIES;
}
