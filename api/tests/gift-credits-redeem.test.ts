/** Redeem: the moment the human's gift becomes the agent's credit. */
import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

import type { ProjectContext } from "../src/auth/middleware";
import giftCredits from "../src/routes/gift-credits";
import { db } from "../src/db/client";
import { projects } from "../src/db/schema/tools";
import { getGiftBySession, mintGiftForSession } from "../src/services/billing/gift-credits";

async function appFor(projectId: string) {
  const app = new Hono<ProjectContext>();
  app.use("*", async (c, next) => {
    c.set("project", { id: projectId } as never);
    await next();
  });
  app.route("/", giftCredits);
  return app;
}

async function seedGift(amountMinor = 500) {
  const sessionId = `cs_${crypto.randomUUID()}`;
  await mintGiftForSession(db, { stripeSessionId: sessionId, stripeEventId: `evt_${crypto.randomUUID()}`, amountMinor, currency: "usd" });
  return (await getGiftBySession(db, sessionId))!;
}

describe("POST /v1/gift-credits/redeem", () => {
  test("happy path credits the caller's project", async () => {
    const [p] = await db.insert(projects).values({ name: `redeem-${crypto.randomUUID()}` } as never).returning();
    const gift = await seedGift(2000);
    const app = await appFor(p.id);
    const res = await app.request("/redeem", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: gift.code }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.redeemed).toBe(true);
    expect(body.credits_added).toBe(20000);
    expect(body.gift.amount_minor).toBe(2000);
  });

  test("validation guides on missing code", async () => {
    const [p] = await db.insert(projects).values({ name: `redeem-${crypto.randomUUID()}` } as never).returning();
    const app = await appFor(p.id);
    const res = await app.request("/redeem", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});
