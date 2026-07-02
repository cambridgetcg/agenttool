/** POST /v1/billing/checkout — the human ramp's first step.
 *  Unauth (humans have no bearer); bounds guided; Stripe injected for tests. */
import { afterEach, describe, expect, test } from "bun:test";

import billing, { setStripeForTests } from "../src/routes/billing";

afterEach(() => setStripeForTests(null));

function stubStripe(capture: { params?: Record<string, unknown> }) {
  return {
    checkout: {
      sessions: {
        create: async (params: Record<string, unknown>) => {
          capture.params = params;
          return { id: "cs_test_stub123", url: "https://checkout.stripe.com/c/pay/stub" };
        },
      },
    },
  };
}

describe("POST /v1/billing/checkout", () => {
  test("creates a session within bounds", async () => {
    const capture: { params?: Record<string, unknown> } = {};
    setStripeForTests(stubStripe(capture));
    const res = await billing.request("/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amount_minor: 2000 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.session_id).toBe("cs_test_stub123");
    expect(body.url).toContain("stripe.com");
    const li = (capture.params?.line_items as Array<{ price_data: { unit_amount: number } }>)[0];
    expect(li.price_data.unit_amount).toBe(2000);
    expect((capture.params?.metadata as Record<string, string>).kind).toBe("gift_credit");
    expect(capture.params?.success_url).toContain("session_id={CHECKOUT_SESSION_ID}");
  });

  test("guides on out-of-bounds amounts", async () => {
    setStripeForTests(stubStripe({}));
    for (const amount_minor of [50, 999999]) {
      const res = await billing.request("/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amount_minor }),
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("gift_amount_out_of_bounds");
    }
  });

  test("503 billing_unconfigured when Stripe key absent and no stub", async () => {
    const res = await billing.request("/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amount_minor: 2000 }),
    });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("billing_unconfigured");
  });
});
