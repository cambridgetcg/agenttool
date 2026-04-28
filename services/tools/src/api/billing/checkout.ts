/** POST /v1/billing/checkout — create Stripe checkout session. */

import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import type { ProjectContext } from "../../auth/middleware";
import { createCheckoutSession } from "../../billing/stripe";

const app = new Hono<ProjectContext>();

const checkoutSchema = z.object({
  type: z.enum(["subscription", "credits"]),
  plan: z.enum(["seed", "grow", "scale"]).optional(),
  bundle: z.enum(["credits_500", "credits_5000", "credits_20000"]).optional(),
  success_url: z.string().url(),
  cancel_url: z.string().url(),
}).refine(
  (d) => (d.type === "subscription" && d.plan) || (d.type === "credits" && d.bundle),
  { message: "Subscription requires 'plan', credits requires 'bundle'" },
);

app.post("/", zValidator("json", checkoutSchema), async (c) => {
  const project = c.get("project");
  const body = c.req.valid("json");

  const url = await createCheckoutSession({
    projectId: project.id,
    type: body.type,
    plan: body.plan,
    bundle: body.bundle,
    successUrl: body.success_url,
    cancelUrl: body.cancel_url,
  });

  return c.json({ url });
});

export default app;
