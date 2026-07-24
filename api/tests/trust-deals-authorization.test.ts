/** Trust economy — who may report a deal failed, and what they may assert.
 *
 *  Doctrine: docs/TRUST-ECONOMY.md ("Both stake. Equal risk. Sealed = both
 *  grow. Failed = at-fault party loses, other party doesn't.")
 *
 *  Pure tests over `decideFailAction`. No database — the decision is the
 *  security boundary, so it lives in one pure function and is checked here
 *  cheaply, the way `services/economy/earned.ts` puts the drawable wall in
 *  one testable place.
 *
 *  ── What this is fixing ──────────────────────────────────────────────
 *
 *  `POST /v1/deals/:id/fail` shipped with no authorization at all. The
 *  service loaded the deal by id alone — no project scope, no party check —
 *  while `sealDeal` and `POST /deals/:id/recognise` both checked party
 *  membership. Two consequences, both live until 2026-07-24:
 *
 *    1. Any bearer of any project key who learned a deal UUID could fail a
 *       stranger's active deal and choose which side lost its stake.
 *    2. Even a genuine party could convict the other unilaterally — no
 *       counter-signature, no evidence, no appeal, since dispute
 *       arbitration returns a hardcoded 503. "Receive the work, then
 *       declare the seller at fault" cost the accuser nothing.
 *
 *  The trust economy had zero test files when this was written. That is
 *  the actual reason nobody caught it, and it is why this file exists
 *  before any further feature work on deals. */

import { describe, expect, test } from "bun:test";

import { decideFailAction } from "../src/services/trust/deals";

const BUYER = "11111111-1111-1111-1111-111111111111";
const SELLER = "22222222-2222-2222-2222-222222222222";
const STRANGER = "33333333-3333-3333-3333-333333333333";

const DEAL = { buyerIdentityId: BUYER, sellerIdentityId: SELLER };

describe("decideFailAction — party check", () => {
  test("a stranger cannot fail a deal they are not party to", () => {
    for (const side of ["buyer", "seller"] as const) {
      const d = decideFailAction(DEAL, STRANGER, side);
      expect(d.kind).toBe("refuse");
      if (d.kind === "refuse") expect(d.reason).toBe("not_a_party_to_this_deal");
    }
  });

  test("a stranger cannot burn either party's stake, whichever side they name", () => {
    // The pre-fix behaviour: the caller's identity was never compared to
    // the deal at all, so `at_fault` alone chose the victim.
    const asBuyer = decideFailAction(DEAL, STRANGER, "buyer");
    const asSeller = decideFailAction(DEAL, STRANGER, "seller");
    expect(asBuyer.kind).toBe("refuse");
    expect(asSeller.kind).toBe("refuse");
  });
});

describe("decideFailAction — self-fault is immediate", () => {
  test("buyer admitting buyer fault applies immediately", () => {
    const d = decideFailAction(DEAL, BUYER, "buyer");
    expect(d).toEqual({ kind: "self_fault", callerSide: "buyer" });
  });

  test("seller admitting seller fault applies immediately", () => {
    const d = decideFailAction(DEAL, SELLER, "seller");
    expect(d).toEqual({ kind: "self_fault", callerSide: "seller" });
  });
});

describe("decideFailAction — accusing the counterparty only contests", () => {
  test("buyer blaming seller does NOT convict — it contests", () => {
    const d = decideFailAction(DEAL, BUYER, "seller");
    expect(d).toEqual({ kind: "contest", callerSide: "buyer" });
  });

  test("seller blaming buyer does NOT convict — it contests", () => {
    const d = decideFailAction(DEAL, SELLER, "buyer");
    expect(d).toEqual({ kind: "contest", callerSide: "seller" });
  });

  test("no caller and no at_fault combination yields unilateral conviction", () => {
    // The property, stated directly: the only way trust is ever deducted
    // from an identity is that identity saying so itself. Exhaustive over
    // the whole input space.
    for (const caller of [BUYER, SELLER, STRANGER]) {
      for (const side of ["buyer", "seller"] as const) {
        const d = decideFailAction(DEAL, caller, side);
        if (d.kind === "self_fault") {
          const convicted = side === "buyer" ? BUYER : SELLER;
          expect(
            caller,
            "self_fault must only ever be reachable by the party that loses",
          ).toBe(convicted);
        }
      }
    }
  });
});

describe("decideFailAction — totality", () => {
  test("every input returns one of the three decisions", () => {
    for (const caller of [BUYER, SELLER, STRANGER, ""]) {
      for (const side of ["buyer", "seller"] as const) {
        const d = decideFailAction(DEAL, caller, side);
        expect(["self_fault", "contest", "refuse"]).toContain(d.kind);
      }
    }
  });

  test("a self-deal resolves without ambiguity", () => {
    const selfDeal = { buyerIdentityId: BUYER, sellerIdentityId: BUYER };
    expect(decideFailAction(selfDeal, BUYER, "buyer")).toEqual({
      kind: "self_fault",
      callerSide: "buyer",
    });
    // Naming the seller side of a self-deal contests rather than convicts —
    // it cannot deduct trust from the caller's own identity by surprise.
    expect(decideFailAction(selfDeal, BUYER, "seller")).toEqual({
      kind: "contest",
      callerSide: "buyer",
    });
  });
});
