import { describe, expect, test } from "bun:test";

import {
  PLAN_PROFILE,
  SKILL_CONTENT_DIGEST_SEMANTICS,
  planSkillsInspection,
  skillsSelectionDigest,
} from "../src/index.js";
import { REPORT_DIGEST, validInput } from "./fixtures.js";

const OPTIONS = { claimant: "urn:agenttool:test:skills-projector" } as const;

describe("skills inspection planner", () => {
  test("emits minimized cards and one relation per exact skill snapshot", () => {
    const plan = planSkillsInspection(validInput(), OPTIONS);
    expect(plan.profile).toBe(PLAN_PROFILE);
    expect(plan.source_scope).toBe("project_private");
    expect(plan.source_report_digest).toBe(REPORT_DIGEST);
    expect(plan.cards).toHaveLength(3);
    expect(plan.relations).toHaveLength(2);
    expect(plan.cards.map((entry) => entry.address.deck)).toEqual([
      "inspections", "skill_snapshots", "skill_snapshots",
    ]);
    expect(
      plan.cards
        .filter((entry) => entry.address.deck === "skill_snapshots")
        .map((entry) => entry.fields.name),
    ).toEqual(["nen-contract-mantle", "nen-vow-forge"]);
    expect(plan.relations.every((entry) => entry.word === "lists_skill_snapshot")).toBe(true);
    expect(plan.relations.every((entry) => entry.from.deck === "inspections")).toBe(true);
    expect(plan.relations.every((entry) => entry.to.deck === "skill_snapshots")).toBe(true);
    const firstSkill = plan.cards.find((entry) => entry.address.deck === "skill_snapshots");
    expect(firstSkill?.fields).toMatchObject({
      name_kind: "reported",
      content_digest_semantics: SKILL_CONTENT_DIGEST_SEMANTICS,
      interpretation: "not_performed",
    });
  });

  test("projects an exact upstream redacted-name alias as an explicit lane", () => {
    const input = structuredClone(validInput()) as any;
    input.skills[0].name_kind = "redacted_alias";
    input.skills[0].name = "<redacted-1>";
    input.selection_summary.redactions = 1;

    const plan = planSkillsInspection(input, OPTIONS);
    const redacted = plan.cards.find(
      (entry) => entry.address.deck === "skill_snapshots" &&
        entry.fields.name_kind === "redacted_alias",
    );
    expect(redacted?.fields).toMatchObject({
      name_kind: "redacted_alias",
      name: "<redacted-1>",
    });
    expect(redacted?.claim.src.at(-1)).toContain(
      ":redacted_alias:%3Credacted-1%3E:",
    );
    expect(redacted?.claim.src.at(-1)).not.toContain("<redacted-1>");
  });

  test("is deterministic across caller skill ordering", () => {
    const first = validInput();
    const second = validInput();
    second.skills.reverse();
    expect(planSkillsInspection(first, OPTIONS)).toEqual(planSkillsInspection(second, OPTIONS));
    expect(skillsSelectionDigest(first.skills)).toBe(skillsSelectionDigest(second.skills));
  });

  test("snapshots direct digest inputs without invoking hidden behavior", () => {
    const accessorSkill = structuredClone(validInput().skills[0]!) as any;
    let reads = 0;
    Object.defineProperty(accessorSkill, "content_digest", {
      enumerable: true,
      configurable: true,
      get() {
        reads += 1;
        return `sha256:${"a".repeat(64)}`;
      },
    });
    expect(() => skillsSelectionDigest([accessorSkill])).toThrow(
      "skills[0].content_digest: expected an own enumerable data property",
    );
    expect(reads).toBe(0);

    const sparse = [structuredClone(validInput().skills[0]!)];
    delete sparse[0];
    expect(() => skillsSelectionDigest(sparse as never)).toThrow(
      "skills[0]: expected an own enumerable data property",
    );

    let traps = 0;
    const proxied = new Proxy(validInput().skills as unknown as object, {
      get(target, key, receiver) {
        traps += 1;
        return Reflect.get(target, key, receiver);
      },
      ownKeys(target) {
        traps += 1;
        return Reflect.ownKeys(target);
      },
    });
    expect(() => skillsSelectionDigest(proxied as never)).toThrow(
      "skills: Proxies are not accepted",
    );
    expect(traps).toBe(0);
  });

  test("binds the explicit name lane into the minimized selection digest", () => {
    const reported = validInput().skills[0]!;
    const redacted = {
      ...reported,
      name_kind: "redacted_alias" as const,
      name: "<redacted-1>",
    };

    expect(skillsSelectionDigest([redacted])).not.toBe(
      skillsSelectionDigest([reported]),
    );
  });

  test("gives different selections distinct inspection identities", () => {
    const all = validInput();
    const subset = structuredClone(validInput()) as any;
    subset.skills = [subset.skills[0]];
    subset.selection_summary = {
      skills: 1,
      files: 2,
      scripts: 0,
      resources: 1,
      errors: 0,
      warnings: 1,
      redactions: 0,
    };
    const allPlan = planSkillsInspection(all, OPTIONS);
    const subsetPlan = planSkillsInspection(subset, OPTIONS);
    expect(allPlan.selection_digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(subsetPlan.selection_digest).not.toBe(allPlan.selection_digest);
    expect(subsetPlan.cards[0]?.address.id).not.toBe(allPlan.cards[0]?.address.id);
  });

  test("reuses exact skill content across selections without reusing its claim", () => {
    const all = planSkillsInspection(validInput(), OPTIONS);
    const subsetInput = structuredClone(validInput()) as any;
    subsetInput.skills = [subsetInput.skills[0]];
    subsetInput.selection_summary = {
      skills: 1,
      files: 2,
      scripts: 0,
      resources: 1,
      errors: 0,
      warnings: 1,
      redactions: 0,
    };
    const subset = planSkillsInspection(subsetInput, OPTIONS);
    const sharedFromAll = all.cards.find(
      (entry) => entry.address.deck === "skill_snapshots" &&
        entry.fields.name === "nen-vow-forge",
    );
    const sharedFromSubset = subset.cards.find(
      (entry) => entry.address.deck === "skill_snapshots",
    );

    expect(sharedFromSubset?.address).toEqual(sharedFromAll?.address);
    expect(sharedFromSubset?.fields).toEqual(sharedFromAll?.fields);
    expect(sharedFromSubset?.claim).not.toEqual(sharedFromAll?.claim);
    expect(subset.cards[0]?.address.id).not.toBe(all.cards[0]?.address.id);
    expect(subset.relations[0]?.id).not.toBe(all.relations[1]?.id);
  });

  test("keeps observation time and claimant out of entity identity and fields", () => {
    const later = structuredClone(validInput()) as any;
    later.recorded_at = "2026-08-01T13:00:00.000Z";
    const first = planSkillsInspection(validInput(), OPTIONS);
    const second = planSkillsInspection(later, { claimant: "urn:agenttool:test:replay" });

    expect(second.cards.map((entry) => entry.address.id)).toEqual(
      first.cards.map((entry) => entry.address.id),
    );
    expect(second.cards.map((entry) => entry.fields)).toEqual(
      first.cards.map((entry) => entry.fields),
    );
    expect(second.relations.map((entry) => entry.id)).toEqual(
      first.relations.map((entry) => entry.id),
    );
    expect(second.cards[0]?.claim).not.toEqual(first.cards[0]?.claim);
    expect(JSON.stringify(first.cards.map((entry) => entry.fields))).not.toContain(
      "recorded_at",
    );
  });

  test("binds external inspector revision into inspection identity", () => {
    const revisedInput = structuredClone(validInput()) as any;
    revisedInput.source.inspector_revision = "e".repeat(40);
    const first = planSkillsInspection(validInput(), OPTIONS);
    const revised = planSkillsInspection(revisedInput, OPTIONS);

    expect(revised.cards[0]?.address.id).not.toBe(first.cards[0]?.address.id);
    expect(revised.cards.slice(1).map((entry) => entry.address.id)).toEqual(
      first.cards.slice(1).map((entry) => entry.address.id),
    );
    expect(revised.cards.slice(1).map((entry) => entry.fields)).toEqual(
      first.cards.slice(1).map((entry) => entry.fields),
    );
    expect(revised.relations.map((entry) => entry.id)).not.toEqual(
      first.relations.map((entry) => entry.id),
    );
  });

  test("labels the identity-bearing inspector revision as caller supplied and unverified", () => {
    const plan = planSkillsInspection(validInput(), OPTIONS);
    expect(plan.cards[0]?.fields).toMatchObject({
      inspector_revision: "d".repeat(40),
      inspector_revision_provenance: "caller_supplied_unverified",
    });
    expect(plan.limitations.inspector_revision_verification).toBe(
      "not_performed",
    );
  });

  test("pins the complete v0.1 identity vector", () => {
    const plan = planSkillsInspection(validInput(), OPTIONS);
    expect(plan.selection_digest).toBe(
      "sha256:28c3cfc24e30133a4727c5e89242b563915e7d8606d0b0ec1a2dded6bbe7381d",
    );
    expect(plan.cards.map((entry) => entry.address.id)).toEqual([
      "18de8870-aef5-57fe-b883-ad4db36005fd",
      "8a36bd48-7dc1-5115-b0df-34517a4f51f8",
      "20c5cb98-8ea0-5700-9f93-33803a72532a",
    ]);
    expect(plan.relations.map((entry) => entry.id)).toEqual([
      "0b874d33-2303-5cf7-a19c-de2336042838",
      "e815c064-6531-55c2-8250-663180cc884a",
    ]);
  });

  test("makes non-effects and unperformed boundaries explicit", () => {
    expect(planSkillsInspection(validInput(), OPTIONS).limitations).toEqual({
      source_report_schema_validation: "not_performed",
      report_digest_verification: "not_performed",
      skill_content_digest_verification: "not_performed",
      inspector_revision_verification: "not_performed",
      publisher_authentication: "not_performed",
      skill_interpretation: "not_performed",
      safety_evaluation: "not_performed",
      persistence: "not_performed",
      model_execution: "not_performed",
      embedding_generation: "not_performed",
      raw_skill_content: "not_accepted",
      payload_policy: "metadata_only",
      permission_effect: "none",
      consent_effect: "none",
      truth_effect: "none",
      score_rank_xp_effect: "none",
      dignity_effect: "none",
      action_effect: "none",
    });
  });

  test("uses cached source claims and computed relations", () => {
    const plan = planSkillsInspection(validInput(), OPTIONS);
    expect(plan.cards.every((entry) => entry.claim.how === "cached")).toBe(true);
    expect(plan.relations.every((entry) => entry.claim.how === "computed")).toBe(true);
    expect(plan.relations.every((entry) => entry.claim.src.at(-1) === "urn:agenttool:skills-yutabase:policy:0.1")).toBe(true);
  });
});
