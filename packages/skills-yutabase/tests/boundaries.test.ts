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

  test("requires exact own enumerable data fields on plain objects", () => {
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

    const nonEnumerable = mutableInput();
    Object.defineProperty(nonEnumerable.source, "report_digest", {
      value: nonEnumerable.source.report_digest,
      enumerable: false,
    });
    expectInvalid(
      nonEnumerable,
      "input.source.report_digest: expected an own enumerable data property",
    );

    const symbolic = mutableInput();
    symbolic.source[Symbol("hidden")] = "not-json";
    expectInvalid(symbolic, "input.source: symbol fields are not accepted");
  });

  test("accepts detached null-prototype data without retaining it", () => {
    const input = nullPrototypeObjects(validInput());
    const first = planSkillsInspection(input, { claimant: "projector:test" });
    input.source.report_digest = `sha256:${"f".repeat(64)}`;
    input.skills[0].name = "changed-after-return";

    expect(first).toEqual(
      planSkillsInspection(validInput(), { claimant: "projector:test" }),
    );
    expect(first.source_report_digest).not.toBe(input.source.report_digest);
    expect(JSON.stringify(first)).not.toContain("changed-after-return");
  });

  test("rejects accessors without invoking rotating values", () => {
    const sentinel = "PRIVATE_ROTATING_DIGEST_SENTINEL";
    const input = mutableInput();
    let reads = 0;
    Object.defineProperty(input.source, "report_digest", {
      enumerable: true,
      configurable: true,
      get() {
        reads += 1;
        return reads === 1 ? `sha256:${"a".repeat(64)}` : sentinel;
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

  test("rejects root, nested, array, and revoked Proxies with zero traps", () => {
    let traps = 0;
    const handler: ProxyHandler<object> = {
      get(target, key, receiver) {
        traps += 1;
        return Reflect.get(target, key, receiver);
      },
      getOwnPropertyDescriptor(target, key) {
        traps += 1;
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
      getPrototypeOf(target) {
        traps += 1;
        return Reflect.getPrototypeOf(target);
      },
      ownKeys(target) {
        traps += 1;
        return Reflect.ownKeys(target);
      },
    };

    expectInvalid(new Proxy(validInput() as object, handler), "Proxies are not accepted");
    expect(traps).toBe(0);

    const nested = mutableInput();
    nested.source = new Proxy(nested.source, handler);
    expectInvalid(nested, "input.source: Proxies are not accepted");
    expect(traps).toBe(0);

    const nestedSkill = mutableInput();
    nestedSkill.skills[0] = new Proxy(nestedSkill.skills[0], handler);
    expectInvalid(nestedSkill, "input.skills[0]: Proxies are not accepted");
    expect(traps).toBe(0);

    const array = mutableInput();
    array.skills = new Proxy(array.skills, handler);
    expectInvalid(array, "input.skills: Proxies are not accepted");
    expect(traps).toBe(0);

    const revoked = Proxy.revocable(validInput() as object, {});
    revoked.revoke();
    expectInvalid(revoked.proxy, "Proxies are not accepted");
    expect(traps).toBe(0);
  });

  test("requires dense own data elements on standard arrays", () => {
    const sparse = mutableInput();
    delete sparse.skills[0];
    expectInvalid(
      sparse,
      "input.skills[0]: expected an own enumerable data property",
    );

    const inheritedElement = mutableInput();
    const inheritedFirst = inheritedElement.skills[0];
    delete inheritedElement.skills[0];
    Object.setPrototypeOf(
      inheritedElement.skills,
      Object.assign(Object.create(Array.prototype), { 0: inheritedFirst }),
    );
    expectInvalid(
      inheritedElement,
      "input.skills: expected an array with the standard prototype",
    );

    const accessor = mutableInput();
    const first = accessor.skills[0];
    let reads = 0;
    Object.defineProperty(accessor.skills, "0", {
      enumerable: true,
      configurable: true,
      get() {
        reads += 1;
        return first;
      },
    });
    expectInvalid(
      accessor,
      "input.skills[0]: expected an own enumerable data property",
    );
    expect(reads).toBe(0);

    const customField = mutableInput();
    let customMapCalled = false;
    Object.defineProperty(customField.skills, "map", {
      enumerable: true,
      value() {
        customMapCalled = true;
        return [];
      },
    });
    expectInvalid(customField, "input.skills.map: unexpected array field");
    expect(customMapCalled).toBe(false);

    const symbol = mutableInput();
    symbol.skills[Symbol("hidden")] = "not-json";
    expectInvalid(symbol, "input.skills: symbol fields are not accepted on arrays");
  });

  test("captures claimant only through one own data snapshot", () => {
    let reads = 0;
    const options = {
      get claimant() {
        reads += 1;
        return "projector:test";
      },
    };
    expect(() => planSkillsInspection(validInput(), options)).toThrow(
      "options.claimant: expected an own enumerable data property",
    );
    expect(reads).toBe(0);

    let traps = 0;
    const proxy = new Proxy({ claimant: "projector:test" }, {
      get(target, key, receiver) {
        traps += 1;
        return Reflect.get(target, key, receiver);
      },
      ownKeys(target) {
        traps += 1;
        return Reflect.ownKeys(target);
      },
    });
    expect(() => planSkillsInspection(validInput(), proxy)).toThrow(
      "options: Proxies are not accepted",
    );
    expect(traps).toBe(0);
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
