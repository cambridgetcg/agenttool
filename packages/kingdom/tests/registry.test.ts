import { describe, expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import cardSchema from "../schema/agenttool-kingdom-card-v0.1.schema.json";
import registrySchema from "../schema/agenttool-kingdom-registry-v0.1.schema.json";
import {
  buildKingdomRegistry,
  encodeKingdomRegistry,
  MAX_KINGDOM_REGISTRY_MEMBERS,
  stringifyKingdomRegistry,
} from "../src/index.js";
import {
  AGENTTOOL_CARD_SOURCE,
  mustParse,
  XENIA_CARD_SOURCE,
} from "./fixtures.js";

const OBSERVED_AT = "2026-07-28T12:00:00.000Z";

describe("KINGDOM derived registry", () => {
  test("keeps members, dependency edges, and adoption declarations separate", () => {
    const agenttool = mustParse(AGENTTOOL_CARD_SOURCE);
    const xenia = mustParse(XENIA_CARD_SOURCE);
    const result = buildKingdomRegistry([agenttool, xenia], {
      observedAt: OBSERVED_AT,
    });

    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.registry).toMatchObject({
      schema_version: "agenttool.kingdom.registry/0.1",
      observed_at: OBSERVED_AT,
      members: [
        { name: "agenttool" },
        { name: "xenia" },
      ],
      dependency_edges: [{ from: "agenttool", to: "xenia" }],
      adoption_declarations: [
        { member: "agenttool", adoption: "xenia.rights/0.1" },
      ],
    });
    for (const member of result.registry.members) {
      expect(member).not.toHaveProperty("dependsOn");
      expect(member).not.toHaveProperty("adopts");
      expect(member).not.toHaveProperty("path");
    }
    const serialized = stringifyKingdomRegistry(result.registry);
    expect(serialized).not.toContain("/Users/");
    expect(serialized).not.toContain('"path"');
    expect(result.registry.declaration_boundary).toContain("do not prove");
    expect(Object.isFrozen(result.registry)).toBe(true);
  });

  test("produces deterministic bytes for fixed observedAt and any input order", () => {
    const agenttool = mustParse(AGENTTOOL_CARD_SOURCE);
    const xenia = mustParse(XENIA_CARD_SOURCE);
    const forward = buildKingdomRegistry([agenttool, xenia], {
      observedAt: OBSERVED_AT,
    });
    const reverse = buildKingdomRegistry([xenia, agenttool], {
      observedAt: OBSERVED_AT,
    });
    if (!forward.valid || !reverse.valid) {
      throw new Error("fixtures must build");
    }

    expect(stringifyKingdomRegistry(forward.registry)).toBe(
      stringifyKingdomRegistry(reverse.registry),
    );
    expect(encodeKingdomRegistry(forward.registry)).toEqual(
      encodeKingdomRegistry(reverse.registry),
    );
    expect(new TextDecoder().decode(encodeKingdomRegistry(forward.registry))).toEndWith(
      "\n",
    );
  });

  test("rejects duplicate members, unknown dependencies, and implicit clocks", () => {
    const agenttool = mustParse(AGENTTOOL_CARD_SOURCE);
    const duplicate = { ...agenttool, name: "AgentTool", dependsOn: [] };
    const duplicateResult = buildKingdomRegistry([agenttool, duplicate], {
      observedAt: OBSERVED_AT,
    });
    expect(duplicateResult.valid).toBe(false);
    expect(duplicateResult.diagnostics).toContainEqual(
      expect.objectContaining({ code: "duplicate-member" }),
    );

    const unknown = { ...agenttool, dependsOn: ["private-service"] };
    const unknownResult = buildKingdomRegistry([unknown], {
      observedAt: OBSERVED_AT,
    });
    expect(unknownResult.valid).toBe(false);
    expect(unknownResult.diagnostics).toContainEqual(
      expect.objectContaining({ code: "unknown-dependency" }),
    );
    expect(JSON.stringify(unknownResult.diagnostics)).not.toContain(
      "private-service",
    );

    const noTime = buildKingdomRegistry([agenttool], {} as {
      observedAt: string;
    });
    expect(noTime.valid).toBe(false);
    expect(noTime.diagnostics).toContainEqual(
      expect.objectContaining({ code: "invalid-observed-at" }),
    );
  });

  test("rejects sparse and over-limit arrays before deriving members", () => {
    const sparse = buildKingdomRegistry(new Array(1), {
      observedAt: OBSERVED_AT,
    });
    expect(sparse.valid).toBe(false);
    expect(sparse.diagnostics).toEqual([
      expect.objectContaining({ code: "invalid-type", card_index: 0 }),
    ]);

    const overLimit = buildKingdomRegistry(
      new Array(MAX_KINGDOM_REGISTRY_MEMBERS + 1),
      { observedAt: OBSERVED_AT },
    );
    expect(overLimit.valid).toBe(false);
    expect(overLimit.diagnostics).toEqual([
      expect.objectContaining({ code: "registry-size" }),
    ]);
  });

  test("card and registry outputs conform to bundled closed schemas", () => {
    const ajv = new Ajv2020({ strict: true });
    addFormats(ajv);
    const validateCard = ajv.compile(cardSchema);
    const validateRegistry = ajv.compile(registrySchema);
    const agenttool = mustParse(AGENTTOOL_CARD_SOURCE);
    const xenia = mustParse(XENIA_CARD_SOURCE);
    const result = buildKingdomRegistry([agenttool, xenia], {
      observedAt: OBSERVED_AT,
    });
    if (!result.valid) throw new Error("fixtures must build");

    expect(validateCard(agenttool)).toBe(true);
    expect(validateRegistry(result.registry)).toBe(true);
    expect(registrySchema.$defs.member.properties.purpose).toEqual(
      cardSchema.properties.purpose,
    );

    const withRegistryPurpose = (purpose: string) => ({
      ...result.registry,
      members: result.registry.members.map((member, index) =>
        index === 0 ? { ...member, purpose } : member
      ),
    });
    const internalWhitespace = "internal \ufeff separator";
    expect(validateCard({ ...agenttool, purpose: internalWhitespace })).toBe(true);
    expect(validateRegistry(withRegistryPurpose(internalWhitespace))).toBe(true);

    const invalidPurposes = [
      " ",
      " leading",
      "trailing ",
      "\ufeffleading",
      "trailing\ufeff",
      "ok\u0000",
      "ok\u007f",
      "ok\u0085",
      "ok\n",
    ];
    for (const purpose of invalidPurposes) {
      expect(validateCard({ ...agenttool, purpose }), purpose).toBe(false);
      expect(validateRegistry(withRegistryPurpose(purpose)), purpose).toBe(false);
    }

    expect(cardSchema.additionalProperties).toBe(false);
    expect(registrySchema.additionalProperties).toBe(false);
  });
});
