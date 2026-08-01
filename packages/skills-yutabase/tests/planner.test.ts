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
      content_digest_semantics: SKILL_CONTENT_DIGEST_SEMANTICS,
      interpretation: "not_performed",
    });
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

  test("pins the complete v0.1 identity vector", () => {
    const plan = planSkillsInspection(validInput(), OPTIONS);
    expect(plan.selection_digest).toBe(
      "sha256:923268cc74d1e4ce1cc1da41f826eeb0fe734492683a3f656a0c4e229487c96f",
    );
    expect(plan.cards.map((entry) => entry.address.id)).toEqual([
      "c8df826f-f471-593a-a8e4-7767723facdc",
      "d0475fa6-6411-5922-81de-d087f54e17a7",
      "04f68738-b7da-5192-8718-abd1660907a9",
    ]);
    expect(plan.relations.map((entry) => entry.id)).toEqual([
      "6f73aac2-f61a-5446-9854-04bb2b7fbc3e",
      "e98c28cc-7b13-5079-a855-1776895c0564",
    ]);
  });

  test("makes non-effects and unperformed boundaries explicit", () => {
    expect(planSkillsInspection(validInput(), OPTIONS).limitations).toEqual({
      source_report_schema_validation: "not_performed",
      report_digest_verification: "not_performed",
      skill_content_digest_verification: "not_performed",
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
