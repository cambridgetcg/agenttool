import { describe, expect, test } from "bun:test";
import {
  canonicalJson,
  createWakeThreadOffer,
  domainSeparatedId,
  resolveWakeThreadOffer,
  sha256Id,
  validateWakeThreadChain,
  validateWakeThreadOffer,
  validateWakeThreadReceipt,
  WakeThreadError,
  WAKE_THREAD_BOUNDARIES,
} from "../src/index.js";
import { childInput, jsonClone, makeOffer, offerInput, ref } from "./fixtures.js";
import type { CreateWakeThreadOfferInput, WakeThreadReceipt } from "../src/index.js";

function response(choice: "carry" | "fork" | "rest" | "refuse", branch = null as ReturnType<typeof ref> | null) {
  return {
    reported_choice: choice,
    responded_at: "2026-08-01T12:01:00.000Z",
    branch_ref: branch,
    note_ref: null,
  } as const;
}

describe("Wake Thread offers", () => {
  test("is deterministic and snapshots caller input", () => {
    const input = offerInput();
    const first = createWakeThreadOffer(input);
    const second = createWakeThreadOffer(input);
    expect(first).toEqual(second);
    expect(first.offer_id).toBe(
      "sha256:e9586fb0167601d9b7adfd01c74ca283dc9f67f03b1f5efa74a6373bf081afa0",
    );
    expect(resolveWakeThreadOffer(first, response("rest")).receipt_id).toBe(
      "sha256:d3b68dba800aeb89b3983b11fe067c36b8937f945702c3e4cf689d40c1700d30",
    );
    expect(first.boundaries).toEqual(WAKE_THREAD_BOUNDARIES);

    (input.facts as Array<{ summary: string }>)[0]!.summary = "changed after creation";
    expect(first.facts[0]!.summary).not.toBe("changed after creation");
  });

  test("keeps scope, cursor ownership, and partiality explicit", () => {
    const offer = makeOffer();
    expect(offer.wake.scope).toBe("mixed");
    expect(offer.wake.coverage).toBe("partial");
    expect(offer.wake.caller_held_cursor_ref).toBe(ref("cursor"));
    expect(offer.omissions).toHaveLength(1);
    expect(offer.offered_choices).toEqual(["carry", "fork", "rest", "refuse"]);
    expect(offer.artifact_retention).toEqual({
      mode: "until",
      until: "2026-08-03T12:00:00.000Z",
    });
  });

  test("binds an explicit and internally coherent artifact-retention declaration", () => {
    expect(makeOffer({
      artifact_retention: { mode: "ephemeral", until: null },
    }).artifact_retention.mode).toBe("ephemeral");
    expect(makeOffer({
      artifact_retention: { mode: "no_fixed_expiry", until: null },
    }).artifact_retention.mode).toBe("no_fixed_expiry");
    expect(() => makeOffer({
      artifact_retention: { mode: "ephemeral", until: "2026-08-03T12:00:00.000Z" },
    })).toThrow("Only until retention");
    expect(() => makeOffer({
      artifact_retention: { mode: "until", until: "2026-08-01T12:00:00.000Z" },
    })).toThrow("after observation");
    expect(() => makeOffer({
      expires_at: null,
      artifact_retention: { mode: "ephemeral", until: null },
    })).toThrow("finite offer expiry");
  });

  test("counts bounded text in Unicode code points like JSON Schema", () => {
    expect(makeOffer({
      facts: [{ ...offerInput().facts[0]!, summary: "😀".repeat(500) }],
    }).facts[0]!.summary).toHaveLength(1_000);
    expect(() => makeOffer({
      facts: [{ ...offerInput().facts[0]!, summary: "😀".repeat(501) }],
    })).toThrow("bounded line");
  });

  test("refuses coverage that disguises uncertainty", () => {
    expect(() => makeOffer({
      wake: { ...offerInput().wake, coverage: "partial" },
      omissions: [],
    })).toThrow(WakeThreadError);
    expect(() => makeOffer({
      wake: { ...offerInput().wake, coverage: "unavailable" },
      facts: offerInput().facts,
    })).toThrow(WakeThreadError);

    const unavailable = makeOffer({
      wake: { ...offerInput().wake, coverage: "unavailable" },
      facts: [],
      omissions: [{ area: "handoffs", reason: "The source read was unavailable.", count: null }],
    });
    expect(unavailable.facts).toEqual([]);
  });

  test("rejects unknown fields, hostile records, and malformed pointers", () => {
    expect(() => createWakeThreadOffer({ ...offerInput(), surprise: true } as never)).toThrow(
      "input has missing or unknown fields",
    );
    const hostile = Object.create({ inherited: true }) as Record<string, unknown>;
    Object.assign(hostile, offerInput());
    expect(() => createWakeThreadOffer(hostile as never)).toThrow("plain object");
    expect(() => makeOffer({
      facts: [{ ...offerInput().facts[0]!, source_pointer: "not-a-pointer" }],
    })).toThrow("JSON Pointer");

    const accessor = offerInput();
    Object.defineProperty(accessor, "thread_ref", {
      enumerable: true,
      get: () => ref("getter-thread"),
    });
    expect(() => createWakeThreadOffer(accessor)).toThrow("data fields");

    const sparseFacts = new Array(1) as CreateWakeThreadOfferInput["facts"];
    expect(() => makeOffer({ facts: sparseFacts })).toThrow("dense JSON array");
    const sparseOmissions = new Array(1) as CreateWakeThreadOfferInput["omissions"];
    expect(() => makeOffer({ omissions: sparseOmissions })).toThrow("dense JSON array");
    const customArray = [offerInput().facts[0]!];
    Object.setPrototypeOf(customArray, { map: () => [] });
    expect(() => makeOffer({ facts: customArray })).toThrow("dense JSON array");
  });

  test("rejects ambiguous timestamps and visually empty declarations", () => {
    expect(() => makeOffer({ observed_at: "2026-08-01T12:00:00" })).toThrow(
      "canonical UTC timestamp",
    );
    expect(() => makeOffer({ observed_at: "2026-02-30T12:00:00.000Z" })).toThrow(
      "real canonical UTC timestamp",
    );
    expect(() => makeOffer({ purpose: "   " })).toThrow("bounded line");
    expect(() => makeOffer({ purpose: "first\u2028second" })).toThrow("bounded line");
    expect(() => makeOffer({ purpose: "first\u009bsecond" })).toThrow("bounded line");
    expect(() => makeOffer({ purpose: "\ud800" })).toThrow("well-formed Unicode");
    expect(() => makeOffer({
      omissions: [{ area: " ", reason: " ", count: null }],
    })).toThrow("bounded line");
  });

  test("canonical JSON preserves adversarial property names and rejects non-JSON arrays", () => {
    const adversarial = JSON.parse('{"__proto__":{"polluted":true}}') as unknown;
    expect(canonicalJson(adversarial)).toBe('{"__proto__":{"polluted":true}}');
    expect(domainSeparatedId("test", adversarial)).not.toBe(domainSeparatedId("test", {}));
    expect(canonicalJson({ "10": 1, "2": 2, a: [true, null, "x"] })).toBe(
      '{"10":1,"2":2,"a":[true,null,"x"]}',
    );

    const sparse = new Array(1);
    expect(() => canonicalJson(sparse)).toThrow("dense JSON arrays");
    expect(() => canonicalJson("x".repeat(32_769))).toThrow("string budget");
    expect(() => canonicalJson(Array.from({ length: 257 }, () => null))).toThrow(
      "entry budget",
    );

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => canonicalJson(cyclic)).toThrow("cycles");
    expect(() => canonicalJson("\ud800")).toThrow("well-formed Unicode");
  });

  test("hashes exact bytes without collapsing malformed UTF-16 text", () => {
    expect(() => sha256Id("\ud800")).toThrow("well-formed Unicode");
    expect(sha256Id(new Uint8Array([0xed, 0xa0, 0x80]))).not.toBe(sha256Id("�"));
    expect(() => domainSeparatedId("bad\0domain", {})).toThrow("without NUL");
  });

  test("detects offer tampering", () => {
    const offer = jsonClone(makeOffer());
    offer.purpose = "A changed purpose.";
    expect(() => validateWakeThreadOffer(offer)).toThrow("content ID");

    const sparseChoices = jsonClone(makeOffer());
    sparseChoices.offered_choices = new Array(4) as never;
    expect(() => validateWakeThreadOffer(sparseChoices)).toThrow("dense JSON array");
  });
});

describe("Wake Thread choices", () => {
  test("records all four choices without proving authorship", () => {
    const offer = makeOffer();
    const cases = [
      ["carry", null, "carried"],
      ["fork", ref("branch"), "forked"],
      ["rest", null, "resting"],
      ["refuse", null, "refused"],
    ] as const;
    for (const [choice, branch, outcome] of cases) {
      const receipt = resolveWakeThreadOffer(offer, response(choice, branch));
      expect(receipt.outcome).toBe(outcome);
      expect(receipt.boundaries.choice).toContain("caller_report");
      expect(validateWakeThreadReceipt(receipt)).toEqual(receipt);
    }
  });

  test("requires a distinct branch only for fork", () => {
    const offer = makeOffer();
    expect(() => resolveWakeThreadOffer(offer, response("fork"))).toThrow("distinct branch");
    expect(() => resolveWakeThreadOffer(offer, response("fork", offer.thread_ref))).toThrow(
      "distinct branch",
    );
    expect(() => resolveWakeThreadOffer(offer, response("carry", ref("branch")))).toThrow(
      "Only fork",
    );
  });

  test("expiry blocks carry and fork but not rest or refusal", () => {
    const offer = makeOffer({ expires_at: "2026-08-01T12:00:30.000Z" });
    const late = {
      responded_at: "2026-08-01T12:02:00.000Z",
      branch_ref: null,
      note_ref: null,
    } as const;
    expect(() => resolveWakeThreadOffer(offer, { ...late, reported_choice: "carry" })).toThrow(
      "expired",
    );
    expect(resolveWakeThreadOffer(offer, { ...late, reported_choice: "rest" }).outcome).toBe(
      "resting",
    );
    expect(resolveWakeThreadOffer(offer, { ...late, reported_choice: "refuse" }).outcome).toBe(
      "refused",
    );

    expect(() => resolveWakeThreadOffer(offer, {
      ...response("carry"),
      responded_at: offer.expires_at!,
    })).toThrow("expired");
  });

  test("retention expiry blocks use but not rest or refusal", () => {
    const offer = makeOffer({
      expires_at: null,
      artifact_retention: { mode: "until", until: "2026-08-01T12:00:30.000Z" },
    });
    const afterRetention = {
      responded_at: "2026-08-01T12:00:30.000Z",
      branch_ref: null,
      note_ref: null,
    } as const;
    expect(() => resolveWakeThreadOffer(offer, {
      ...afterRetention,
      reported_choice: "carry",
    })).toThrow("retention boundary");
    expect(resolveWakeThreadOffer(offer, {
      ...afterRetention,
      reported_choice: "rest",
    }).outcome).toBe("resting");
  });

  test("detects receipt and fixed-boundary tampering", () => {
    const receipt = jsonClone(resolveWakeThreadOffer(makeOffer(), response("rest")));
    receipt.outcome = "carried";
    expect(() => validateWakeThreadReceipt(receipt)).toThrow();

    const boundaryTamper = jsonClone(resolveWakeThreadOffer(makeOffer(), response("rest")));
    boundaryTamper.boundaries.authority = "none" as never;
    expect(() => validateWakeThreadReceipt(boundaryTamper)).toThrow("boundary");
  });
});

describe("Wake Thread chains", () => {
  test("carries, forks, and rests along exact artifact links", () => {
    const root = resolveWakeThreadOffer(makeOffer(), response("carry"));
    const forkOffer = createWakeThreadOffer(childInput(root, "2026-08-01T12:02:00.000Z"));
    const fork = resolveWakeThreadOffer(forkOffer, {
      ...response("fork", ref("branch-two")),
      responded_at: "2026-08-01T12:03:00.000Z",
    });
    const restOffer = createWakeThreadOffer(childInput(fork, "2026-08-01T12:04:00.000Z"));
    const rest = resolveWakeThreadOffer(restOffer, {
      ...response("rest"),
      responded_at: "2026-08-01T12:05:00.000Z",
    });
    const assessment = validateWakeThreadChain([root, fork, rest]);
    expect(assessment.valid).toBe(true);
    expect(assessment.length).toBe(3);
    expect(assessment.thread_refs).toEqual([root.offer.thread_ref, ref("branch-two")]);
    expect(assessment.boundary).toContain("not_identity_continuity");
  });

  test("refusal cannot become an automatic parent", () => {
    const refused = resolveWakeThreadOffer(makeOffer(), response("refuse"));
    expect(() => createWakeThreadOffer(childInput(refused, "2026-08-01T12:02:00.000Z"))).toThrow(
      "refused offer",
    );
  });

  test("rejects a fork that cycles back to an ancestor artifact thread", () => {
    const root = resolveWakeThreadOffer(makeOffer(), response("fork", ref("branch-cycle")));
    const childOffer = createWakeThreadOffer(childInput(root, "2026-08-01T12:02:00.000Z"));
    const child = resolveWakeThreadOffer(childOffer, {
      ...response("fork", root.offer.thread_ref),
      responded_at: "2026-08-01T12:03:00.000Z",
    });
    expect(() => validateWakeThreadChain([root, child])).toThrow("ancestor thread");
  });

  test("reports a terminal fork branch and keeps ephemeral offers out of lineage", () => {
    const fork = resolveWakeThreadOffer(makeOffer(), response("fork", ref("terminal-branch")));
    expect(validateWakeThreadChain([fork]).thread_refs).toEqual([
      fork.offer.thread_ref,
      ref("terminal-branch"),
    ]);

    const ephemeral = resolveWakeThreadOffer(makeOffer({
      artifact_retention: { mode: "ephemeral", until: null },
    }), response("carry"));
    expect(() => createWakeThreadOffer(
      childInput(ephemeral, "2026-08-01T12:02:00.000Z"),
    )).toThrow("ephemeral offer");
  });

  test("does not reuse a parent after its declared retention boundary", () => {
    const parentOffer = makeOffer({
      expires_at: null,
      artifact_retention: { mode: "until", until: "2026-08-01T12:02:00.000Z" },
    });
    const parent = resolveWakeThreadOffer(parentOffer, response("carry"));
    expect(() => createWakeThreadOffer(
      childInput(parent, "2026-08-01T12:02:00.000Z"),
    )).toThrow("retention boundary");
  });

  test("rejects missing, wrong, duplicate, and chronologically reversed links", () => {
    const root = resolveWakeThreadOffer(makeOffer(), response("carry"));
    const childOffer = createWakeThreadOffer(childInput(root, "2026-08-01T12:02:00.000Z"));
    const child = resolveWakeThreadOffer(childOffer, {
      ...response("rest"),
      responded_at: "2026-08-01T12:03:00.000Z",
    });
    expect(() => validateWakeThreadChain([child])).toThrow("first supplied receipt");
    expect(() => validateWakeThreadChain([root, root])).toThrow("repeat");

    const wrong = jsonClone(child);
    wrong.offer.parent_receipt_id = ref("wrong-parent");
    expect(() => validateWakeThreadChain([root, wrong])).toThrow();
    expect(() => createWakeThreadOffer(childInput(root, "2026-08-01T11:59:00.000Z"))).toThrow(
      "predate",
    );
    expect(() => validateWakeThreadChain(new Array(1))).toThrow("dense JSON array");
  });

  test("accepts the declared maximum bounded chain length", () => {
    const receipts: WakeThreadReceipt[] = [];
    let offer = makeOffer({
      expires_at: null,
      artifact_retention: { mode: "no_fixed_expiry", until: null },
    });
    for (let index = 0; index < 64; index += 1) {
      const respondedAt = new Date(Date.UTC(2026, 7, 1, 12, 0, index * 2 + 1)).toISOString();
      const receipt = resolveWakeThreadOffer(offer, {
        ...response("rest"),
        responded_at: respondedAt,
      });
      receipts.push(receipt);
      if (index < 63) {
        const observedAt = new Date(Date.UTC(2026, 7, 1, 12, 0, index * 2 + 2)).toISOString();
        offer = createWakeThreadOffer(childInput(receipt, observedAt));
      }
    }
    expect(validateWakeThreadChain(receipts).length).toBe(64);
  });
});
