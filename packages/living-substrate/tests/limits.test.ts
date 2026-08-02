import { describe, expect, test } from "bun:test";

import {
  createLivingSubstrateMap,
  createRegenerationProposal,
  sha256Id,
} from "../src/index.js";

function facet(index: number) {
  return {
    facet_id: sha256Id(`limit-facet:${String(index)}`),
    kind: "layer" as const,
    condition: "unknown" as const,
    evidence_refs: [],
    assertion: "caller_asserted" as const,
    verified_by_package: false as const,
  };
}

function relation(facets: ReturnType<typeof facet>[], index: number) {
  const from = Math.floor(index / (facets.length - 1));
  const offset = index % (facets.length - 1);
  const to = offset >= from ? offset + 1 : offset;
  return {
    from_ref: facets[from]!.facet_id,
    relation: "supports" as const,
    to_ref: facets[to]!.facet_id,
    evidence_refs: [],
    assertion: "caller_asserted" as const,
    verified_by_package: false as const,
  };
}

function action(index: number, target: string) {
  return {
    action_ref: sha256Id(`limit-action:${String(index)}`),
    kind: "observe_more" as const,
    target_refs: [target as `sha256:${string}`],
    basis_refs: [],
    reversibility: "reversible" as const,
    state: "proposed_unaccepted" as const,
    authority: "separate_authority_required" as const,
    assertion: "caller_asserted" as const,
    verified_by_package: false as const,
  };
}

describe("closed public limits", () => {
  test("admits the maximum map and rejects one extra facet or relation", () => {
    const facets = Array.from({ length: 64 }, (_, index) => facet(index));
    const relations = Array.from({ length: 256 }, (_, index) =>
      relation(facets, index),
    );
    const map = createLivingSubstrateMap({
      scope_ref: sha256Id("limit-scope"),
      facets,
      relations,
    });
    expect(map.facets).toHaveLength(64);
    expect(map.relations).toHaveLength(256);
    expect(() =>
      createLivingSubstrateMap({
        scope_ref: sha256Id("limit-scope"),
        facets: [...facets, facet(64)],
        relations: [],
      }),
    ).toThrow(/at most 64 facets/);
    expect(() =>
      createLivingSubstrateMap({
        scope_ref: sha256Id("limit-scope"),
        facets,
        relations: [...relations, relation(facets, 256)],
      }),
    ).toThrow(/at most 256 relations/);
  });

  test("admits 64 actions and rejects action, evidence, target, and basis overflow", () => {
    const targetFacet = facet(0);
    const map = createLivingSubstrateMap({
      scope_ref: sha256Id("limit-scope"),
      facets: [targetFacet],
      relations: [],
    });
    const actions = Array.from({ length: 64 }, (_, index) =>
      action(index, targetFacet.facet_id),
    );
    expect(createRegenerationProposal(map, { actions }).actions).toHaveLength(
      64,
    );
    expect(() =>
      createRegenerationProposal(map, {
        actions: [...actions, action(64, targetFacet.facet_id)],
      }),
    ).toThrow(/at most 64 actions/);

    const refs = Array.from({ length: 17 }, (_, index) =>
      sha256Id(`limit-ref:${String(index)}`),
    );
    expect(() =>
      createLivingSubstrateMap({
        scope_ref: sha256Id("limit-scope"),
        facets: [{ ...targetFacet, evidence_refs: refs.slice(0, 9) }],
        relations: [],
      }),
    ).toThrow(/at most 8 refs/);
    expect(() =>
      createRegenerationProposal(map, {
        actions: [{ ...action(0, targetFacet.facet_id), target_refs: refs }],
      }),
    ).toThrow(/at most 16 refs/);
    expect(() =>
      createRegenerationProposal(map, {
        actions: [{ ...action(0, targetFacet.facet_id), basis_refs: refs }],
      }),
    ).toThrow(/at most 16 refs/);
  });
});
