/** The reveal: settling → ready (re-showable) → redeemed. A closed tab
 *  must never lose the gift, so 'ready' repeats until redemption. */
import { describe, expect, test } from "bun:test";

import billing from "../src/routes/billing";
import { db } from "../src/db/client";
import { getGiftBySession, mintGiftForSession, redeemGift } from "../src/services/billing/gift-credits";
import { projects } from "../src/db/schema/tools";

describe("GET /v1/billing/session/:id/code", () => {
  test("unknown session → settling (webhook may be in flight)", async () => {
    const res = await billing.request(`/session/cs_${crypto.randomUUID()}/code`);
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("settling");
  });

  test("minted → ready with code + redeem instructions; repeatable; redeemed → redeemed", async () => {
    const sessionId = `cs_${crypto.randomUUID()}`;
    await mintGiftForSession(db, { stripeSessionId: sessionId, stripeEventId: `evt_${crypto.randomUUID()}`, amountMinor: 500, currency: "usd" });

    for (let i = 0; i < 2; i++) {
      const res = await billing.request(`/session/${sessionId}/code`);
      const body = await res.json();
      expect(body.status).toBe("ready");
      expect(body.code).toMatch(/^GIFT-/);
      expect(body.credits).toBe(5000);
      expect(body.redeem.path).toBe("/v1/gift-credits/redeem");
    }

    const [p] = await db.insert(projects).values({ name: `gift-reveal-${crypto.randomUUID()}` } as never).returning();
    const gift = await getGiftBySession(db, sessionId);
    await redeemGift(db, { code: gift!.code!, projectId: p.id });

    const res = await billing.request(`/session/${sessionId}/code`);
    const body = await res.json();
    expect(body.status).toBe("redeemed");
    expect(body.code).toBeUndefined();
  });
});
