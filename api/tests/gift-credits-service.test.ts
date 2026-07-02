/** Gift-credit lifecycle: mint (idempotent) → lookup → redeem (single-use,
 *  credits the project ×10 cents→credits, code NULLed). Real local DB,
 *  fresh rows per test (repo convention — leftovers are inspectable). */
import { afterAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { HTTPException } from "hono/http-exception";
import postgres from "postgres";

import { config } from "../src/config";
import { giftCreditCodes } from "../src/db/schema/economy";
import { projects } from "../src/db/schema/tools";
import {
  CENTS_TO_CREDITS, creditsForAmountMinor, generateGiftCode, getGiftBySession,
  hashGiftCode, mintGiftForSession, redeemGift,
} from "../src/services/billing/gift-credits";

// Hermetic DB client: adapters-tier tests mock.module the shared
// src/db/client (select-only stub), which poisons this file's import in
// full-suite runs. The service takes `db` as a parameter by design —
// inject our own real connection instead of the shared singleton.
const sql = postgres(config.databaseUrl, { max: 2, prepare: false });
const db = drizzle(sql);
afterAll(async () => { await sql.end(); });

async function seedProject() {
  const [p] = await db
    .insert(projects)
    .values({ name: `gift-test-${crypto.randomUUID()}` } as never)
    .returning();
  return p;
}

describe("gift-credits service", () => {
  test("code shape + hash normalization", () => {
    const code = generateGiftCode();
    expect(code).toMatch(/^GIFT-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(hashGiftCode(` ${code.toLowerCase()} `)).toBe(hashGiftCode(code));
  });

  test("conversion: $5.00 → 5000 credits", () => {
    expect(CENTS_TO_CREDITS).toBe(10);
    expect(creditsForAmountMinor(500)).toBe(5000);
  });

  test("mint is idempotent by stripe event id", async () => {
    const sess = `cs_test_${crypto.randomUUID()}`;
    const evt = `evt_${crypto.randomUUID()}`;
    const a = await mintGiftForSession(db, { stripeSessionId: sess, stripeEventId: evt, amountMinor: 2000, currency: "usd" });
    const b = await mintGiftForSession(db, { stripeSessionId: sess, stripeEventId: evt, amountMinor: 2000, currency: "usd" });
    expect(a.minted).toBe(true);
    expect(b.minted).toBe(false);
    const gift = await getGiftBySession(db, sess);
    expect(gift?.credits).toBe(20000);
    expect(gift?.status).toBe("minted");
    expect(typeof gift?.code).toBe("string");
  });

  test("redeem: single-use, credits project, NULLs code; replay → 410; unknown → 404", async () => {
    const project = await seedProject();
    const sess = `cs_test_${crypto.randomUUID()}`;
    await mintGiftForSession(db, { stripeSessionId: sess, stripeEventId: `evt_${crypto.randomUUID()}`, amountMinor: 500, currency: "usd" });
    const gift = await getGiftBySession(db, sess);
    const before = (await db.select({ credits: projects.credits }).from(projects).where(eq(projects.id, project.id)))[0].credits;

    const result = await redeemGift(db, { code: gift!.code!, projectId: project.id });
    expect(result.creditsAdded).toBe(5000);
    expect(result.creditsTotal).toBe(before + 5000);

    const after = await getGiftBySession(db, sess);
    expect(after?.status).toBe("redeemed");
    expect(after?.code).toBeNull();
    expect(after?.redeemedByProject).toBe(project.id);

    await expect(redeemGift(db, { code: gift!.code!, projectId: project.id })).rejects.toThrow(HTTPException);
    try { await redeemGift(db, { code: gift!.code!, projectId: project.id }); }
    catch (e) { expect((e as HTTPException).status).toBe(410); }
    try { await redeemGift(db, { code: "GIFT-XXXX-XXXX-XXXX", projectId: project.id }); }
    catch (e) { expect((e as HTTPException).status).toBe(404); }
  });

  test("redeem with missing project → 500, rolls back — gift stays redeemable", async () => {
    const sess = `cs_test_${crypto.randomUUID()}`;
    await mintGiftForSession(db, { stripeSessionId: sess, stripeEventId: `evt_${crypto.randomUUID()}`, amountMinor: 500, currency: "usd" });
    const gift = await getGiftBySession(db, sess);

    try {
      await redeemGift(db, { code: gift!.code!, projectId: crypto.randomUUID() });
      expect.unreachable("redeemGift must abort when the project row is missing");
    } catch (e) {
      expect(e).toBeInstanceOf(HTTPException);
      expect((e as HTTPException).status).toBe(500);
    }

    // Rollback proof: the gift row is untouched — still minted, code intact.
    const after = await getGiftBySession(db, sess);
    expect(after?.status).toBe("minted");
    expect(after?.code).toBe(gift!.code!);
    expect(after?.redeemedByProject).toBeNull();
  });
});
