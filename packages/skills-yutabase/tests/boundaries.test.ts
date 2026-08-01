import { describe, expect, test } from "bun:test";

import { SkillsYutabasePlanError, assertSkillsYutabaseInput, planSkillsInspection } from "../src/index.js";
import { validInput } from "./fixtures.js";

function mutableInput(): Record<string, any> {
  return structuredClone(validInput()) as unknown as Record<string, any>;
}

function expectInvalid(input: unknown, fragment: string): void {
  expect(() => assertSkillsYutabaseInput(input as never)).toThrow(fragment);
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

  test("requires a valid digest-bearing report and exact inspector provenance", () => {
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
