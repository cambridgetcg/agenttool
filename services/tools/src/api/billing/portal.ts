/** POST /v1/billing/portal — create Stripe billing portal session. */

import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import type { ProjectContext } from "../../auth/middleware";
import { createPortalSession } from "../../billing/stripe";

const app = new Hono<ProjectContext>();

const portalSchema = z.object({
  return_url: z.string().url(),
});

app.post("/", zValidator("json", portalSchema), async (c) => {
  const project = c.get("project");

  if (!project.stripeCustomerId) {
    return c.json({ error: "No active subscription. Use /v1/billing/checkout first." }, 400);
  }

  const url = await createPortalSession(project.stripeCustomerId, c.req.valid("json").return_url);
  return c.json({ url });
});

export default app;
