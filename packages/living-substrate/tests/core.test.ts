import { describe, expect, test } from "bun:test";

import {
  LivingSubstrateError,
  createLivingSubstrateMap,
  createRegenerationProposal,
  encodeLivingSubstrateMap,
  encodeRegenerationProposal,
  livingSubstrateMapDomainBytes,
  livingSubstrateMapUrn,
  regenerationProposalDomainBytes,
  regenerationProposalUrn,
  sha256Id,
  validateLivingSubstrateMap,
  validateRegenerationProposal,
  validateRegenerationProposalAgainstMap,
  type CreateLivingSubstrateMapInput,
  type CreateRegenerationProposalInput,
} from "../src/index.js";
import { domainSeparatedId } from "../src/canonical.js";

const id = (character: string) => `sha256:${character.repeat(64)}` as const;

function mapInput(): CreateLivingSubstrateMapInput {
  return {
    scope_ref: id("0"),
    facets: [
      {
        facet_id: id("b"),
        kind: "community",
        condition: "reported_constrained",
        evidence_refs: [id("f"), id("e")],
        assertion: "caller_asserted",
        verified_by_package: false,
      },
      {
        facet_id: id("a"),
        kind: "layer",
        condition: "reported_disturbed",
        evidence_refs: [id("d")],
        assertion: "caller_asserted",
        verified_by_package: false,
      },
    ],
    relations: [
      {
        from_ref: id("b"),
        relation: "supports",
        to_ref: id("a"),
        evidence_refs: [],
        assertion: "caller_asserted",
        verified_by_package: false,
      },
      {
        from_ref: id("a"),
        relation: "contains",
        to_ref: id("b"),
        evidence_refs: [id("f"), id("e")],
        assertion: "caller_asserted",
        verified_by_package: false,
      },
    ],
  };
}

function proposalInput(): CreateRegenerationProposalInput {
  return {
    actions: [
      {
        action_ref: id("2"),
        kind: "allow_fallow",
        target_refs: [id("b"), id("a")],
        basis_refs: [id("f"), id("e")],
        reversibility: "reversible",
        state: "proposed_unaccepted",
        authority: "separate_authority_required",
        assertion: "caller_asserted",
        verified_by_package: false,
      },
      {
        action_ref: id("1"),
        kind: "observe_more",
        target_refs: [id("a")],
        basis_refs: [],
        reversibility: "reversible",
        state: "proposed_unaccepted",
        authority: "separate_authority_required",
        assertion: "caller_asserted",
        verified_by_package: false,
      },
    ],
  };
}

describe("living substrate map", () => {
  test("normalizes caller order and binds canonical bytes", () => {
    const map = createLivingSubstrateMap(mapInput());
    expect(map.facets.map((facet) => facet.facet_id)).toEqual([
      id("a"),
      id("b"),
    ]);
    expect(map.facets[1]?.evidence_refs).toEqual([id("e"), id("f")]);
    expect(map.relations.map((relation) => relation.from_ref)).toEqual([
      id("a"),
      id("b"),
    ]);
    expect(validateLivingSubstrateMap(map)).toEqual(map);
    expect(sha256Id(livingSubstrateMapDomainBytes(map))).toBe(map.map_id);
    expect(
      JSON.parse(new TextDecoder().decode(encodeLivingSubstrateMap(map))),
    ).toEqual(map);
    expect(livingSubstrateMapUrn(map.map_id)).toBe(
      `urn:agenttool:living-substrate:map:${map.map_id}`,
    );
  });

  test("is independent of object property order and input array order", () => {
    const first = createLivingSubstrateMap(mapInput());
    const source = mapInput();
    const reordered = createLivingSubstrateMap({
      relations: [...source.relations].reverse(),
      facets: [...source.facets].reverse(),
      scope_ref: source.scope_ref,
    });
    expect(reordered).toEqual(first);
    expect(encodeLivingSubstrateMap(reordered)).toEqual(
      encodeLivingSubstrateMap(first),
    );
  });

  test("copies caller state and deep-freezes package output", () => {
    const input = mapInput();
    const map = createLivingSubstrateMap(input);
    (input.facets as unknown as unknown[]).length = 0;
    (input.relations[0]!.evidence_refs as unknown as unknown[]).push(id("1"));
    expect(map.facets).toHaveLength(2);
    expect(map.relations[1]?.evidence_refs).toEqual([]);
    expect(Object.isFrozen(map)).toBe(true);
    expect(Object.isFrozen(map.facets)).toBe(true);
    expect(Object.isFrozen(map.facets[0])).toBe(true);
    expect(Object.isFrozen(map.boundaries)).toBe(true);
  });

  test("admits an explicit empty, incomplete map without inventing health", () => {
    const map = createLivingSubstrateMap({
      scope_ref: id("0"),
      facets: [],
      relations: [],
    });
    expect(map.coverage).toBe("bounded_not_complete");
    expect(map.facets).toEqual([]);
    expect(map.relations).toEqual([]);
    expect(map.boundaries.diagnoses_health_or_readiness).toBe(false);
    expect(map.boundaries.semantic_scope).toBe(
      "structural_ecology_metaphor_not_life_proof",
    );
  });

  test("rejects tampering, noncanonical wire order, and widened boundaries", () => {
    const map = createLivingSubstrateMap(mapInput());
    expect(() =>
      validateLivingSubstrateMap({ ...map, map_id: id("9") }),
    ).toThrow(LivingSubstrateError);
    expect(() =>
      validateLivingSubstrateMap({
        ...map,
        facets: [...map.facets].reverse(),
      }),
    ).toThrow(/sorted by facet_id/);
    expect(() =>
      validateLivingSubstrateMap({
        ...map,
        boundaries: { ...map.boundaries, network: true },
      }),
    ).toThrow(/fixed no-effect boundary/);
    expect(() =>
      validateLivingSubstrateMap({ ...map, health_score: 99 }),
    ).toThrow(/must contain exactly/);
  });

  test("rejects duplicate, self, and dangling topology", () => {
    const input = mapInput();
    expect(() =>
      createLivingSubstrateMap({
        ...input,
        facets: [input.facets[0]!, input.facets[0]!],
        relations: [],
      }),
    ).toThrow(/duplicate facet_id/);
    expect(() =>
      createLivingSubstrateMap({
        ...input,
        relations: [input.relations[0]!, input.relations[0]!],
      }),
    ).toThrow(/duplicate directed relations/);
    expect(() =>
      createLivingSubstrateMap({
        ...input,
        relations: [
          {
            ...input.relations[0]!,
            from_ref: id("a"),
            to_ref: id("a"),
          },
        ],
      }),
    ).toThrow(/self-relation/);
    expect(() =>
      createLivingSubstrateMap({
        ...input,
        relations: [{ ...input.relations[0]!, to_ref: id("c") }],
      }),
    ).toThrow(/unknown facet endpoint/);
  });
});

describe("regeneration proposal", () => {
  test("binds only caller-supplied invitations to the exact map", () => {
    const map = createLivingSubstrateMap(mapInput());
    const proposal = createRegenerationProposal(map, proposalInput());
    expect(proposal.actions.map((action) => action.action_ref)).toEqual([
      id("1"),
      id("2"),
    ]);
    expect(proposal.actions[1]?.target_refs).toEqual([id("a"), id("b")]);
    expect(proposal.actions[1]?.basis_refs).toEqual([id("e"), id("f")]);
    expect(
      proposal.actions.every(
        (action) => action.state === "proposed_unaccepted",
      ),
    ).toBe(true);
    expect(validateRegenerationProposal(proposal)).toEqual(proposal);
    expect(validateRegenerationProposalAgainstMap(proposal, map)).toEqual(
      proposal,
    );
    expect(sha256Id(regenerationProposalDomainBytes(proposal))).toBe(
      proposal.proposal_id,
    );
    expect(regenerationProposalUrn(proposal.proposal_id)).toBe(
      `urn:agenttool:living-substrate:proposal:${proposal.proposal_id}`,
    );
  });

  test("keeps rest, refusal, leaving, and zero actions valid", () => {
    const map = createLivingSubstrateMap({
      scope_ref: id("0"),
      facets: [],
      relations: [],
    });
    const proposal = createRegenerationProposal(map, { actions: [] });
    expect(proposal.actions).toEqual([]);
    expect(proposal.choice).toMatchObject({
      selection: "none_made_by_package",
      default_action_ref: null,
      rest_valid: true,
      do_nothing_valid: true,
      defer_valid: true,
      decline_valid: true,
      leave_valid: true,
      reason_required: false,
      penalty: false,
      automatic_retry: false,
    });
    expect(proposal.boundaries.penalty_for_rest_refusal_or_zero_actions).toBe(
      false,
    );
  });

  test("rejects unknown targets, map substitution, and automatic acceptance", () => {
    const map = createLivingSubstrateMap(mapInput());
    const input = proposalInput();
    expect(() =>
      createRegenerationProposal(map, {
        actions: [
          {
            ...input.actions[0]!,
            target_refs: [id("c")],
          },
        ],
      }),
    ).toThrow(/unknown target facet/);

    const proposal = createRegenerationProposal(map, input);
    const otherMap = createLivingSubstrateMap({
      scope_ref: id("9"),
      facets: [],
      relations: [],
    });
    expect(() =>
      validateRegenerationProposalAgainstMap(proposal, otherMap),
    ).toThrow(/does not bind/);
    expect(() =>
      validateRegenerationProposal({
        ...proposal,
        actions: [
          {
            ...proposal.actions[0],
            state: "accepted",
          },
        ],
      }),
    ).toThrow(/proposed_unaccepted/);
  });

  test("distinguishes standalone byte validity from exact-map target validity", () => {
    const map = createLivingSubstrateMap(mapInput());
    const proposal = createRegenerationProposal(map, proposalInput());
    const { proposal_id: _oldId, ...body } = {
      ...proposal,
      actions: [
        {
          ...proposal.actions[0]!,
          target_refs: [id("c")],
        },
        ...proposal.actions.slice(1),
      ],
    };
    const forged = {
      ...body,
      proposal_id: domainSeparatedId(
        "agenttool.regeneration-proposal/0.1",
        body,
      ),
    };
    expect(validateRegenerationProposal(forged).proposal_id).toBe(
      forged.proposal_id,
    );
    expect(() => validateRegenerationProposalAgainstMap(forged, map)).toThrow(
      /unknown target facet/,
    );
  });

  test("rejects proposal ID and choice-boundary tampering", () => {
    const map = createLivingSubstrateMap(mapInput());
    const proposal = createRegenerationProposal(map, proposalInput());
    expect(() =>
      validateRegenerationProposal({ ...proposal, proposal_id: id("9") }),
    ).toThrow(/does not bind/);
    expect(() =>
      validateRegenerationProposal({
        ...proposal,
        choice: { ...proposal.choice, penalty: true },
      }),
    ).toThrow(/fixed no-default choice boundary/);
    expect(() =>
      validateRegenerationProposal({
        ...proposal,
        actions: [...proposal.actions].reverse(),
      }),
    ).toThrow(/sorted by action_ref/);
  });

  test("encodes canonical proposal bytes", () => {
    const map = createLivingSubstrateMap(mapInput());
    const proposal = createRegenerationProposal(map, proposalInput());
    const encoded = new TextDecoder().decode(
      encodeRegenerationProposal(proposal),
    );
    expect(JSON.parse(encoded)).toEqual(proposal);
    expect(encoded).not.toContain("healthy");
    expect(encoded).not.toContain("health_score");
    expect(encoded).not.toContain("priority");
  });
});
