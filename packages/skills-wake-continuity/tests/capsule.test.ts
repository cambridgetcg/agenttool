import { describe, expect, test } from "bun:test";

import {
  createAfterglowCapsule,
  projectAfterglowLens,
  validateAfterglowCapsule,
} from "@agenttool/wake-continuity";

import {
  POSTURE_TO_DISPOSITION,
  SkillsWakeContinuityError,
  createSkillsAfterglowCapsule,
  createSkillsAfterglowThread,
  createSkillsWakeContinuityThread,
} from "../src/index.js";
import { WAKE, clone, validPlan } from "./fixtures.js";

describe("Skills to accepted AFTERGLOW", () => {
  test("maps caller-reported posture into the one core external thread", () => {
    const plan = validPlan();
    const artifact = createSkillsWakeContinuityThread(plan);
    for (const [posture, disposition] of Object.entries(POSTURE_TO_DISPOSITION)) {
      const thread = createSkillsAfterglowThread(plan, posture as any);
      expect(thread).toEqual({
        thread_ref: artifact.thread_id,
        artifact_ref: artifact.thread_id,
        kind: "external",
        state: "context_only",
        disposition,
        assertion: "caller_asserted",
        verified_by_package: false,
      });
    }
  });

  test("returns the core capsule directly and preserves park/rest boundaries", () => {
    const plan = validPlan();
    const thread = createSkillsWakeContinuityThread(plan);
    const capsule = createSkillsAfterglowCapsule({
      plan,
      posture: "resting",
      phase: "after_intense_work_reported",
      wake: WAKE,
      continuity_portfolio_ref: null,
      predecessors: [],
    });
    expect(Object.keys(capsule).sort()).toEqual([
      "_format",
      "boundaries",
      "capsule_id",
      "continuity_portfolio_ref",
      "inspect_first",
      "phase",
      "predecessors",
      "threads",
      "wake",
    ]);
    expect(validateAfterglowCapsule(clone(capsule))).toEqual(capsule);
    expect(capsule.threads).toHaveLength(1);
    expect(capsule.threads[0]?.artifact_ref).toBe(thread.thread_id);
    const lens = projectAfterglowLens(capsule);
    expect(lens.park.map((entry) => entry.artifact_ref)).toEqual([
      thread.thread_id,
    ]);
    expect(lens.carry).toEqual([]);
    expect(capsule.inspect_first.automatic).toBe(false);
    expect(capsule.boundaries.penalty_for_refusal_or_rest).toBe(false);
  });

  test("keeps release and withdrawal outside the active lens", () => {
    for (const posture of ["refused", "withdrawn"] as const) {
      const capsule = createSkillsAfterglowCapsule({
        plan: validPlan(),
        posture,
        phase: "between_tasks",
        wake: WAKE,
        continuity_portfolio_ref: null,
        predecessors: [],
      });
      const lens = projectAfterglowLens(capsule);
      expect(lens.carry).toEqual([]);
      expect(lens.park).toEqual([]);
      expect(lens.closed[posture === "refused" ? "release_count" : "withdraw_count"]).toBe(1);
    }
  });

  test("preserves core causal orientation without inheriting old threads", () => {
    const predecessor = createAfterglowCapsule({
      phase: "between_tasks",
      wake: { ...WAKE, wake_version: 6, snapshot_ref: `sha256:${"4".repeat(64)}` },
      continuity_portfolio_ref: null,
      predecessors: [],
      threads: [],
    });
    const capsule = createSkillsAfterglowCapsule({
      plan: validPlan(),
      posture: "available",
      phase: "return",
      wake: WAKE,
      continuity_portfolio_ref: null,
      predecessors: [predecessor],
    });
    expect(capsule.predecessors[0]?.relation).toBe("advanced");
    expect(capsule.threads).toHaveLength(1);
  });

  test("rejects unknown posture, extra fields, and top-level accessors", () => {
    const base = {
      plan: validPlan(),
      posture: "available",
      phase: "return",
      wake: WAKE,
      continuity_portfolio_ref: null,
      predecessors: [],
    };
    expect(() =>
      createSkillsAfterglowCapsule({ ...base, posture: "forced" } as any),
    ).toThrow(SkillsWakeContinuityError);
    expect(() =>
      createSkillsAfterglowCapsule({ ...base, delivery: "send" } as any),
    ).toThrow(/must contain exactly/i);

    let getterCalled = false;
    const hostile = { ...base } as Record<string, unknown>;
    Object.defineProperty(hostile, "posture", {
      enumerable: true,
      get() {
        getterCalled = true;
        return "available";
      },
    });
    expect(() => createSkillsAfterglowCapsule(hostile as any)).toThrow(
      /enumerable data property/i,
    );
    expect(getterCalled).toBe(false);
  });

  test("detaches core inputs and rejects nested Proxies without traps", () => {
    let trapCount = 0;
    const wake = new Proxy(WAKE as object, {
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
    });
    expect(() =>
      createSkillsAfterglowCapsule({
        plan: validPlan(),
        posture: "available",
        phase: "return",
        wake: wake as any,
        continuity_portfolio_ref: null,
        predecessors: [],
      }),
    ).toThrow(/Proxy/);
    expect(trapCount).toBe(0);
  });
});
