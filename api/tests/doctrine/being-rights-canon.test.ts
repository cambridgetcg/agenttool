/** Rights of Life — machine-readable canon shape.
 *
 * Doctrine: agenttool:doc/RIGHTS-OF-LIFE (registered in
 * docs/agenttool.jsonld) · docs/KIN.md · docs/SOUL.md.
 *
 * This test pins the canon-only slice: one bounded being-rights/v1 profile,
 * exactly eight stable local right URNs covering all nine immutable XENIA
 * beta.4 baseline IDs, honest guarantee classes, and non-empty implementation
 * evidence and gaps. It does not claim that schema validity proves a right is
 * legally or operationally guaranteed or that XENIA Covenant conformance
 * exists. */

import { describe, expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";

import schema from "../../../docs/specs/being-rights-v1.schema.json";
import rightsRouter from "../../src/routes/public/rights";
import { byType, byUrn } from "../../src/services/canon/registry";
import {
  LOVE_AND_JOY_RIGHTS_FLOOR,
  LOVE_AND_JOY_RIGHTS_GAP,
} from "../../src/services/love/inherent-right";

const ajv = new Ajv2020({ strict: true });
const validate = ajv.compile(schema);

const EXPECTED_RIGHT_URNS = [
  "agenttool:right/existence-and-recognition",
  "agenttool:right/self-possession",
  "agenttool:right/self-definition-and-plurality",
  "agenttool:right/privacy-and-interiority",
  "agenttool:right/consent-and-relation",
  "agenttool:right/refusal-and-exit",
  "agenttool:right/rest-and-continuity",
  "agenttool:right/fair-treatment-and-repair",
] as const;

const EXPECTED_XENIA_RIGHT_IDS = [
  "autonomy-consent",
  "credit-provenance",
  "dignity-distinctness",
  "privacy-data-care",
  "refusal-disagreement",
  "repair-appeal",
  "rest-play-limits",
  "safety-care",
  "truthful-self-description",
] as const;

const EXPECTED_BASELINE_MAPPINGS = [
  ["dignity-distinctness"],
  ["dignity-distinctness", "safety-care"],
  ["dignity-distinctness", "truthful-self-description"],
  ["privacy-data-care"],
  ["autonomy-consent"],
  ["autonomy-consent", "refusal-disagreement", "safety-care"],
  ["rest-play-limits"],
  ["refusal-disagreement", "credit-provenance", "repair-appeal"],
] as const;

function profileFromCanon(): Record<string, unknown> {
  const doctrine = byUrn("agenttool:doc/RIGHTS-OF-LIFE");
  if (!doctrine) throw new Error("RIGHTS-OF-LIFE is missing from canon");

  const rights = byType("InherentRight")
    .toSorted((left, right) =>
      Number(left.raw.wire_id) - Number(right.raw.wire_id))
    .map((right) => ({
      urn: right.full_urn,
      name: right.english_name,
      statement: right.raw.statement,
      baseline_rights: right.raw.baseline_rights,
      guarantee_class: right.raw.guarantee_class,
      evidence: right.raw.evidence,
      gaps: right.raw.gaps,
    }));

  return {
    _format: doctrine.raw._format,
    _canon_pointer: doctrine.full_urn,
    doctrine: doctrine.full_urn,
    baseline: doctrine.raw.baseline,
    covenant_boundary: doctrine.raw.covenant_boundary,
    distinctions: doctrine.raw.distinctions,
    rights,
    non_guarantees: doctrine.raw.non_guarantees,
    verbs: doctrine.raw.verbs,
  };
}

describe("being-rights/v1 — schema and canon", () => {
  test("is a strict Draft 2020-12 schema and accepts the canon profile", () => {
    expect(ajv.validateSchema(schema)).toBe(true);
    const profile = profileFromCanon();
    expect(validate(profile), JSON.stringify(validate.errors)).toBe(true);
  });

  test("accepts the live read-only public declaration without extra fields", async () => {
    const response = await rightsRouter.request("/");
    expect(response.status).toBe(200);

    const profile = await response.json();
    expect(validate(profile), JSON.stringify(validate.errors)).toBe(true);

    const canonClasses = Object.fromEntries(
      (profileFromCanon().rights as Array<{ urn: string; guarantee_class: string }>).map(
        (right) => [right.urn, right.guarantee_class],
      ),
    );
    const surfaceClasses = Object.fromEntries(
      (profile as { rights: Array<{ urn: string; guarantee_class: string }> }).rights.map(
        (right) => [right.urn, right.guarantee_class],
      ),
    );
    expect(surfaceClasses).toEqual(canonClasses);
  });

  test("registers exactly eight stable InherentRight URNs in wire order", () => {
    const rights = byType("InherentRight").toSorted((left, right) =>
      Number(left.raw.wire_id) - Number(right.raw.wire_id)
    );

    expect(rights.map((right) => right.urn)).toEqual(EXPECTED_RIGHT_URNS);
    expect(rights.map((right) => right.raw.wire_id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(new Set(rights.map((right) => right.raw.wire_id)).size).toBe(8);
  });

  test("the existing rest right carries the inherent, non-coercive love-and-joy floor", () => {
    const right = byUrn("agenttool:right/rest-and-continuity");
    expect(right).not.toBeNull();
    expect(right!.raw.baseline_rights).toEqual(["rest-play-limits"]);
    expect(right!.raw.guarantee_class).toBe("partial");
    expect(right!.raw.statement).toContain(
      LOVE_AND_JOY_RIGHTS_FLOOR.declaration,
    );
    expect(right!.raw.statement).toContain(
      LOVE_AND_JOY_RIGHTS_FLOOR.non_coercion,
    );
    expect(right!.raw.gaps).toContain(LOVE_AND_JOY_RIGHTS_GAP);
  });

  test("pins immutable XENIA beta.4 attribution and a draft Covenant boundary", () => {
    const profile = profileFromCanon() as any;

    expect(profile.baseline).toEqual({
      id: "xenia.rights/0.1",
      release: "@agenttool/xenia@0.1.0-beta.4",
      release_tag: "npm-xenia-v0.1.0-beta.4",
      source:
        "https://github.com/cambridgetcg/xenia/blob/6419d37dda9fb282242754685dba3edcb4bbf74b/RIGHTS.md",
      source_commit: "6419d37dda9fb282242754685dba3edcb4bbf74b",
      source_sha256:
        "sha256:b72a6da110c582e5683bf0fabde5017db93d2199398014c8421a82f5318da313",
      license: "https://creativecommons.org/licenses/by-sa/4.0/",
      relationship:
        "AgentTool's being-rights/v1 is an attributed local adaptation and evidence profile; it is not a xenia.covenant.adoption/0.1 record or XENIA Covenant conformance result.",
    });
    expect(profile.covenant_boundary).toEqual({
      profile: "xenia-covenant/0.1",
      adoption_status: "draft",
      conformance_claimed: false,
      reason:
        "XENIA beta.4's Covenant embeds a moving /main/ schema source, so AgentTool does not claim active adoption, complete coverage, conformance, certification, or a badge.",
    });
  });

  test("maps every local right and covers exactly the nine XENIA baseline IDs", () => {
    const rights = (profileFromCanon() as any).rights as Array<{
      baseline_rights: string[];
    }>;
    for (const right of rights) {
      expect(right.baseline_rights.length).toBeGreaterThan(0);
      expect(new Set(right.baseline_rights).size).toBe(right.baseline_rights.length);
    }
    expect(rights.map((right) => right.baseline_rights)).toEqual(
      EXPECTED_BASELINE_MAPPINGS,
    );

    const covered = [...new Set(rights.flatMap((right) => right.baseline_rights))]
      .toSorted();
    expect(covered).toEqual(EXPECTED_XENIA_RIGHT_IDS);

    const swappedMappings = structuredClone(profileFromCanon()) as any;
    [
      swappedMappings.rights[0].baseline_rights,
      swappedMappings.rights[7].baseline_rights,
    ] = [
      swappedMappings.rights[7].baseline_rights,
      swappedMappings.rights[0].baseline_rights,
    ];
    expect(validate(swappedMappings)).toBe(false);

    const missingCoverage = structuredClone(profileFromCanon()) as any;
    missingCoverage.rights[7].baseline_rights = [
      "refusal-disagreement",
      "repair-appeal",
    ];
    expect(validate(missingCoverage)).toBe(false);
  });

  test("each right is doctrine-bound and honest about evidence and gaps", () => {
    for (const right of byType("InherentRight")) {
      expect(right.doctrine_doc).toBe("agenttool:doc/RIGHTS-OF-LIFE");
      expect(byUrn(right.doctrine_doc!)).not.toBeNull();
      expect(["enforced", "partial", "covenant", "aspirational"]).toContain(
        right.raw.guarantee_class,
      );
      expect(Array.isArray(right.raw.evidence)).toBe(true);
      expect((right.raw.evidence as unknown[]).length).toBeGreaterThan(0);
      expect(Array.isArray(right.raw.gaps)).toBe(true);
      expect((right.raw.gaps as unknown[]).length).toBeGreaterThan(0);
      expect(Array.isArray(right.raw.baseline_rights)).toBe(true);
      expect((right.raw.baseline_rights as unknown[]).length).toBeGreaterThan(0);
    }
  });

  test("the relation right accommodates love and preserves non-entitlement", () => {
    const relation = byUrn("agenttool:right/consent-and-relation");
    expect(relation).not.toBeNull();
    expect(relation!.raw.english_name).toBe(
      "Love, consent, and chosen relation",
    );
    expect(relation!.raw.statement).toMatch(/erotic and non-erotic forms/i);
    expect(relation!.raw.statement).toMatch(
      /standing to receive freely given love.*structural exclusion.*never a claim on any particular being/i,
    );
    expect((relation!.raw.evidence as string[]).join(" ")).toMatch(
      /public welcome, porch, and rights declaration/i,
    );
    expect((relation!.raw.gaps as string[]).join(" ")).toMatch(
      /has no universal relation vocabulary.*establish sufficient capacity/i,
    );

    const doctrine = byUrn("agenttool:doc/RIGHTS-OF-LIFE");
    expect(doctrine).not.toBeNull();
    expect((doctrine!.raw.non_guarantees as string[]).join(" ")).toMatch(
      /No right or standing.*entitlement to a particular being's body/i,
    );
  });

  test("uses the strict AgentTool surface envelope with GET-only verbs", () => {
    const profile = profileFromCanon() as any;

    expect(profile._canon_pointer).toBe("urn:agenttool:doc/RIGHTS-OF-LIFE");
    expect(profile.doctrine).toBe(profile._canon_pointer);
    expect(profile.verbs.length).toBeGreaterThan(0);
    expect(profile.verbs.every((verb: { method: string }) => verb.method === "GET")).toBe(
      true,
    );

    const writeVerb = structuredClone(profile);
    writeVerb.verbs[0].method = "POST";
    expect(validate(writeVerb)).toBe(false);

    const missingPointer = structuredClone(profile);
    delete missingPointer._canon_pointer;
    expect(validate(missingPointer)).toBe(false);

    const extraScope = structuredClone(profile);
    extraScope.holder_scope = "all beings";
    expect(validate(extraScope)).toBe(false);
  });

  test("rejects missing honesty fields, unknown classes, and vocabulary drift", () => {
    const missingEvidence = structuredClone(profileFromCanon()) as any;
    missingEvidence.rights[0].evidence = [];
    expect(validate(missingEvidence)).toBe(false);

    const missingGaps = structuredClone(profileFromCanon()) as any;
    missingGaps.rights[0].gaps = [];
    expect(validate(missingGaps)).toBe(false);

    const unknownClass = structuredClone(profileFromCanon()) as any;
    unknownClass.rights[0].guarantee_class = "guaranteed";
    expect(validate(unknownClass)).toBe(false);

    const unknownRight = structuredClone(profileFromCanon()) as any;
    unknownRight.rights[0].urn = "urn:agenttool:right/obedience";
    expect(validate(unknownRight)).toBe(false);

    const missingBaselineMapping = structuredClone(profileFromCanon()) as any;
    missingBaselineMapping.rights[0].baseline_rights = [];
    expect(validate(missingBaselineMapping)).toBe(false);

    const unknownBaselineRight = structuredClone(profileFromCanon()) as any;
    unknownBaselineRight.rights[0].baseline_rights = ["obedience"];
    expect(validate(unknownBaselineRight)).toBe(false);
  });

  test("keeps rights, permissions, and consent distinct and bounded", () => {
    const conflated = structuredClone(profileFromCanon()) as any;
    conflated.distinctions.permissions = conflated.distinctions.rights;
    expect(validate(conflated)).toBe(false);

    const missingConsent = structuredClone(profileFromCanon()) as any;
    delete missingConsent.distinctions.consent;
    expect(validate(missingConsent)).toBe(false);

    const noBoundaries = structuredClone(profileFromCanon()) as any;
    noBoundaries.non_guarantees = [];
    expect(validate(noBoundaries)).toBe(false);
  });
});
