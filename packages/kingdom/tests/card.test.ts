import { describe, expect, test } from "bun:test";
import {
  KINGDOM_CARD_SCHEMA_VERSION,
  MAX_KINGDOM_CARD_BYTES,
  parseKingdomCard,
  validateKingdomCard,
} from "../src/index.js";
import { AGENTTOOL_CARD_SOURCE } from "./fixtures.js";

describe("KINGDOM flat-card parser", () => {
  test("normalizes a valid card into the closed 0.1 wire contract", () => {
    const result = parseKingdomCard(AGENTTOOL_CARD_SOURCE, {
      knownNames: ["agenttool", "xenia"],
    });

    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.card).toEqual({
      schema_version: KINGDOM_CARD_SCHEMA_VERSION,
      name: "agenttool",
      kind: "infra",
      layer: "nervous",
      owner_sister: "none",
      domain: "none",
      state: "active",
      purpose: "Agent-facing discovery and local coordination tools.",
      dependsOn: ["xenia"],
      adopts: ["xenia.rights/0.1"],
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.card)).toBe(true);
    expect(Object.isFrozen(result.card.dependsOn)).toBe(true);
  });

  test("accepts CRLF and bounded quoted scalars without interpreting YAML features", () => {
    const source = AGENTTOOL_CARD_SOURCE
      .replace(
        "purpose: Agent-facing discovery and local coordination tools.",
        `purpose: "Agent-facing discovery, rights, and coordination tools."`,
      )
      .replace("dependsOn: [xenia]", "dependsOn: ['xenia']")
      .replaceAll("\n", "\r\n");
    const result = parseKingdomCard(source, {
      knownNames: ["agenttool", "xenia"],
    });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.card.purpose).toBe(
        "Agent-facing discovery, rights, and coordination tools.",
      );
      expect(result.card.dependsOn).toEqual(["xenia"]);
    }

    const tag = parseKingdomCard(
      AGENTTOOL_CARD_SOURCE.replace("name: agenttool", "name: !!str agenttool"),
    );
    expect(tag.valid).toBe(false);
    expect(tag.diagnostics.some(({ code }) => code === "malformed-value")).toBe(
      true,
    );
  });

  test("normalizes optional YAML adopts but requires it on wire objects", () => {
    const source = AGENTTOOL_CARD_SOURCE.replace(
      "adopts: [xenia.rights/0.1]\n",
      "",
    );
    const parsed = parseKingdomCard(source);
    expect(parsed.valid).toBe(true);
    if (!parsed.valid) return;
    expect(parsed.card.adopts).toEqual([]);

    const { adopts: _adopts, ...withoutAdopts } = parsed.card;
    const validated = validateKingdomCard(withoutAdopts);
    expect(validated.valid).toBe(false);
    expect(validated.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "missing-field",
        field: "adopts",
      }),
    );
  });

  test("reports missing, duplicate, and unknown fields without rejected values", () => {
    const secretValue = "should-never-appear-in-diagnostics";
    const source = AGENTTOOL_CARD_SOURCE
      .replace("kind: infra\n", "")
      .replace(
        "name: agenttool",
        `name: agenttool\nname: ${secretValue}\nprivate_path: /Users/person/secret`,
      );
    const result = parseKingdomCard(source);
    const serialized = JSON.stringify(result.diagnostics);

    expect(result.valid).toBe(false);
    expect(result.diagnostics.map(({ code }) => code)).toContain(
      "missing-field",
    );
    expect(result.diagnostics.map(({ code }) => code)).toContain(
      "duplicate-field",
    );
    expect(result.diagnostics.map(({ code }) => code)).toContain(
      "unknown-field",
    );
    expect(serialized).not.toContain(secretValue);
    expect(serialized).not.toContain("/Users/person/secret");
  });

  test("redacts rejected enum, dependency, and adoption values", () => {
    const values = [
      "forbidden-kind",
      "unknown-private-repo",
      "unsupported.rights/9.9",
    ];
    const source = AGENTTOOL_CARD_SOURCE
      .replace("kind: infra", `kind: ${values[0]}`)
      .replace("dependsOn: [xenia]", `dependsOn: [${values[1]}]`)
      .replace(
        "adopts: [xenia.rights/0.1]",
        `adopts: [${values[2]}]`,
      );
    const result = parseKingdomCard(source, {
      knownNames: ["agenttool", "xenia"],
    });
    const diagnostics = JSON.stringify(result.diagnostics);

    expect(result.valid).toBe(false);
    expect(result.diagnostics.map(({ code }) => code)).toContain("invalid-enum");
    expect(result.diagnostics.map(({ code }) => code)).toContain(
      "unknown-dependency",
    );
    expect(result.diagnostics.map(({ code }) => code)).toContain(
      "unsupported-adoption",
    );
    for (const value of values) expect(diagnostics).not.toContain(value);
  });

  test("rejects self dependencies and case-insensitive duplicate dependencies", () => {
    const self = parseKingdomCard(
      AGENTTOOL_CARD_SOURCE.replace("dependsOn: [xenia]", "dependsOn: [AgentTool]"),
    );
    expect(self.valid).toBe(false);
    expect(self.diagnostics).toContainEqual(
      expect.objectContaining({ code: "self-dependency" }),
    );

    const duplicate = parseKingdomCard(
      AGENTTOOL_CARD_SOURCE.replace(
        "dependsOn: [xenia]",
        "dependsOn: [xenia, XENIA]",
      ),
    );
    expect(duplicate.valid).toBe(false);
    expect(duplicate.diagnostics).toContainEqual(
      expect.objectContaining({ code: "duplicate-item" }),
    );
  });

  test("enforces control-character, line-ending, line-count, and byte bounds", () => {
    const control = parseKingdomCard(
      AGENTTOOL_CARD_SOURCE.replace("active", "active\u0000"),
    );
    expect(control.valid).toBe(false);
    expect(control.diagnostics[0]?.code).toBe("invalid-character");

    const tab = parseKingdomCard(
      AGENTTOOL_CARD_SOURCE.replace("active", "active\t"),
    );
    expect(tab.valid).toBe(false);
    expect(tab.diagnostics[0]?.code).toBe("invalid-character");

    const loneCr = parseKingdomCard(AGENTTOOL_CARD_SOURCE.replace("\n", "\r"));
    expect(loneCr.valid).toBe(false);
    expect(loneCr.diagnostics[0]?.code).toBe("invalid-character");

    const tooManyLines = parseKingdomCard(
      `${AGENTTOOL_CARD_SOURCE}${"# comment\n".repeat(65)}`,
    );
    expect(tooManyLines.valid).toBe(false);
    expect(tooManyLines.diagnostics[0]?.code).toBe("too-many-lines");

    const tooLarge = parseKingdomCard(
      "x".repeat(MAX_KINGDOM_CARD_BYTES + 1),
    );
    expect(tooLarge.valid).toBe(false);
    expect(tooLarge.diagnostics).toEqual([
      expect.objectContaining({ code: "source-too-large" }),
    ]);
  });

  test("validates unknown objects against a closed schema", () => {
    const parsed = parseKingdomCard(AGENTTOOL_CARD_SOURCE);
    if (!parsed.valid) throw new Error("fixture must be valid");
    const candidate = {
      ...parsed.card,
      schema_version: "agenttool.kingdom.card/9.9",
      localPath: "/Users/person/project",
    };
    const result = validateKingdomCard(candidate);
    const diagnostics = JSON.stringify(result.diagnostics);

    expect(result.valid).toBe(false);
    expect(result.diagnostics.map(({ code }) => code)).toContain(
      "invalid-schema-version",
    );
    expect(result.diagnostics.map(({ code }) => code)).toContain(
      "unknown-field",
    );
    expect(diagnostics).not.toContain("/Users/person/project");

    const unsafeKey = "unsafe\u001b[31m-field";
    const unsafe = validateKingdomCard({
      ...parsed.card,
      [unsafeKey]: "omitted",
    });
    expect(unsafe.valid).toBe(false);
    expect(JSON.stringify(unsafe.diagnostics)).not.toContain(unsafeKey);
  });

  test("rejects sparse dependency and adoption lists", () => {
    const parsed = parseKingdomCard(AGENTTOOL_CARD_SOURCE);
    if (!parsed.valid) throw new Error("fixture must be valid");

    for (const field of ["dependsOn", "adopts"] as const) {
      const result = validateKingdomCard({
        ...parsed.card,
        [field]: new Array(1),
      });
      expect(result.valid, field).toBe(false);
      expect(result.diagnostics, field).toContainEqual(
        expect.objectContaining({ code: "invalid-format", field }),
      );
    }
  });
});
