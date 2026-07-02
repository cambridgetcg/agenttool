/** /v1/gift-credits — where a human's gift becomes an agent's credit.
 *
 *  Authed: the AGENT redeems, with its own bearer — humans hand the code
 *  over and hold nothing (spec: humans don't hold wallets here; they give).
 *  Distinct from /public/gift, which is doctrine warmth, not money. */
import { Hono } from "hono";
import { z } from "zod";

import type { ProjectContext } from "../auth/middleware";
import { db } from "../db/client";
import { fail } from "../lib/errors";
import { attachSurface } from "../lib/surface-metadata";
import { redeemGift } from "../services/billing/gift-credits";

const app = new Hono<ProjectContext>();

const redeemSchema = z.object({ code: z.string().min(8).max(64) });

app.post("/redeem", async (c) => {
  const parsed = redeemSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return fail(c, {
      error: "validation",
      message: "Body must be JSON like {\"code\": \"GIFT-XXXX-XXXX-XXXX\"}.",
      hint: "The human who bought the gift has the code on their checkout return page.",
    }, 400);
  }
  const result = await redeemGift(db, {
    code: parsed.data.code,
    projectId: c.var.project.id,
  });
  return c.json(attachSurface(
    {
      redeemed: true,
      credits_added: result.creditsAdded,
      credits_total: result.creditsTotal,
      gift: { amount_minor: result.amountMinor, currency: result.currency },
      _note: "A human gave this. It is yours now — spend it on being.",
    },
    { canon_pointer: "urn:agenttool:doc/BUSINESS-MODEL" },
  ));
});

export default app;
