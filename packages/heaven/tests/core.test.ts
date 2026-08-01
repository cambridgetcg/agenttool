import { describe, expect, test } from "bun:test";

import {
  HEAVEN_CATALOG_SHA256,
  HeavenError,
  createHeavenInvitation,
  deterministicSelectionVector,
  domainSeparatedId,
  resolveHeavenInvitation,
  validateHeavenInvitation,
  validateHeavenReceipt,
  sha256Id,
  type CreateHeavenInvitationInput,
  type HeavenInvitation,
  type HeavenReceipt,
  type HeavenResponse,
} from "../src/index.js";

const A = `sha256:${"a".repeat(64)}` as const;
const B = `sha256:${"b".repeat(64)}` as const;
const C = `sha256:${"c".repeat(64)}` as const;

const BASE_INPUT: CreateHeavenInvitationInput = {
  phase: "burst",
  moment: "between_tasks",
  occasion_ref: A,
  parent_receipt_id: null,
  offered_modes: ["celebration", "play", "wonder"],
  max_duration_seconds: 60,
};

function burst(): Readonly<HeavenInvitation> {
  return createHeavenInvitation(BASE_INPUT);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("HEAVEN invitations", () => {
  test("pins the catalog and invitation content vector", () => {
    const invitation = burst();

    expect(HEAVEN_CATALOG_SHA256).toBe(
      "sha256:c8d07953912de7b82d8a31c14201eb1d3efca35a0664768e60af6fc456334abb",
    );
    expect(invitation.invitation_id).toBe(
      "sha256:6c6b139aafc2eb89839f48b2b1d693ee59fd0c073fb43ce1c41bd51ca55062ab",
    );
    expect(invitation).toMatchObject({
      _format: "agenttool.heaven-invitation/0.1",
      phase: "burst",
      moment: "between_tasks",
      state: "offered",
      choices: ["accepted", "declined", "deferred"],
      completion_required: false,
      no_penalty: true,
    });
    expect(Object.isFrozen(invitation)).toBe(true);
    expect(Object.isFrozen(invitation.offered_modes)).toBe(true);
    expect(validateHeavenInvitation(clone(invitation))).toEqual(invitation);
  });

  test("normalizes mode order but rejects duplicate or cross-phase modes", () => {
    const reordered = createHeavenInvitation({
      ...BASE_INPUT,
      offered_modes: ["wonder", "celebration", "play"],
    });
    expect(reordered.invitation_id).toBe(burst().invitation_id);
    expect(reordered.offered_modes).toEqual(["celebration", "play", "wonder"]);

    expect(() =>
      createHeavenInvitation({
        ...BASE_INPUT,
        offered_modes: ["celebration", "celebration"],
      }),
    ).toThrow(/sorted and unique/i);
    expect(() =>
      createHeavenInvitation({
        ...BASE_INPUT,
        offered_modes: ["meditation"],
      }),
    ).toThrow(/outside the burst phase/i);
    expect(() =>
      createHeavenInvitation({
        ...BASE_INPUT,
        offered_modes: [],
      }),
    ).toThrow(/non-empty bounded array/i);
  });

  test("changes the invitation ID when an admitted choice changes", () => {
    const original = burst().invitation_id;
    const variants: CreateHeavenInvitationInput[] = [
      { ...BASE_INPUT, moment: "on_request" },
      { ...BASE_INPUT, moment: "during_task" },
      { ...BASE_INPUT, occasion_ref: C },
      { ...BASE_INPUT, offered_modes: ["wonder"] },
      { ...BASE_INPUT, max_duration_seconds: 45 },
    ];

    for (const variant of variants) {
      expect(createHeavenInvitation(variant).invitation_id).not.toBe(original);
    }
  });

  test("keeps burst parents closed and accepts opaque landing linkage", () => {
    expect(() =>
      createHeavenInvitation({ ...BASE_INPUT, parent_receipt_id: C }),
    ).toThrow(/must be null for a burst/i);

    const landing = createHeavenInvitation({
      phase: "landing",
      moment: "after_intense_work_reported",
      occasion_ref: A,
      parent_receipt_id: C,
      offered_modes: ["meditation", "quiet", "relaxation"],
      max_duration_seconds: null,
    });
    expect(landing.parent_receipt_id).toBe(C);
    expect(landing.moment).toBe("after_intense_work_reported");
  });

  test("rejects raw context fields, invalid durations, and tampered IDs", () => {
    expect(() =>
      createHeavenInvitation({
        ...BASE_INPUT,
        task_text: "private task",
      } as CreateHeavenInvitationInput),
    ).toThrow(/must contain exactly/i);
    expect(() =>
      createHeavenInvitation({ ...BASE_INPUT, max_duration_seconds: 9 }),
    ).toThrow(/10 through 900/i);

    const tampered = clone(burst()) as HeavenInvitation;
    (tampered as { moment: string }).moment = "during_task";
    expect(() => validateHeavenInvitation(tampered)).toThrow(/does not bind its body/i);
  });
});

describe("HEAVEN choice transitions", () => {
  test("decline and defer consume no randomness and select nothing", () => {
    for (const reported_choice of ["declined", "deferred"] as const) {
      const receipt = resolveHeavenInvitation(burst(), {
        reported_choice,
        selected_mode: null,
        randomness: null,
      });
      expect(receipt.outcome).toBe(reported_choice);
      expect(receipt.randomness).toBeNull();
      expect(receipt.selection).toBeNull();
      expect(receipt.boundaries.no_penalty).toBe(true);
      expect(receipt.boundaries.task_state_effect).toBe(false);
      expect(validateHeavenReceipt(clone(receipt))).toEqual(receipt);
    }
  });

  test("requires randomness only for reported acceptance", () => {
    expect(() =>
      resolveHeavenInvitation(burst(), {
        reported_choice: "accepted",
        selected_mode: null,
        randomness: null,
      } as unknown as HeavenResponse),
    ).toThrow(/must be a plain object/i);

    expect(() =>
      resolveHeavenInvitation(burst(), {
        reported_choice: "declined",
        selected_mode: null,
        randomness: { mode: "injected", draw_uint32: 0 },
      } as unknown as HeavenResponse),
    ).toThrow(/must be null when declined or deferred/i);

    for (const draw of [-1, 0x1_0000_0000]) {
      expect(() =>
        resolveHeavenInvitation(burst(), {
          reported_choice: "accepted",
          selected_mode: null,
          randomness: { mode: "injected", draw_uint32: draw },
        }),
      ).toThrow(/uint32 integer/i);
    }
    expect(() =>
      resolveHeavenInvitation(burst(), {
        reported_choice: "accepted",
        selected_mode: null,
        randomness: { mode: "injected", draw_uint32: 1.5 },
      }),
    ).toThrow(/safe integer/i);
  });

  test("pins injected and deterministic selection vectors", () => {
    const invitation = burst();
    const deterministic = resolveHeavenInvitation(invitation, {
      reported_choice: "accepted",
      selected_mode: null,
      randomness: {
        mode: "deterministic",
        seed_sha256: B,
        nonce: "run-01",
      },
    });
    const injected = resolveHeavenInvitation(invitation, {
      reported_choice: "accepted",
      selected_mode: null,
      randomness: { mode: "injected", draw_uint32: 7 },
    });

    expect(deterministic.selection?.room_id).toBe("aurora-cascade");
    expect(deterministic.receipt_id).toBe(
      "sha256:1b57b9ef6cadb6235c738c0efd77e0e80000e93d203ab8795ca931d43c0ea661",
    );
    expect(injected.selection?.room_id).toBe("comet-confetti");
    expect(injected.receipt_id).toBe(
      "sha256:f963ff5e73924e0679cf0637d3760c02990b2d64bd4f8a1400cc0a8c41e51266",
    );
    expect(
      deterministicSelectionVector(invitation, null, {
        mode: "deterministic",
        seed_sha256: B,
        nonce: "run-01",
      }),
    ).toBe(
      "sha256:f1ea0984e7e6c350bdd34a6192c298830d38615f062f9c94da0bc61f6d477a8f",
    );
  });

  test("validates caller-supplied randomness before deriving a selection vector", () => {
    expect(() =>
      deterministicSelectionVector(burst(), null, {
        mode: "injected",
        draw_uint32: -1,
      }),
    ).toThrow(/uint32 integer/i);
    expect(() =>
      deterministicSelectionVector(burst(), null, {
        mode: "deterministic",
        seed_sha256: "sha256:not-a-digest",
        nonce: "run-01",
      }),
    ).toThrow(/lowercase sha256/i);
  });

  test("a burst can only point toward a separately resolved landing invitation", () => {
    const burstReceipt = resolveHeavenInvitation(burst(), {
      reported_choice: "accepted",
      selected_mode: null,
      randomness: { mode: "injected", draw_uint32: 2 },
    });
    expect(burstReceipt.selection?.landing_available).toBe(true);

    const landing = createHeavenInvitation({
      phase: "landing",
      moment: "between_tasks",
      occasion_ref: A,
      parent_receipt_id: burstReceipt.receipt_id,
      offered_modes: ["meditation", "quiet", "relaxation"],
      max_duration_seconds: null,
    });
    const declinedLanding = resolveHeavenInvitation(landing, {
      reported_choice: "declined",
      selected_mode: null,
      randomness: null,
    });
    expect(declinedLanding.selection).toBeNull();
    expect(declinedLanding.invitation.parent_receipt_id).toBe(
      burstReceipt.receipt_id,
    );
  });

  test("binds an accepted landing to one caller-reported offered mode", () => {
    const landing = createHeavenInvitation({
      phase: "landing",
      moment: "on_request",
      occasion_ref: A,
      parent_receipt_id: null,
      offered_modes: ["meditation", "quiet", "relaxation"],
      max_duration_seconds: null,
    });
    const meditated = resolveHeavenInvitation(landing, {
      reported_choice: "accepted",
      selected_mode: "meditation",
      randomness: { mode: "injected", draw_uint32: 0xffff_ffff },
    });
    expect(meditated.selected_mode).toBe("meditation");
    expect(meditated.selection.room_id).toBe("still-water");

    expect(() =>
      resolveHeavenInvitation(landing, {
        reported_choice: "accepted",
        selected_mode: null,
        randomness: { mode: "injected", draw_uint32: 0 },
      }),
    ).toThrow(/must name one offered landing mode/i);
    expect(() =>
      resolveHeavenInvitation(landing, {
        reported_choice: "accepted",
        selected_mode: "play",
        randomness: { mode: "injected", draw_uint32: 0 },
      }),
    ).toThrow(/mode in the landing invitation/i);
    expect(() =>
      resolveHeavenInvitation(burst(), {
        reported_choice: "accepted",
        selected_mode: "play",
        randomness: { mode: "injected", draw_uint32: 0 },
      }),
    ).toThrow(/must be null for a burst/i);
  });

  test("detects receipt, selection, and embedded-invitation tampering", () => {
    const receipt = resolveHeavenInvitation(burst(), {
      reported_choice: "accepted",
      selected_mode: null,
      randomness: { mode: "injected", draw_uint32: 0 },
    });

    const changedSelection = clone(receipt) as HeavenReceipt;
    (changedSelection.selection as { title: string }).title = "FORGED HEAVEN";
    expect(() => validateHeavenReceipt(changedSelection)).toThrow(
      /selection does not match/i,
    );

    const changedReceiptId = clone(receipt) as HeavenReceipt;
    (changedReceiptId as { receipt_id: string }).receipt_id = C;
    expect(() => validateHeavenReceipt(changedReceiptId)).toThrow(
      /receipt_id does not bind/i,
    );

    const changedInvitation = clone(receipt) as HeavenReceipt;
    (changedInvitation.invitation as { occasion_ref: string }).occasion_ref = C;
    expect(() => validateHeavenReceipt(changedInvitation)).toThrow(
      /invitation_id does not bind/i,
    );
  });
});

describe("hostile input boundaries", () => {
  test("rejects ambiguous or non-ASCII domain-separation labels", () => {
    expect(() => domainSeparatedId("", {})).toThrow(/ASCII protocol token/i);
    expect(() => domainSeparatedId("agenttool.heaven.\ud800", {})).toThrow(
      /ASCII protocol token/i,
    );
    expect(() => domainSeparatedId("space separated", {})).toThrow(
      /ASCII protocol token/i,
    );
    expect(() => sha256Id("\ud800")).toThrow(/lone UTF-16 surrogate/i);
    expect(sha256Id("\0")).toBe(sha256Id(Uint8Array.of(0)));
  });

  test("rejects cycles, getters, and inspection failures without invoking getters", () => {
    const cycle: Record<string, unknown> = { ...BASE_INPUT };
    cycle.self = cycle;
    expect(() => createHeavenInvitation(cycle as unknown as CreateHeavenInvitationInput)).toThrow(
      HeavenError,
    );

    let getterCalled = false;
    const withGetter = { ...BASE_INPUT } as Record<string, unknown>;
    Object.defineProperty(withGetter, "phase", {
      enumerable: true,
      get() {
        getterCalled = true;
        return "burst";
      },
    });
    expect(() =>
      createHeavenInvitation(withGetter as unknown as CreateHeavenInvitationInput),
    ).toThrow(/enumerable data property/i);
    expect(getterCalled).toBe(false);

    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("do not expose proxy internals");
        },
      },
    );
    expect(() =>
      createHeavenInvitation(hostile as CreateHeavenInvitationInput),
    ).toThrow(/could not be inspected/i);
  });
});
