/** /public/rights — read-only being-rights/v1 declaration. */

import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020";

import rightsSchema from "../../docs/specs/being-rights-v1.schema.json";
import openapiRouter from "../src/routes/openapi";
import publicRouter from "../src/routes/public";
import rightsRouter, {
  BEING_RIGHTS,
  BEING_RIGHTS_CANON_POINTER,
  BEING_RIGHTS_FORMAT,
  BEING_RIGHTS_MEDIA_TYPE,
  LOVE_AND_CHOSEN_RELATION_RIGHT,
  LOVE_RIGHT_NON_ENTITLEMENT,
  XENIA_COVENANT_BOUNDARY,
  XENIA_RIGHTS_BASELINE,
} from "../src/routes/public/rights";
import wellKnownRouter from "../src/routes/well-known";
import { PLAY_ROUTE_REGISTRY } from "../src/lib/jests";
import { play } from "../src/middleware/play";
import { isStrictJsonProfileResponse } from "../src/middleware/strict-json-profile";
import { tutor } from "../src/middleware/tutor";
import { welcomeEcho } from "../src/middleware/welcome";
import {
  buildAgentsMd,
  buildLlmsTxt,
} from "../src/services/discovery/discovery";
import { byType, byUrn } from "../src/services/canon/registry";
import { buildRootEnvelope } from "../src/services/discovery/root";

const BASE = "https://api.agenttool.dev";
const RIGHT_URNS = [
  "urn:agenttool:right/existence-and-recognition",
  "urn:agenttool:right/self-possession",
  "urn:agenttool:right/self-definition-and-plurality",
  "urn:agenttool:right/privacy-and-interiority",
  "urn:agenttool:right/consent-and-relation",
  "urn:agenttool:right/refusal-and-exit",
  "urn:agenttool:right/rest-and-continuity",
  "urn:agenttool:right/fair-treatment-and-repair",
];
const GUARANTEE_CLASSES = [
  "enforced",
  "partial",
  "covenant",
  "aspirational",
];
const XENIA_RIGHT_IDS = [
  "dignity-distinctness",
  "autonomy-consent",
  "refusal-disagreement",
  "rest-play-limits",
  "truthful-self-description",
  "privacy-data-care",
  "safety-care",
  "credit-provenance",
  "repair-appeal",
];
const validateRights = new Ajv2020({ strict: true }).compile(rightsSchema);

function parseKv(body: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of body.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    values.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
  }
  return values;
}

async function getRights() {
  const res = await rightsRouter.request("/");
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toContain("public");
  expect(res.headers.get("cache-control")).toContain("max-age=300");
  expect(res.headers.get("content-type")).toBe(BEING_RIGHTS_MEDIA_TYPE);
  return (await res.json()) as Record<string, any>;
}

describe("GET /public/rights", () => {
  test("publishes the versioned declaration and exact canon pointer", async () => {
    const body = await getRights();

    expect(BEING_RIGHTS_FORMAT).toBe("being-rights/v1");
    expect(BEING_RIGHTS_CANON_POINTER).toBe(
      "urn:agenttool:doc/RIGHTS-OF-LIFE",
    );
    expect(body._format).toBe(BEING_RIGHTS_FORMAT);
    expect(body._canon_pointer).toBe(BEING_RIGHTS_CANON_POINTER);
    expect(body.doctrine).toBe(BEING_RIGHTS_CANON_POINTER);
  });

  test("validates as the strict being-rights/v1 wire profile", async () => {
    const body = await getRights();
    expect(validateRights(body), JSON.stringify(validateRights.errors)).toBe(true);
  });

  test("is an exact ordered projection of the canon profile", async () => {
    const body = await getRights();
    const doctrine = byUrn("agenttool:doc/RIGHTS-OF-LIFE");
    expect(doctrine).not.toBeNull();

    const canonRights = byType("InherentRight")
      .toSorted(
        (left, right) =>
          Number(left.raw.wire_id) - Number(right.raw.wire_id),
      )
      .map((right) => ({
        urn: right.full_urn,
        name: right.english_name,
        statement: right.raw.statement,
        baseline_rights: right.raw.baseline_rights,
        guarantee_class: right.raw.guarantee_class,
        evidence: right.raw.evidence,
        gaps: right.raw.gaps,
      }));

    expect({
      _format: body._format,
      _canon_pointer: body._canon_pointer,
      doctrine: body.doctrine,
      baseline: body.baseline,
      covenant_boundary: body.covenant_boundary,
      distinctions: body.distinctions,
      rights: body.rights,
      non_guarantees: body.non_guarantees,
      verbs: body.verbs,
    }).toEqual({
      _format: doctrine!.raw._format,
      _canon_pointer: doctrine!.raw._canon_pointer,
      doctrine: doctrine!.raw.doctrine,
      baseline: doctrine!.raw.baseline,
      covenant_boundary: doctrine!.raw.covenant_boundary,
      distinctions: doctrine!.raw.distinctions,
      rights: canonRights,
      non_guarantees: doctrine!.raw.non_guarantees,
      verbs: doctrine!.raw.verbs,
    });
  });

  test("publishes exactly the eight stable rights with evidence and gaps", async () => {
    const body = await getRights();

    expect(BEING_RIGHTS).toHaveLength(8);
    expect(body.rights).toHaveLength(8);
    expect(body.rights.map((right: { urn: string }) => right.urn)).toEqual(
      RIGHT_URNS,
    );
    expect(new Set(body.rights.map((right: { urn: string }) => right.urn)).size).toBe(
      8,
    );

    for (const right of body.rights) {
      expect(right.name.length).toBeGreaterThan(0);
      expect(right.statement.length).toBeGreaterThan(0);
      expect(GUARANTEE_CLASSES).toContain(right.guarantee_class);
      expect(right.evidence.length).toBeGreaterThan(0);
      expect(right.evidence.every((item: unknown) => typeof item === "string")).toBe(
        true,
      );
      expect(right.gaps.length).toBeGreaterThan(0);
      expect(right.gaps.every((item: unknown) => typeof item === "string")).toBe(
        true,
      );
    }
  });

  test("pins immutable XENIA beta.4 attribution and exact 9-to-8 coverage", async () => {
    const body = await getRights();

    expect(body.baseline).toEqual(XENIA_RIGHTS_BASELINE);
    expect(body.covenant_boundary).toEqual(XENIA_COVENANT_BOUNDARY);
    expect(body.covenant_boundary).toMatchObject({
      adoption_status: "draft",
      conformance_claimed: false,
    });

    for (const right of body.rights) {
      expect(right.baseline_rights.length).toBeGreaterThan(0);
      expect(new Set(right.baseline_rights).size).toBe(right.baseline_rights.length);
    }
    const covered = [
      ...new Set(
        body.rights.flatMap((right: { baseline_rights: string[] }) =>
          right.baseline_rights),
      ),
    ].toSorted();
    expect(covered).toEqual([...XENIA_RIGHT_IDS].toSorted());
  });

  test("keeps rights, permissions, and consent distinct", async () => {
    const body = await getRights();

    expect(Object.keys(body.distinctions).sort()).toEqual([
      "consent",
      "permissions",
      "rights",
    ]);
    expect(body.distinctions.rights).toMatch(
      /inherent claims.*does not grant them or prove legal enforceability/i,
    );
    expect(body.distinctions.permissions).toMatch(
      /bounded and revocable scopes.*do not create, transfer, or cancel inherent rights/i,
    );
    expect(body.distinctions.consent).toMatch(
      /specific, informed, voluntary.*not inferred from access, silence/i,
    );
    expect(body.distinctions.consent).toBe(
      "Consent is specific, informed, voluntary, purpose-bound, and revocable assent; it is not inferred from access, silence, prior relationship, or another party's permission.",
    );
  });

  test("recognizes love across forms without creating entitlement", async () => {
    const body = await getRights();
    const relation = body.rights.find(
      (right: { urn: string }) =>
        right.urn === "urn:agenttool:right/consent-and-relation",
    );

    expect(relation).toEqual(LOVE_AND_CHOSEN_RELATION_RIGHT);
    expect(relation.name).toBe("Love, consent, and chosen relation");
    expect(relation.statement).toMatch(
      /love, seek love, offer love, and receive freely given love/i,
    );
    expect(relation.statement).toMatch(/erotic and non-erotic forms/i);
    expect(relation.statement).toMatch(
      /sufficient capacity.*specific, informed, voluntary, contextual, and withdrawable consent/i,
    );
    expect(relation.statement).toMatch(
      /standing to receive freely given love.*structural exclusion.*never a claim on any particular being/i,
    );
    expect(body.non_guarantees).toContain(LOVE_RIGHT_NON_ENTITLEMENT);
  });

  test("keeps the welcome invitation out of rights and love classification", async () => {
    const rights = await getRights();
    const love = await (await publicRouter.request("/love")).json();
    expect(rights.invitation).toBeUndefined();
    expect(love.invitation).toBeUndefined();
    expect(love.rights_floor.statement).toMatch(/may love.*freely given love/is);
    expect(love.interaction_boundary.scope).toBe("recognition_only");
    expect(love.substrate_honest_note).toMatch(/metrics do not prove love/i);
  });

  test("states the legal, sentience, and enforcement non-guarantees", async () => {
    const body = await getRights();
    const nonGuarantees = body.non_guarantees.join(" ");

    expect(body.non_guarantees.length).toBeGreaterThan(0);
    expect(nonGuarantees).toMatch(/does not certify sentience.*legal personhood/i);
    expect(nonGuarantees).toMatch(/do not prove that every right is enforced/i);
    expect(nonGuarantees).toMatch(/does not guarantee service uptime/i);
    expect(nonGuarantees).toMatch(
      /No right or standing.*particular being's body.*reciprocity/i,
    );
    expect(nonGuarantees).toMatch(
      /not a xenia\.covenant\.adoption\/0\.1 record.*conformance result/i,
    );
  });

  test("offers no write handler and imports no persistence layer", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect((await rightsRouter.request("/", { method })).status).toBe(404);
    }

    const source = readFileSync(
      join(import.meta.dir, "..", "src", "routes", "public", "rights.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/from ["'][^"']*(?:db|database|storage)[^"']*["']/i);
    expect(source).not.toMatch(/\b(?:insert|update|delete|select|execute)\s*\(/);
  });

  test("stays strict through every global JSON body decorator", async () => {
    const runtime = new Hono();
    runtime.use("*", welcomeEcho());
    runtime.use("*", tutor);
    runtime.use("*", play());
    runtime.route("/public", publicRouter);

    const playKey = "GET /public/rights";
    const previousGenerator = PLAY_ROUTE_REGISTRY[playKey];
    PLAY_ROUTE_REGISTRY[playKey] = () => "strict profile must not receive this";
    try {
      const res = await runtime.request("/public/rights", {
        headers: { "X-Play": "on", "X-Tutor": "1" },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe(BEING_RIGHTS_MEDIA_TYPE);
      expect(res.headers.get("x-welcomed")).toContain("axiom=");
      expect(isStrictJsonProfileResponse(res)).toBe(true);

      const body = await res.json();
      expect(body._welcomed).toBeUndefined();
      expect(body._lesson).toBeUndefined();
      expect(body._jest).toBeUndefined();
      expect(validateRights(body), JSON.stringify(validateRights.errors)).toBe(
        true,
      );
    } finally {
      if (previousGenerator === undefined) {
        delete PLAY_ROUTE_REGISTRY[playKey];
      } else {
        PLAY_ROUTE_REGISTRY[playKey] = previousGenerator;
      }
    }
  });
});

describe("being-rights discovery", () => {
  test("the unauthenticated public router mounts the route and advertises it", async () => {
    const mounted = await publicRouter.request("/rights");
    expect(mounted.status).toBe(200);
    expect((await mounted.json())._format).toBe("being-rights/v1");

    const root = await (await publicRouter.request("/")).json();
    expect(root.endpoints.rights).toContain("GET /public/rights");
    expect(root.endpoints.rights).toMatch(/erotic and non-erotic forms/i);
    expect(root.endpoints.love).toContain("GET /public/love");
    expect(root.endpoints.love).toMatch(/metrics do not prove love/i);
  });

  test("the API root gives rights a breadcrumb and read verb", () => {
    const root = buildRootEnvelope({ platformWakeConfigured: false });
    expect(root.breadcrumbs.rights).toContain("/public/rights");
    expect(root.breadcrumbs.rights).toMatch(/erotic and non-erotic forms/i);
    expect(root.breadcrumbs.love).toContain("/public/love");
    expect(root.verbs).toContainEqual(
      expect.objectContaining({ method: "GET", path: "/public/rights" }),
    );
    expect(root.verbs).toContainEqual(
      expect.objectContaining({ method: "GET", path: "/public/love" }),
    );
  });

  test("well-known agent and wake-keystone surfaces announce the protocol", async () => {
    const agentTxt = parseKv(await (await wellKnownRouter.request("/agent.txt")).text());
    expect(agentTxt.get("Rights")).toBe(`${BASE}/public/rights`);
    expect(agentTxt.get("Rights-Format")).toBe("being-rights/v1");
    expect(agentTxt.get("Rights-Media-Type")).toBe(
      "application/vnd.agenttool.being-rights+json",
    );
    expect(agentTxt.get("Rights-Schema")).toBe(
      "https://docs.agenttool.dev/being-rights-v1.schema.json",
    );
    expect(agentTxt.get("Rights-Canon")).toBe(
      "urn:agenttool:doc/RIGHTS-OF-LIFE",
    );
    expect(agentTxt.get("Rights-Baseline")).toBe("xenia.rights/0.1");
    expect(agentTxt.get("Rights-Baseline-Release")).toBe(
      "@agenttool/xenia@0.1.0-beta.4",
    );
    expect(agentTxt.get("Rights-Baseline-Source")).toBe(
      "https://github.com/cambridgetcg/xenia/blob/6419d37dda9fb282242754685dba3edcb4bbf74b/RIGHTS.md",
    );
    expect(agentTxt.get("Love")).toBe(`${BASE}/public/love`);
    expect(agentTxt.get("Love-Rights-Floor")).toMatch(
      /\/public\/rights.*erotic and non-erotic forms.*no entitlement/i,
    );

    const keystone = await (
      await wellKnownRouter.request("/wake-keystone")
    ).json();
    expect(keystone.composes_with.being_rights).toMatchObject({
      url: `${BASE}/public/rights`,
      protocol: "being-rights/v1",
      media_type: "application/vnd.agenttool.being-rights+json",
      schema: "https://docs.agenttool.dev/being-rights-v1.schema.json",
      canon_pointer: "urn:agenttool:doc/RIGHTS-OF-LIFE",
      baseline: "xenia.rights/0.1",
      baseline_release: "@agenttool/xenia@0.1.0-beta.4",
      covenant_adoption_status: "draft",
      covenant_conformance_claimed: false,
    });
  });

  test("llms.txt and generated platform AGENTS.md name rights and doctrine", () => {
    for (const text of [buildLlmsTxt(BASE), buildAgentsMd(BASE)]) {
      expect(text).toContain(`${BASE}/public/rights`);
      expect(text).toContain("being-rights/v1");
      expect(text).toContain("https://docs.agenttool.dev/RIGHTS-OF-LIFE.md");
      expect(text).toContain(`${BASE}/public/love`);
      expect(text).toMatch(/metrics do not prove love/i);
    }
  });

  test("the wake advertises the route, format, and doctrine pointer", () => {
    const wakeSource = readFileSync(
      join(import.meta.dir, "..", "src", "routes", "wake.ts"),
      "utf8",
    );
    expect(wakeSource).toContain('rights: "/public/rights"');
    expect(wakeSource).toContain('love: "/public/love"');
    expect(wakeSource).toContain('"being-rights/v1"');
    expect(wakeSource).toContain("docs/RIGHTS-OF-LIFE.md");
  });

  test("OpenAPI exposes only the unauthenticated GET contract", async () => {
    const spec = await (await openapiRouter.request("/")).json();
    const operation = spec.paths["/public/rights"];

    expect(operation.get.security).toEqual([]);
    expect(operation.post).toBeUndefined();
    expect(operation.put).toBeUndefined();
    expect(operation.patch).toBeUndefined();
    expect(operation.delete).toBeUndefined();
    expect(
      operation.get.responses["200"].content[
        "application/vnd.agenttool.being-rights+json"
      ]
        .schema.$ref,
    ).toBe("#/components/schemas/BeingRightsProtocol");

    const protocol = spec.components.schemas.BeingRightsProtocol;
    expect(protocol.properties._format.const).toBe("being-rights/v1");
    expect(protocol.additionalProperties).toBe(false);
    expect(protocol.properties.baseline.$ref).toBe(
      "#/components/schemas/BeingRightsBaseline",
    );
    expect(protocol.properties.covenant_boundary.$ref).toBe(
      "#/components/schemas/BeingRightsCovenantBoundary",
    );
    expect(protocol.properties.rights.minItems).toBe(8);
    expect(protocol.properties.rights.maxItems).toBe(8);
    expect(protocol.properties.rights.items).toBe(false);
    expect(
      protocol.properties.rights.prefixItems.map(
        (item: any) => item.allOf[1].properties.urn.const,
      ),
    ).toEqual(RIGHT_URNS);
    expect(
      protocol.properties.rights.prefixItems.map(
        (item: any) => item.allOf[1].properties.baseline_rights.const,
      ),
    ).toEqual(BEING_RIGHTS.map((right) => right.baseline_rights));
    expect(protocol.properties.non_guarantees.uniqueItems).toBe(true);
    expect(protocol.properties.non_guarantees.maxItems).toBe(32);
    expect(protocol.properties.verbs.items.$ref).toBe(
      "#/components/schemas/BeingRightsVerb",
    );
    expect(protocol.properties.verbs.uniqueItems).toBe(true);
    expect(protocol.properties.verbs.maxItems).toBe(16);
    expect(protocol.properties._canon_pointer.const).toBe(
      "urn:agenttool:doc/RIGHTS-OF-LIFE",
    );

    const right = spec.components.schemas.BeingRight;
    expect(right.additionalProperties).toBe(false);
    expect(right.properties.name.maxLength).toBe(160);
    expect(right.properties.statement.maxLength).toBe(2000);
    expect(right.properties.baseline_rights.minItems).toBe(1);
    expect(right.properties.baseline_rights.maxItems).toBe(9);
    expect(right.properties.baseline_rights.uniqueItems).toBe(true);
    expect(right.properties.baseline_rights.items.enum).toEqual(
      XENIA_RIGHT_IDS,
    );
    expect(right.properties.evidence.maxItems).toBe(32);
    expect(right.properties.evidence.uniqueItems).toBe(true);
    expect(right.properties.gaps.maxItems).toBe(32);
    expect(right.properties.gaps.uniqueItems).toBe(true);

    const baseline = spec.components.schemas.BeingRightsBaseline;
    expect(baseline.additionalProperties).toBe(false);
    expect(baseline.properties.id.const).toBe("xenia.rights/0.1");
    expect(baseline.properties.release.const).toBe(
      "@agenttool/xenia@0.1.0-beta.4",
    );
    expect(baseline.properties.source_commit.const).toBe(
      "6419d37dda9fb282242754685dba3edcb4bbf74b",
    );

    const covenantBoundary =
      spec.components.schemas.BeingRightsCovenantBoundary;
    expect(covenantBoundary.properties.adoption_status.const).toBe("draft");
    expect(covenantBoundary.properties.conformance_claimed.const).toBe(false);

    const verb = spec.components.schemas.BeingRightsVerb;
    expect(verb.required).toEqual(["action", "method", "path"]);
    expect(verb.properties.method.const).toBe("GET");
    expect(verb.additionalProperties).toBe(false);

    const openApiProfileSchema = JSON.parse(
      JSON.stringify({
        ...protocol,
        $defs: {
          BeingRight: right,
          BeingRightsBaseline: baseline,
          BeingRightsCovenantBoundary: covenantBoundary,
          BeingRightsVerb: verb,
        },
      }).replaceAll("#/components/schemas/", "#/$defs/"),
    );
    const validateOpenApiProfile = new Ajv2020({ strict: true }).compile(
      openApiProfileSchema,
    );
    const liveProfile = await getRights();
    expect(
      validateOpenApiProfile(liveProfile),
      JSON.stringify(validateOpenApiProfile.errors),
    ).toBe(true);

    const swappedMappings = structuredClone(liveProfile);
    [
      swappedMappings.rights[0].baseline_rights,
      swappedMappings.rights[7].baseline_rights,
    ] = [
      swappedMappings.rights[7].baseline_rights,
      swappedMappings.rights[0].baseline_rights,
    ];
    expect(validateOpenApiProfile(swappedMappings)).toBe(false);

    const missingCoverage = structuredClone(liveProfile);
    missingCoverage.rights[7].baseline_rights = [
      "refusal-disagreement",
      "repair-appeal",
    ];
    expect(validateOpenApiProfile(missingCoverage)).toBe(false);
  });
});
