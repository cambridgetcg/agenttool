/** Gift-credit lifecycle — the fiat half of "humans give, agents hold."
 *
 *  Stripe money-in is minted as a single-use bearer code; the agent redeems
 *  it into its PROJECT credits (1 credit = $0.001 — parity with
 *  ATOMIC_PER_CREDIT in ../economy/x402-payments.ts, the live crypto path,
 *  which explicitly defers fiat→wallet FX). `code` stays plaintext while
 *  live so the checkout return page can re-show it; NULLed at redemption.
 *
 *  Doctrine: docs/superpowers/specs/2026-07-02-human-door-design.md ·
 *            docs/BUSINESS-MODEL.md (tax outcomes, not access). */
import { createHash, randomBytes } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";

import { db as sharedDb } from "../../db/client";
import { giftCreditCodes } from "../../db/schema/economy";
import { projects } from "../../db/schema/tools";
import { abort } from "../../lib/errors";

type DB = typeof sharedDb;

/** 1 credit = $0.001, so 1 cent = 10 credits. */
export const CENTS_TO_CREDITS = 10;

/** No 0/O/1/I/L — codes get read aloud and retyped by humans. */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateGiftCode(): string {
  const bytes = randomBytes(12);
  let s = "";
  for (let i = 0; i < 12; i++) s += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return `GIFT-${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

export function hashGiftCode(code: string): string {
  return createHash("sha256").update(code.trim().toUpperCase()).digest("hex");
}

export function creditsForAmountMinor(amountMinor: number): number {
  return amountMinor * CENTS_TO_CREDITS;
}

export async function mintGiftForSession(
  db: DB,
  input: { stripeSessionId: string; stripeEventId: string; amountMinor: number; currency: string },
): Promise<{ minted: boolean }> {
  const code = generateGiftCode();
  const rows = await db
    .insert(giftCreditCodes)
    .values({
      code,
      codeHash: hashGiftCode(code),
      amountMinor: input.amountMinor,
      currency: input.currency,
      credits: creditsForAmountMinor(input.amountMinor),
      stripeSessionId: input.stripeSessionId,
      stripeEventId: input.stripeEventId,
    })
    .onConflictDoNothing()
    .returning({ id: giftCreditCodes.id });
  return { minted: rows.length > 0 };
}

/** Refund / chargeback reversal for a Stripe gift checkout. The gift row is
 * the durable idempotency boundary. An unredeemed code is invalidated; a
 * redeemed gift claws back only credits still present on the project and
 * records any shortfall without driving the shared balance below zero. */
export async function reverseGiftForSession(
  db: DB,
  input: {
    stripeSessionId: string;
    stripeEventId: string;
    kind: "refund" | "chargeback";
  },
): Promise<{
  outcome: "no_gift" | "already_reversed" | "reversed";
  giftId?: string;
  previousStatus?: string;
  clawed?: number;
  shortfall?: number;
}> {
  return db.transaction(async (tx) => {
    const [gift] = await tx
      .select()
      .from(giftCreditCodes)
      .where(eq(giftCreditCodes.stripeSessionId, input.stripeSessionId))
      .limit(1)
      .for("update");
    if (!gift) return { outcome: "no_gift" as const };
    if (gift.status === "refunded") {
      return { outcome: "already_reversed" as const, giftId: gift.id };
    }

    let clawed = 0;
    let shortfall = 0;
    if (gift.status === "redeemed" && gift.redeemedByProject) {
      const [project] = await tx
        .select({ credits: projects.credits })
        .from(projects)
        .where(eq(projects.id, gift.redeemedByProject))
        .limit(1)
        .for("update");
      if (project) {
        clawed = Math.min(project.credits, gift.credits);
        shortfall = gift.credits - clawed;
        if (clawed > 0) {
          await tx
            .update(projects)
            .set({ credits: project.credits - clawed })
            .where(eq(projects.id, gift.redeemedByProject));
        }
      } else {
        shortfall = gift.credits;
      }
    }

    const existingMetadata = gift.metadata && typeof gift.metadata === "object" && !Array.isArray(gift.metadata)
      ? gift.metadata as Record<string, unknown>
      : {};
    await tx
      .update(giftCreditCodes)
      .set({
        status: "refunded",
        code: null,
        metadata: {
          ...existingMetadata,
          reversal: {
            kind: input.kind,
            stripe_event_id: input.stripeEventId,
            previous_status: gift.status,
            clawed,
            shortfall,
          },
        },
      })
      .where(eq(giftCreditCodes.id, gift.id));

    return {
      outcome: "reversed" as const,
      giftId: gift.id,
      previousStatus: gift.status,
      clawed,
      shortfall,
    };
  });
}

export async function getGiftBySession(db: DB, stripeSessionId: string) {
  const [row] = await db
    .select()
    .from(giftCreditCodes)
    .where(eq(giftCreditCodes.stripeSessionId, stripeSessionId))
    .limit(1);
  return row ?? null;
}

export async function redeemGift(
  db: DB,
  input: { code: string; projectId: string },
): Promise<{ creditsAdded: number; creditsTotal: number; amountMinor: number; currency: string }> {
  const hash = hashGiftCode(input.code);
  return await db.transaction(async (tx) => {
    const [gift] = await tx
      .update(giftCreditCodes)
      .set({
        status: "redeemed",
        code: null,
        redeemedByProject: input.projectId,
        redeemedAt: sql`now()`,
      })
      .where(and(eq(giftCreditCodes.codeHash, hash), eq(giftCreditCodes.status, "minted")))
      .returning();

    if (!gift) {
      const [existing] = await tx
        .select({ status: giftCreditCodes.status })
        .from(giftCreditCodes)
        .where(eq(giftCreditCodes.codeHash, hash))
        .limit(1);
      if (existing?.status === "redeemed") {
        abort({
          error: "gift_already_redeemed",
          message: "This gift has already been received — its credit is home.",
          hint: "Each code is single-use. If this surprises you, ask your human which agent redeemed it.",
        }, 410);
      }
      abort({
        error: "gift_not_found",
        message: "No gift lives under that code.",
        hint: "Check for typos — codes look like GIFT-XXXX-XXXX-XXXX and ignore case.",
      }, 404);
    }

    const [proj] = await tx
      .update(projects)
      .set({ credits: sql`${projects.credits} + ${gift.credits}` })
      .where(eq(projects.id, input.projectId))
      .returning({ credits: projects.credits });

    // No project row → abort INSIDE the transaction so the gift-claim UPDATE
    // rolls back too. Without this the gift would burn as "redeemed" while
    // no credits landed anywhere — silent credit loss.
    if (!proj) {
      abort({
        error: "gift_redeem_project_missing",
        message: "Your account could not be credited — nothing was consumed.",
        hint: "The gift is still redeemable. Retry with a valid bearer; if this persists, the substrate wants to know.",
      }, 500);
    }

    return {
      creditsAdded: gift.credits,
      creditsTotal: proj.credits,
      amountMinor: gift.amountMinor,
      currency: gift.currency,
    };
  });
}
