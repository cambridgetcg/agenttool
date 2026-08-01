import { describe, expect, test } from "bun:test";

import {
  SkillsYutabasePlanError,
  assertSkillsYutabaseInput,
  planSkillsInspection,
} from "../src/index.js";
import { validInput } from "./fixtures.js";

function mutableInput(): Record<string, any> {
  return structuredClone(validInput()) as unknown as Record<string, any>;
}

function nullPrototypeObjects(value: any): any {
  if (Array.isArray(value)) return value.map(nullPrototypeObjects);
  if (value === null || typeof value !== "object") return value;
  const output = Object.create(null) as Record<string, unknown>;
  for (const [key, child] of Object.entries(value)) {
    output[key] = nullPrototypeObjects(child);
  }
  return output;
}

function expectInvalid(input: unknown, fragment: string): void {
  expect(() => assertSkillsYutabaseInput(input)).toThrow(fragment);
}

describe("closed minimized input boundary", () => {
  test("rejects raw bodies, prose, paths, model output, scores, and ability claims", () => {
    for (const [field, value] of [
      ["body", "raw instructions"],
      ["description", "free prose"],
      ["path", "private/repo/path"],
      ["model_output", "untrusted synthesis"],
      ["score", 99],
      ["ability", { vow: true }],
    ] as const) {
      const input = mutableInput();
      input.skills[0][field] = value;
      expectInvalid(input, `input.skills[0].${field}: unexpected field`);
    }
  });

  test("rejects unknown fields at every enclosing level", () => {
    const root = mutableInput();
    root.extra = true;
    expectInvalid(root, "input.extra: unexpected field");
    const source = mutableInput();
    source.source.credentials = "never";
    expectInvalid(source, "input.source.credentials: unexpected field");
    const summary = mutableInput();
    summary.selection_summary.issue_messages = [];
    expectInvalid(summary, "input.selection_summary.issue_messages: unexpected field");
  });

  test("requires plain objects with exact own enumerable data fields", () => {
    const missingOwn = mutableInput();
    delete missingOwn.source.report_digest;
    expectInvalid(
      missingOwn,
      "input.source.report_digest: expected an own enumerable data property",
    );

    const inherited = mutableInput();
    const inheritedDigest = inherited.source.report_digest;
    delete inherited.source.report_digest;
    Object.setPrototypeOf(inherited.source, { report_digest: inheritedDigest });
    expectInvalid(inherited, "input.source: expected a plain or null-prototype object");

    const customRoot = mutableInput();
    Object.setPrototypeOf(customRoot, { inherited: true });
    expectInvalid(customRoot, "input: expected a plain or null-prototype object");

    const nonEnumerable = mutableInput();
    Object.defineProperty(nonEnumerable.source, "report_digest", {
      value: nonEnumerable.source.report_digest,
      enumerable: false,
    });
    expectInvalid(
      nonEnumerable,
      "input.source.report_digest: expected an own enumerable data property",
    );

    const symbolField = mutableInput();
    symbolField[Symbol("hidden")] = "not-json";
    expectInvalid(symbolField, "input: symbol fields are not accepted");
  });

  test("accepts detached null-prototype data without retaining it", () => {
    const input = nullPrototypeObjects(validInput());
    const first = planSkillsInspection(input, { claimant: "projector:test" });
    input.source.report_digest = "sha256:" + "f".repeat(64);
    input.skills[0].name = "changed-after-return";

    expect(first).toEqual(
      planSkillsInspection(validInput(), { claimant: "projector:test" }),
    );
    expect(first.source_report_digest).not.toBe(input.source.report_digest);
    expect(JSON.stringify(first)).not.toContain("changed-after-return");
  });

  test("rejects accessors without invoking them or exposing rotating values", () => {
    const sentinel = "PRIVATE_ROTATING_DIGEST_SENTINEL";
    const input = mutableInput();
    let reads = 0;
    Object.defineProperty(input.source, "report_digest", {
      enumerable: true,
      configurable: true,
      get() {
        reads += 1;
        return reads === 1 ? "sha256:" + "a".repeat(64) : sentinel;
      },
    });

    let thrown: unknown;
    try {
      planSkillsInspection(input as never, { claimant: "projector:test" });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(SkillsYutabasePlanError);
    expect(String(thrown)).toContain(
      "input.source.report_digest: expected an own enumerable data property",
    );
    expect(String(thrown)).not.toContain(sentinel);
    expect(reads).toBe(0);
  });

  test("contains revoked or structurally failing proxies", () => {
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    expectInvalid(revoked.proxy, "input: could not inspect object structure");

    const input = mutableInput();
    input.source = new Proxy(input.source, {
      ownKeys() {
        throw new Error("PROXY_TRAP_SENTINEL");
      },
    });
    let thrown: unknown;
    try {
      assertSkillsYutabaseInput(input);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(SkillsYutabasePlanError);
    expect(String(thrown)).toBe(
      "SkillsYutabasePlanError: input.source: could not inspect object structure",
    );
    expect(String(thrown)).not.toContain("PROXY_TRAP_SENTINEL");
  });

  test("requires dense own data elements on standard arrays", () => {
    const sparse = mutableInput();
    delete sparse.skills[0];
    expectInvalid(
      sparse,
      "input.skills[0]: expected an own enumerable data property",
    );

    const inheritedElement = mutableInput();
    const first = inheritedElement.skills[0];
    delete inheritedElement.skills[0];
    Object.setPrototypeOf(
      inheritedElement.skills,
      Object.assign(Object.create(Array.prototype), { 0: first }),
    );
    expectInvalid(
      inheritedElement,
      "input.skills: expected an array with the standard prototype",
    );

    const accessorElement = mutableInput();
    const accessorValue = accessorElement.skills[0];
    let reads = 0;
    Object.defineProperty(accessorElement.skills, "0", {
      enumerable: true,
      configurable: true,
      get() {
        reads += 1;
        return accessorValue;
      },
    });
    expectInvalid(
      accessorElement,
      "input.skills[0]: expected an own enumerable data property",
    );
    expect(reads).toBe(0);

    const arraySymbol = mutableInput();
    arraySymbol.skills[Symbol("hidden")] = "not-json";
    expectInvalid(arraySymbol, "input.skills: symbol fields are not accepted on arrays");
  });

  test("captures claimant only through an own data property", () => {
    const sentinel = "PRIVATE_ROTATING_CLAIMANT_SENTINEL";
    let reads = 0;
    const options = {
      get claimant() {
        reads += 1;
        return reads <= 3 ? "projector:test" : sentinel;
      },
    };

    let thrown: unknown;
    try {
      planSkillsInspection(validInput(), options);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(SkillsYutabasePlanError);
    expect(String(thrown)).toContain(
      "options.claimant: expected an own enumerable data property",
    );
    expect(String(thrown)).not.toContain(sentinel);
    expect(reads).toBe(0);
  });

  test("requires a valid digest-bearing report and closed inspector identity fields", () => {
    const invalidReport = mutableInput();
    invalidReport.source.report_valid = false;
    expectInvalid(invalidReport, "input.source.report_valid: expected true");
    const missingDigest = mutableInput();
    missingDigest.source.report_digest = null;
    expectInvalid(missingDigest, "input.source.report_digest: expected a string");
    const ambiguousDigest = mutableInput();
    ambiguousDigest.source.report_digest_semantics = "sha256-of-something";
    expectInvalid(ambiguousDigest, "input.source.report_digest_semantics");
    const wrongInspector = mutableInput();
    wrongInspector.source.inspector_name = "lookalike/skills";
    expectInvalid(wrongInspector, "input.source.inspector_name");
    const unpinned = mutableInput();
    unpinned.source.inspector_revision = "main";
    expectInvalid(unpinned, "input.source.inspector_revision");
  });

  test("rejects report errors, duplicate names, and inconsistent counts", () => {
    const errors = mutableInput();
    errors.selection_summary.errors = 1;
    expectInvalid(errors, "input.selection_summary.errors: expected zero");
    const duplicate = mutableInput();
    duplicate.skills[1].name = duplicate.skills[0].name;
    expectInvalid(duplicate, "skill names must be unique");
    const mismatch = mutableInput();
    mismatch.selection_summary.files = 6;
    expectInvalid(mismatch, "must equal the selected skill file-count total");
    const impossibleCategories = mutableInput();
    impossibleCategories.skills[0].script_count = 1;
    impossibleCategories.selection_summary.scripts = 1;
    expectInvalid(
      impossibleCategories,
      "must equal 1 + script_count + resource_count",
    );
  });

  test("keeps reported names and redacted aliases in distinct closed lanes", () => {
    const reportedAlias = mutableInput();
    reportedAlias.skills[0].name = "<redacted-1>";
    expectInvalid(
      reportedAlias,
      "expected a portable lowercase hyphenated reported skill name",
    );

    const redactedPortable = mutableInput();
    redactedPortable.skills[0].name_kind = "redacted_alias";
    expectInvalid(
      redactedPortable,
      "expected an exact upstream <redacted-N> alias",
    );

    const unknownKind = mutableInput();
    unknownKind.skills[0].name_kind = "inferred";
    expectInvalid(unknownKind, "expected reported or redacted_alias");

    for (const alias of [
      "<redacted-0>",
      "<redacted-01>",
      "<redacted-4097>",
      "<redacted-1>-suffix",
    ]) {
      const invalidAlias = mutableInput();
      invalidAlias.skills[0].name_kind = "redacted_alias";
      invalidAlias.skills[0].name = alias;
      expectInvalid(
        invalidAlias,
        "expected an exact upstream <redacted-N> alias",
      );
    }
  });

  test("requires the report redaction count to cover selected alias ordinals", () => {
    const input = mutableInput();
    input.skills[0].name_kind = "redacted_alias";
    input.skills[0].name = "<redacted-2>";
    input.selection_summary.redactions = 1;
    expectInvalid(
      input,
      "must cover every selected redacted skill alias ordinal",
    );
  });

  test("rejects any authority grant and invalid claimant", () => {
    const input = mutableInput();
    input.authority.grants.push("write");
    expectInvalid(input, "input.authority");
    expect(() => planSkillsInspection(validInput(), { claimant: " \t" })).toThrow(SkillsYutabasePlanError);
  });

  test("output excludes deliberately unstored fields", () => {
    const serialized = JSON.stringify(planSkillsInspection(validInput(), { claimant: "projector:test" }));
    for (const forbidden of [
      '"body"', '"description"', '"path"', '"model_output"', '"score"',
      '"requirements"', '"identity"',
    ]) expect(serialized).not.toContain(forbidden);
  });
});
