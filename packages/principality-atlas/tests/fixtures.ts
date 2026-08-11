import {
  createPrincipalityAtlas,
  sha256Id,
  type AtlasCell,
  type AtlasClaim,
  type AtlasRelation,
  type ChartBridge,
  type PrincipalityChart,
} from "../src/index.js";

export const id = (name: string) => sha256Id(`principality-atlas-test:${name}`);

export function cell(name: string): AtlasCell {
  return { cell_ref: id(`cell:${name}`), kind_ref: id(`kind:${name}`) };
}

export function chart(
  name: string,
  cells: readonly AtlasCell[] = [],
  relations: readonly AtlasRelation[] = [],
  claims: readonly AtlasClaim[] = [],
): PrincipalityChart {
  return {
    chart_ref: id(`chart:${name}`),
    principality_ref: id(`principality:${name}`),
    perspective_ref: id(`perspective:${name}`),
    cells,
    relations,
    claims,
  };
}

export function relation(
  name: string,
  cells: readonly AtlasCell[],
): AtlasRelation {
  return {
    relation_ref: id(`relation:${name}`),
    kind_ref: id(`relation-kind:${name}`),
    incidences: cells.map((entry, index) => ({
      cell_ref: entry.cell_ref,
      role_ref: id(`role:${name}:${String(index)}`),
    })),
  };
}

export function claim(
  name: string,
  subject: AtlasClaim["subject"],
  perspective: string,
  posture: AtlasClaim["posture"],
  supersedes: AtlasClaim["supersedes_claim_ref"] = null,
): AtlasClaim {
  return {
    claim_ref: id(`claim:${name}`),
    subject,
    perspective_ref: id(`claim-perspective:${perspective}`),
    posture,
    evidence_refs: [],
    supersedes_claim_ref: supersedes,
    assertion: "caller_asserted",
    verified_by_package: false,
  };
}

export function atlas(
  charts: readonly PrincipalityChart[] = [],
  bridges: readonly ChartBridge[] = [],
) {
  return createPrincipalityAtlas({
    scope_ref: id("scope"),
    charts,
    bridges,
  });
}
