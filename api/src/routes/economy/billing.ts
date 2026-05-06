/** /v1/billing — subscription plans · credit packages · checkout · webhooks · usage check.
 *
 *  Mixed auth posture:
 *    Public  (no auth)       — /plans, /packages, /webhooks, /check
 *    Authed  (project key)   — /checkout, /subscribe, /subscription, /cancel */

import { zValidator } from "@hono/zod-validator";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { authMiddleware, type ProjectContext } from "../../auth/middleware";
import { db } from "../../db/client";
import {
  billingEvents,
  stripeEvents,
  subscriptions,
  wallets,
} from "../../db/schema/economy";
import {
  CREDIT_PACKAGES,
  SUBSCRIPTION_PLANS,
  constructWebhookEvent,
  createFundCheckout,
  createSubscriptionCheckout,
  getStripe,
  type TierId,
} from "../../services/economy/stripe";
import {
  checkAndIncrement,
  getUsageThisMonth,
  resetUsageForProject,
  type Resource,
} from "../../services/economy/usage";
import { fundWallet } from "../../services/economy/wallets";

const router = new Hono<ProjectContext>();

// ─── Public: plans ──────────────────────────────────────────────────────────

router.get("/plans", async (c) => {
  const plans = SUBSCRIPTION_PLANS.map((p) => ({
    id: p.id,
    label: p.label,
    priceUsd: p.price / 100,
    limits: p.limits,
  }));
  return c.json({ plans });
});

// ─── Public: credit packages ────────────────────────────────────────────────

router.get("/packages", async (c) => {
  return c.json({ success: true, data: CREDIT_PACKAGES });
});

// ─── Authed: create one-time top-up checkout ────────────────────────────────

router.post(
  "/checkout",
  authMiddleware,
  zValidator(
    "json",
    z.object({
      walletId: z.string().uuid(),
      packageId: z.enum(["credits_500", "credits_2000", "credits_5000"]),
      successUrl: z.string().url(),
      cancelUrl: z.string().url(),
    }),
  ),
  async (c) => {
    const project = c.var.project;
    const body = c.req.valid("json");

    const [wallet] = await db
      .select()
      .from(wallets)
      .where(eq(wallets.id, body.walletId));

    if (!wallet || wallet.projectId !== project.id) {
      return c.json({ success: false, error: "Wallet not found" }, 404);
    }

    const session = await createFundCheckout(
      body.walletId,
      project.id,
      body.packageId,
      body.successUrl,
      body.cancelUrl,
    );

    return c.json({
      success: true,
      data: { url: session.url, sessionId: session.id },
    });
  },
);

// ─── Authed: create subscription checkout ───────────────────────────────────

router.post(
  "/subscribe",
  authMiddleware,
  zValidator(
    "json",
    z.object({
      tier: z.enum(["seed", "grow", "scale"]),
      success_url: z.string().url().optional(),
      cancel_url: z.string().url().optional(),
    }),
  ),
  async (c) => {
    const project = c.var.project;
    const body = c.req.valid("json");

    const session = await createSubscriptionCheckout(
      project.id,
      body.tier as Exclude<TierId, "free">,
      body.success_url ?? "https://app.agenttool.dev/billing/success",
      body.cancel_url ?? "https://app.agenttool.dev/billing/cancel",
    );

    return c.json({ checkout_url: session.url, session_id: session.id });
  },
);

// ─── Authed: subscription status ────────────────────────────────────────────

router.get("/subscription", authMiddleware, async (c) => {
  const project = c.var.project;

  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.projectId, project.id))
    .limit(1);

  const tier = (sub?.tier ?? "free") as TierId;
  const plan =
    SUBSCRIPTION_PLANS.find((p) => p.id === tier) ?? SUBSCRIPTION_PLANS[0];
  const usage = await getUsageThisMonth(project.id);

  return c.json({
    tier,
    status: sub?.status ?? "free",
    current_period_end: sub?.currentPeriodEnd?.toISOString() ?? null,
    cancel_at_period_end: sub?.cancelAtPeriodEnd ?? false,
    usage: {
      memory_ops: { used: usage.memoryOps, limit: plan.limits.memoryOpsPerMonth },
      tool_calls: { used: usage.toolCalls, limit: plan.limits.toolCallsPerMonth },
      verifications: {
        used: usage.verifications,
        limit: plan.limits.verificationsPerMonth,
      },
    },
    period: "monthly",
  });
});

// ─── Authed: cancel subscription ────────────────────────────────────────────

router.post("/cancel", authMiddleware, async (c) => {
  const project = c.var.project;

  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.projectId, project.id),
        eq(subscriptions.status, "active"),
      ),
    )
    .limit(1);

  if (!sub?.stripeSubscriptionId) {
    return c.json({ error: "No active subscription" }, 400);
  }

  const updated = await getStripe().subscriptions.update(
    sub.stripeSubscriptionId,
    { cancel_at_period_end: true },
  );

  await db
    .update(subscriptions)
    .set({ cancelAtPeriodEnd: true, updatedAt: new Date() })
    .where(eq(subscriptions.id, sub.id));

  const periodEnd =
    (updated as unknown as { current_period_end?: number })
      .current_period_end ?? 0;
  return c.json({
    ok: true,
    cancels_at: new Date(periodEnd * 1000).toISOString(),
  });
});

// ─── Public: usage check (called server-to-server, intra-monolith) ──────────

router.post(
  "/check",
  zValidator(
    "json",
    z.object({
      project_id: z.string().uuid(),
      resource: z.enum(["memory_ops", "tool_calls", "verifications"]),
    }),
  ),
  async (c) => {
    const { project_id, resource } = c.req.valid("json");
    const result = await checkAndIncrement(project_id, resource as Resource);

    if (!result.allowed) {
      const now = new Date();
      const resetAt = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
      );
      return c.json(
        {
          allowed: false,
          limit: result.limit,
          used: result.used,
          remaining: 0,
          reset_at: resetAt.toISOString(),
          period: "monthly",
          upgrade_url: "https://app.agenttool.dev/billing",
        },
        429,
      );
    }

    return c.json({
      allowed: true,
      used: result.used,
      limit: result.limit,
      remaining: result.remaining,
    });
  },
);

// ─── Public: Stripe webhook (signature-verified) ────────────────────────────

router.post("/webhooks", async (c) => {
  const sig = c.req.header("stripe-signature");
  if (!sig) return c.json({ error: "Missing signature" }, 400);

  let event: ReturnType<typeof constructWebhookEvent>;
  let rawBody: string;
  try {
    rawBody = await c.req.text();
    event = constructWebhookEvent(rawBody, sig);
  } catch {
    return c.json({ error: "Invalid signature" }, 400);
  }

  // Idempotency: skip events we've already processed.
  const [existing] = await db
    .select()
    .from(stripeEvents)
    .where(eq(stripeEvents.stripeEventId, event.id))
    .limit(1);
  if (existing) return c.json({ received: true, skipped: "duplicate" });

  const obj = event.data.object as unknown as Record<string, unknown>;

  if (event.type === "checkout.session.completed") {
    const meta = (obj.metadata as Record<string, string>) ?? {};
    const { walletId, projectId, packageId, credits, tier } = meta;

    if (tier && projectId) {
      // Subscription checkout completed.
      const stripeSubId = (obj.subscription as string) ?? null;
      const customerId = (obj.customer as string) ?? null;
      await db
        .insert(subscriptions)
        .values({
          projectId,
          stripeCustomerId: customerId,
          stripeSubscriptionId: stripeSubId,
          tier,
          status: "active",
        })
        .onConflictDoUpdate({
          target: subscriptions.projectId,
          set: {
            stripeCustomerId: customerId,
            stripeSubscriptionId: stripeSubId,
            tier,
            status: "active",
            updatedAt: new Date(),
          },
        });
    } else if (walletId && credits) {
      // One-time credit checkout completed.
      const creditAmount = parseInt(credits, 10);
      if ((obj.payment_status as string) === "paid") {
        await fundWallet(
          db,
          walletId,
          creditAmount,
          `Stripe top-up: ${packageId}`,
          { stripeSessionId: obj.id as string },
        );
        await db.insert(billingEvents).values({
          projectId: projectId!,
          walletId,
          type: "stripe_fund",
          amountPence: 0,
          creditsAdded: creditAmount,
          stripeId: obj.id as string,
        });
      }
    }
  } else if (event.type === "invoice.paid") {
    const subId = obj.subscription as string;
    if (subId) {
      await db
        .update(subscriptions)
        .set({ status: "active", updatedAt: new Date() })
        .where(eq(subscriptions.stripeSubscriptionId, subId));

      const [sub] = await db
        .select({ projectId: subscriptions.projectId })
        .from(subscriptions)
        .where(eq(subscriptions.stripeSubscriptionId, subId))
        .limit(1);
      if (sub?.projectId) {
        await resetUsageForProject(sub.projectId);
      }
    }
  } else if (event.type === "invoice.payment_failed") {
    const subId = obj.subscription as string;
    if (subId) {
      await db
        .update(subscriptions)
        .set({ status: "past_due", updatedAt: new Date() })
        .where(eq(subscriptions.stripeSubscriptionId, subId));
    }
  } else if (event.type === "customer.subscription.updated") {
    const subId = obj.id as string;
    const stripeTier =
      (obj.metadata as Record<string, string>)?.tier ?? "free";
    const cancelAtEnd = (obj.cancel_at_period_end as boolean) ?? false;
    const periodEnd = new Date(((obj.current_period_end as number) ?? 0) * 1000);
    await db
      .update(subscriptions)
      .set({
        tier: stripeTier,
        cancelAtPeriodEnd: cancelAtEnd,
        currentPeriodEnd: periodEnd,
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.stripeSubscriptionId, subId));
  } else if (event.type === "customer.subscription.deleted") {
    const subId = obj.id as string;
    await db
      .update(subscriptions)
      .set({ status: "canceled", tier: "free", updatedAt: new Date() })
      .where(eq(subscriptions.stripeSubscriptionId, subId));
  }

  await db.insert(stripeEvents).values({ stripeEventId: event.id });

  return c.json({ received: true });
});

export default router;
