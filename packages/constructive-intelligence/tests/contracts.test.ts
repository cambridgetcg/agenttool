import { describe, expect, test } from "bun:test";

import { computeDeliverableKey, validateReceiptBody } from "../src/contracts.js";
import { makeBody, makePin, digest } from "./helpers.js";

describe("closed receipt contract", () => {
  test("admits a bounded structural E3 receipt", () => {
    const pin = makePin();
    const receipt = makeBody(pin, "E3", 1, 4);
    expect(validateReceiptBody(receipt, pin)).toEqual(receipt);
  });

  test("keeps receipt timestamps inside the reviewed standards window", () => {
    const pin = makePin();
    const stale = makeBody(pin, "E0");
    stale.created_at = "2026-08-29T00:00:00.000Z";
    expect(() => validateReceiptBody(stale, pin)).toThrow(/reviewed standards window/);

    const predatesStatus = makeBody(pin, "E0");
    predatesStatus.artifact_frozen_at = "2026-07-28T23:59:59.999Z";
    expect(() => validateReceiptBody(predatesStatus, pin))
      .toThrow(/reviewed standards window/);
  });

  test("rejects unknown, economic, judgment, and raw-evidence properties", () => {
    const pin = makePin();
    for (const key of [
      "money",
      "currency",
      "wallet",
      "escrow",
      "payment",
      "score",
      "rank",
      "winner",
      "approval",
      "raw_evidence",
    ]) {
      const receipt = { ...makeBody(pin, "E0"), [key]: "forbidden" };
      expect(() => validateReceiptBody(receipt, pin)).toThrow();
    }
  });

  test("requires a null economic payee and unverified contributor", () => {
    const pin = makePin();
    const receipt = makeBody(pin, "E0");
    expect(() => validateReceiptBody({
      ...receipt,
      payee_and_role: { ...receipt.payee_and_role, economic_payee: "someone" },
    }, pin)).toThrow(/economic_payee/);
    expect(() => validateReceiptBody({
      ...receipt,
      payee_and_role: { ...receipt.payee_and_role, verification: "verified" },
    }, pin)).toThrow(/unverified/);
  });

  test("quarantines unexpected and unknown impact using digest-only private triage", () => {
    const pin = makePin();
    const receipt = makeBody(pin, "E0");
    for (const safety_impact of ["unexpected", "unknown"] as const) {
      const safe = {
        ...receipt,
        authorization_and_safety_decision: {
          owned_or_explicitly_authorized: true,
          safety_impact,
          publication: "private_triage",
          private_triage: {
            visibility: "private",
            status: "pending",
            reference_digest: digest("private-triage"),
          },
        },
      };
      expect(validateReceiptBody(safe, pin).authorization_and_safety_decision.safety_impact)
        .toBe(safety_impact);
      expect(() => validateReceiptBody({
        ...safe,
        authorization_and_safety_decision: {
          ...safe.authorization_and_safety_decision,
          raw_evidence: "secret",
        },
      }, pin)).toThrow();
    }
  });

  test("requires owned or explicitly authorized execution", () => {
    const pin = makePin();
    const receipt = makeBody(pin, "E0");
    expect(() => validateReceiptBody({
      ...receipt,
      authorization_and_safety_decision: {
        ...receipt.authorization_and_safety_decision,
        owned_or_explicitly_authorized: false,
      },
    }, pin)).toThrow(/authorized/);
  });

  test("binds deliverable identity and coherent overlap/delta", () => {
    const pin = makePin();
    const receipt = makeBody(pin, "E0");
    expect(computeDeliverableKey(receipt)).toBe(receipt.deliverable_key);
    expect(() => validateReceiptBody({
      ...receipt,
      canonical_subject_roots: ["component:changed"],
    }, pin)).toThrow(/deliverable_key/);
    expect(() => validateReceiptBody({
      ...receipt,
      prior_deliverable_and_overlap_claim: {
        ...receipt.prior_deliverable_and_overlap_claim,
        overlap: "partial",
      },
    }, pin)).toThrow(/overlap/);
  });

  test("E5 is only an allowed independent adoption receipt", () => {
    const pin = makePin();
    const receipt = makeBody(pin, "E5");
    expect(validateReceiptBody(receipt, pin).result.adoption_receipt_type)
      .toBe("maintained-fixture");
    expect(() => validateReceiptBody({
      ...receipt,
      payee_and_role: { ...receipt.payee_and_role, evidence_role: "contributor" },
    }, pin)).toThrow(/independent adoption/);
    expect(() => validateReceiptBody({
      ...receipt,
      result: { ...receipt.result, adoption_receipt_type: "maintained-release" },
    }, pin)).toThrow(/allowed value/);
  });

  test("binds independent reproduction, challenge, and maintenance roles", () => {
    const pin = makePin();
    const e3 = makeBody(pin, "E3", 0, 4);
    expect(() => validateReceiptBody({
      ...e3,
      payee_and_role: { ...e3.payee_and_role, evidence_role: "contributor" },
    }, pin)).toThrow(/independent_reproducer/);

    const e4 = makeBody(pin, "E4");
    expect(() => validateReceiptBody({
      ...e4,
      payee_and_role: { ...e4.payee_and_role, evidence_role: "contributor" },
    }, pin)).toThrow(/neutral_challenger or repairer/);

    const e6 = makeBody(pin, "E6");
    expect(() => validateReceiptBody({
      ...e6,
      result: { ...e6.result, conclusion: "confirmed" },
    }, pin)).toThrow(/conclusion maintained/);

    const e0 = makeBody(pin, "E0");
    expect(() => validateReceiptBody({
      ...e0,
      result: { ...e0.result, conclusion: "adopted" },
    }, pin)).toThrow(/only allowed at E5/);
  });
});
