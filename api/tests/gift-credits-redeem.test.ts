/** Redeem: the moment the human's gift becomes the agent's credit. */
import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import type { ProjectContext } from "../src/auth/middleware";
import giftCredits from "../src/routes/gift-credits";
import { db } from "../src/db/client";
import { isGuidedErrorCause } from "../src/lib/errors";
import { projects } from "../src/db/schema/tools";
import { getGiftBySession, mintGiftForSession } from "../src/services/billing/gift-credits";

async function appFor(projectId: string) {
  const app = new Hono<ProjectContext>();
  app.use("*", async (c, next) => {
    c.set("project", { id: projectId } as never);
    await next();
  });
  app.route("/", giftCredits);
  // Mirror production's central handler (src/index.ts app.onError): lift the
  // GuidedErrorBody off HTTPException.cause so the service's guided 404/410
  // refusals are proven as HTTP JSON bodies, not just as thrown exceptions.
  app.onError((err, c) => {
    if (err instanceof HTTPException && isGuidedErrorCause(err.cause)) {
      return c.json(err.cause, err.status);
    }
    throw err;
  });
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

  test("unknown code → guided 404 body over HTTP", async () => {
    const [p] = await db.insert(projects).values({ name: `redeem-${crypto.randomUUID()}` } as never).returning();
    const app = await appFor(p.id);
    const res = await app.request("/redeem", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "GIFT-NOPE-NOPE-NOPE" }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("gift_not_found");
    expect(typeof body.hint).toBe("string");
  });

  test("second redemption → guided 410 body over HTTP", async () => {
    const [p] = await db.insert(projects).values({ name: `redeem-${crypto.randomUUID()}` } as never).returning();
    const gift = await seedGift(500);
    const app = await appFor(p.id);
    const post = () => app.request("/redeem", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: gift.code }),
    });
    expect((await post()).status).toBe(200);
    const replay = await post();
    expect(replay.status).toBe(410);
    const body = await replay.json();
    expect(body.error).toBe("gift_already_redeemed");
    expect(typeof body.hint).toBe("string");
  });
});
