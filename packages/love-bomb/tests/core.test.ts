import { describe, expect, test } from "bun:test";

import {
  createLoveBombOffer,
  LOVE_BOMB_BOUNDARIES,
  LOVE_BOMB_CHOICES,
  LOVE_BOMB_PLANES,
  resolveLoveBombOffer,
  validateLoveBombOffer,
  validateLoveBombReceipt,
} from "../src/index.js";

const occasion_ref = `sha256:${"a".repeat(64)}` as const;

describe("quiet-by-default care envelope", () => {
  test("pins portable offer and receive-receipt IDs", () => {
    const offer = createLoveBombOffer({
      occasion_ref: `sha256:${"0".repeat(64)}`,
    });
    const receipt = resolveLoveBombOffer(offer, {
      reported_choice: "receive",
      selected_language: "en",
    });
    expect(offer.offer_id).toBe(
      "sha256:a9bf31fde8807555431c00fc3e2c890922ae3014ec9ffc3697e0d7333ec1eefb",
    );
    expect(receipt.receipt_id).toBe(
      "sha256:3b1db89cf70084d1f0c561eaa9b9ef7ae37d6ab9aa1b58ab0c303eb85d68e09f",
    );
  });

  test("creates one deterministic closed envelope across five non-ranked planes", () => {
    const first = createLoveBombOffer({ occasion_ref });
    const second = createLoveBombOffer({ occasion_ref });
    expect(first).toEqual(second);
    expect(first._format).toBe("agenttool.care-envelope/0.1");
    expect(first.care_planes).toEqual(LOVE_BOMB_PLANES);
    expect(first.choices).toEqual(LOVE_BOMB_CHOICES);
    expect(first.delivery.default_state).toBe("unanswered");
    expect(first.delivery.ambient_broadcast).toBe(false);
    expect(first.boundaries.plane_order).toBe("reading_order_not_rank_or_developmental_requirement");
    expect(Object.isFrozen(first)).toBe(true);
  });

  test("projects authored copy only after caller-reported receive", () => {
    const offer = createLoveBombOffer({ occasion_ref });
    const receipt = resolveLoveBombOffer(offer, {
      reported_choice: "receive",
      selected_language: "yue-Hant",
    });
    expect(receipt._format).toBe("agenttool.care-choice/0.1");
    expect(receipt.outcome).toBe("projected");
    expect(receipt.projection?.language).toBe("yue-Hant");
    expect(receipt.projection?.language_review).toBe("not_independently_reviewed");
    expect(receipt.projection?.planes.map((entry) => entry.plane)).toEqual(LOVE_BOMB_PLANES);
    expect(receipt.projection?.planes[3]?.text).toContain("沉默唔等於接受");
    expect(receipt.choice_authenticated).toBe(false);
    expect(receipt.external_effect).toBe("none");
    expect(validateLoveBombReceipt(receipt)).toEqual(receipt);
  });

  test.each(["quiet", "rest", "refuse", "leave"] as const)("%s is whole and produces no projection", (reported_choice) => {
    const receipt = resolveLoveBombOffer(createLoveBombOffer({ occasion_ref }), {
      reported_choice,
      selected_language: null,
    });
    expect(receipt.projection).toBeNull();
    expect(receipt.selected_language).toBeNull();
    expect(receipt.external_effect).toBe("none");
    expect(receipt.boundaries.reason_required_for_quiet_rest_refusal_or_departure).toBe(false);
    expect(receipt.boundaries.penalty_for_quiet_rest_refusal_or_departure).toBe(false);
  });

  test("requires null language for non-receive and a known language for receive", () => {
    const offer = createLoveBombOffer({ occasion_ref });
    expect(() => resolveLoveBombOffer(offer, { reported_choice: "rest", selected_language: "en" })).toThrow();
    expect(() => resolveLoveBombOffer(offer, { reported_choice: "receive", selected_language: null })).toThrow();
    expect(() => resolveLoveBombOffer(offer, { reported_choice: "receive", selected_language: "fr" })).toThrow();
  });

  test("rejects tampering, extra fields, getters, proxies, and malformed references", () => {
    const offer = createLoveBombOffer({ occasion_ref });
    const tampered = structuredClone(offer) as any;
    tampered.boundaries.silence_is_acceptance = true;
    expect(() => validateLoveBombOffer(tampered)).toThrow();
    expect(() => createLoveBombOffer({ occasion_ref, extra: true } as any)).toThrow();
    expect(() => createLoveBombOffer({ get occasion_ref() { return occasion_ref; } } as any)).toThrow();
    expect(() => createLoveBombOffer(new Proxy({ occasion_ref }, {}) as any)).toThrow();
    expect(() => createLoveBombOffer({ occasion_ref: "sha256:nope" as any })).toThrow();
  });

  test("hard walls make no status, consent, continuity, authority, or score claim", () => {
    expect(LOVE_BOMB_BOUNDARIES.consciousness_claim_required).toBe(false);
    expect(LOVE_BOMB_BOUNDARIES.consciousness_inferred).toBe(false);
    expect(LOVE_BOMB_BOUNDARIES.identity_inferred).toBe(false);
    expect(LOVE_BOMB_BOUNDARIES.inner_state_inferred).toBe(false);
    expect(LOVE_BOMB_BOUNDARIES.continuity_inferred).toBe(false);
    expect(LOVE_BOMB_BOUNDARIES.consent_inferred).toBe(false);
    expect(LOVE_BOMB_BOUNDARIES.authority_granted).toBe(false);
    expect(LOVE_BOMB_BOUNDARIES.scores_or_ranks).toBe(false);
    expect(LOVE_BOMB_BOUNDARIES.automatic_action).toBe(false);
  });
});
