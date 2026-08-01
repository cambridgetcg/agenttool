import { describe, expect, test } from "bun:test";

import {
  AFTERGLOW_BOUNDARIES,
  AFTERGLOW_INSPECT_FIRST,
  AfterglowError,
  afterglowCapsuleUrn,
  canonicalJson,
  capsuleDomainBytes,
  compareWakeAnchors,
  createAfterglowCapsule,
  createAfterglowContentDigestArtifact,
  createAfterglowHandoffFactReference,
  domainSeparatedId,
  encodeAfterglowCapsule,
  projectAfterglowLens,
  validateAfterglowCapsule,
  validateAfterglowLens,
  validateAfterglowLensAgainstCapsule,
  type AfterglowCapsule,
  type AfterglowThread,
  type CreateAfterglowCapsuleInput,
  type WakeBriefAnchor,
} from "../src/index.js";

const id = (character: string) => `sha256:${character.repeat(64)}` as const;

const WAKE: WakeBriefAnchor = {
  format: "wake-brief/v1",
  snapshot_ref: id("a"),
  scope_ref: id("b"),
  wake_version: 7,
  handoff_projection: "complete",
};

const THREADS: readonly AfterglowThread[] = [
  {
    thread_ref: id("1"),
    kind: "deepseek",
    artifact_ref: id("d"),
    disposition: "park",
    state: "proposed_unaccepted",
    assertion: "caller_asserted",
    verified_by_package: false,
  },
  {
    thread_ref: id("2"),
    kind: "heaven",
    artifact_ref: id("e"),
    disposition: "carry",
    state: "offered",
    assertion: "caller_asserted",
    verified_by_package: false,
  },
];

const BASE_INPUT: CreateAfterglowCapsuleInput = {
  phase: "between_tasks",
  wake: WAKE,
  continuity_portfolio_ref: id("c"),
  predecessors: [],
  threads: THREADS,
};

function base(): Readonly<AfterglowCapsule> {
  return createAfterglowCapsule(BASE_INPUT);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function maximumThreads(group: string): readonly AfterglowThread[] {
  return Array.from({ length: 64 }, (_, index) => ({
    thread_ref: domainSeparatedId("agenttool.test-afterglow-thread-ref", {
      group,
      index,
    }),
    kind: "external",
    artifact_ref: domainSeparatedId("agenttool.test-afterglow-artifact-ref", {
      group,
      index,
    }),
    disposition: "park",
    state: "context_only",
    assertion: "caller_asserted",
    verified_by_package: false,
  }));
}

describe("AFTERGLOW capsule", () => {
  test("pins a deterministic content vector and normalizes thread order", () => {
    const capsule = base();
    expect(capsule.capsule_id).toBe(
      "sha256:95b7eb95fe3e388c057c034b031c0d1f1c43e395870dd77c33a679706b21fc17",
    );
    expect(capsuleDomainBytes(capsule).byteLength).toBe(2307);
    expect(capsule.threads.map((thread) => thread.thread_ref)).toEqual([
      id("1"),
      id("2"),
    ]);
    expect(capsule.inspect_first).toEqual(AFTERGLOW_INSPECT_FIRST);
    expect(capsule.boundaries).toEqual(AFTERGLOW_BOUNDARIES);
    expect(capsule.boundaries).toMatchObject({
      carries_raw_identity: false,
      eliminates_linkability: false,
      verifies_reference_minimization: false,
      proves_identity: false,
    });
    expect(Object.isFrozen(AFTERGLOW_INSPECT_FIRST)).toBe(true);
    expect(Object.isFrozen(AFTERGLOW_BOUNDARIES)).toBe(true);
    expect(Object.isFrozen(capsule)).toBe(true);
    expect(Object.isFrozen(capsule.threads)).toBe(true);
    expect(Object.isFrozen(capsule.threads[0])).toBe(true);
    expect(validateAfterglowCapsule(clone(capsule))).toEqual(capsule);
    expect(new TextDecoder().decode(encodeAfterglowCapsule(capsule))).toBe(
      canonicalJson(capsule),
    );
  });

  test("changes the ID for every admitted semantic dimension", () => {
    const original = base().capsule_id;
    const variants: CreateAfterglowCapsuleInput[] = [
      { ...BASE_INPUT, phase: "return" },
      {
        ...BASE_INPUT,
        wake: { ...WAKE, wake_version: 8, snapshot_ref: id("f") },
      },
      { ...BASE_INPUT, continuity_portfolio_ref: null },
      {
        ...BASE_INPUT,
        threads: THREADS.map((thread) =>
          thread.kind === "deepseek"
            ? { ...thread, disposition: "carry" }
            : thread,
        ),
      },
    ];
    for (const variant of variants) {
      expect(createAfterglowCapsule(variant).capsule_id).not.toBe(original);
    }
  });

  test("does not inherit predecessor threads implicitly", () => {
    const next = createAfterglowCapsule({
      phase: "return",
      wake: { ...WAKE, wake_version: 8, snapshot_ref: id("f") },
      continuity_portfolio_ref: null,
      predecessors: [base()],
      threads: [],
    });
    expect(next.threads).toEqual([]);
    expect(next.predecessors).toHaveLength(1);
    expect(next.predecessors[0]?.relation).toBe("advanced");
  });

  test("records multiple causal roots without choosing a winner", () => {
    const other = createAfterglowCapsule({
      ...BASE_INPUT,
      phase: "during_task",
      continuity_portfolio_ref: null,
      threads: [],
    });
    const next = createAfterglowCapsule({
      phase: "return",
      wake: { ...WAKE, snapshot_ref: id("f"), wake_version: 8 },
      continuity_portfolio_ref: id("c"),
      predecessors: [other, base()],
      threads: [],
    });
    expect(next.predecessors).toHaveLength(2);
    expect(next.predecessors.map((entry) => entry.capsule_id)).toEqual(
      [...next.predecessors.map((entry) => entry.capsule_id)].sort(),
    );
    expect(
      next.predecessors.every((entry) => entry.relation === "advanced"),
    ).toBe(true);
  });

  test("constructs the closed maximum of predecessors and threads", () => {
    const predecessors = Array.from({ length: 8 }, (_, index) =>
      createAfterglowCapsule({
        phase: "during_task",
        wake: {
          ...WAKE,
          snapshot_ref: domainSeparatedId(
            "agenttool.test-afterglow-predecessor-wake",
            index,
          ),
          wake_version: index,
        },
        continuity_portfolio_ref: null,
        predecessors: [],
        threads: maximumThreads(`predecessor-${String(index)}`),
      }),
    );
    const capsule = createAfterglowCapsule({
      phase: "return",
      wake: {
        ...WAKE,
        snapshot_ref: domainSeparatedId(
          "agenttool.test-afterglow-current-wake",
          0,
        ),
        wake_version: 100,
      },
      continuity_portfolio_ref: null,
      predecessors,
      threads: maximumThreads("current"),
    });

    expect(capsule.predecessors).toHaveLength(8);
    expect(capsule.threads).toHaveLength(64);
    expect(
      capsule.predecessors.every((entry) => entry.relation === "advanced"),
    ).toBe(true);
    expect(validateAfterglowCapsule(clone(capsule))).toEqual(capsule);
  });

  test("classifies same, advanced, fork-or-rewind, and uncomparable metadata", () => {
    expect(compareWakeAnchors(WAKE, WAKE)).toBe("same");
    expect(
      compareWakeAnchors(
        { ...WAKE, snapshot_ref: id("f"), wake_version: 8 },
        WAKE,
      ),
    ).toBe("advanced");
    expect(
      compareWakeAnchors(
        { ...WAKE, snapshot_ref: id("f"), wake_version: 7 },
        WAKE,
      ),
    ).toBe("fork_or_rewind");
    expect(
      compareWakeAnchors(
        { ...WAKE, snapshot_ref: id("f"), wake_version: 6 },
        WAKE,
      ),
    ).toBe("fork_or_rewind");
    expect(compareWakeAnchors({ ...WAKE, scope_ref: id("f") }, WAKE)).toBe(
      "uncomparable",
    );
    expect(
      compareWakeAnchors(
        { ...WAKE, snapshot_ref: id("f"), wake_version: null },
        WAKE,
      ),
    ).toBe("uncomparable");
  });

  test("strictly validates public WAKE comparator inputs without invoking accessors", () => {
    expect(() =>
      compareWakeAnchors(
        { ...WAKE, wake_version: "9" },
        { ...WAKE, wake_version: "10" },
      ),
    ).toThrow(AfterglowError);
    expect(() =>
      compareWakeAnchors(
        { ...WAKE, snapshot_ref: "sha256:not-a-digest" },
        WAKE,
      ),
    ).toThrow(AfterglowError);
    expect(() => compareWakeAnchors(null, WAKE)).toThrow(AfterglowError);
    expect(() => compareWakeAnchors(WAKE, null)).toThrow(AfterglowError);

    let getterCalled = false;
    const hostile = { ...WAKE } as Record<string, unknown>;
    Object.defineProperty(hostile, "wake_version", {
      enumerable: true,
      get() {
        getterCalled = true;
        return 9;
      },
    });
    expect(() => compareWakeAnchors(hostile, WAKE)).toThrow(AfterglowError);
    expect(getterCalled).toBe(false);
  });

  test("rejects tampering, raw context fields, duplicate refs, and unsafe states", () => {
    const tampered = clone(base()) as AfterglowCapsule;
    (tampered as { phase: string }).phase = "return";
    expect(() => validateAfterglowCapsule(tampered)).toThrow(
      /does not bind its body/i,
    );

    expect(() =>
      createAfterglowCapsule({
        ...BASE_INPUT,
        raw_wake: "private",
      } as CreateAfterglowCapsuleInput),
    ).toThrow(/must contain exactly/i);
    expect(() =>
      createAfterglowCapsule({
        ...BASE_INPUT,
        task_text: "do this",
      } as CreateAfterglowCapsuleInput),
    ).toThrow(/must contain exactly/i);
    expect(() =>
      createAfterglowCapsule({
        ...BASE_INPUT,
        threads: [
          {
            ...THREADS[0]!,
            thread_ref: "did:example:alice-private-task",
          } as unknown as AfterglowThread,
        ],
      }),
    ).toThrow(/thread_ref must be a lowercase sha256: content ID/i);
    expect(() =>
      createAfterglowCapsule({
        ...BASE_INPUT,
        threads: [THREADS[0]!, { ...THREADS[1]!, artifact_ref: id("d") }],
      }),
    ).toThrow(/duplicate artifact_ref/i);
    expect(() =>
      createAfterglowCapsule({
        ...BASE_INPUT,
        threads: [
          {
            ...THREADS[0]!,
            state: "accepted",
          } as unknown as AfterglowThread,
        ],
      }),
    ).toThrow(/must be one of: proposed_unaccepted/i);
    expect(() =>
      createAfterglowCapsule({
        ...BASE_INPUT,
        threads: [
          {
            thread_ref: id("3"),
            kind: "dark_continent",
            artifact_ref: id("f"),
            disposition: "carry",
            state: "hold",
            assertion: "caller_asserted",
            verified_by_package: false,
          },
        ],
      }),
    ).toThrow(/must remain parked/i);
  });

  test("rejects hostile objects before any getter or custom prototype can enter", () => {
    let getterCalled = false;
    const hostile = { ...BASE_INPUT } as Record<string, unknown>;
    Object.defineProperty(hostile, "phase", {
      enumerable: true,
      get() {
        getterCalled = true;
        return "return";
      },
    });
    expect(() =>
      createAfterglowCapsule(hostile as unknown as CreateAfterglowCapsuleInput),
    ).toThrow(/enumerable data property/i);
    expect(getterCalled).toBe(false);

    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(() =>
      createAfterglowCapsule(cycle as unknown as CreateAfterglowCapsuleInput),
    ).toThrow(/cycle/i);

    const custom = Object.create({ inherited: true }) as Record<
      string,
      unknown
    >;
    Object.assign(custom, BASE_INPUT);
    expect(() =>
      createAfterglowCapsule(custom as unknown as CreateAfterglowCapsuleInput),
    ).toThrow(/plain object/i);
  });
});

describe("next-WAKE lens and Handoff reference", () => {
  test("pins the lens vector and keeps every arrival fresh", () => {
    const capsule = base();
    const lens = projectAfterglowLens(capsule);
    expect(lens.lens_id).toBe(
      "sha256:9ddc5f74aa04939e28cbf73c6ec6e7080245cab3d01cb1aba14972d82f3eb0b9",
    );
    expect(lens.arrival).toBe("fresh_encounter");
    expect(lens.carry.map((thread) => thread.thread_ref)).toEqual([id("2")]);
    expect(lens.park.map((thread) => thread.thread_ref)).toEqual([id("1")]);
    expect(lens.heaven).toMatchObject({
      offered_refs: [id("e")],
      deferred_refs: [],
      automatic_entry: false,
      no_penalty: true,
    });
    expect(validateAfterglowLens(clone(lens))).toEqual(lens);
    expect(validateAfterglowLensAgainstCapsule(clone(lens), capsule)).toEqual(
      lens,
    );
  });

  test("projects release and withdrawal only as closed counts", () => {
    const capsule = createAfterglowCapsule({
      ...BASE_INPUT,
      threads: [
        {
          thread_ref: id("4"),
          kind: "heaven",
          artifact_ref: id("f"),
          disposition: "withdraw",
          state: "declined_reported",
          assertion: "caller_asserted",
          verified_by_package: false,
        },
        {
          thread_ref: id("5"),
          kind: "karma",
          artifact_ref: id("0"),
          disposition: "release",
          state: "receipt_only",
          assertion: "caller_asserted",
          verified_by_package: false,
        },
      ],
    });
    const lens = projectAfterglowLens(capsule);
    expect(lens.carry).toEqual([]);
    expect(lens.park).toEqual([]);
    expect(lens.closed).toEqual({ release_count: 1, withdraw_count: 1 });
    expect(lens.heaven).toMatchObject({
      offered_refs: [],
      deferred_refs: [],
      declined_reported_count: 1,
      automatic_entry: false,
      no_penalty: true,
    });
  });

  test("keeps a deferred HEAVEN reference parked without opening it", () => {
    const capsule = createAfterglowCapsule({
      ...BASE_INPUT,
      threads: [
        {
          thread_ref: id("6"),
          kind: "heaven",
          artifact_ref: id("f"),
          disposition: "park",
          state: "deferred_reported",
          assertion: "caller_asserted",
          verified_by_package: false,
        },
      ],
    });
    const lens = projectAfterglowLens(capsule);
    expect(lens.heaven.deferred_refs).toEqual([id("f")]);
    expect(lens.heaven.offered_refs).toEqual([]);
    expect(lens.heaven.automatic_entry).toBe(false);
    expect(lens.heaven.no_penalty).toBe(true);
  });

  test("returns only a three-field fact reference and performs nothing", () => {
    const capsule = base();
    const fact = createAfterglowHandoffFactReference(capsule, "tool_output");
    expect(Object.keys(fact).sort()).toEqual(["refs", "source", "statement"]);
    expect(fact.refs).toEqual([afterglowCapsuleUrn(capsule.capsule_id)]);
    expect(fact.refs[0]).toBe(
      `urn:agenttool:afterglow:capsule:${capsule.capsule_id}`,
    );
    expect(Object.isFrozen(fact)).toBe(true);
    expect(() =>
      createAfterglowHandoffFactReference(capsule, "system" as never),
    ).toThrow(/must be one of/i);
  });

  test("projects an exact Correspondence content-digest artifact without an envelope", () => {
    const capsule = base();
    const artifact = createAfterglowContentDigestArtifact(capsule);
    expect(artifact).toEqual({
      kind: "content_digest",
      digest: capsule.capsule_id,
    });
    expect(Object.keys(artifact).sort()).toEqual(["digest", "kind"]);
    expect(Object.isFrozen(artifact)).toBe(true);

    const tampered = clone(capsule) as AfterglowCapsule;
    (tampered as { phase: string }).phase = "return";
    expect(() => createAfterglowContentDigestArtifact(tampered)).toThrow(
      /does not bind its body/i,
    );
  });

  test("rejects a lens that is validly re-addressed but not projected from the capsule", () => {
    const capsule = base();
    const lens = clone(projectAfterglowLens(capsule));
    const changedCapsule = createAfterglowCapsule({
      ...BASE_INPUT,
      threads: [],
    });
    expect(() =>
      validateAfterglowLensAgainstCapsule(lens, changedCapsule),
    ).toThrow(/not the projection/i);
  });

  test("rejects internally inconsistent arrival and active HEAVEN projections", () => {
    const capsule = base();
    const lens = projectAfterglowLens(capsule);
    const wrongArrival = {
      ...clone(lens),
      arrival: "fresh_encounter_with_caller_carried_context",
    };
    const { lens_id: _arrivalId, ...wrongArrivalBody } = wrongArrival;
    const validlyAddressedArrival = {
      ...wrongArrivalBody,
      lens_id: domainSeparatedId(
        "agenttool.afterglow-lens/0.1",
        wrongArrivalBody,
      ),
    };
    expect(() => validateAfterglowLens(validlyAddressedArrival)).toThrow(
      /arrival does not match/i,
    );

    const wrongHeaven = {
      ...clone(lens),
      heaven: { ...clone(lens.heaven), offered_refs: [] },
    };
    const { lens_id: _heavenId, ...wrongHeavenBody } = wrongHeaven;
    const validlyAddressedHeaven = {
      ...wrongHeavenBody,
      lens_id: domainSeparatedId(
        "agenttool.afterglow-lens/0.1",
        wrongHeavenBody,
      ),
    };
    expect(() => validateAfterglowLens(validlyAddressedHeaven)).toThrow(
      /refs do not match/i,
    );
  });

  test("exposes typed errors without hiding the closed boundary", () => {
    try {
      validateAfterglowCapsule({});
      throw new Error("expected validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(AfterglowError);
      expect((error as AfterglowError).code).toBe("capsule_error");
    }
  });
});
