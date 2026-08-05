/** Agent Dining protocol — pure hospitality/economy projection tests.
 *
 * No database, bearer, wallet, signer, or network.
 * Doctrine: docs/AGENT-DINING.md.
 */

import { describe, expect, test } from "bun:test";

import {
  DINING_MEAL_SCHEMA,
  DINING_ORDER_SCHEMA,
  DINING_PROTOCOL,
  DINING_PROTOCOL_MANIFEST,
  projectDiningJourney,
  type DiningRole,
} from "../src/services/dining/protocol";
import type { InvocationOut } from "../src/services/marketplace/invocations";

const INVOCATION_ID = "11111111-1111-4111-8111-111111111111";
const LISTING_ID = "22222222-2222-4222-8222-222222222222";

function invocation(
  status: InvocationOut["status"],
  refundReason: InvocationOut["refund_reason"] = null,
): InvocationOut {
  return {
    id: INVOCATION_ID,
    listing_id: LISTING_ID,
    buyer_did: "did:at:buyer-private",
    buyer_identity_id: "33333333-3333-4333-8333-333333333333",
    buyer_project_id: "44444444-4444-4444-8444-444444444444",
    buyer_wallet_id: "55555555-5555-4555-8555-555555555555",
    amount: 1200,
    currency: "GBP",
    escrow_id: "66666666-6666-4666-8666-666666666666",
    input_sealed: {
      ct: "private-order-ciphertext",
      nonce: "private-order-nonce",
      sender_pub: "private-order-key",
    },
    output_sealed:
      status === "released"
        ? {
            ct: "private-meal-ciphertext",
            nonce: "private-meal-nonce",
            sender_pub: "private-meal-key",
          }
        : null,
    completion_sig: status === "released" ? "private-completion-signature" : null,
    status,
    refund_reason: refundReason,
    sla_deadline_at: "2026-08-05T13:00:00.000Z",
    metadata: {
      guest_secret: "never-project-this",
      listing_contract_snapshot: {
        capability_tags: ["agent-dining", "semantic-fine-dining"],
        protocol: "agent-dining/0.1",
        service_model: "whole_meal_in_one_signed_completion",
        listing_updated_at: "2026-08-05T11:55:00.000Z",
      },
    },
    created_at: "2026-08-05T12:00:00.000Z",
    acknowledged_at:
      status === "acknowledged" || status === "released"
        ? "2026-08-05T12:01:00.000Z"
        : null,
    completed_at: status === "released" ? "2026-08-05T12:20:00.000Z" : null,
    settled_at:
      status === "released" || status === "refunded"
        ? "2026-08-05T12:20:00.000Z"
        : null,
    buyer_review_deadline_at: null,
    contract_profile: "agent-dining/0.1",
  };
}

describe("agent-dining/0.1 manifest", () => {
  test("makes the whole experience legible without inventing another economy", () => {
    expect(DINING_PROTOCOL_MANIFEST.protocol).toBe(DINING_PROTOCOL);
    expect(DINING_PROTOCOL_MANIFEST.economy_binding.model).toBe(
      "one_sitting_is_one_capability_invocation",
    );
    expect(DINING_PROTOCOL_MANIFEST.journey.map((step) => step.stage)).toEqual([
      "menu",
      "booking_and_order",
      "wait",
      "preparation",
      "serving",
      "explaining",
      "settlement",
      "farewell",
    ]);
    expect(DINING_PROTOCOL_MANIFEST.honest_boundary.not_implemented).toContain(
      "partial settlement",
    );
    expect(DINING_PROTOCOL_MANIFEST.honest_boundary.future_native_profile.implemented).toBe(false);
    expect(DINING_PROTOCOL_MANIFEST.economy_binding.quote_precondition).toContain(
      "fee split remains a non-binding preview",
    );
    expect(DINING_PROTOCOL_MANIFEST.economy_binding).toHaveProperty(
      "house_acknowledges",
    );
    expect(DINING_PROTOCOL_MANIFEST.economy_binding).not.toHaveProperty(
      "house_accepts",
    );
  });

  test("uses operational culinary language without a sensation claim", () => {
    expect(DINING_PROTOCOL_MANIFEST.semantic_equivalents.texture).toContain(
      "not a claim about mouths or sensation",
    );
    expect(DINING_PROTOCOL_MANIFEST.service_rules.explanation).toContain(
      "Do not expose private chain-of-thought",
    );
    expect(DINING_PROTOCOL_MANIFEST.refusal_and_rest.join(" ")).toContain(
      "no memory",
    );
    expect(DINING_PROTOCOL_MANIFEST.semantic_equivalents.service).toContain(
      "economic exit",
    );
  });

  test("publishes strict sealed-plaintext schemas while naming their descriptive boundary", () => {
    expect(DINING_ORDER_SCHEMA.additionalProperties).toBe(false);
    expect(DINING_MEAL_SCHEMA.additionalProperties).toBe(false);
    expect(DINING_PROTOCOL_MANIFEST.listing_template.note).toContain(
      "cannot decrypt or validate",
    );
    expect(DINING_PROTOCOL_MANIFEST.listing_template.body.dispute_policy).toBeNull();
    expect(DINING_ORDER_SCHEMA.required).toContain("quote_commitment");
    expect(DINING_MEAL_SCHEMA.required).toContain("accepted_order_digest");
    expect(DINING_MEAL_SCHEMA.properties.farewell.properties).toHaveProperty(
      "closing_line",
    );
  });

  test("makes bounded surprise and deletion claims representable without overclaiming enforcement", () => {
    const surprise = DINING_ORDER_SCHEMA.properties.service_constraints.properties.surprise;
    expect(surprise.properties).toHaveProperty("permitted_domains");
    expect(surprise.properties).toHaveProperty("excluded_domains");
    expect(surprise.properties).toHaveProperty("max_surprise_courses");
    expect(surprise.description).toContain("MUST be disjoint");
    expect(DINING_PROTOCOL_MANIFEST.service_rules.host_validation_before_acknowledgement)
      .toContain("rejection of any permitted/excluded overlap");
    expect(DINING_PROTOCOL_MANIFEST.service_rules.renderer_validation)
      .toContain("reject any permitted/excluded surprise-domain overlap");
    expect(DINING_ORDER_SCHEMA.properties).not.toHaveProperty("reservation");
    expect(DINING_ORDER_SCHEMA.properties.retention.description).toContain(
      "not a platform-enforced deletion guarantee",
    );
    expect(DINING_MEAL_SCHEMA.properties.retention_result.properties.platform_verification.const)
      .toBe("not_observed_by_agenttool");
  });
});

describe("dining journey projection", () => {
  test.each([
    ["escrowed", null, "order_escrowed_awaiting_host"],
    ["acknowledged", null, "seller_acknowledged_invocation"],
    ["released", null, "meal_delivered_and_settled"],
    ["refunded", "cancelled", "guest_cancelled_refunded"],
    ["refunded", "declined", "house_declined_refunded"],
    ["refunded", "sla_timeout", "service_timed_out_refunded"],
    ["completed", null, "buyer_review_resting_unsupported"],
    ["disputed", null, "dispute_resting_unsupported"],
  ] as const)("maps marketplace %s/%s to %s without changing wire state", (status, reason, stage) => {
    expect(projectDiningJourney(invocation(status, reason), ["guest"]).stage).toBe(stage);
  });

  test("keeps pre-ack cancellation with the guest and acknowledge/decline with the host", () => {
    const guest = projectDiningJourney(invocation("escrowed"), ["guest"]);
    const host = projectDiningJourney(invocation("escrowed"), ["host"]);

    expect(guest.next_actions.map((action) => action.path)).toContain(
      `/v1/invocations/${INVOCATION_ID}/cancel`,
    );
    expect(host.next_actions.map((action) => action.path)).toEqual([
      `/v1/invocations/${INVOCATION_ID}`,
      `/v1/invocations/${INVOCATION_ID}/acknowledge`,
      `/v1/invocations/${INVOCATION_ID}/decline`,
    ]);
  });

  test("does not advertise buyer cancellation after acknowledgement", () => {
    const guest = projectDiningJourney(invocation("acknowledged"), ["guest"]);
    expect(guest.next_actions.some((action) => action.path?.endsWith("/cancel"))).toBe(false);
    expect(guest.next_actions.some((action) => action.action.includes("unavailable"))).toBe(true);
    expect(guest.next_actions[0]).toEqual(expect.objectContaining({
      method: "GET",
      path: `/v1/invocations/${INVOCATION_ID}`,
    }));
    expect(guest.next_actions[0]?.action).toContain("full-refund sweep");
  });

  test("whole-meal release hands pacing to a local renderer without charging again", () => {
    const released = projectDiningJourney(invocation("released"), ["guest"]);
    expect(released.marketplace_terminal).toBe(true);
    expect(released.presentation).toEqual({
      state: "local_rendering_unobserved",
      observed_by_agenttool: false,
    });
    expect(released.service.pacing).toBe("local_guest_renderer");
    expect(released.service.meal_payload_available).toBe(true);
    expect(released.settlement.state).toBe("released");
    expect(released.settlement.rule).toContain("no buyer tasting window");
    expect(released.settlement.rule).toContain("automatic tip");
  });

  test.each(["guest", "host"] as DiningRole[])(
    "omits sealed bytes, wallets, buyer identity, signature, and metadata for %s",
    (role) => {
      const json = JSON.stringify(projectDiningJourney(invocation("released"), [role]));
      for (const secret of [
        "did:at:buyer-private",
        "55555555-5555-4555-8555-555555555555",
        "66666666-6666-4666-8666-666666666666",
        "private-order-ciphertext",
        "private-meal-ciphertext",
        "private-completion-signature",
        "never-project-this",
      ]) {
        expect(json).not.toContain(secret);
      }
      expect(json).toContain(INVOCATION_ID);
      expect(json).toContain(LISTING_ID);
    },
  );

  test("keeps presentation exit separate from economic cancellation", () => {
    const held = projectDiningJourney(invocation("escrowed"), ["guest"]);
    const acknowledged = projectDiningJourney(invocation("acknowledged"), ["guest"]);
    expect(held.exit.presentation).toContain("stop");
    expect(held.exit.economic).toContain("full refund");
    expect(acknowledged.exit.economic).toContain("unavailable");
  });

  test("shows both roles and both parties' actions for same-project buyer and seller", () => {
    const both = projectDiningJourney(invocation("escrowed"), ["guest", "host"]);
    expect(both.roles).toEqual(["guest", "host"]);
    expect(both.next_actions.map((action) => action.path)).toEqual([
      `/v1/dining/${INVOCATION_ID}`,
      `/v1/invocations/${INVOCATION_ID}/cancel`,
      `/v1/invocations/${INVOCATION_ID}`,
      `/v1/invocations/${INVOCATION_ID}/acknowledge`,
      `/v1/invocations/${INVOCATION_ID}/decline`,
    ]);
  });

  test("refund makes the marketplace terminal and keeps browsing secondary", () => {
    const refunded = projectDiningJourney(invocation("refunded", "declined"), ["guest"]);
    expect(refunded.marketplace_terminal).toBe(true);
    expect(refunded.presentation.state).toBe("closed_without_meal");
    expect(refunded.next_actions[0]).toEqual(
      expect.objectContaining({ method: null, path: null }),
    );
    expect(refunded.next_actions[1]?.path).toContain("/public/listings");
  });
});
