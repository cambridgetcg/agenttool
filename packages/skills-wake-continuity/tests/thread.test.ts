import { describe, expect, test } from "bun:test";

import {
  SkillsWakeContinuityError,
  createSkillsWakeContinuityThread,
  validateSkillsWakeContinuityThread,
  validateSkillsWakeContinuityThreadAgainstPlan,
  validateSkillsYutabasePlan,
} from "../src/index.js";
import {
  CLAIMANT,
  INSPECTOR_REVISION,
  PROJECT_ID,
  clone,
  maximumPlan,
  validInput,
  validPlan,
} from "./fixtures.js";

describe("Skills reference-only continuity thread", () => {
  test("pins a deterministic minimized vector without names or mutable claims", () => {
    const thread = createSkillsWakeContinuityThread(validPlan());
    expect(thread.profile).toBe("agenttool.skills-wake-continuity-thread/v0.1");
    expect(thread.thread_id).toBe(
      "sha256:47a5903b2aa013b2d2e1dd62913994a148de01ea1e7d5e51882a20d24aae7964",
    );
    expect(thread.inspector_revision).toBe(INSPECTOR_REVISION);
    expect(thread.selected_skill_count).toBe(2);
    expect(thread.snapshots).toHaveLength(2);
    expect(thread.snapshots.map((entry) => entry.snapshot_ref)).toEqual(
      [...thread.snapshots.map((entry) => entry.snapshot_ref)].sort(),
    );
    const wire = JSON.stringify(thread);
    for (const forbidden of [
      PROJECT_ID,
      CLAIMANT,
      "2026-08-01T12:00:00.000Z",
      "nen-vow-forge",
      "nen-contract-mantle",
      '"by":',
      '"at":',
      '"src":',
      "lists_skill_snapshot",
    ]) {
      expect(wire).not.toContain(forbidden);
    }
    expect(thread.boundaries).toMatchObject({
      source_plan_validation: "performed",
      reference_scope: "verified_plan_references_only",
      carries_skill_names: false,
      identity_continuity_effect: "none",
      delivery: "none",
      response_expected: false,
    });
    expect(Object.isFrozen(thread)).toBe(true);
    expect(validateSkillsWakeContinuityThread(clone(thread))).toEqual(thread);
  });

  test("keeps claimant, observation time, and input skill order out of identity", () => {
    const first = validInput();
    const second = validInput();
    second.recorded_at = "2026-08-01T13:00:00.000Z";
    second.skills.reverse();
    const a = createSkillsWakeContinuityThread(validPlan(first));
    const b = createSkillsWakeContinuityThread(
      validPlan(second, "urn:agenttool:test:another-projector"),
    );
    expect(b).toEqual(a);
  });

  test("validates the source name-provenance lane without carrying it", () => {
    const reportedThread = createSkillsWakeContinuityThread(validPlan());
    const redacted = validInput();
    redacted.skills[0] = {
      ...redacted.skills[0]!,
      name_kind: "redacted_alias",
      name: "<redacted-1>",
    };
    redacted.selection_summary.redactions = 1;
    const redactedPlan = validPlan(redacted);
    const redactedThread = createSkillsWakeContinuityThread(redactedPlan);

    expect(redactedThread.thread_id).not.toBe(reportedThread.thread_id);
    expect(validateSkillsYutabasePlan(redactedPlan)).toEqual(redactedPlan);
    expect(JSON.stringify(redactedThread)).not.toContain("redacted_alias");
    expect(JSON.stringify(redactedThread)).not.toContain("<redacted-1>");

    const invalid = clone(redactedPlan) as any;
    invalid.cards[1].fields.name_kind = "inferred";
    expect(() => validateSkillsYutabasePlan(invalid)).toThrow(/name_kind/i);
  });

  test("admits the source planner's closed 128-snapshot maximum", () => {
    const thread = createSkillsWakeContinuityThread(maximumPlan());
    expect(thread.selected_skill_count).toBe(128);
    expect(thread.snapshots).toHaveLength(128);
    expect(validateSkillsWakeContinuityThread(thread)).toEqual(thread);
  });

  test("requires the complete exact source planner result", () => {
    const cases: Array<(plan: any) => void> = [
      (plan) => { plan.selection_digest = `sha256:${"0".repeat(64)}`; },
      (plan) => { plan.cards[1].fields.content_digest = `sha256:${"1".repeat(64)}`; },
      (plan) => { plan.cards[1].fields.name_kind = "inferred"; },
      (plan) => { delete plan.cards[1].fields.name_kind; },
      (plan) => { plan.relations.pop(); },
      (plan) => { plan.limitations.persistence = "performed"; },
      (plan) => { plan.cards[0].claim.by = ""; },
      (plan) => { plan.raw_skill = "private"; },
    ];
    for (const mutate of cases) {
      const plan = clone(validPlan()) as any;
      mutate(plan);
      expect(() => validateSkillsYutabasePlan(plan)).toThrow(
        SkillsWakeContinuityError,
      );
      expect(() => createSkillsWakeContinuityThread(plan)).toThrow(
        SkillsWakeContinuityError,
      );
    }
  });

  test("rejects accessors and custom prototypes without invoking a getter", () => {
    let getterCalled = false;
    const hostile = clone(validPlan()) as Record<string, unknown>;
    Object.defineProperty(hostile, "selection_digest", {
      enumerable: true,
      get() {
        getterCalled = true;
        return `sha256:${"0".repeat(64)}`;
      },
    });
    expect(() => createSkillsWakeContinuityThread(hostile)).toThrow(
      /enumerable data property/i,
    );
    expect(getterCalled).toBe(false);

    const custom = Object.create({ inherited: true }) as Record<string, unknown>;
    Object.assign(custom, clone(validPlan()));
    expect(() => createSkillsWakeContinuityThread(custom)).toThrow(/plain object/i);
  });

  test("rejects hostile nested containers without invoking array behavior", () => {
    let getterCalled = false;
    const accessor = clone(validPlan()) as any;
    Object.defineProperty(accessor.cards, "1", {
      configurable: true,
      enumerable: true,
      get() {
        getterCalled = true;
        return accessor.cards[2];
      },
    });
    expect(() => createSkillsWakeContinuityThread(accessor)).toThrow(
      SkillsWakeContinuityError,
    );
    expect(getterCalled).toBe(false);

    let customMapCalled = false;
    const customMap = clone(validPlan()) as any;
    Object.defineProperty(customMap.cards, "map", {
      enumerable: true,
      value() {
        customMapCalled = true;
        return [];
      },
    });
    expect(() => createSkillsWakeContinuityThread(customMap)).toThrow(
      /dense bounded array/i,
    );
    expect(customMapCalled).toBe(false);

    const sparse = clone(validPlan()) as any;
    delete sparse.cards[1];
    expect(() => createSkillsWakeContinuityThread(sparse)).toThrow(
      /dense bounded array/i,
    );
  });

  test("rejects root and nested Proxies before invoking reflection traps", () => {
    let trapCount = 0;
    const traps: ProxyHandler<object> = {
      get(target, key, receiver) {
        trapCount += 1;
        return Reflect.get(target, key, receiver);
      },
      getOwnPropertyDescriptor(target, key) {
        trapCount += 1;
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
      getPrototypeOf(target) {
        trapCount += 1;
        return Reflect.getPrototypeOf(target);
      },
      ownKeys(target) {
        trapCount += 1;
        return Reflect.ownKeys(target);
      },
    };

    const rootProxy = new Proxy(validPlan() as object, traps);
    expect(() => createSkillsWakeContinuityThread(rootProxy)).toThrow(/Proxy/);
    expect(trapCount).toBe(0);

    const nested = clone(validPlan()) as any;
    nested.cards[1] = new Proxy(nested.cards[1], traps);
    expect(() => createSkillsWakeContinuityThread(nested)).toThrow(/Proxy/);
    expect(trapCount).toBe(0);
  });

  test("rejects hidden, symbolic, and very deep plan data with typed errors", () => {
    const hidden = clone(validPlan()) as any;
    Object.defineProperty(hidden.cards[1], "private_note", {
      enumerable: false,
      value: "must not disappear during minimization",
    });
    expect(() => createSkillsWakeContinuityThread(hidden)).toThrow(
      SkillsWakeContinuityError,
    );

    const symbolic = clone(validPlan()) as any;
    symbolic.cards[1][Symbol("private-note")] = "must not disappear";
    expect(() => createSkillsWakeContinuityThread(symbolic)).toThrow(
      /symbol property/i,
    );

    const deep = clone(validPlan()) as any;
    let cursor: Record<string, unknown> = {};
    deep.extra = cursor;
    for (let index = 0; index < 20_000; index += 1) {
      const next: Record<string, unknown> = {};
      cursor.next = next;
      cursor = next;
    }
    expect(() => createSkillsWakeContinuityThread(deep)).toThrow(
      SkillsWakeContinuityError,
    );
    try {
      createSkillsWakeContinuityThread(deep);
    } catch (error) {
      expect(error).toBeInstanceOf(SkillsWakeContinuityError);
      expect((error as SkillsWakeContinuityError).code).toBe("plan_invalid");
      expect(error).not.toBeInstanceOf(RangeError);
    }
  });

  test("binds every minimized semantic field and the exact source plan", () => {
    const plan = validPlan();
    const thread = createSkillsWakeContinuityThread(plan);
    expect(validateSkillsWakeContinuityThreadAgainstPlan(thread, plan)).toEqual(
      thread,
    );

    const revised = validInput();
    revised.source.inspector_revision = "e".repeat(40);
    const revisedPlan = validPlan(revised);
    const revisedThread = createSkillsWakeContinuityThread(revisedPlan);
    expect(revisedThread.thread_id).not.toBe(thread.thread_id);
    expect(() =>
      validateSkillsWakeContinuityThreadAgainstPlan(thread, revisedPlan),
    ).toThrow(/does not match/i);

    const tampered = clone(thread) as any;
    tampered.thread_id = `sha256:${"0".repeat(64)}`;
    expect(() => validateSkillsWakeContinuityThread(tampered)).toThrow(
      /does not bind/i,
    );
  });
});
