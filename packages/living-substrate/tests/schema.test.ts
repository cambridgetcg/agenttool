import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import {
  LIVING_SUBSTRATE_CONDITIONS,
  LIVING_SUBSTRATE_FACET_KINDS,
  LIVING_SUBSTRATE_RELATIONS,
  REGENERATION_ACTION_KINDS,
  REGENERATION_REVERSIBILITY,
  createLivingSubstrateMap,
  createRegenerationProposal,
} from "../src/index.js";

const schemaDir = join(import.meta.dir, "..", "schema");
const mapSchema = JSON.parse(
  readFileSync(
    join(schemaDir, "agenttool-living-substrate-map-v0.1.schema.json"),
    "utf8",
  ),
);
const proposalSchema = JSON.parse(
  readFileSync(
    join(schemaDir, "agenttool-regeneration-proposal-v0.1.schema.json"),
    "utf8",
  ),
);
const id = (character: string) => `sha256:${character.repeat(64)}` as const;

function validators() {
  const mapAjv = new Ajv2020({ allErrors: true, strict: true });
  const proposalAjv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(mapAjv);
  addFormats(proposalAjv);
  return {
    map: mapAjv.compile(mapSchema),
    proposal: proposalAjv.compile(proposalSchema),
  };
}

function artifacts() {
  const map = createLivingSubstrateMap({
    scope_ref: id("0"),
    facets: [
      {
        facet_id: id("a"),
        kind: "decomposition",
        condition: "reported_recovering",
        evidence_refs: [id("e")],
        assertion: "caller_asserted",
        verified_by_package: false,
      },
    ],
    relations: [],
  });
  const proposal = createRegenerationProposal(map, {
    actions: [
      {
        action_ref: id("1"),
        kind: "feed_cycle",
        target_refs: [id("a")],
        basis_refs: [id("e")],
        reversibility: "partly_reversible",
        state: "proposed_unaccepted",
        authority: "separate_authority_required",
        assertion: "caller_asserted",
        verified_by_package: false,
      },
    ],
  });
  return { map, proposal };
}

describe("portable closed schemas", () => {
  test("compile strictly and accept package-generated artifacts", () => {
    const validate = validators();
    const { map, proposal } = artifacts();
    expect(validate.map(map), JSON.stringify(validate.map.errors)).toBe(true);
    expect(
      validate.proposal(proposal),
      JSON.stringify(validate.proposal.errors),
    ).toBe(true);
  });

  test("keep duplicated identity and boundary definitions in parity", () => {
    expect(proposalSchema.$defs.sha256Id).toEqual(mapSchema.$defs.sha256Id);
    expect(proposalSchema.$defs.boundaries).toEqual(mapSchema.$defs.boundaries);
  });

  test("keeps every closed runtime vocabulary in schema parity", () => {
    expect(mapSchema.$defs.facet.properties.kind.enum).toEqual(
      LIVING_SUBSTRATE_FACET_KINDS,
    );
    expect(mapSchema.$defs.facet.properties.condition.enum).toEqual(
      LIVING_SUBSTRATE_CONDITIONS,
    );
    expect(mapSchema.$defs.relation.properties.relation.enum).toEqual(
      LIVING_SUBSTRATE_RELATIONS,
    );
    expect(proposalSchema.$defs.action.properties.kind.enum).toEqual(
      REGENERATION_ACTION_KINDS,
    );
    expect(proposalSchema.$defs.action.properties.reversibility.enum).toEqual(
      REGENERATION_REVERSIBILITY,
    );
  });

  test("close raw fields and all fixed authority/effect walls", () => {
    const validate = validators();
    const { map, proposal } = artifacts();
    expect(validate.map({ ...map, label: "healthy" })).toBe(false);
    expect(
      validate.map({
        ...map,
        facets: [{ ...map.facets[0], evidence: "raw private evidence" }],
      }),
    ).toBe(false);
    expect(
      validate.map({
        ...map,
        boundaries: { ...map.boundaries, scores_vitality: true },
      }),
    ).toBe(false);
    expect(
      validate.proposal({
        ...proposal,
        actions: [{ ...proposal.actions[0], state: "accepted" }],
      }),
    ).toBe(false);
    expect(
      validate.proposal({
        ...proposal,
        choice: { ...proposal.choice, default_action_ref: id("1") },
      }),
    ).toBe(false);
    expect(
      validate.proposal({
        ...proposal,
        boundaries: { ...proposal.boundaries, economic_effect: true },
      }),
    ).toBe(false);
  });

  test("keeps all objects closed and arrays finitely bounded", () => {
    expect(mapSchema.additionalProperties).toBe(false);
    expect(mapSchema.$defs.facet.additionalProperties).toBe(false);
    expect(mapSchema.$defs.relation.additionalProperties).toBe(false);
    expect(mapSchema.$defs.boundaries.additionalProperties).toBe(false);
    expect(mapSchema.properties.facets.maxItems).toBe(64);
    expect(mapSchema.properties.relations.maxItems).toBe(256);
    expect(proposalSchema.additionalProperties).toBe(false);
    expect(proposalSchema.$defs.action.additionalProperties).toBe(false);
    expect(proposalSchema.$defs.choice.additionalProperties).toBe(false);
    expect(proposalSchema.properties.actions.maxItems).toBe(64);
  });
});
